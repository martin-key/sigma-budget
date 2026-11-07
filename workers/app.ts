// The Worker of the site (docs/adr/0002-react-router-ssr.md). The platform serves the static files of the client build first (css/, js/,
// data/, vendor/, images); the Worker answers the rest:
//   /admin/*                            the operator API (worker/admin.js), behind Cloudflare Access and checked again there
//   anything but GET and HEAD           405: the public routes never write
//   /api/releases*, /data/releases/*    the public, read-only release API (worker/api.js)
//   /data/<file>                        the stable address of a data file: the file of the current release (registry), else the static one
//                                       (wrangler.jsonc assets.run_worker_first sends these here before the static files)
//   every screen                        React Router: the screen drawn from the current release (app/), one scope per request
// The registry is D1 (binding DB), the objects are R2 (binding OBJECTS): docs/release.md.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequestHandler } from 'react-router';
import { adminApi } from '../worker/admin.js';
import { publicApi } from '../worker/api.js';
import { provideScope } from '../site/js/env.js';
import { requestState } from '../site/js/store.js';
import { releaseData, type ReleaseData } from './release-data';
import { CSP } from '../app/lib/security';

declare module 'react-router' {
  interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
    release: { id: string; dataBase: string; origin: string; sigmaUrl: string; feedbackEmail: string };
  }
}

interface Scope {
  url: URL;
  origin: string;
  releaseId: string;
  dataBase: string;
  sigmaUrl: string;
  state: Record<string, unknown>;
  data: Map<string, unknown>;
  load: ReleaseData['load'];
}
const scopes = new AsyncLocalStorage<Scope>();
provideScope(() => scopes.getStore() ?? null);

const handler = createRequestHandler(() => import('virtual:react-router/server-build'), import.meta.env.MODE);

/* A drawn screen depends only on the release, the build and the address: the edge cache keeps it under exactly that key, so a repeated
   request costs no render (a cold render takes up to ~60 ms of CPU, docs/production-readiness.md), and a new release or a new deploy is a
   new key. The stored copy is the response before documentHeaders(); the visitor's copy is always revalidated (max-age=0). */
declare const __BUILD__: string;
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
const edge = () => (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
const cacheKey = (rid: string, url: URL) => new Request(`https://ssr.cache/${BUILD}/${rid || 'none'}${url.pathname}${url.search}`);
const RELEASES = /^\/(api\/releases(\/|$)|data\/releases\/)/;
const DATA_FILE = /^\/data\/(?!releases\/)[A-Za-z0-9_\-./]+$/;

/* no-transform keeps Cloudflare from editing a response, and from compressing it too: the Worker compresses text itself. The runtime
   gzips a body sent with Content-Encoding; the visitor decodes it to the same bytes. The visitor's own Accept-Encoding decides
   (request.cf.clientAcceptEncoding: the header the Worker sees is rewritten); a Range request and a client without gzip get the bytes. */
const TEXT = /^(text\/|application\/(json|xml|javascript)|image\/svg\+xml)/;
function encoded(request: Request, res: Response): Response {
  const accepts = String((request as Request & { cf?: { clientAcceptEncoding?: string } }).cf?.clientAcceptEncoding ?? '').toLowerCase();
  if (!res.body || res.headers.has('Content-Encoding') || request.headers.has('Range') || !TEXT.test(res.headers.get('Content-Type') || '')
      || !/\bgzip\b/.test(accepts)) return res;
  const h = new Headers(res.headers);
  h.set('Content-Encoding', 'gzip');
  h.append('Vary', 'Accept-Encoding');
  h.delete('Content-Length');
  const tag = h.get('ETag');
  if (tag && !tag.startsWith('W/')) h.set('ETag', 'W/' + tag);                // another representation of the same bytes
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** a static file when there is one, else the answer the Worker already has */
async function fallback(request: Request, env: Env, res: Response): Promise<Response> {
  const file = await env.ASSETS.fetch(request);
  return file.status === 404 ? res : file;
}

/** /data/<file>: from the current release when there is a registry, so the stable addresses follow a new release without a deploy */
async function dataFile(request: Request, env: Env, url: URL, data: ReleaseData): Promise<Response> {
  const path = url.pathname.slice(1);
  const f = path.includes('..') ? null : await data.file(path);
  if (!f) return env.ASSETS.fetch(request);
  const etag = `"${f.sha256}"`;
  const headers = {
    'Content-Type': f.mime + (/^text\/|json|xml/.test(f.mime) && !/charset/.test(f.mime) ? '; charset=utf-8' : ''),
    'Cache-Control': 'public, max-age=300, must-revalidate, no-transform', ETag: etag, 'X-Release-Id': data.releaseId,
    'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff',
  };
  if ((request.headers.get('If-None-Match') || '').replace(/^W\//, '') === etag) return new Response(null, { status: 304, headers });
  return encoded(request, new Response(request.method === 'HEAD' ? null : f.bytes, { headers }));
}

/* the headers that site/_headers (tools/site/build.py) gives the static files, for the documents the Worker draws. no-transform: a zone
   feature that edits HTML on the way out (the Web Analytics beacon, Email Obfuscation, Rocket Loader) must not change the screens */
function documentHeaders(res: Response, env: Env, embed: boolean, rid: string, cached?: 'HIT' | 'MISS'): Response {
  const h = new Headers(res.headers);
  if (cached) h.set('X-Screen-Cache', cached);
  h.set('Content-Security-Policy', CSP + (embed ? '; frame-ancestors *' : "; frame-ancestors 'self'"));
  if (!embed) h.set('X-Frame-Options', 'SAMEORIGIN');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  if (!h.has('Cache-Control') || res.status === 200 || res.status === 404) h.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
  if (env.NOINDEX === '1' || embed) h.set('X-Robots-Tag', 'noindex');
  if (rid) h.set('X-Release-Id', rid);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/admin/')) return adminApi(request, env, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    if (RELEASES.test(url.pathname)) {
      // the registry's releases; a release that was published with the site (site/data/releases/) is one of the static files. An
      // environment without a registry (no D1 tables: a local check, a new environment) answers as one where the release is unknown
      let res: Response;
      try { res = await publicApi(request, env, url); }
      catch { res = Response.json({ error: 'no release registry in this environment' }, { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
      return res.status === 404 && url.pathname.startsWith('/data/releases/') ? fallback(request, env, res) : res;
    }

    const origin = (env.SITE_ORIGIN || url.origin).replace(/\/+$/, '');
    const sigmaUrl = env.SIGMA_URL || '';
    const data = await releaseData(env, url.origin);
    if (DATA_FILE.test(url.pathname)) return dataFile(request, env, url, data);
    const release = { id: data.releaseId, dataBase: data.dataBase, origin, sigmaUrl, feedbackEmail: env.FEEDBACK_EMAIL || '' };
    const scope: Scope = { url, origin, releaseId: data.releaseId, dataBase: data.dataBase, sigmaUrl,
      state: requestState(url.searchParams.get('per')), data: new Map(), load: data.load };
    const embed = url.pathname.startsWith('/embed/');
    const cache = request.method === 'GET' ? edge() : undefined;
    const key = cacheKey(data.releaseId, url);
    const hit = cache ? await cache.match(key) : undefined;
    if (hit) return encoded(request, documentHeaders(hit, env, embed, data.releaseId, 'HIT'));
    const res = await scopes.run(scope, () => handler(request, { cloudflare: { env, ctx }, release }));
    if (cache && (res.status === 200 || res.status === 404)) {
      const copy = new Response(res.clone().body, { status: res.status, headers: res.headers });
      copy.headers.set('Cache-Control', 'public, max-age=86400');
      ctx.waitUntil(cache.put(key, copy).catch(() => {}));
    }
    return encoded(request, documentHeaders(res, env, embed, data.releaseId, 'MISS'));
  },
} satisfies ExportedHandler<Env>;
