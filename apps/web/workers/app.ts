// The Worker of the site (docs/adr/0002-react-router-ssr.md). The platform serves the static files of the client build first (css/, js/,
// data/, vendor/, images); the Worker answers the rest:
//   /admin/*                            the operator API (apps/web/workers/api/admin.js), behind Cloudflare Access and checked again there
//   anything but GET and HEAD           405: the public routes never write
//   /api/releases*, /data/releases/*    the public, read-only release API (apps/web/workers/api/api.js)
//   /data/<file>                        the stable address of a data file: the file of the current release (registry), else the static one
//                                       (apps/web/wrangler.jsonc assets.run_worker_first sends these here before the static files)
//   every screen                        React Router: the screen drawn from the current release (app/), one scope per request
// The registry is D1 (binding DB), the objects are R2 (binding OBJECTS): docs/release.md.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequestHandler } from 'react-router';
import { adminApi } from './api/admin.js';
import { publicApi } from './api/api.js';
import { provideScope } from '../client/env.js';
import { requestState } from '../client/store.js';
import { screenSearch } from '../client/routes.js';
import { releaseData, noRegistry, type ReleaseData } from './release-data';
import { inFlight, claim, withinCap } from './render-gate';
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
  /** a file of the screen could not be read (apps/web/client/data.js): the screen is shown, but not kept in the edge cache */
  degraded?: boolean;
}
const scopes = new AsyncLocalStorage<Scope>();
provideScope(() => scopes.getStore() ?? null);

const handler = createRequestHandler(() => import('virtual:react-router/server-build'), import.meta.env.MODE);

/* The edge cache, as in СИГМА (midt-bg/sigma, apps/web/workers/app.ts and cache-key.ts). A drawn screen depends only on the release, the
   build and the address of the screen: its path and the keys of the query that the screen reads (apps/web/client/routes.js screenSearch). The
   server draws it from exactly that address, and the cache keeps it under exactly that key, so a repeated request costs no render (a
   cold render takes up to ~60 ms of CPU, docs/production-readiness.md), ?x=… or another screen's key lands on the same entry, and a new
   release or a new deploy is a new key. Only a complete screen is kept: a 200 with every file it read (no error, no redirect, no 404
   screen, no 503); identical misses wait for the first one (apps/web/workers/render-gate.ts). The stored copy is the response before
   documentHeaders(); the visitor's copy is always revalidated (max-age=0). */
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

/** the registry (D1, R2) cannot be read right now, or the isolate sheds a render: a 503 that says when to come back, as in СИГМА (a
 *  crawler backs off on it, where a 500 reads as a broken page), and that nothing keeps */
function unavailable(message = 'Данните не могат да бъдат прочетени в момента. Опитайте отново след малко.'): Response {
  return new Response(message + '\n', { status: 503, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}

/** a static file when there is one, else the answer the Worker already has */
async function fallback(request: Request, env: Env, res: Response): Promise<Response> {
  const file = await env.ASSETS.fetch(request);
  return file.status === 404 ? res : file;
}

/* data/feed.xml of a release links to a placeholder host (pipeline/budget_pipeline/build/feed.py: a reserved name that never resolves), as the hash
   addresses of the prototype. apps/web/scripts/build.py writes the site's origin into the static copy (stamp_files); the stable address of a
   registry release gets the same links here. The file of the release itself (/data/releases/<id>/data/feed.xml) keeps its bytes. */
const FEED = 'data/feed.xml';
const PLACEHOLDER = /https?:\/\/budget-na-svetlo\.example\/(?:#\/)?/g;
async function withOrigin(bytes: ArrayBuffer, origin: string): Promise<{ bytes: ArrayBuffer; tag: string }> {
  const text = new TextDecoder().decode(bytes).replace(PLACEHOLDER, origin + '/').split(origin + '/#/').join(origin + '/');
  const out = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', out));
  return { bytes: out.buffer as ArrayBuffer, tag: [...digest].map(b => b.toString(16).padStart(2, '0')).join('') };
}

/** /data/<file>: from the current release when there is a registry, so the stable addresses follow a new release without a deploy */
async function dataFile(request: Request, env: Env, url: URL, data: ReleaseData, origin: string): Promise<Response> {
  const path = url.pathname.slice(1);
  let f: Awaited<ReturnType<ReleaseData['file']>>;
  try { f = path.includes('..') ? null : await data.file(path); }
  catch (e) { console.error(e); return unavailable(); }                     // R2 cannot be read right now: not the static file instead
  if (!f) return env.ASSETS.fetch(request);
  if (path === FEED) { const o = await withOrigin(f.bytes, origin); f = { ...f, bytes: o.bytes, sha256: o.tag }; }
  const etag = `"${f.sha256}"`;
  const headers = {
    'Content-Type': f.mime + (/^text\/|json|xml/.test(f.mime) && !/charset/.test(f.mime) ? '; charset=utf-8' : ''),
    'Cache-Control': 'public, max-age=300, must-revalidate, no-transform', ETag: etag, 'X-Release-Id': data.releaseId,
    'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff',
  };
  if ((request.headers.get('If-None-Match') || '').replace(/^W\//, '') === etag) return new Response(null, { status: 304, headers });
  return encoded(request, new Response(request.method === 'HEAD' ? null : f.bytes, { headers }));
}

/* the headers that site/_headers (apps/web/scripts/build.py) gives the static files, for the documents the Worker draws. no-transform: a zone
   feature that edits HTML on the way out (the Web Analytics beacon, Email Obfuscation, Rocket Loader) must not change the screens */
function documentHeaders(res: Response, env: Env, embed: boolean, rid: string, cached?: 'HIT' | 'MISS' | 'BYPASS', degraded = false): Response {
  const h = new Headers(res.headers);
  if (cached) h.set('X-Screen-Cache', cached);
  h.set('Content-Security-Policy', CSP + (embed ? '; frame-ancestors *' : "; frame-ancestors 'self'"));
  if (!embed) h.set('X-Frame-Options', 'SAMEORIGIN');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  if (res.status >= 500 || degraded) {
    // an error or an incomplete screen is shown once and never kept; a 503 says when to come back (a crawler backs off on it)
    h.set('Cache-Control', 'no-store, no-transform');
    if (res.status === 503) h.set('Retry-After', '30');
  } else if (!h.has('Cache-Control') || res.status === 200 || res.status === 404) h.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
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
      // the registry's releases; a release that was published with the site (data/release/releases/) is one of the static files. An
      // environment without a registry (no D1 tables: a local check, a new environment) answers as one where the release is unknown
      let res: Response;
      try { res = await publicApi(request, env, url); }
      catch (e) {
        if (!noRegistry(env, e)) { console.error(e); return unavailable(); }
        res = Response.json({ error: 'no release registry in this environment' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
      return res.status === 404 && url.pathname.startsWith('/data/releases/') ? fallback(request, env, res) : res;
    }

    const origin = (env.SITE_ORIGIN || url.origin).replace(/\/+$/, '');
    const sigmaUrl = env.SIGMA_URL || '';
    let data: ReleaseData;
    try { data = await releaseData(env, url.origin); }
    catch (e) { console.error(e); return unavailable(); }                   // RegistryError: D1 or R2 cannot be read right now
    if (DATA_FILE.test(url.pathname)) return dataFile(request, env, url, data, origin);
    const release = { id: data.releaseId, dataBase: data.dataBase, origin, sigmaUrl, feedbackEmail: env.FEEDBACK_EMAIL || '' };
    // the address the screen is drawn from: the query its screen reads, nothing else; null for a path that is not a screen (it is never kept)
    const search = screenSearch(url.pathname, url.search);
    const screenUrl = new URL(url);
    if (search !== null) screenUrl.search = search;
    const screenRequest = screenUrl.search === url.search ? request : new Request(screenUrl, request);
    const scope: Scope = { url: screenUrl, origin, releaseId: data.releaseId, dataBase: data.dataBase, sigmaUrl,
      state: requestState(screenUrl.searchParams.get('per')), data: new Map(), load: data.load };
    const embed = url.pathname.startsWith('/embed/');
    const cache = request.method === 'GET' && search !== null ? edge() : undefined;
    const key = cacheKey(data.releaseId, screenUrl);
    const fromCache = async () => {
      const hit = cache ? await cache.match(key) : undefined;
      return hit ? encoded(request, documentHeaders(hit, env, embed, data.releaseId, 'HIT')) : null;
    };
    const hit = await fromCache();
    if (hit) return hit;

    // the same miss is already being drawn in this isolate: take its entry instead of drawing the screen again (apps/web/workers/render-gate.ts)
    const pending = cache && inFlight(key.url);
    if (pending) {
      await pending;
      const stored = await fromCache();
      if (stored) return stored;
    }
    const settle = cache ? claim(key.url) : () => {};
    let stored: Promise<unknown> = Promise.resolve();
    try {
      const res = await withinCap(() => scopes.run(scope, () => handler(screenRequest, { cloudflare: { env, ctx }, release })));
      if (!res) return unavailable('Сайтът е претоварен. Опитайте отново след малко.');
      const cacheable = !!cache && res.status === 200 && !scope.degraded;
      if (cacheable) {
        const copy = new Response(res.clone().body, { status: res.status, headers: res.headers });
        copy.headers.set('Cache-Control', 'public, max-age=86400');
        stored = cache.put(key, copy).catch(() => {});
        ctx.waitUntil(stored);
      }
      return encoded(request, documentHeaders(res, env, embed, data.releaseId, cacheable ? 'MISS' : 'BYPASS', !!scope.degraded));
    } finally {
      void stored.then(settle, settle);                                       // the waiting misses look the entry up once it is stored
    }
  },
} satisfies ExportedHandler<Env>;
