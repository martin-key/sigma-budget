// Shared screen catalogue: edit routes.json. Both the web app and the Python pipeline
// apply the defaults below. Legacy pages and React route modules consume the same metadata.
// The legacy facade exposes ROUTES as window.__ROUTES__ for browser checks.
import catalogue from './routes.json' with { type: 'json' };

export const GROUPS = catalogue.groups;
export interface WebRoute {
  id: string;
  key: string;
  pattern: string | null;
  file: string;
  title: string;
  group: string;
  icon: string;
  step: number | null;
  next: string[];
  parent: string | null;
  phase: number;
  nav: boolean;
  samples: string[];
  desc: string;
  periods: 'all' | 'none' | string[];
  short: string;
  query: string[];
  bare?: boolean;
}

type RouteOptions = Partial<
  Omit<WebRoute, 'id' | 'key' | 'pattern' | 'file' | 'title' | 'group' | 'icon'>
>;
type RouteRecord = [string, string, string | null, string, string, string, string, RouteOptions?];
const R = (
  id: string,
  key: string,
  pattern: string | null,
  file: string,
  title: string,
  group: string,
  icon: string,
  o: Partial<WebRoute> = {},
): WebRoute => ({
  id,
  key,
  pattern,
  file,
  title,
  group,
  icon,
  step: null,
  next: ['S01'],
  parent: null,
  phase: 1,
  nav: true,
  samples: [],
  desc: '',
  periods: 'all',
  short: '',
  query: [],
  ...o,
});

export const ROUTES: WebRoute[] = catalogue.routes.map((record) => R(...(record as RouteRecord)));
for (const r of ROUTES) {
  if (!r.samples.length && r.pattern) r.samples = ['#' + r.pattern];
}
