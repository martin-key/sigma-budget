// The search of the MCP tools (apps/web/workers/mcp/tools.ts `search` and `fetch`): the index of the site's own search (apps/web/client/searchlib.js:
// data/search-index.json, the annual figures of this release, the screens and the glossary), plus the traps and the methodology of the catalog,
// which an assistant needs before it compares two numbers. Every result has an id that `fetch` opens:
//   term:<slug>      a glossary term            dataset:<slug>   a data set of the catalog
//   trap:<id>        a trap of the catalog       method:<id>      a methodology note
//   page:<address>   a page of the site, with every figure the index has for it
import {
  parse,
  run,
  entry,
  fromDoc,
  fromRoutes,
  fromGlossary,
  oldAnnual,
  annualSearch,
  groupLabel,
  metaOf as resultLine,
} from '../../client/searchlib.js';
import { internal } from '../../client/loc.js';
import { PendingError } from '../../client/data.js';
import { catalog, load, pageUrl, type Ctx } from './data';

export type Entry = ReturnType<typeof entry> & { id?: string };

const KIND: Record<string, string> = { notes: 'Бележки за данните' };
const kindOf = (group: string) => KIND[group] || groupLabel(group);

/** the id `fetch` opens for an index entry */
export function idOf(e: Entry): string {
  if (e.id) return e.id;
  const address = internal(e.href);
  const term = /^\/rechnik\/([^/?#]+)$/.exec(address);
  if (term) return 'term:' + decodeURIComponent(term[1]!);
  const set = /^\/danni\/([^/?#]+)$/.exec(address);
  if (set) return 'dataset:' + decodeURIComponent(set[1]!);
  return 'page:' + address;
}

const firstSentence = (s: string) => {
  const m = /^(.{20,200}?[.!?])(\s|$)/.exec(s.trim());
  return m ? m[1]! : s.trim().slice(0, 200);
};

/** a file the index can do without: a file that is not in the release (pending) is left out; one that cannot be read fails the call */
async function optional<T>(ctx: Ctx, name: string): Promise<T | null> {
  try {
    return await load<T>(ctx, name);
  } catch (e) {
    if (e instanceof PendingError) return null;
    throw e;
  }
}

async function build(ctx: Ctx): Promise<Entry[]> {
  const doc = await optional<{ items?: unknown[] }>(ctx, 'search-index');
  const entries: Entry[] = doc ? fromDoc(doc).filter((e: Entry) => !oldAnnual(e)) : [];
  const [outlook, revenue, expenditure] = await Promise.all(
    ['outlook', 'revenue', 'expenditure'].map((n) => optional<{ byPeriod?: unknown }>(ctx, n)),
  );
  if (outlook?.byPeriod && revenue?.byPeriod && expenditure?.byPeriod)
    entries.push(...annualSearch(outlook, revenue, expenditure));
  entries.push(...fromRoutes());
  if (!entries.some((e) => e.group === 'terms')) {
    const glossary = await optional(ctx, 'glossary');
    if (glossary) entries.push(...fromGlossary(glossary));
  }
  const cat = await catalog(ctx);
  for (const [kind, notes, anchor] of [
    ['trap', cat.traps, 's24-t-'],
    ['method', cat.methodology, 's24-m-'],
  ] as const)
    for (const n of notes || [])
      entries.push({
        ...entry('notes', n.title, {
          sub: firstSentence(n.text),
          kw: n.text,
          href: `#/danni?to=${anchor}${n.id}`,
        }),
        id: `${kind}:${n.id}`,
      });
  return entries;
}

const indexes = new Map<string, Promise<Entry[]>>();
/** the entries of the release, built once per isolate and release */
export function index(ctx: Ctx): Promise<Entry[]> {
  const key = ctx.data.releaseId;
  let p = indexes.get(key);
  if (!p) {
    p = build(ctx);
    indexes.set(key, p);
    while (indexes.size > 2) indexes.delete(indexes.keys().next().value as string);
    p.catch(() => {
      if (indexes.get(key) === p) indexes.delete(key);
    });
  }
  return p;
}
export const resetIndexes = () => indexes.clear();

export interface Result {
  id: string;
  title: string;
  url: string;
  kind: string;
  text?: string;
  value?: string;
  status?: string;
}

/** the best results for a query, one per id; `fuzzy`: nothing matched exactly, these are the near misses */
export async function search(ctx: Ctx, query: string, limit = 10) {
  const toks = parse(query);
  if (!toks.length) return { results: [] as Result[], fuzzy: false };
  const { hits, fuzzy } = run(await index(ctx), toks);
  const seen = new Set<string>();
  const results: Result[] = [];
  for (const e of hits as Entry[]) {
    const id = idOf(e);
    if (seen.has(id)) continue;
    seen.add(id);
    const line = resultLine(e);
    results.push({
      id,
      title: e.title,
      url: pageUrl(ctx, e.href),
      kind: kindOf(e.group),
      ...(line ? { text: line } : {}),
      ...(e.value ? { value: e.value } : {}),
      ...(e.status !== 'real' ? { status: e.status } : {}),
    });
    if (results.length >= limit) break;
  }
  return { results, fuzzy };
}

/** every index entry of one page (an institution, its policies and programmes; the annual figures of a period) */
export async function entriesOf(ctx: Ctx, id: string): Promise<Entry[]> {
  return (await index(ctx)).filter((e) => idOf(e) === id);
}
