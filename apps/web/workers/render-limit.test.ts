import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
const { render } = vi.hoisted(() => ({ render: vi.fn(async () => new Response('page')) }));
vi.mock('react-router', () => ({ createRequestHandler: () => render }));
vi.mock('./release-data', () => ({
  usesRegistry: async () => true,
  releaseData: async () => ({
    releaseId: 'test',
    dataBase: '/data/',
    load: async () => null,
    file: async () => null,
  }),
  candidateReleaseId: () => null,
  noRegistry: () => false,
}));
import app from './app';

const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
const envWith = (limit: (o: { key: string }) => Promise<{ success: boolean }>) =>
  ({
    ENVIRONMENT: 'production',
    RELEASE_RATE_LIMITER: { limit },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  }) as unknown as Env;
const site = (path: string, init?: RequestInit) =>
  new Request('https://budget.example' + path, {
    ...init,
    headers: { 'CF-Connecting-IP': '192.0.2.1' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  render.mockClear();
});

it('charges every uncached render to the client, under its own key, and answers 429 when exhausted', async () => {
  const limit = vi.fn(async () => ({ success: false }));
  for (const q of ['a', 'b']) {
    const res = await app.fetch(site('/tarsene?q=' + q), envWith(limit), ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(render).not.toHaveBeenCalled();
  expect(limit).toHaveBeenCalledWith({ key: 'render:192.0.2.1' });
  const ok = vi.fn(async () => ({ success: true }));
  expect((await app.fetch(site('/tarsene?q=c'), envWith(ok), ctx)).status).toBe(200);
  expect(render).toHaveBeenCalledTimes(1);
});

it('draws two simultaneous identical misses once and charges the limiter once', async () => {
  const store = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: async (key: Request) => store.get(key.url)?.clone(),
      put: async (key: Request, res: Response) => {
        store.set(key.url, res);
      },
    },
  });
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  render.mockImplementationOnce(async () => {
    await gate;
    return new Response('page');
  });
  const limit = vi.fn(async () => ({ success: true }));
  const first = app.fetch(site('/razhodi'), envWith(limit), ctx);
  const second = app.fetch(site('/razhodi'), envWith(limit), ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));
  open();
  const answers = await Promise.all([first, second]);
  expect(answers.map((res) => res.status)).toEqual([200, 200]);
  expect(answers.map((res) => res.headers.get('X-Screen-Cache')).sort()).toEqual(['HIT', 'MISS']);
  expect(render).toHaveBeenCalledTimes(1);
  expect(limit).toHaveBeenCalledTimes(1);
});

it('lets a waiting identical miss through when the first one was refused', async () => {
  vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } });
  let calls = 0;
  const limit = vi.fn(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { success: calls > 1 };
  });
  const answers = await Promise.all([
    app.fetch(site('/razhodi'), envWith(limit), ctx),
    app.fetch(site('/razhodi'), envWith(limit), ctx),
  ]);
  expect(answers.map((res) => res.status)).toEqual([429, 200]);
  expect(render).toHaveBeenCalledTimes(1);
});

it('keeps the pages up when the limiter binding is missing or fails', async () => {
  const failing = vi.fn(async () => {
    throw new Error('limiter down');
  });
  expect((await app.fetch(site('/razhodi'), envWith(failing), ctx)).status).toBe(200);
  const missing = { ...envWith(failing), RELEASE_RATE_LIMITER: undefined } as unknown as Env;
  expect((await app.fetch(site('/razhodi'), missing, ctx)).status).toBe(200);
});

it('answers HEAD from the GET cache entry without rendering or charging the limiter', async () => {
  const limit = vi.fn(async () => ({ success: false }));
  const put = vi.fn(async () => {});
  vi.stubGlobal('caches', { default: { match: async () => new Response('warm page'), put } });
  const get = await app.fetch(site('/razhodi'), envWith(limit), ctx);
  expect(get.headers.get('X-Screen-Cache')).toBe('HIT');
  for (let i = 0; i < 2; i++) {
    const head = await app.fetch(site('/razhodi', { method: 'HEAD' }), envWith(limit), ctx);
    expect(head.status).toBe(200);
    expect(head.headers.get('X-Screen-Cache')).toBe('HIT');
    expect(await head.text()).toBe('');
  }
  expect(render).not.toHaveBeenCalled();
  expect(limit).not.toHaveBeenCalled();
});

it('never stores a HEAD render in the screen cache', async () => {
  const put = vi.fn(async () => {});
  vi.stubGlobal('caches', { default: { match: async () => undefined, put } });
  const ok = vi.fn(async () => ({ success: true }));
  const head = await app.fetch(site('/razhodi', { method: 'HEAD' }), envWith(ok), ctx);
  expect(head.status).toBe(200);
  expect(render).toHaveBeenCalledTimes(1);
  expect(put).not.toHaveBeenCalled();
});

it('the service worker keeps neither operator pages nor no-store answers', async () => {
  const events: Record<string, (e: unknown) => void> = {};
  const records = new Map<string, Response>();
  let online = true;
  let headers: Record<string, string> = {};
  const self = {
    registration: { scope: 'https://budget.example/' },
    location: { origin: 'https://budget.example' },
    addEventListener: (name: string, fn: (e: unknown) => void) => (events[name] = fn),
  };
  const caches = {
    open: async () => ({ put: async (req: Request, res: Response) => records.set(req.url, res) }),
    match: async (req: Request | string) =>
      records.get(typeof req === 'string' ? req : req.url)?.clone(),
  };
  const fetch = async () => {
    if (!online) throw new Error('offline');
    const res = new Response('body', { headers });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self,
    caches,
    URL,
    Request,
    fetch,
  });
  const visit = async (path: string) => {
    let response: Promise<Response> | undefined;
    events.fetch({
      request: new Request('https://budget.example' + path),
      respondWith: (p: Promise<Response>) => (response = p),
    });
    if (response) await response;
    await new Promise((r) => setTimeout(r, 0));
    return response;
  };
  expect(await visit('/admin/operations/00000000-0000-0000-0000-000000000000')).toBeUndefined();
  headers = { 'Cache-Control': 'no-store' };
  await visit('/private');
  headers = { 'Cache-Control': 'public, max-age=0, must-revalidate' };
  await visit('/razhodi');
  expect([...records.keys()]).toEqual(['https://budget.example/razhodi']);
  online = false;
  expect(await (await visit('/razhodi'))?.text()).toBe('body');
});
