// The bindings and variables of the Worker (wrangler.jsonc).
interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OBJECTS: R2Bucket;
  ENVIRONMENT: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  SERVICE_TOKENS: string;
  OPERATORS?: string;
  /** the public address of the site (canonical links, the sitemap); empty: the address of the request */
  SITE_ORIGIN?: string;
  /** the address of the original СИГМА (docs/approach-specification.md, section 2.2) */
  SIGMA_URL?: string;
  /** "1" keeps the environment out of search engines (staging) */
  NOINDEX?: string;
}

declare module 'virtual:react-router/server-build' {
  import type { ServerBuild } from 'react-router';
  const build: ServerBuild;
  export = build;
}
