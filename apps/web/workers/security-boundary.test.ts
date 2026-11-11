import { expect, it, vi } from 'vitest';
vi.mock('react-router', () => ({ createRequestHandler: () => async () => new Response('page') }));
vi.mock('./release-data', () => ({
  usesRegistry: vi.fn(async () => false),
  releaseData: vi.fn(async () => ({
    releaseId: 'test',
    dataBase: '/data/',
    load: async () => null,
    file: async () => null,
  })),
  candidateReleaseId: vi.fn(() => null),
  noRegistry: () => false,
}));
import app from './app';
import { candidateReleaseId, usesRegistry, releaseData } from './release-data';

it('finalizes actual dispatch early returns, resource fallbacks, admin auth and exceptions', async () => {
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  const env = {
    ENVIRONMENT: 'local',
    ASSETS: { fetch: async () => new Response('asset') },
  } as unknown as Env;
  for (const [path, method, status] of [
    ['/', 'POST', 405],
    ['/admin/operations', 'GET', 503],
    ['/api/releases', 'GET', 503],
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

it('rate-limits the actual public API before D1 or R2 reads', async () => {
  const prepare = vi.fn();
  const env = {
    ENVIRONMENT: 'production',
    DB: { prepare },
    OBJECTS: {},
    RELEASE_RATE_LIMITER: { limit: async () => ({ success: false }) },
  } as unknown as Env;
  const res = await app.fetch(
    new Request('https://budget.example/api/releases'),
    env,
    {} as ExecutionContext,
  );
  expect(res.status).toBe(429);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(prepare).not.toHaveBeenCalled();
});

it('does not charge bundled static files to the registry read limiter', async () => {
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

it('limits stable registry data before loading the manifest or file', async () => {
  vi.mocked(usesRegistry).mockResolvedValueOnce(true);
  vi.mocked(releaseData).mockClear();
  const env = {
    ENVIRONMENT: 'production',
    RELEASE_RATE_LIMITER: { limit: async () => ({ success: false }) },
  } as unknown as Env;
  const res = await app.fetch(
    new Request('https://budget.example/data/core.json'),
    env,
    {} as ExecutionContext,
  );
  expect(res.status).toBe(429);
  expect(releaseData).not.toHaveBeenCalled();
});

it.each(['manifest.json', 'data/core.json'])(
  'does not limit packaged release %s, with or without a binding',
  async (file) => {
    const path = `/data/releases/${'a'.repeat(64)}/${file}`;
    for (const binding of [undefined, { limit: vi.fn(async () => ({ success: false })) }]) {
      const prepare = vi.fn();
      const env = {
        ENVIRONMENT: 'production',
        DB: { prepare },
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
      expect(prepare).not.toHaveBeenCalled();
    }
  },
);
it('candidate release assets and API errors do not touch the registry or limiter', async () => {
  vi.mocked(candidateReleaseId).mockReturnValue('a'.repeat(64));
  try {
    const limit = vi.fn(async () => ({ success: false }));
    const prepare = vi.fn();
    const env = {
      ENVIRONMENT: 'production',
      DB: { prepare },
      RELEASE_RATE_LIMITER: { limit },
      ASSETS: { fetch: async () => new Response('candidate') },
    } as unknown as Env;
    for (const file of ['manifest.json', 'data/core.json']) {
      const res = await app.fetch(
        new Request(`https://budget.example/data/releases/${'a'.repeat(64)}/${file}`),
        env,
        {} as ExecutionContext,
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('candidate');
    }
    expect(
      (
        await app.fetch(
          new Request('https://budget.example/api/releases'),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(404);
    expect(limit).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    vi.mocked(candidateReleaseId).mockReturnValue(null);
  }
});
it('unknown packaged files still charge the limiter before any registry read', async () => {
  const prepare = vi.fn();
  const limit = vi.fn(async () => ({ success: false }));
  const env = {
    ENVIRONMENT: 'production',
    DB: { prepare },
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
  expect(prepare).not.toHaveBeenCalled();
});
