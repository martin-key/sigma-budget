import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
vi.mock('react-router', () => ({ createRequestHandler: () => async () => new Response('page') }));
vi.mock('./release-data', () => ({
  releaseData: vi.fn(async () => ({
    releaseId: 'test',
    dataBase: '/data/',
    load: async () => null,
  })),
}));
import app from './app';

it('finalizes actual dispatch early returns, resource fallbacks, unknown paths and exceptions', async () => {
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  const env = {
    ENVIRONMENT: 'local',
    ASSETS: { fetch: async () => new Response('asset') },
  } as unknown as Env;
  for (const [path, method, status] of [
    ['/', 'POST', 405],
    ['/admin/operations', 'GET', 404],
    ['/api/releases', 'GET', 404],
    ['/api/releases/%ZZ', 'GET', 400],
    ['/data/core.json', 'GET', 200],
    ['/missing', 'GET', 200],
  ] as const) {
    const res = await app.fetch(new Request('https://budget.example' + path, { method }), env, ctx);
    expect(res.status, path).toBe(status);
    expect(res.headers.get('X-Robots-Tag'), path).toBe('noindex');
    expect(res.headers.get('X-Content-Type-Options'), path).toBe('nosniff');
    expect(res.headers.has('Content-Security-Policy'), path).toBe(true);
  }
  const failure = await app.fetch(
    new Request('https://budget.example/data/core.json'),
    {
      ...env,
      ASSETS: {
        fetch: async () => {
          throw new Error('private details');
        },
      },
    } as unknown as Env,
    ctx,
  );
  expect(failure.status).toBe(503);
  expect(failure.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(await failure.text()).not.toContain('private details');
});

it('rate-limits the actual public API before asset reads', async () => {
  const env = {
    ENVIRONMENT: 'production',
    RELEASE_RATE_LIMITER: { limit: async () => ({ success: false }) },
  } as unknown as Env;
  const res = await app.fetch(
    new Request('https://budget.example/api/releases'),
    env,
    {} as ExecutionContext,
  );
  expect(res.status).toBe(429);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
});

it('does not charge bundled static files to the release read limiter', async () => {
  const limit = vi.fn(async () => ({ success: false }));
  const env = {
    ENVIRONMENT: 'production',
    ASSETS: { fetch: async () => new Response('bundled') },
    RELEASE_RATE_LIMITER: { limit },
  } as unknown as Env;
  const res = await app.fetch(
    new Request('https://budget.example/data/core.json'),
    env,
    {} as ExecutionContext,
  );
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('bundled');
  expect(limit).not.toHaveBeenCalled();
});

it.each(['manifest.json', 'data/core.json'])(
  'does not limit packaged release %s, with or without a binding',
  async (file) => {
    const path = `/data/releases/${'a'.repeat(64)}/${file}`;
    for (const binding of [undefined, { limit: vi.fn(async () => ({ success: false })) }]) {
      const env = {
        ENVIRONMENT: 'production',
        RELEASE_RATE_LIMITER: binding,
        ASSETS: { fetch: async () => new Response('packaged') },
      } as unknown as Env;
      for (let i = 0; i < 125; i++) {
        const res = await app.fetch(
          new Request('https://budget.example' + path),
          env,
          {} as ExecutionContext,
        );
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('packaged');
      }
      if (binding) expect(binding.limit).not.toHaveBeenCalled();
    }
  },
);
it('unknown packaged files still charge the limiter before any API read', async () => {
  const limit = vi.fn(async () => ({ success: false }));
  const env = {
    ENVIRONMENT: 'production',
    RELEASE_RATE_LIMITER: { limit },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  } as unknown as Env;
  const res = await app.fetch(
    new Request(`https://budget.example/data/releases/${'a'.repeat(64)}/unknown.json`),
    env,
    {} as ExecutionContext,
  );
  expect(res.status).toBe(429);
  expect(limit).toHaveBeenCalledOnce();
});

it('answers current with the release published in the build for GET and HEAD', async () => {
  const bytes = readFileSync(
    new URL('../../../data/release/releases/current.json', import.meta.url),
  );
  const pointer = JSON.parse(bytes.toString());
  const env = {
    ENVIRONMENT: 'local',
    ASSETS: { fetch: async () => new Response(bytes) },
  } as unknown as Env;
  for (const method of ['GET', 'HEAD']) {
    const res = await app.fetch(
      new Request('https://budget.example/api/releases/current', { method }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Release-Id')).toBe(pointer.release_id);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    if (method === 'GET')
      expect(await res.json()).toEqual({
        ...pointer,
        manifest: `/data/releases/${pointer.release_id}/manifest.json`,
      });
    else expect(await res.text()).toBe('');
  }
});

it('serves current manifest outputs from packaged bytes with HEAD and conditional reads', async () => {
  const id = 'b'.repeat(64),
    digest = 'c'.repeat(64);
  const fetch = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === '/data/releases/current.json') return Response.json({ release_id: id });
    if (path === `/data/releases/${id}/manifest.json`)
      return Response.json({
        outputs: [{ path: 'data/core.json', sha256: digest }],
        inputs: [{ path: 'data/originals/source.pdf' }],
      });
    if (path === '/data/core.json')
      return new Response(request.method === 'HEAD' ? null : 'published bytes', {
        headers: { 'Content-Type': 'application/json', ETag: '"asset-tag"' },
      });
    return new Response(null, { status: 404 });
  });
  const env = { ASSETS: { fetch }, ENVIRONMENT: 'local' } as unknown as Env;
  const visit = (path: string, init?: RequestInit) =>
    app.fetch(new Request('https://budget.example' + path, init), env, {} as ExecutionContext);
  const path = `/data/releases/${id}/data/core.json`;
  const res = await visit(path);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('published bytes');
  expect(res.headers.get('X-Release-Id')).toBe(id);
  expect(res.headers.get('ETag')).toBe(`"${digest}"`);
  expect(res.headers.get('Cache-Control')).toContain('immutable');
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  const head = await visit(path, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect((await visit(path, { headers: { 'If-None-Match': `"${digest}"` } })).status).toBe(304);
  expect((await visit(`/data/releases/${id}/data/%ZZ`)).status).toBe(400);
  for (const unknown of [
    `/data/releases/${'a'.repeat(64)}/data/core.json`,
    `/data/releases/${id}/data/missing.json`,
    `/data/releases/${id}/data/originals/source.pdf`,
  ])
    expect((await visit(unknown)).status).toBe(404);
});

it('takes POST only on /mcp, with the finalized headers of a non-public-data route', async () => {
  const env = {
    ENVIRONMENT: 'local',
    ASSETS: { fetch: async () => new Response('asset') },
  } as unknown as Env;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const res = await app.fetch(
    new Request('https://budget.example/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    env,
    {} as ExecutionContext,
  );
  expect(res.status).toBe(200);
  expect(res.headers.get('Mcp-Session-Id')).toMatch(/^[0-9a-f]{32}$/);
  expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.has('Content-Security-Policy')).toBe(true);
  expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);
  const slash = await app.fetch(
    new Request('https://budget.example/mcp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    env,
    {} as ExecutionContext,
  );
  expect(slash.status, 'POST /mcp/').toBe(200);
  for (const [path, method, status, allow] of [
    ['/mcp', 'GET', 405, 'POST'],
    ['/mcp', 'PUT', 405, 'POST'],
    ['/mcp/', 'GET', 405, 'POST'],
    ['/mcpx', 'POST', 405, 'GET, HEAD'],
    ['/data/core.json', 'POST', 405, 'GET, HEAD'],
  ] as const) {
    const r = await app.fetch(
      new Request('https://budget.example' + path, { method }),
      env,
      {} as ExecutionContext,
    );
    expect(r.status, `${method} ${path}`).toBe(status);
    expect(r.headers.get('Allow'), `${method} ${path}`).toBe(allow);
  }
});

it("serves OpenAI's domain-check token as plain text, and 404 without one", async () => {
  const path = 'https://budget.example/.well-known/openai-apps-challenge';
  const base = { ENVIRONMENT: 'local', ASSETS: { fetch: async () => new Response('asset') } };
  const set = await app.fetch(
    new Request(path),
    { ...base, OPENAI_APPS_CHALLENGE: ' token-123 \n' } as unknown as Env,
    {} as ExecutionContext,
  );
  expect(set.status).toBe(200);
  expect(set.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  expect(await set.text()).toBe('token-123');
  const unset = await app.fetch(new Request(path), base as unknown as Env, {} as ExecutionContext);
  expect(unset.status).toBe(404);
  const post = await app.fetch(
    new Request(path, { method: 'POST' }),
    { ...base, OPENAI_APPS_CHALLENGE: 'token-123' } as unknown as Env,
    {} as ExecutionContext,
  );
  expect(post.status).toBe(405);
});
