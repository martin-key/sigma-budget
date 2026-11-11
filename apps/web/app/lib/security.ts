// The content security policy of every document (apps/web/public/index.html had it as a <meta>; the Worker also sends it as a header, apps/web/workers/app.ts)
export const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'";

type PolicyEnv = Pick<Env, 'ENVIRONMENT' | 'NOINDEX'>;
export function responseHeaders(path: string, env: PolicyEnv): Headers {
  const embed = path.startsWith('/embed/');
  const publicData =
    path === '/api/releases' || path.startsWith('/api/releases/') || path.startsWith('/data/');
  const h = new Headers({
    'Content-Security-Policy': CSP + (embed ? '; frame-ancestors *' : "; frame-ancestors 'self'"),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': publicData || embed ? 'cross-origin' : 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  });
  if (!embed) h.set('X-Frame-Options', 'SAMEORIGIN');
  if (env.ENVIRONMENT !== 'production' || env.NOINDEX === '1' || embed)
    h.set('X-Robots-Tag', 'noindex');
  if (publicData) {
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET, HEAD');
    h.set('Access-Control-Expose-Headers', 'ETag, X-Release-Id, Retry-After');
  }
  return h;
}

/** Outermost boundary: includes early returns, errors, static fallbacks and cache hits. */
export function finalizeResponse(request: Request, response: Response, env: PolicyEnv): Response {
  const h = new Headers(response.headers);
  for (const [key, value] of responseHeaders(new URL(request.url).pathname, env)) {
    // Route policies (sandbox, stricter framing/referrer policies, etc.) take precedence.
    // Cache-Control and Content-Disposition are outside the defaults and stay untouched.
    if (!h.has(key)) h.set(key, value);
    // Environment noindex must also apply when a route already carries another robots directive.
    else if (key === 'x-robots-tag' && !/\bnoindex\b/i.test(h.get(key) || '')) h.append(key, value);
  }
  h.delete('Access-Control-Allow-Credentials');
  if (new URL(request.url).pathname.startsWith('/embed/')) h.delete('X-Frame-Options');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  });
}

/** Emit the identical policy at build time as defense in depth for Static Assets. */
export function staticResponseHeaders(env: PolicyEnv): string {
  return (
    ['/*', '/data/*', '/embed/*']
      .map((pattern) => {
        const path = pattern === '/*' ? '/' : pattern.replace('*', 'example');
        const entries = [...responseHeaders(path, env)].map(([key, value]) => `  ${key}: ${value}`);
        if (pattern !== '/*')
          entries.unshift(...[...responseHeaders('/', env).keys()].map((key) => `  ! ${key}`));
        return [pattern, ...entries].join('\n');
      })
      .join('\n') + '\n'
  );
}
