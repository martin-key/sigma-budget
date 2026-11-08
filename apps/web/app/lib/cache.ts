export interface RoutePolicy {
  screen: string;
  query: readonly string[];
  periods: 'none' | 'all' | readonly string[];
  cache: { ttl: number };
}
export const cached = (ttl: number) => () => ({
  'Cache-Control': ttl ? `public, max-age=0, s-maxage=${ttl}` : 'no-store',
});

/** Raw per stays in the key: aliases and canonical addresses have different notices. */
export const screenCacheKey = (build: string, release: string, url: URL) =>
  new Request(`https://ssr.cache/${build}/${release || 'none'}${url.pathname}${url.search}`);
