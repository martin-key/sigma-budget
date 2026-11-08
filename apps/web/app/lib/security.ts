// The content security policy of every document (apps/web/public/index.html had it as a <meta>; the Worker also sends it as a header, apps/web/workers/app.ts)
export const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'";
