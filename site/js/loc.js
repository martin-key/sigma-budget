// The address of a screen. Every screen has its own path (/prihodi/dds?per=2026.draft): the server draws each one into the first response,
// for search engines and for the first paint (docs/adr/0002-react-router-ssr.md). The old hash addresses (#/prihodi/dds) still open: the router
// reads them and rewrites the address bar to the path.
// Hash mode: with window.__HASH_ROUTES__ set before boot, the app keeps the hash addresses of V6 (links, the address bar, history).
// The v6 checks in tools/mock/ run in this mode (they set it with an init script), so their hash expectations stay valid.
// Code that builds a link writes the internal form '/prihodi/dds?x=1' (or the old '#/prihodi/dds') and passes it through toHref().

import { serverScope } from './env.js';

/** the site root, wherever the current page is (/razhodi/obrazovanie loads its files from the root, not from /razhodi/). On the server
 *  (js/env.js) the site is at the root of its host; the scope of the request knows the host */
const SERVER_ROOT = { get href() { return (serverScope()?.origin || 'https://server.invalid') + '/'; }, pathname: '/', toString() { return this.href; } };
export const ROOT = typeof document === 'undefined' ? SERVER_ROOT : new URL('../', import.meta.url);
export const BASE = ROOT.pathname;                                     // '/' when the site is served at the root of its host
export const HASH = typeof window !== 'undefined' && !!window.__HASH_ROUTES__;

/** '#/x?y' | '/x?y' | 'x?y' -> '/x?y' (the internal form; the base is not part of it) */
export function internal(a) {
  let s = String(a ?? '').replace(/^#/, '');
  if (!HASH && BASE !== '/' && s.startsWith(BASE)) s = '/' + s.slice(BASE.length);
  return s.startsWith('/') ? s : '/' + s;
}
/** the link to an address in the active mode: '/x?y' -> '/x?y' (path mode) or '#/x?y' (hash mode) */
export const toHref = a => (HASH ? '#' : BASE.slice(0, -1)) + internal(a);
/** a full URL for the address (share links, embed code, canonical) */
export const absolute = (a, origin) => new URL(toHref(a), origin || serverScope()?.origin || location.href).href;

/** the current address, internal form '/x?y'. In path mode an old hash address (#/x) in the address bar wins: it is a link from V6 */
export function here() {
  const sc = serverScope();
  if (sc) return internal(sc.url.pathname).replace(/\/index\.html$/, '/') + sc.url.search;     // the server: the request's address
  if (HASH || location.hash.startsWith('#/')) return internal(location.hash || '#/');
  return internal(location.pathname).replace(/\/index\.html$/, '/') + location.search;     // /index.html is the start page
}
/** the address bar's own string for the current address, to compare with toHref() */
export const hereHref = () => (HASH ? location.hash : location.pathname + location.search);
/** the path and query of the current address: { path:'/x', query:'y' } */
export function parts(a = here()) { const i = a.indexOf('?'); return i < 0 ? { path: a, query: '' } : { path: a.slice(0, i), query: a.slice(i + 1) }; }

/** a file name ends in an extension that starts with a letter (.json, .woff2); a program code such as /vedomstvo/0200/0200.01.00 is a screen */
export const FILE_EXT = /\.[a-z][a-z0-9]{0,4}$/i;

/** a link of the app (to a screen), as opposed to a file (/data/core.json), a fragment (#main) or another site */
export function isAppHref(h) {
  if (!h || typeof h !== 'string') return false;
  if (h.startsWith('#/')) return true;
  if (HASH || h.startsWith('#')) return false;
  let u;
  try { u = new URL(h, location.href); } catch { return false; }
  return u.origin === location.origin && u.pathname.startsWith(BASE) && !FILE_EXT.test(u.pathname) && !NOT_SCREENS.test(u.pathname.slice(BASE.length - 1));
}
/** addresses of the server that are files or JSON, not screens: the data files and the release API (/api itself is the S25 screen) */
const NOT_SCREENS = /^\/(data\/|api\/releases(\/|$))/;
export const isAppLink = a => !!a && isAppHref(a.getAttribute('href'));

/** path mode: an old '#/x' link written by a page, a data file (search index, feed) or a component becomes '/x' in the DOM, so that
 *  crawlers, „Open in new tab“ and the server's HTML all see the path; a file link relative to the root (data/core.json) becomes
 *  /data/core.json, which also holds on /danni/execution. Hash mode: nothing to do (every page is the root document). */
const LINKS = 'a[href^="#/"],a[href^="data/"]';
// a data file of the visit's release (js/data.js); data/releases/… is the address of a release itself and stays as it is
const dataBaseOf = () => { const b = (typeof document === 'undefined' ? '' : document.querySelector('meta[name="data-base"]')?.content) || ''; return /^\/data\/(releases\/[0-9a-f]{64}\/data\/)?$/.test(b) ? b : ''; };
export const fileHref = (h, base = dataBaseOf()) => (base && h.startsWith('data/') && !h.startsWith('data/releases/') ? base + h.slice(5) : BASE + h);
const fixOne = a => { const h = a.getAttribute('href'); a.setAttribute('href', h.startsWith('#/') ? toHref(h) : fileHref(h)); };
export function fixLinks(root) {
  if (HASH || !root || !root.querySelectorAll) return;
  if (root.matches?.(LINKS)) fixOne(root);
  for (const a of root.querySelectorAll(LINKS)) fixOne(a);
}
export function watchLinks() {
  if (HASH || typeof MutationObserver === 'undefined') return;
  fixLinks(document.body);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') { if (m.target.matches?.(LINKS)) fixOne(m.target); continue; }
      for (const n of m.addedNodes) if (n.nodeType === 1) fixLinks(n);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
}
