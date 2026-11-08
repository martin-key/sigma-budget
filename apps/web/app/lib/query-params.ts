import type { WebRoute } from './routes';
import { match } from '../../client/routes.js';
export const SCREEN_QUERY = ['per', 'demo'];
const keeps = (route: WebRoute, k: string) =>
  SCREEN_QUERY.includes(k) || (route.query || []).includes(k);
/** the part of a parsed query that the server draws the screen of `route` from */
export const screenQuery = (route: WebRoute, q: Record<string, string>) =>
  Object.fromEntries(Object.entries(q || {}).filter(([k]) => keeps(route, k)));
/** the search of a request URL that the server draws its screen from, in the order of the address ('' or '?a=1&b=2'); null when the path
 *  is not the address of a screen (an old address that js/redirects.js forwards, a file, an unknown path): it keeps its whole query */
export function screenSearch(pathname: string, search: string) {
  const segs = String(pathname)
    .split('/')
    .filter(Boolean)
    .map((x) => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    });
  const m = match(segs);
  if (!m) return null;
  const all = new URLSearchParams(search);
  const kept = [...all].filter(([k]) => keeps(m.route, k));
  if (kept.length === [...all].length) return String(search).replace(/^\?$/, '');
  const s = new URLSearchParams(kept).toString();
  return s ? '?' + s : '';
}
