// The release the MCP tools read (apps/web/workers/mcp/handler.ts): the files of the current release, exactly as the screens get them
// (apps/web/workers/release-data.ts: the registry, else the static files of the build), parsed once per isolate and release, and the
// addresses a tool answer links to, so the model can cite the page and the file of every number.
import { internal } from '../../client/loc.js';
import { href } from '../../client/routes.js';
import type { ReleaseData } from '../release-data';

export interface Ctx {
  env: Env;
  /** the public address of the site (SITE_ORIGIN), else the address of the request */
  origin: string;
  data: ReleaseData;
}

/* A parsed file is kept per release: a release never changes, and the same few files (the catalog, core, the index) serve most calls.
   Eight entries hold even the two big files (budget2027.json, budget2027-provenance.json) next to the small ones. */
const LIMIT = 8;
const parsed = new Map<string, Promise<unknown>>();

/** a data file of the release as it is published: execution.json keeps its decimal strings (client/data.js turns them into numbers for
 *  the screens and keeps the file on `canonical`) */
export function load<T = unknown>(ctx: Ctx, name: string): Promise<T> {
  const key = ctx.data.releaseId + ':' + name;
  const cached = parsed.get(key);
  if (cached) {
    parsed.delete(key);
    parsed.set(key, cached);
    return cached as Promise<T>;
  }
  const p = ctx.data.load(name).then((v) => (v as { canonical?: unknown } | null)?.canonical ?? v);
  parsed.set(key, p);
  while (parsed.size > LIMIT) parsed.delete(parsed.keys().next().value as string);
  p.catch(() => {
    if (parsed.get(key) === p) parsed.delete(key); // an unreadable file is asked for again next time
  });
  return p as Promise<T>;
}
/** forget the parsed files (tests) */
export const resetParsed = () => parsed.clear();

/** the page of the site for an in-app address ('#/x?y' of the index, or '/x?y') */
export const pageUrl = (ctx: Ctx, address: string) => ctx.origin + internal(address);
/** the page of a screen: screenUrl(ctx, 'S24', {set: 'execution'}) -> https://…/danni/execution */
export const screenUrl = (
  ctx: Ctx,
  id: string,
  params: Record<string, string> = {},
  query: Record<string, string> = {},
) => ctx.origin + href(id, params, query);
/** the address of a file of this very release (/data/releases/<id>/data/<name>.json from the registry, else /data/<name>.json) */
export const fileUrl = (ctx: Ctx, name: string) =>
  ctx.origin + (ctx.data.dataBase || '/data/') + name + '.json';

/* ------------------------------------------------------------------ the files every tool reads */

export interface CatalogSet {
  id: string;
  slug: string;
  file?: string | null;
  fileTemplate?: string;
  parts?: { code: string; file: string; bytes?: number }[];
  title: string;
  description?: string;
  group: string;
  status: string;
  source?: string[];
  period?: string;
  asOf?: string;
  unit?: string;
  mediaType?: string;
  bytes?: number;
  screens?: string[];
  pending?: string[];
  expected?: string;
  mock?: boolean;
  schema?: { key: string; type: string; length?: number }[];
}
export interface Note {
  id: string;
  title: string;
  text: string;
  related?: string[];
}
export interface Catalog {
  meta: Record<string, unknown>;
  groups: { id: string; label: string }[];
  datasets: CatalogSet[];
  traps: Note[];
  methodology: Note[];
}
export interface SourceRecord {
  title: string;
  publisher?: string;
  url?: string;
  kind?: string;
  access?: string;
  note?: string;
}
export interface Core {
  meta: Record<string, unknown>;
  build: Record<string, unknown>;
  sources: Record<string, SourceRecord>;
  pending: Record<string, { id: string; title: string; reason?: string; expected?: string }>;
}

export const catalog = (ctx: Ctx) => load<Catalog>(ctx, 'catalog');
export const core = (ctx: Ctx) => load<Core>(ctx, 'core');

/** the data file of a set, as load() names it: data/outlook.json -> outlook; null for a set without one JSON file */
export const fileName = (set: Pick<CatalogSet, 'file' | 'mediaType'>) =>
  set.file && /\.json$/.test(set.file)
    ? set.file.replace(/^data\//, '').replace(/\.json$/, '')
    : null;

/** the sources of a set or a file by id, with the publisher and the address of each */
export function sources(c: Core, ids: unknown) {
  return (Array.isArray(ids) ? ids : [])
    .filter((id): id is string => typeof id === 'string')
    .map((id) => {
      const s = c.sources[id];
      return s
        ? { id, title: s.title, publisher: s.publisher, url: s.url, note: s.note }
        : { id, title: id };
    });
}

/** the meta block of a file, the fields a citation needs */
export function metaOf(file: unknown) {
  const m = ((file as { meta?: Record<string, unknown> } | null)?.meta ?? {}) as Record<
    string,
    unknown
  >;
  const pick = ['id', 'title', 'status', 'source', 'sourceNote', 'asOf', 'retrieved', 'unit'];
  const out: Record<string, unknown> = {};
  for (const k of pick) if (m[k] !== undefined) out[k] = m[k];
  if (Array.isArray(m.pending) && m.pending.length) out.pending = m.pending;
  if (m.mock) out.mock = true;
  return out;
}
