// The request a screen is drawn for (docs/adr/0002-react-router-ssr.md). In the browser there is one: the page's own address,
// <meta> tags and storage, and serverScope() is null. On the server (workers/app.ts) every request has its own scope, kept in
// AsyncLocalStorage, so two requests that interleave in one Worker never see each other's address, period or data:
//   { url: URL, origin: 'https://…', releaseId, dataBase, sigmaUrl, state: { period, … }, data: Map(name -> json), load(name) -> Promise<json> }
// js/loc.js, js/seo.js, js/store.js and js/data.js read the scope when there is one.
let provider = null;
/** the scope of the current server request, or null in the browser */
export const serverScope = () => (provider ? provider() : null);
/** the server installs its scope provider once (workers/app.ts) */
export function provideScope(fn) { provider = fn; }
