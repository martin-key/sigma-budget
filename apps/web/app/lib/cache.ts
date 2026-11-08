export interface RoutePolicy {
  screen: string;
  query: readonly string[];
  periods: 'none' | 'all' | readonly string[];
  cache: { ttl: number };
}
export const cached = (ttl: number) => () => ({
  'Cache-Control': ttl ? `public, max-age=0, s-maxage=${ttl}` : 'no-store',
});
