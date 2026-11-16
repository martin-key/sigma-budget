// The typed query lists of routes.ts are complete: the edge cache keys a drawn screen on them alone (apps/web/workers/app.ts).
//
// The server draws a screen from the keys of its route only (`query` in the route table and SCREEN_QUERY, query-params.ts screenSearch), as
// СИГМА does (midt-bg/sigma, apps/web/app/lib/query-params.ts and its drift test). A key that a page reads but its route does not list still
// works in the browser, but the first paint from the server ignores it. This check reads every page module of a route and finds the keys it
// reads or writes:
//   ctx.query.x, ctx.query?.x, ctx.query['x']   a read
//   setQuery({ x: … })                          a write
//   query: 'x' or query: 'x=…' or `x=…`         a control of ui/ (seg, tabs, chips, forms, treemap-list) that writes ?x=
//   data-query="x…"                             a control that writes ?x= (js/actions.js)
//   query: true                                 a sortable table of ui/table.js: ?sort= and ?dir=
//   QUERY_KEYS = [...], CONTROL_KEYS = [...]     the keys a page names itself
// and the keys of the sample addresses of every route. Each must be in the route's list. A read through another name (const q = ctx.query)
// is not found here, so the lists stay the source of truth and this check is the floor under them.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTES, type WebRoute } from './routes';
import { SCREEN_QUERY } from './query-params';

const PAGES = fileURLToPath(new URL('../../client/pages/', import.meta.url));
// an identifier as Python's [a-zA-Z_]\w* reads it (\w is Unicode there)
const KEY = String.raw`[a-zA-Z_][\p{L}\p{N}_]*`;
const READS = [
  new RegExp(String.raw`ctx\.query\??\.(${KEY})`, 'gu'),
  new RegExp(String.raw`ctx\.query\[['"](${KEY})['"]\]`, 'gu'),
  new RegExp(String.raw`\bquery:\s*['"\x60](${KEY})`, 'gu'),
  new RegExp(String.raw`data-query="(${KEY})`, 'gu'),
];
const SET_QUERY = /setQuery\(\{([^}]*)\}/g;
const SET_KEY = new RegExp(String.raw`(?:^|,)\s*(${KEY})\s*:`, 'gu');
const NAMED = /\b(?:QUERY_KEYS|CONTROL_KEYS)\s*=\s*\[([^\]]*)\]/g;
const STRINGS = /'([^']*)'/g;

const groups = (rx: RegExp, src: string) => [...src.matchAll(rx)].map((m) => m[1]!);

/** the query keys a page module reads or writes */
function keysOf(src: string): Set<string> {
  const found = new Set<string>();
  for (const rx of READS) for (const k of groups(rx, src)) found.add(k);
  for (const body of groups(SET_QUERY, src)) for (const k of groups(SET_KEY, body)) found.add(k);
  for (const body of groups(NAMED, src)) for (const k of groups(STRINGS, body)) found.add(k);
  if (/\bquery:\s*true\b/.test(src)) for (const k of ['sort', 'dir']) found.add(k);
  return found;
}

type Route = Pick<WebRoute, 'id' | 'pattern' | 'file' | 'query' | 'samples'>;

/** every problem of the query lists, and the number of screens whose page module was read */
function queryProblems(
  routes: readonly Route[],
  every: readonly string[],
  page: (file: string) => string | null,
): { problems: string[]; screens: number } {
  const problems: string[] = [];
  let screens = 0;
  for (const route of routes) {
    const src = page(route.file);
    if (src === null) {
      problems.push(`${route.id}: no page module apps/web/client/pages/${route.file}.js`);
      continue;
    }
    screens += 1;
    const found = keysOf(src);
    for (const sample of route.samples) {
      const query = sample.includes('?') ? sample.slice(sample.indexOf('?') + 1) : '';
      for (const key of new URLSearchParams(query).keys()) found.add(key);
    }
    found.delete('to'); // the scroll target: the browser's, never part of the screen
    const missing = [...found].filter((k) => !route.query.includes(k) && !every.includes(k)).sort();
    if (missing.length)
      problems.push(
        `${route.id} ${route.pattern} (${route.file}): reads ${missing.join(', ')}, not in its query list`,
      );
  }
  return { problems, screens };
}

const readPage = (file: string) => {
  const path = PAGES + file + '.js';
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

describe('the query each screen is drawn and cached by', () => {
  it('the shared query keeps raw per, demo and the display unit', () => {
    // raw per selects a visible notice, so it must survive query filtering even for aliases and unknown values
    expect(SCREEN_QUERY).toEqual(['per', 'demo', 'unit']);
  });

  it("every key the pages read is in its route's query list", () => {
    const { problems, screens } = queryProblems(ROUTES, SCREEN_QUERY, readPage);
    expect(problems).toEqual([]);
    expect(screens).toBeGreaterThan(0);
  });

  it('finds every kind of read and write', () => {
    const src = [
      'const a = ctx.query.po, b = ctx.query?.vid, c = ctx.query["kod"], d = ctx.query[\'red\'];',
      'seg({ query: \'izgled\', options }); tabs({ query: "tab" }); chips({ query: `filtar=${x}` });',
      '<button data-query="godina=2026">',
      "setQuery({ sravni: 1, nivo: 'x' }); table({ query: true });",
      "const QUERY_KEYS = ['q1', 'q2']; const CONTROL_KEYS = ['c1'];",
      'const other = ctx.queryX; query: 5; setQuery(x);',
    ].join('\n');
    expect([...keysOf(src)].sort()).toEqual(
      [
        'po',
        'vid',
        'kod',
        'red',
        'izgled',
        'tab',
        'filtar',
        'godina',
        'sravni',
        'nivo',
        'sort',
        'dir',
        'q1',
        'q2',
        'c1',
      ].sort(),
    );
  });

  it('reports a key that is not listed, a missing page module and a retired screen that keeps an address', () => {
    const route = (o: Partial<Route>): Route => ({
      id: 'S99',
      pattern: '/test',
      file: 's99-test',
      query: ['po'],
      samples: [],
      ...o,
    });
    const pages: Record<string, string> = {
      's99-test': 'ctx.query.po; ctx.query.per; ctx.query.to; ctx.query.vid',
    };
    const page = (file: string) => pages[file] ?? null;
    expect(queryProblems([route({})], SCREEN_QUERY, page)).toEqual({
      problems: ['S99 /test (s99-test): reads vid, not in its query list'],
      screens: 1,
    });
    expect(
      queryProblems(
        [route({ query: ['po', 'vid'], samples: ['/test?po=1&nivo=&to=x'] })],
        SCREEN_QUERY,
        page,
      ).problems,
    ).toEqual(['S99 /test (s99-test): reads nivo, not in its query list']);
    expect(queryProblems([route({ file: 'nyama' })], SCREEN_QUERY, page)).toEqual({
      problems: ['S99: no page module apps/web/client/pages/nyama.js'],
      screens: 0,
    });
  });
});
