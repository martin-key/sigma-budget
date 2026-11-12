import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { CSP, finalizeResponse, staticResponseHeaders } from '../app/lib/security';
import { rateLimitReleaseRead } from './release-rate-limit';
import { publicApi } from './api/api.js';
import { operator } from './api/access.js';
import { adminApi } from './api/admin.js';

const root = resolve(import.meta.dirname, '../../..');
const local = { ENVIRONMENT: 'local' };
const request = (path: string, method = 'GET') =>
  new Request('https://budget.example' + path, { method });

describe('SECURITY-01–04 repository gates', () => {
  it('ignores secret variants at every depth but preserves sanitized examples', () => {
    for (const path of [
      '.env.local',
      'apps/web/.env.staging',
      'apps/web/.dev.vars',
      'apps/web/.dev.vars.staging',
    ]) {
      expect(
        execFileSync('git', ['check-ignore', '--no-index', path], { cwd: root }).toString().trim(),
      ).toBe(path);
    }
    expect(() =>
      execFileSync('git', ['check-ignore', '--no-index', 'apps/web/.dev.vars.example'], {
        cwd: root,
      }),
    ).toThrow();
  });
  it('pins every external action and blocks advisory, secret and static findings', () => {
    for (const path of readdirSync(resolve(root, '.github/workflows'))) {
      const text = readFileSync(resolve(root, '.github/workflows', path), 'utf8');
      for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) {
        if (!match[1].startsWith('./')) expect(match[1]).toMatch(/@[a-f0-9]{40}$/);
      }
    }
    const workflow = readFileSync(resolve(root, '.github/workflows/security.yml'), 'utf8');
    expect(workflow).toContain('pnpm audit --audit-level=low');
    expect(workflow).toContain('dir . --redact');
    expect(workflow.indexOf('Secret scan')).toBeLessThan(workflow.indexOf('pnpm install'));
    expect(workflow).toContain('--metrics=off --error');
    expect(workflow).not.toContain('continue-on-error');
    const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
    expect(lock).not.toContain('@vitest/mocker@4.1.11');
  });
});

describe('SECURITY-05–06 response policy', () => {
  it.each(['/', '/api/releases', '/data/core.json', '/admin/operations', '/missing'])(
    'hardens all statuses and methods on %s',
    async (path) => {
      for (const status of [200, 304, 400, 401, 404, 405, 429, 503]) {
        const res = finalizeResponse(request(path), new Response(null, { status }), local);
        for (const header of [
          'Content-Security-Policy',
          'Strict-Transport-Security',
          'X-Content-Type-Options',
          'Cross-Origin-Resource-Policy',
          'Permissions-Policy',
        ])
          expect(res.headers.has(header)).toBe(true);
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
      }
      const res = finalizeResponse(request(path, 'HEAD'), new Response('body'), local);
      expect(await res.text()).toBe('');
    },
  );
  it('keeps downloaded originals attached, sandboxed and immutable without transforming bytes', () => {
    const res = finalizeResponse(
      request('/data/releases/id/original.html'),
      new Response('original', {
        headers: {
          'Content-Disposition': 'attachment; filename="original.html"',
          'Content-Security-Policy': 'sandbox',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Cache-Control': 'public, max-age=31536000, immutable, no-transform',
        },
      }),
      local,
    );
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="original.html"');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable, no-transform',
    );
    expect(
      res.headers
        .get('Content-Security-Policy')
        ?.split(';')
        .map((s) => s.trim()),
    ).toContain('sandbox');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
  it('preserves document no-transform and adds the complete shared CSP', () => {
    const res = finalizeResponse(
      request('/izpalnenie'),
      new Response('document', {
        headers: {
          'Cache-Control': 'private, no-store, no-transform',
        },
      }),
      local,
    );
    expect(res.headers.get('Cache-Control')).toBe('private, no-store, no-transform');
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP + "; frame-ancestors 'self'");
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  });
  it('scopes public CORS and embedding without weakening downloaded originals', () => {
    for (const path of ['/api/releases', '/data/core.json', '/data/releases/x/manifest.json']) {
      const h = finalizeResponse(request(path), new Response(null), local).headers;
      expect(h.get('Access-Control-Allow-Origin')).toBe('*');
      expect(h.get('Access-Control-Allow-Methods')).toBe('GET, HEAD');
      expect(h.has('Access-Control-Allow-Credentials')).toBe(false);
      expect(h.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    }
    const h = finalizeResponse(
      request('/embed/test'),
      new Response(null, { headers: { 'X-Frame-Options': 'SAMEORIGIN' } }),
      local,
    ).headers;
    expect(h.get('Content-Security-Policy')).toContain('frame-ancestors *');
    expect(h.has('X-Frame-Options')).toBe(false);
    const admin = finalizeResponse(request('/admin/operations'), new Response(null), {
      ENVIRONMENT: 'production',
    }).headers;
    expect(admin.has('Access-Control-Allow-Origin')).toBe(false);
    expect(admin.has('X-Robots-Tag')).toBe(false);
    expect(admin.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
    const sandbox = finalizeResponse(
      request('/data/releases/x/original'),
      new Response(null, { headers: { 'Content-Security-Policy': 'sandbox' } }),
      local,
    );
    expect(sandbox.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect(staticResponseHeaders(local)).toContain('x-robots-tag: noindex');
  });
});

describe('SECURITY-07 parameter validation precedes storage', () => {
  it.each([
    '?limit=1.5',
    '?limit=0',
    '?limit=101',
    '?limit=',
    '?limit=1&limit=2',
    '?before=Infinity',
    '?before=-1',
    '?before=9007199254740992',
    '/%ZZ',
  ])('returns JSON 400 for %s', async (suffix) => {
    const req = request('/api/releases' + suffix);
    const res = await publicApi(req, {}, new URL(req.url));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });
  it('passes safe integer boundaries to bound D1 parameters', async () => {
    const all = vi.fn(async () => ({ results: [] }));
    const bind = vi.fn(() => ({ all }));
    const env = { DB: { prepare: () => ({ bind }) }, OBJECTS: {} };
    const req = request('/api/releases?limit=100&before=9007199254740991');
    expect((await publicApi(req, env, new URL(req.url))).status).toBe(200);
    expect(bind).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, 100);
  });
});

describe('SECURITY-08 malformed Access JWTs', () => {
  const env = { ACCESS_ISSUER: 'https://access.example', ACCESS_AUD: 'test', DB: {}, OBJECTS: {} };
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  it.each([null, [], 'text', 42, {}, { alg: 'RS256', kid: 1 }])(
    'rejects header %j',
    async (header) => {
      const req = new Request('https://budget.example/admin/operations', {
        headers: { 'Cf-Access-Jwt-Assertion': `${encode(header)}.${encode({})}.AA` },
      });
      expect((await operator(req, env)).status).toBe(401);
      expect((await adminApi(req, env, new URL(req.url))).status).toBe(401);
    },
  );
  it.each([null, [], {}, { iss: 'x', aud: [], exp: '9999999999' }])(
    'rejects claims %j',
    async (claims) => {
      const req = new Request('https://budget.example/admin/operations', {
        headers: {
          'Cf-Access-Jwt-Assertion': `${encode({ alg: 'RS256', kid: 'x' })}.${encode(claims)}.AA`,
        },
      });
      expect((await operator(req, env)).status).toBe(401);
    },
  );
  it('rejects malformed signature encoding before certificate lookup', async () => {
    const req = new Request('https://budget.example/admin/operations', {
      headers: {
        'Cf-Access-Jwt-Assertion': `${encode({ alg: 'RS256', kid: 'x' })}.${encode({ iss: env.ACCESS_ISSUER, aud: 'test', exp: 9999999999 })}.Z`,
      },
    });
    expect((await operator(req, { ...env, ACCESS_JWKS: 'invalid' })).status).toBe(401);
  });
  it('sanitizes unavailable certificate verification', async () => {
    const req = new Request('https://budget.example/admin/operations', {
      headers: {
        'Cf-Access-Jwt-Assertion': `${encode({ alg: 'RS256', kid: 'x' })}.${encode({ iss: env.ACCESS_ISSUER, aud: 'test', exp: 9999999999 })}.AA`,
      },
    });
    const res = await adminApi(req, { ...env, ACCESS_JWKS: 'invalid' }, new URL(req.url));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Access verification unavailable' });
  });
});

describe('SECURITY-09 release rate limit', () => {
  it('allows, denies, and shares a client key across paths', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const env = { ...local, RELEASE_RATE_LIMITER: { limit } };
    expect(await rateLimitReleaseRead(request('/api/releases'), env)).toBeNull();
    limit.mockResolvedValue({ success: false });
    const res = await rateLimitReleaseRead(request('/data/core.json'), env);
    expect(res?.status).toBe(429);
    expect(res?.headers.get('Retry-After')).toBe('60');
    expect(limit.mock.calls[0]).toEqual(limit.mock.calls[1]);
  });
  it('shares the same client budget across rolling versions, host aliases and paths', async () => {
    const counts = new Map<string, number>();
    const limit = vi.fn(async ({ key }: { key: string }) => {
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return { success: count <= 120 };
    });
    const env = { ENVIRONMENT: 'production', RELEASE_RATE_LIMITER: { limit } };
    let allowed = 0;
    for (let i = 0; i < 240; i++) {
      const host = i % 2 ? 'old-version.example' : 'new-version.example';
      const req = new Request(`https://${host}/api/releases`, {
        headers: { 'CF-Connecting-IP': '192.0.2.1' },
      });
      const res = await rateLimitReleaseRead(req, env);
      if (!res) allowed++;
      else expect(res.status).toBe(429);
    }
    expect(allowed).toBe(120);
    expect(counts.size).toBe(1);
    expect(limit).toHaveBeenCalledWith({ key: '192.0.2.1' });
  });
  it('keeps production at top level and staging isolated without a production env block', () => {
    const text = readFileSync(resolve(root, 'apps/web/wrangler.jsonc'), 'utf8');
    const config = JSON.parse(
      text
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n'),
    );
    const namespaces = [config, config.env.staging].map((c) => {
      const binding = c.ratelimits.find((b: { name: string }) => b.name === 'RELEASE_RATE_LIMITER');
      expect(binding.simple).toEqual({ limit: 120, period: 60 });
      return binding.namespace_id;
    });
    expect(namespaces).toEqual(['2001', '2002']);
    expect(new Set(namespaces).size).toBe(2);
    expect(config.name).toBe('sigma-budget');
    expect(config.vars.ENVIRONMENT).toBe('production');
    expect(config.vars.SITE_ORIGIN).toBe('https://sigma-budget.midt.bg');
    expect(config.vars.FEEDBACK_EMAIL).toBe('contact@midt.government.bg');
    expect(config.vars.NOINDEX).toBe('');
    expect(config.d1_databases[0].database_name).toBe('sigma-budget-registry');
    expect(config.r2_buckets[0].bucket_name).toBe('sigma-budget-objects');
    expect(config.env).not.toHaveProperty('production');
    expect(text).not.toContain('WORKER_VERSION');
  });
  it.each(['dev', 'staging', 'development', 'test', 'PRODUCTION', ''])(
    'fails open only on missing/error binding but enforces a working limiter for ENVIRONMENT=%j',
    async (ENVIRONMENT) => {
      const req = request('/api/releases');
      expect(await rateLimitReleaseRead(req, { ENVIRONMENT })).toBeNull();
      expect(
        await rateLimitReleaseRead(req, {
          ENVIRONMENT,
          RELEASE_RATE_LIMITER: {
            limit: async () => {
              throw new Error('unavailable');
            },
          },
        }),
      ).toBeNull();
      expect(
        (
          await rateLimitReleaseRead(req, {
            ENVIRONMENT,
            RELEASE_RATE_LIMITER: {
              limit: async () => ({ success: false }),
            },
          })
        )?.status,
      ).toBe(429);
    },
  );
  it('degrades locally, fails closed in production, and handles binding failures', async () => {
    expect(await rateLimitReleaseRead(request('/api/releases'), local)).toBeNull();
    expect(
      (await rateLimitReleaseRead(request('/api/releases'), { ENVIRONMENT: 'production' }))?.status,
    ).toBe(503);
    const limiter = {
      limit: vi.fn(async () => {
        throw new Error('unavailable');
      }),
    };
    expect(
      await rateLimitReleaseRead(request('/api/releases'), {
        ...local,
        RELEASE_RATE_LIMITER: limiter,
      }),
    ).toBeNull();
    expect(
      (
        await rateLimitReleaseRead(request('/api/releases'), {
          ENVIRONMENT: 'production',
          RELEASE_RATE_LIMITER: limiter,
        })
      )?.status,
    ).toBe(503);
  });
});
