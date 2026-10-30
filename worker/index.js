// Cloudflare Worker in front of the static files (Workers Static Assets, wrangler.jsonc). The platform serves every file of dist/
// before this code runs (/prihodi -> prihodi.html, /data/core.json, /css/…); the Worker only answers what has no file:
//   /embed/*        the embed view is not prerendered: the app shell (dist/app.html) builds it in the browser; not for indexing, and made to be
//                   framed by other sites (the _headers of every other path forbid that: frame-ancestors 'self', X-Frame-Options)
//   anything else   the 404 screen (dist/404.html) with status 404, so a mistyped address is not a page of its own for search engines
// No state, no storage, no outside requests: the read-only API and the release registry of docs/approach-specification.md come later.
export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    const embed = url.pathname.startsWith('/embed/');
    const file = await env.ASSETS.fetch(new Request(new URL(embed ? '/app' : '/404', url), request));
    const headers = new Headers(file.headers);
    if (embed) {
      headers.set('X-Robots-Tag', 'noindex');
      headers.delete('X-Frame-Options');
      const csp = headers.get('Content-Security-Policy');
      if (csp) headers.set('Content-Security-Policy', csp.replace(/frame-ancestors [^;]*/, 'frame-ancestors *'));
    }
    return new Response(file.body, { status: embed ? 200 : 404, headers });
  }
};
