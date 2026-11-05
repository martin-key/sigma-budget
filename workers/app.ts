// The Worker of the site (docs/adr/0002-react-router-ssr.md). The platform serves the static files of the client build first (css/, js/,
// data/, vendor/, images); the Worker answers the rest:
//   /admin/*                            the operator API (worker/admin.js), behind Cloudflare Access and checked again there
//   anything but GET and HEAD           405: the public routes never write
//   /api/releases*, /data/releases/*    the public, read-only release API (worker/api.js)
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
    release: { id: string; dataBase: string; origin: string; sigmaUrl: string };
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
const RELEASES = /^\/(api\/releases(\/|$)|data\/releases\/)/;

/* the headers that site/_headers (tools/site/build.py) gives the static files, for the documents the Worker draws. no-transform: a zone
   feature that edits HTML on the way out (the Web Analytics beacon, Email Obfuscation, Rocket Loader) must not change the screens */
function documentHeaders(res: Response, env: Env, embed: boolean, rid: string): Response {
  const h = new Headers(res.headers);
  h.set('Content-Security-Policy', CSP + (embed ? '; frame-ancestors *' : "; frame-ancestors 'self'"));
  if (!embed) h.set('X-Frame-Options', 'SAMEORIGIN');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  if (!h.has('Cache-Control') || res.status === 200) h.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
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
    if (RELEASES.test(url.pathname)) return publicApi(request, env, url);

    const origin = (env.SITE_ORIGIN || url.origin).replace(/\/+$/, '');
    const sigmaUrl = env.SIGMA_URL || '';
    const data = await releaseData(env, url.origin);
    const release = { id: data.releaseId, dataBase: data.dataBase, origin, sigmaUrl };
    const scope: Scope = { url, origin, releaseId: data.releaseId, dataBase: data.dataBase, sigmaUrl,
      state: requestState(url.searchParams.get('per')), data: new Map(), load: data.load };
    const res = await scopes.run(scope, () => handler(request, { cloudflare: { env, ctx }, release }));
    return documentHeaders(res, env, url.pathname.startsWith('/embed/'), data.releaseId);
  },
} satisfies ExportedHandler<Env>;
