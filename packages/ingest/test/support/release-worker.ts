import { createRequire } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

interface LocalD1 {
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): {
    bind(...values: unknown[]): { all(): Promise<{ results: Record<string, unknown>[] }> };
    all(): Promise<{ results: Record<string, unknown>[] }>;
    run(): Promise<unknown>;
  };
}
interface LocalR2 {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array): Promise<unknown>;
}
interface LocalWorker {
  ready: Promise<URL>;
  dispose(): Promise<void>;
  getD1Database(name: string): Promise<LocalD1>;
  getR2Bucket(name: string): Promise<LocalR2>;
}
/** Uses the exact Miniflare/workerd already pinned through Wrangler, no new dependency. */
export async function localReleaseWorker(maxObjectBytes = 50 * 1024 * 1024) {
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
  const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare') as {
    Miniflare: new (options: unknown) => LocalWorker;
    convertV4MiniflareOptions(options: unknown): Promise<unknown>;
  };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'release-client-test',
    issuer = 'https://release-client-test.invalid',
    aud = 'release-client-test';
  const token = (email = 'operator@example.invalid') => {
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const text =
      encode({ alg: 'RS256', kid }) +
      '.' +
      encode({ iss: issuer, aud: [aud], email, iat: now, nbf: now, exp: now + 1800 });
    return text + '.' + sign('RSA-SHA256', Buffer.from(text), privateKey).toString('base64url');
  };
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const api = join(root, 'apps/web/workers/api');
  const modules = await Promise.all(
    ['admin.js', 'api.js', 'store.js', 'access.js'].map(async (name) => ({
      type: 'ESModule',
      path: join(api, name),
      contents: await readFile(join(api, name), 'utf8'),
    })),
  );
  modules.unshift({
    type: 'ESModule',
    path: join(api, 'operator-test-entry.js'),
    contents: `import {adminApi} from './admin.js'; import {publicApi} from './api.js'; export default {fetch(request,env){const url=new URL(request.url);return url.pathname.startsWith('/admin/')?adminApi(request,env,url):publicApi(request,env,url)}};`,
  });
  const mf = new Miniflare(
    await convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      modules,
      modulesRoot: api,
      compatibilityDate: '2025-09-01',
      d1Databases: { DB: 'release-client-test' },
      r2Buckets: ['OBJECTS'],
      bindings: {
        ACCESS_ISSUER: issuer,
        ACCESS_AUD: aud,
        ACCESS_JWKS: JSON.stringify({
          keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }],
        }),
        OPERATORS: 'operator@example.invalid',
        MAX_OBJECT_BYTES: String(maxObjectBytes),
      },
      outboundService: () =>
        new Response('External network disabled in release-client tests', { status: 503 }),
    }),
  );
  try {
    const url = String(await mf.ready).replace(/\/$/, '');
    const db = await mf.getD1Database('DB');
    const sql = await readFile(join(root, 'apps/web/migrations/0001_registry.sql'), 'utf8');
    // Keep each CREATE TRIGGER body intact; D1 exec itself splits on newlines.
    const statements = sql.replace(/--[^\n]*/g, '').split(/;\s*\n(?=\s*(?:CREATE|INSERT|$))/);
    for (const statement of statements.filter((s) => s.trim())) await db.prepare(statement).run();
    return { mf, db, url, token, r2: await mf.getR2Bucket('OBJECTS'), maxObjectBytes };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
