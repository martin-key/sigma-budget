import { screenCacheKey } from '../app/lib/cache';
// The site renders screens and serves the release packaged with the build.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequestHandler } from 'react-router';
import { publicApi } from './api/api.js';
import { provideScope } from '../client/env.js';
import { requestState } from '../client/store.js';
import { screenSearch } from '../app/lib/query-params';
import { releaseData, type ReleaseData } from './release-data';
import { inFlight, claim, withinCap } from './render-gate';
import { finalizeResponse } from '../app/lib/security';
import { rateLimitReleaseRead, rateLimitRender } from './release-rate-limit';
import { bundledFeed } from './feed';

declare module 'react-router' {
  interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
    release: {
      id: string;
      dataBase: string;
      origin: string;
      sigmaUrl: string;
      feedbackEmail: string;
    };
  }
}

interface Scope {
  url: URL;
  origin: string;
  releaseId: string;
  dataBase: string;
  sigmaUrl: string;
  feedbackEmail: string;
  state: Record<string, unknown>;
  data: Map<string, unknown>;
  load: ReleaseData['load'];
  /** a file of the screen could not be read (apps/web/client/data.js): the screen is shown, but not kept in the edge cache */
  degraded?: boolean;
}
const scopes = new AsyncLocalStorage<Scope>();
provideScope(() => scopes.getStore() ?? null);

const handler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

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
const cacheKey = (rid: string, url: URL) => screenCacheKey(BUILD, rid, url);
const RELEASES = /^\/(api\/releases(\/|$)|data\/releases\/)/;
const DATA_FILE = /^\/data\/(?!releases\/)[A-Za-z0-9_\-./]+$/;

/* no-transform keeps Cloudflare from editing a response, and from compressing it too: the Worker compresses text itself. The runtime
   gzips a body sent with Content-Encoding; the visitor decodes it to the same bytes. The visitor's own Accept-Encoding decides
   (request.cf.clientAcceptEncoding: the header the Worker sees is rewritten); a Range request and a client without gzip get the bytes. */
const TEXT = /^(text\/|application\/(json|xml|javascript)|image\/svg\+xml)/;
function encoded(request: Request, res: Response): Response {
  const accepts = String(
    (request as Request & { cf?: { clientAcceptEncoding?: string } }).cf?.clientAcceptEncoding ??
      '',
  ).toLowerCase();
  if (
    !res.body ||
    res.headers.has('Content-Encoding') ||
    request.headers.has('Range') ||
    !TEXT.test(res.headers.get('Content-Type') || '') ||
    !/\bgzip\b/.test(accepts)
  )
    return res;
  const h = new Headers(res.headers);
  h.set('Content-Encoding', 'gzip');
  h.append('Vary', 'Accept-Encoding');
  h.delete('Content-Length');
  const tag = h.get('ETag');
  if (tag && !tag.startsWith('W/')) h.set('ETag', 'W/' + tag); // another representation of the same bytes
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** The assets cannot be read right now, or the isolate sheds a render: a 503 that says when to come back, as in СИГМА (a
 *  crawler backs off on it, where a 500 reads as a broken page), and that nothing keeps */
function unavailable(
  message = 'Данните не могат да бъдат прочетени в момента. Опитайте отново след малко.',
): Response {
  return new Response(message + '\n', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Retry-After': '30',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Stable data addresses retain the build's asset headers and feed origin. */
async function dataFile(request: Request, env: Env, data: ReleaseData, origin: string) {
  return new URL(request.url).pathname === '/data/feed.xml'
    ? encoded(request, await bundledFeed(request, env.ASSETS, origin, data.releaseId))
    : env.ASSETS.fetch(request);
}

/* the headers that build/client/_headers (apps/web/scripts/release-artifact.ts) gives the static files, for the documents the Worker draws. no-transform: a zone
   feature that edits HTML on the way out (the Web Analytics beacon, Email Obfuscation, Rocket Loader) must not change the screens */
function documentHeaders(
  res: Response,
  env: Env,
  embed: boolean,
  rid: string,
  cached?: 'HIT' | 'MISS' | 'BYPASS',
  degraded = false,
): Response {
  const h = new Headers(res.headers);
  if (cached) h.set('X-Screen-Cache', cached);
  if (res.status >= 500 || degraded) {
    // an error or an incomplete screen is shown once and never kept; a 503 says when to come back (a crawler backs off on it)
    h.set('Cache-Control', 'no-store, no-transform');
    if (res.status === 503) h.set('Retry-After', '30');
  } else if (!h.has('Cache-Control') || res.status === 200 || res.status === 404)
    h.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
  if (rid) h.set('X-Release-Id', rid);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

interface CurrentOutputs {
  id: string;
  hashes: Map<string, string>;
}
// A deploy's assets are immutable; share both the first load and its result across requests.
const outputMaps = new WeakMap<Fetcher, Promise<CurrentOutputs | null>>();
function currentOutputs(assets: Fetcher, url: URL): Promise<CurrentOutputs | null> {
  let pending = outputMaps.get(assets);
  if (!pending) {
    pending = (async () => {
      const pointer = await assets.fetch(new Request(new URL('/data/releases/current.json', url)));
      if (!pointer.ok) return null;
      const current = await pointer.json<{ release_id: string }>().catch(() => null);
      if (!current || !/^[a-f0-9]{64}$/.test(current.release_id)) return null;
      const manifest = await assets.fetch(
        new Request(new URL(`/data/releases/${current.release_id}/manifest.json`, url)),
      );
      if (!manifest.ok) return null;
      const data = await manifest.json<{ outputs: { path: string; sha256: string }[] }>();
      return {
        id: current.release_id,
        hashes: new Map(data.outputs.map((f) => [f.path, f.sha256])),
      };
    })().then(
      (outputs) => {
        // keep only a loaded map: a failed read is tried again on the next request
        if (!outputs) outputMaps.delete(assets);
        return outputs;
      },
      (error) => {
        outputMaps.delete(assets);
        throw error;
      },
    );
    outputMaps.set(assets, pending);
  }
  return pending;
}

/** Only current manifest outputs have archive download addresses; source inputs never do. */
async function currentOutput(
  request: Request,
  env: Env,
  url: URL,
  archive: Response,
): Promise<Response | null> {
  const match = /^\/data\/releases\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
  if (!match) return archive.status !== 404 ? archive : null;
  let path: string;
  try {
    path = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  const current = await currentOutputs(env.ASSETS, url);
  if (!current) return archive.status !== 404 ? archive : null;
  const hash = match[1] === current.id ? current.hashes.get(path) : undefined;
  if (!hash) return !path.startsWith('data/') && archive.status !== 404 ? archive : null;
  // The asset's own validator describes the stable (possibly host-stamped) copy.
  // Archive URLs always use the original output hash from the manifest.
  const headers = new Headers({
    ETag: `"${hash}"`,
    'X-Release-Id': current.id,
    'Cache-Control': 'public, max-age=31536000, immutable, no-transform',
  });
  if (
    request.headers
      .get('If-None-Match')
      ?.split(',')
      .some((tag) => tag.trim().replace(/^W\//, '') === `"${hash}"` || tag.trim() === '*')
  )
    return new Response(null, { status: 304, headers });
  const sourceRequest = new Request(
    archive.status === 304 ? url : new URL('/' + path, url),
    request,
  );
  sourceRequest.headers.delete('If-None-Match');
  const asset =
    archive.status !== 404 && archive.status !== 304
      ? archive
      : await env.ASSETS.fetch(sourceRequest);
  if (asset.status === 404) return null;
  const combined = new Headers(asset.headers);
  headers.forEach((value, name) => combined.set(name, value));
  return encoded(request, new Response(asset.body, { status: asset.status, headers: combined }));
}

async function dispatch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/admin/')) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (RELEASES.test(url.pathname)) {
    if (url.pathname.startsWith('/data/releases/')) {
      const asset = await env.ASSETS.fetch(request);
      const output = await currentOutput(request, env, url, asset);
      if (output) return output;
    }
    const limited = await rateLimitReleaseRead(request, env);
    if (limited) return limited;
    return publicApi(request, env, url);
  }

  // Route static assets through the finalizer too: runtime noindex applies to every response.
  if (!DATA_FILE.test(url.pathname)) {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
  }

  const origin = (env.SITE_ORIGIN || url.origin).replace(/\/+$/, '');
  const sigmaUrl = env.SIGMA_URL || '';
  let data: ReleaseData;
  try {
    data = await releaseData(env, url.origin);
  } catch (e) {
    console.error(e);
    return unavailable();
  }
  if (DATA_FILE.test(url.pathname)) return dataFile(request, env, data, origin);
  const release = {
    id: data.releaseId,
    dataBase: data.dataBase,
    origin,
    sigmaUrl,
    feedbackEmail: env.FEEDBACK_EMAIL || '',
  };
  // the address the screen is drawn from: the query its screen reads, nothing else; null for a path that is not a screen (it is never kept)
  const search = screenSearch(url.pathname, url.search);
  const screenUrl = new URL(url);
  if (search !== null) screenUrl.search = search;
  const screenRequest = screenUrl.search === url.search ? request : new Request(screenUrl, request);
  const scope: Scope = {
    url: screenUrl,
    origin,
    releaseId: data.releaseId,
    dataBase: data.dataBase,
    sigmaUrl,
    feedbackEmail: release.feedbackEmail,
    state: requestState(screenUrl.searchParams.get('per')),
    data: new Map(),
    load: data.load,
  };
  const embed = url.pathname.startsWith('/embed/');
  // HEAD reads the entry GET stored (headers only) but never draws one into the cache
  const head = request.method === 'HEAD';
  const cache = search !== null ? edge() : undefined;
  const key = cacheKey(data.releaseId, screenUrl);
  const fromCache = async () => {
    const hit = cache ? await cache.match(key) : undefined;
    if (!hit) return null;
    const res = documentHeaders(hit, env, embed, data.releaseId, 'HIT');
    return head
      ? new Response(null, { status: res.status, headers: res.headers })
      : encoded(request, res);
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
  // claim the miss before any await, so an identical miss arriving meanwhile waits for this one; the finally settles it on every exit
  const settle = cache && !head ? claim(key.url) : () => {};
  let stored: Promise<unknown> = Promise.resolve();
  try {
    // every request that reaches the renderer counts against the client's limit (cached screens do not)
    const limited = await rateLimitRender(request, env);
    if (limited) return limited;
    const res = await withinCap(() =>
      scopes.run(scope, () => handler(screenRequest, { cloudflare: { env, ctx }, release })),
    );
    if (!res) return unavailable('Сайтът е претоварен. Опитайте отново след малко.');
    const cacheable = !!cache && !head && res.status === 200 && !scope.degraded;
    if (cacheable) {
      const copy = new Response(res.clone().body, { status: res.status, headers: res.headers });
      copy.headers.set(
        'Cache-Control',
        `public, max-age=${['/proverka', '/novo'].includes(screenUrl.pathname) ? 60 : 86400}`,
      );
      stored = cache.put(key, copy).catch(() => {});
      ctx.waitUntil(stored);
    }
    return encoded(
      request,
      documentHeaders(
        res,
        env,
        embed,
        data.releaseId,
        cacheable ? 'MISS' : 'BYPASS',
        !!scope.degraded,
      ),
    );
  } finally {
    void stored.then(settle, settle); // the waiting misses look the entry up once it is stored
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let res: Response;
    try {
      res = await dispatch(request, env, ctx);
    } catch {
      res = Response.json(
        { error: 'service unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
      );
    }
    return finalizeResponse(request, res, env);
  },
} satisfies ExportedHandler<Env>;
