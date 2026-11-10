/** SEARCH validation only. Source: pipeline/budget_pipeline/validate/search_feed.py. */
import { pythonNumberAt } from '../common/numbers.js';
import { parseSearchJson } from './search-json.js';
import { Check, fmt, isnum, pyRepr as baseRepr, pyTruth } from './checks.js';
import { Context } from './context.js';
import {
  executionGet,
  executionInteger,
  executionItems,
  executionIterable,
  executionRequired,
} from './execution-python.js';
import { entry, FIELDS, GROUPS, parse, run } from './search-reference.js';
import {
  asciiDigits,
  digitClass,
  isPrintable,
  spaceClass,
  trim,
  wordClass,
} from './search-unicode.js';

function pyRepr(value: unknown): string {
  if (typeof value === 'string') {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    let out = quote;
    for (const ch of value) {
      const cp = ch.codePointAt(0)!;
      if (ch === quote || ch === '\\') out += '\\' + ch;
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (!isPrintable(ch))
        out +=
          cp < 256
            ? `\\x${cp.toString(16).padStart(2, '0')}`
            : cp < 65536
              ? `\\u${cp.toString(16).padStart(4, '0')}`
              : `\\U${cp.toString(16).padStart(8, '0')}`;
      else out += ch;
    }
    return out + quote;
  }
  if (Array.isArray(value))
    return `[${value.map((v, i) => reprAt(value, String(i), v)).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([k, v]) => `${pyRepr(k)}: ${reprAt(value, k, v)}`)
      .join(', ')}}`;
  return baseRepr(value);
}
function reprAt(holder: object, key: string, value: unknown): string {
  return typeof value === 'number' && pythonNumberAt(holder, key, value).kind === 'float'
    ? floatRepr(value)
    : pyRepr(value);
}

const nbsp = '\u00a0',
  nnbsp = '\u202f';
function cleanText(c: Check, label: string, s: unknown): void {
  if (!c.ok(typeof s === 'string' && trim(s) !== '', `${label}: empty or not a string`)) return;
  const text = s as string;
  c.ok(text === trim(text), `${label}: leading or trailing space`);
  c.ok(
    !/[ \u00a0\u202f]{2,}|[\t\r\n]/.test(text),
    `${label}: double space or line break: ${pyRepr(text)}`,
  );
  c.ok(
    !text.includes('..') && !/[ \u00a0][,.;:!?]/.test(text),
    `${label}: stray dot or a space before punctuation: ${pyRepr(text)}`,
  );
  c.ok(
    !new RegExp(
      `(?<!${wordClass})(?:None|null|NaN|undefined)(?!${wordClass})|%[sd]|[{}"]`,
      'u',
    ).test(text),
    `${label}: placeholder or ASCII quote: ${pyRepr(text)}`,
  );
  c.ok(!text.toLowerCase().includes('private channel'), `${label}: mentions a private channel`);
}
function amounts(
  c: Check,
  label: string,
  text: string,
  money: unknown[],
  floats: boolean[] = [],
): void {
  const num = `(−)?(${digitClass}{1,3}(?:${nnbsp}${digitClass}{3})+|${digitClass}+)(?:,(${digitClass}+))?`;
  const patterns = [
    new RegExp(num + `${nbsp}(млрд|млн|хил)\\.${nbsp}€`, 'gu'),
    new RegExp(num + `${nbsp}€`, 'gu'),
    new RegExp(num + '%', 'gu'),
  ];
  const units: Record<string, number> = { млрд: 1000, млн: 1, хил: 0.001 };
  for (let k = 0; k < patterns.length; k++) {
    const got = [...text.matchAll(patterns[k]!)].map((m) => {
      const n =
          Number(asciiDigits(m[2]!.replaceAll(nnbsp, '') + (m[3] ? '.' + m[3] : ''))) *
          (m[1] ? -1 : 1),
        f = k === 0 ? units[m[4]!]! : 1;
      return [n * f, 0.5 * 10 ** -(m[3]?.length ?? 0) * f];
    });
    const want = k === 0 ? money : [];
    c.ok(
      got.length === want.length &&
        got.every(([g, t], i) => isnum(want[i]) && Math.abs(g! - (want[i] as number)) <= t! + 1e-9),
      `${label}: amounts in ${['млн. €', '€', '%'][k]} are [${got.map((x) => floatRepr(Number(fmt(x[0], 4).replaceAll(nnbsp, '').replace(',', '.')))).join(', ')}], expected [${want.map((x, i) => (floats[i] && typeof x === 'number' ? floatRepr(x) : pyRepr(x))).join(', ')}]`,
    );
  }
}
function floatRepr(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'nan' : n < 0 ? '-inf' : 'inf';
  if (Object.is(n, -0)) return '-0.0';
  if (n !== 0 && (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e16)) {
    const [mantissa, exponent] = n.toExponential().split('e');
    const exp = Number(exponent);
    return `${mantissa}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return Number.isInteger(n) ? `${n}.0` : String(n);
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function hashable<T>(value: T): T {
  if (value !== null && typeof value === 'object')
    throw new TypeError(`unhashable type: '${Array.isArray(value) ? 'list' : 'dict'}'`);
  return value;
}
function stringAt(holder: object, key: string, value: unknown): string {
  return typeof value === 'string' ? value : reprAt(holder, key, value);
}
function articleNumber(s: string): number {
  const value = asciiDigits(trim(s));
  if (!/^[+-]?[0-9]+(?:_[0-9]+)*$/.test(value)) {
    const e = new Error(`invalid literal for int() with base 10: ${pyRepr(s)}`);
    e.name = 'ValueError';
    throw e;
  }
  return Number(value.replaceAll('_', ''));
}
function billAmount(value: unknown): number {
  if (typeof value === 'number' || typeof value === 'boolean') return Number(value) / 1000;
  const type =
    value === null || value === undefined
      ? 'NoneType'
      : Array.isArray(value)
        ? 'list'
        : typeof value === 'string'
          ? 'str'
          : 'dict';
  throw new TypeError(`unsupported operand type(s) for /: '${type}' and 'int'`);
}
export function search(ctx: Context): Check {
  const c = new Check('SEARCH');
  // Keep JSON number lexemes: Python distinguishes an integer group index from 1.0.
  const get = (name: string): any => parseSearchJson(ctx.text(name));
  const s = get('search-index.json');
  c.ok(
    equal(Object.keys(s).sort(), ['fields', 'groups', 'items', 'meta', 'version']) &&
      (s.version === 1 || s.version === true),
    `search-index keys ${pyRepr(Object.keys(s).sort())}`,
  );
  c.ok(
    equal(executionRequired(s, 'groups'), GROUPS) && equal(executionRequired(s, 'fields'), FIELDS),
    'groups/fields differ from the contract of searchlib.js',
  );
  const mi = get('ministries.json'),
    mu = get('municipalities.json'),
    me = get('measures.json');
  const gl = get('glossary.json'),
    cat = get('catalog.json'),
    pr = get('programs.json'),
    bill = get('budget2027.json');
  const miItems = executionIterable(executionRequired(mi, 'items'));
  const articleCodes = new Map<number, string>(
    miItems.map((b: any) => [b.art + (b.art >= 32 ? 1 : 0), b.id]),
  );
  const budgets = new Map<string, any>();
  for (const [a, b] of executionItems(
    executionRequired(executionRequired(bill, 'budgets'), 'bill'),
  )) {
    const article = articleNumber(a);
    if (article >= 2) budgets.set(articleCodes.get(article) ?? 'art' + a, b);
  }
  const measures = new Map<
    string,
    { row: any; cell: any; gap: any; publication: string; table: string }
  >();
  for (const table of ['II_7', 'II_8'])
    for (const [ordinal, row] of executionIterable(
      executionRequired(executionRequired(bill, 'forecast'), table),
    ).entries())
      for (const [column, period] of ['2027.draft', '2028.forecast', '2029.forecast'].entries()) {
        const href = `#/merki?per=${period}&to=s12-${table}-${ordinal}-${column}`;
        measures.set(href, {
          row,
          cell: executionGet(executionRequired(row, 'cells'), String(column)),
          gap: executionGet(executionRequired(row, 'gaps'), String(column)),
          publication: `${column === 0 ? 'Проект' : 'Прогноза'} ${period.slice(0, 4)}`,
          table,
        });
      }
  const muItems = executionIterable(executionRequired(mu, 'items'));
  const meItems = executionIterable(executionRequired(me, 'items'));
  const terms = executionIterable(executionRequired(gl, 'terms'));
  const datasets = executionIterable(executionRequired(cat, 'datasets'));
  const ids: Record<string, Set<string>> = {
    vedomstvo: new Set(miItems.map((x: any) => hashable(executionRequired(x, 'id')))),
    obshtina: new Set(muItems.map((x: any) => hashable(executionRequired(x, 'id')))),
    merki: new Set(meItems.map((x: any) => hashable(executionRequired(x, 'id')))),
    rechnik: new Set(terms.map((x: any) => hashable(executionRequired(x, 'slug')))),
    danni: new Set(datasets.map((x: any) => hashable(executionRequired(x, 'slug')))),
  };
  for (const id of budgets.keys()) ids.vedomstvo!.add(id);
  const fields: Record<string, number> = Object.fromEntries(
    executionIterable(executionRequired(pr, 'fields')).map((n: string, i: number) => [
      hashable(n),
      i,
    ]),
  );
  const programs = executionIterable(executionRequired(pr, 'items'));
  const codes = new Set(
    programs.map((p: any) => hashable(executionRequired(p, executionRequired(fields, 'code')))),
  );
  const routes = ctx.routes(),
    seen = new Set<string>(),
    per = GROUPS.map(() => 0),
    rows5 = new Map<string, any>();
  const seenCurrent = new Set<string>(),
    seenMeasures = new Set<string>();
  let mock = 0;
  const items = executionIterable(executionRequired(s, 'items'));
  for (const [i, r] of items.entries()) {
    const tag = `row ${i} ${Array.isArray(r) && r.length > 1 ? reprAt(r, '1', r[1]) : pyRepr(r)}`;
    const integer =
      Array.isArray(r) &&
      (typeof r[0] === 'boolean' ||
        (typeof r[0] === 'number' && pythonNumberAt(r, '0', r[0]).kind === 'int'));
    if (
      !c.ok(
        Array.isArray(r) &&
          r.length === FIELDS.length &&
          integer &&
          Number(r[0]) >= 0 &&
          Number(r[0]) < GROUPS.length &&
          r.slice(1).every((x: unknown) => typeof x === 'string'),
        `${tag}: shape`,
      )
    )
      continue;
    const group = Number(r[0]);
    per[group]!++;
    cleanText(c, `${tag} title`, r[1]);
    c.ok(
      r[3] === '' ||
        (new RegExp(digitClass, 'u').test(r[3]) && '€%'.includes(r[3].at(-1))) ||
        r[3].endsWith(' от БВП'),
      `${tag}: value ${pyRepr(r[3])}`,
    );
    c.ok(['real', 'mock', 'pending'].includes(r[5]), `${tag}: status ${pyRepr(r[5])}`);
    c.ok(
      r[6].startsWith('#/') && routes.match(r[6]) !== null,
      `${tag}: href ${pyRepr(r[6])} opens no screen`,
    );
    if (group === 3 && r[6].startsWith('#/merki?')) {
      const expected = measures.get(r[6]);
      if (c.ok(expected !== undefined, `${tag}: unexpected current measure destination`)) {
        const { row, cell, gap, publication, table } = expected!;
        c.ok(
          r[1] === trim(row.label.replace(new RegExp(`${spaceClass}+`, 'gu'), ' ')),
          `${tag}: current measure label`,
        );
        c.ok(
          r[4] === publication && r[2].includes('Таблица ' + table.replace('_', '-')),
          `${tag}: current measure publication`,
        );
        if (cell != null)
          amounts(
            c,
            tag,
            r[3],
            [executionRequired(cell, 'value')],
            [
              typeof cell.value === 'number' &&
                pythonNumberAt(cell, 'value', cell.value).kind === 'float',
            ],
          );
        else
          c.ok(
            r[3] === '' && pyTruth(gap) && r[2].includes(gap),
            `${tag}: missing printed measure cell must remain blank`,
          );
        seenMeasures.add(r[6]);
      }
    }
    const m = /^#\/(vedomstvo|obshtina|merki|rechnik|danni)\/([^/?#]+)(?:\/([^/?#]+))?/.exec(r[6]);
    if (m) {
      c.ok(ids[m[1]!]!.has(m[2]!), `${tag}: ${m[1]} id ${pyRepr(m[2])} is not in its dataset`);
      if (group === 1 && r[4] === 'Проект 2027' && m[1] === 'vedomstvo') {
        const budget = budgets.get(m[2]!);
        c.ok(
          budget !== undefined && r[6].includes('per=2027.draft'),
          `${tag}: current bill budget or period missing`,
        );
        if (pyTruth(budget)) {
          const source = executionIterable(executionRequired(budget, 'rows')).find(
            (x: any) => executionRequired(x, 'no') === 'II.',
          );
          const cell = source === undefined ? null : executionRequired(source, 'cell');
          amounts(
            c,
            tag,
            r[3],
            pyTruth(cell) ? [billAmount(executionRequired(cell, 'value'))] : [],
            [true],
          );
          seenCurrent.add(m[2]!);
        }
      }
      if (m[3] && m[1] === 'vedomstvo')
        c.ok(codes.has(m[3]), `${tag}: programme code ${pyRepr(m[3])} is not in programs.json`);
    }
    const key = JSON.stringify([group, r[1], r[6]]);
    c.ok(!seen.has(key), `${tag}: duplicate row`);
    seen.add(key);
    if (group === 5) rows5.set(r[6], r);
    if (r[5] === 'mock') {
      mock++;
      c.ok(group === 5, `${tag}: a mock row outside the datasets group`);
    }
  }
  const nProg = programs.filter((p: any) =>
    pyTruth(executionRequired(p, executionRequired(fields, 'name'))),
  ).length;
  for (const [g, n] of [
    [1, budgets.size + nProg],
    [2, muItems.length],
    [3, meItems.length + measures.size],
    [4, terms.length],
  ])
    c.ok(per[g!] === n, `${GROUPS[g!]}: ${per[g!]} rows, the datasets hold ${n}`);
  const sameSet = (a: Set<string>, b: Iterable<string>) => {
    const bb = new Set(b);
    return a.size === bb.size && [...a].every((x) => bb.has(x));
  };
  c.ok(sameSet(seenCurrent, budgets.keys()), 'current bill budgets: missing or extra search rows');
  c.ok(sameSet(seenMeasures, measures.keys()), 'current measures: missing or extra search rows');
  c.ok(per[0]! >= 15, `indicators: only ${per[0]} rows`);
  const real = datasets.filter((d: any) => executionRequired(d, 'status') === 'real');
  c.ok(
    per[5] === real.length,
    `datasets: ${per[5]} rows, the catalog has ${real.length} real datasets`,
  );
  c.ok(mock === 0, `mock rows: ${mock}, expected none`);
  for (const d of datasets) {
    const slug = stringAt(d, 'slug', executionRequired(d, 'slug'));
    const r = rows5.get(`#/danni/${slug}`);
    const status = executionRequired(d, 'status');
    if (status === 'real')
      c.ok(r && r[5] === 'real', `datasets: ${slug} has no row or a different status`);
    else
      c.ok(!r, `datasets: ${slug} is ${stringAt(d, 'status', status)} and must have no search row`);
  }
  const entries = items.map((r: any) => {
    const index = executionInteger(executionRequired(r, 0), 'index', r, '0');
    const group = executionRequired(GROUPS, index);
    return entry(
      group,
      executionRequired(r, 1),
      executionRequired(r, 2),
      executionRequired(r, 7),
      executionRequired(r, 4),
      executionRequired(r, 3),
      executionRequired(r, 5),
      executionRequired(r, 6),
    );
  });
  for (const q of ['ДДС', 'дълг', 'Пловдив', 'образование', 'МВР', 'пенсии', 'заплати'])
    c.ok(run(entries, parse(q)).hits.length > 0, `the popular query ${pyRepr(q)} finds nothing`);
  c.ok(
    run(entries, parse('МВР')).hits[0]?.href === '#/vedomstvo/1300?per=2027.draft',
    'МВР: the first hit is not the ministry of the interior',
  );
  c.ok(
    run(entries, parse('дълг')).hits[0]?.href.startsWith('#/dalg'),
    'дълг: the first hit is not a debt screen',
  );
  c.fact(
    `${items.length} rows (${per.map((n, i) => `${n} ${GROUPS[i]}`).join(' + ')}), ${mock} mock`,
  );
  return c;
}
