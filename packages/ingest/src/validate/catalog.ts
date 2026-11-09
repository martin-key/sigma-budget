/** Independent ports of the Python CORE and CATALOG validation groups. */
import { readFileSync } from 'node:fs';
import { Check, fmt, gzipSize, isnum, pyRepr, pyTruth } from './checks.js';
import { Context, files, safePath } from './context.js';
import { pythonNumberAt } from '../common/numbers.js';
import { catalogIntegerRepr, catalogIntegerText } from './catalog-integer.js';

const sources = [
  'budget2027',
  'kfp',
  'asbp',
  'bill',
  'zdb',
  'zbdoo',
  'zbnzok',
  'prb',
  'parliament',
  'eurostat',
  'bnb',
  'nap',
  'sebra',
  'gisco',
  'dataeuropa',
  'minfin',
  'wg',
  'ec-oil',
  'excise-law',
  'customs-excise-law',
  'nsi-pack',
];
const months = [
  'януари',
  'февруари',
  'март',
  'април',
  'май',
  'юни',
  'юли',
  'август',
  'септември',
  'октомври',
  'ноември',
  'декември',
];
const internal = [
  'gdoc',
  'lovable',
  'artifact-files',
  'sources/',
  '/lov',
  'state/',
  'scripts/',
  'playbook',
];
const formats: Record<string, string> = {
  JSON: 'application/json',
  GeoJSON: 'application/geo+json',
  RSS: 'application/rss+xml',
};
function error(name: string, message: string): never {
  const e = new Error(message);
  e.name = name;
  throw e;
}
function kind(v: any): string {
  return v === null
    ? 'NoneType'
    : Array.isArray(v)
      ? 'list'
      : typeof v === 'object'
        ? 'dict'
        : typeof v === 'number'
          ? Number.isInteger(v)
            ? 'int'
            : 'float'
          : typeof v === 'boolean'
            ? 'bool'
            : typeof v === 'string'
              ? 'str'
              : 'NoneType';
}
function get(v: any, k: any): any {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean')
    error('TypeError', `'${kind(v)}' object is not subscriptable`);
  if (Array.isArray(v) || typeof v === 'string') {
    if (typeof k !== 'number' || !Number.isInteger(k))
      error('TypeError', `${kind(v)} indices must be integers or slices, not ${kind(k)}`);
    const i = k < 0 ? v.length + k : k;
    if (i < 0 || i >= v.length) error('IndexError', `${kind(v)} index out of range`);
    return v[i];
  }
  if (!contains(v, k)) error('KeyError', pyRepr(k));
  return v[k];
}
function opt(v: any, k: string, fallback: any = null): any {
  if (v === null || typeof v !== 'object' || Array.isArray(v))
    error('AttributeError', `'${kind(v)}' object has no attribute 'get'`);
  return Object.hasOwn(v, k) ? v[k] : fallback;
}
function iterable(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [...v];
  if (v && typeof v === 'object') return Object.keys(v);
  return error('TypeError', `'${kind(v)}' object is not iterable`);
}
function entries(v: any): [string, any][] {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    error('AttributeError', `'${kind(v)}' object has no attribute 'items'`);
  return Object.entries(v);
}
function len(v: any): number {
  if (typeof v === 'string') return [...v].length;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return error('TypeError', `object of type '${kind(v)}' has no len()`);
}
function equal(a: any, b: any): boolean {
  if (typeof a === 'boolean' && typeof b === 'number') return Number(a) === b;
  if (typeof b === 'boolean' && typeof a === 'number') return a === Number(b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  )
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
    );
  return a === b;
}
function uniq(values: any[]): any[] {
  const result: any[] = [];
  for (const value of values) {
    if (value && typeof value === 'object') error('TypeError', `unhashable type: '${kind(value)}'`);
    if (!result.some((other) => equal(value, other))) result.push(value);
  }
  return result;
}
const sameSet = (a: any, b: any) => {
  const aa = uniq(iterable(a)),
    bb = uniq(iterable(b));
  return aa.length === bb.length && aa.every((x) => bb.includes(x));
};
const pstr = (v: any): string => (typeof v === 'string' ? v : pyRepr(v));
function starts(v: any, x: string): boolean {
  if (typeof v !== 'string')
    error('AttributeError', `'${kind(v)}' object has no attribute 'startswith'`);
  return v.startsWith(x);
}
function contains(v: any, needle: any): boolean {
  if (typeof v === 'string') {
    if (typeof needle !== 'string')
      error('TypeError', "'in <string>' requires string as left operand, not " + kind(needle));
    return v.includes(needle);
  }
  if (Array.isArray(v)) return v.some((x) => equal(x, needle));
  if (v && typeof v === 'object') {
    if (needle !== null && typeof needle === 'object')
      error('TypeError', "unhashable type: '" + kind(needle) + "'");
    return typeof needle === 'string' && Object.hasOwn(v, needle);
  }
  return error('TypeError', `argument of type '${kind(v)}' is not iterable`);
}
function pySlice(v: any, start: number): any {
  if (typeof v === 'string' || Array.isArray(v)) return v.slice(start);
  return error('TypeError', `'${kind(v)}' object is not subscriptable`);
}
function pyMethod(v: any, method: string): string {
  if (typeof v !== 'string')
    return error('AttributeError', `'${kind(v)}' object has no attribute '${method}'`);
  return v;
}
function strField(v: any): boolean {
  return typeof v === 'string' && !!strip(v);
}
function strip(value: string): string {
  return value.replace(
    /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
    '',
  );
}
function number(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return Number(v);
  return error('TypeError', `unsupported operand type: '${kind(v)}'`);
}

function monthName(holder: any, field: string): string {
  const value = get(holder, field);
  if (typeof value !== 'number' && typeof value !== 'boolean')
    error('TypeError', `unsupported operand type(s) for -: '${kind(value)}' and 'int'`);
  const index = number(value) - 1;
  if (
    !Number.isInteger(index) ||
    (typeof value === 'number' && pythonNumberAt(holder, field, value).kind === 'float')
  )
    error('TypeError', 'tuple indices must be integers or slices, not float');
  const actual = index < 0 ? months.length + index : index;
  if (actual < 0 || actual >= months.length) error('IndexError', 'tuple index out of range');
  return months[actual]!;
}
function pythonInt(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'boolean') return Number(value);
  if (typeof value !== 'string')
    error(
      'TypeError',
      `int() argument must be a string, a bytes-like object or a real number, not '${kind(value)}'`,
    );
  const text = catalogIntegerText(value);
  if (!/^[+-]?\d(?:_?\d)*$/.test(text))
    error(
      'ValueError',
      `invalid literal for int() with base 10: ${[...catalogIntegerRepr(value)].slice(0, 200).join('')}`,
    );
  const decimal = text.replaceAll('_', '');
  const digits = decimal.replace(/^[+-]/, '').length;
  if (digits > 4300)
    error(
      'ValueError',
      `Exceeds the limit (4300 digits) for integer string conversion: value has ${digits} digits; use sys.set_int_max_str_digits() to increase the limit`,
    );
  return Number(decimal);
}
function pythonMonth(v: any): number {
  if (typeof v !== 'number' && typeof v !== 'boolean')
    error('TypeError', `unsupported operand type(s) for %: '${kind(v)}' and 'int'`);
  const n = number(v);
  return (((n % 12) + 12) % 12) + 1;
}

export function core(ctx: Context): Check {
  const c = new Check('CORE'),
    core = ctx.get('core.json'),
    ex = ctx.get('execution.json'),
    o = ctx.get('outlook.json'),
    e = ctx.get('expenditure.json'),
    r = ctx.get('revenue.json'),
    debt = ctx.get('debt.json'),
    mins = ctx.get('ministries.json'),
    progs = ctx.get('programs.json'),
    gl = ctx.get('glossary.json'),
    mu = ctx.get('municipalities.json'),
    me = ctx.get('measures.json');
  c.ok(
    sameSet(core, [
      'meta',
      'build',
      'years',
      'sources',
      'pending',
      'counts',
      'population',
      'kpis',
      'functions',
      'revenueGroups',
    ]),
    `core keys ${pyRepr(iterable(core).sort())}`,
  );
  const b = get(core, 'build'),
    dataver = get(b, 'dataVersion');
  const latest = () => get(ex, 'latest'),
    kpis = () => get(core, 'kpis');
  if (typeof dataver !== 'string')
    error('TypeError', `expected string or bytes-like object, got '${kind(dataver)}'`);
  c.ok(
    /^\d{4}-\d{2}-\d{2}\.\d+$/.test(dataver) && dataver.startsWith(ctx.buildDate),
    `build.dataVersion ${pyRepr(dataver)}`,
  );
  c.ok(
    equal(get(b, 'kfpLatest'), get(latest(), 'asOf')) &&
      equal(get(latest(), 'asOf'), get(kpis(), 'asOf')) &&
      equal(get(kpis(), 'asOf'), get(get(core, 'meta'), 'asOf')),
    'build.kfpLatest / kpis.asOf / meta.asOf must equal execution.latest.asOf',
  );
  const ms = get(get(get(ex, 'data'), '2026'), 'months');
  c.ok(equal(get(b, 'kfpMonths2026'), Array.isArray(ms) ? len(ms) : ms), 'build.kfpMonths2026');
  c.ok(
    equal(get(b, 'kfpMonths2026'), get(latest(), 'month')) &&
      equal(get(latest(), 'month'), get(kpis(), 'month')),
    'kfpMonths2026 vs execution.latest.month vs kpis.month',
  );
  const nxt = get(get(ex, 'pendingMonths'), 0),
    count = get(b, 'kfpMonths2026');
  c.ok(
    equal(get(b, 'kfpNext'), get(nxt, 'asOf')) && equal(get(nxt, 'month'), pythonMonth(count)),
    'build.kfpNext must be the first pending month of execution.json',
  );
  c.ok(equal(get(b, 'eurRate'), 1.95583), `build.eurRate ${pstr(get(b, 'eurRate'))}`);
  const years = get(core, 'years'),
    oy = get(o, 'years');
  c.ok(
    equal(get(years, 'list'), oy) &&
      equal(
        iterable(oy).map((y) => get(get(years, 'vintage'), String(y))),
        get(o, 'vintage'),
      ),
    'years must equal outlook',
  );
  const src = get(core, 'sources');
  c.ok(
    equal(iterable(src).sort(), [...sources].sort()),
    `sources: keys ${pyRepr(iterable(src).sort())}`,
  );
  for (const [key, s] of entries(src)) {
    c.ok(
      ['title', 'publisher', 'kind', 'access'].every((x) => strField(opt(s, x))),
      `source ${key}: title/publisher/kind/access`,
    );
    c.ok(
      ['xls', 'pdf', 'html', 'doc', 'api', 'generator'].includes(opt(s, 'kind')) &&
        ['open', 'browser-only', 'none'].includes(opt(s, 'access')),
      `source ${key}: kind ${pyRepr(opt(s, 'kind'))} / access ${pyRepr(opt(s, 'access'))}`,
    );
    if (pyTruth(opt(s, 'url')))
      c.ok(starts(get(s, 'url'), 'https://'), `source ${key}: url ${pyRepr(get(s, 'url'))}`);
    c.ok(
      iterable(s).every((x) => ['title', 'publisher', 'url', 'kind', 'access', 'note'].includes(x)),
      `source ${key}: keys ${pyRepr(iterable(s).sort())}`,
    );
  }
  const routes = ctx.routes(),
    pending = get(core, 'pending');
  c.ok(
    equal(
      iterable(pending).sort(),
      Array.from({ length: 7 }, (_, i) => `P0${i + 1}`),
    ),
    `pending ids ${pyRepr(iterable(pending).sort())}`,
  );
  for (const [key, p] of entries(pending)) {
    c.ok(
      get(p, 'status') === 'pending' &&
        equal(get(p, 'id'), key) &&
        ['title', 'reason', 'expected'].every((x) => strField(opt(p, x))),
      `pending ${key}: shape`,
    );
    c.ok(
      pyTruth(get(p, 'source')) && iterable(get(p, 'source')).every((x) => contains(src, x)),
      `pending ${key}: source keys`,
    );
    c.ok(
      pyTruth(get(p, 'screens')) && iterable(get(p, 'screens')).every((x) => routes.ids.has(x)),
      `pending ${key}: screens ${pstr(get(p, 'screens'))}`,
    );
  }
  const p04 = opt(pending, 'P04', {}),
    nas = get(nxt, 'asOf'),
    ny = nas.slice(0, 4),
    reason = opt(p04, 'reason', ''),
    title = opt(p04, 'title', '');
  c.ok(
    starts(title, `Отчетът към ${nas.split('-').reverse().join('.')} г.`) &&
      contains(reason, `за ${monthName(nxt, 'month')} ${ny} г. още не е добавен`) &&
      pyMethod(reason, 'endswith').endsWith(
        `е за ${monthName(latest(), 'month')} ${get(latest(), 'asOf').slice(0, 4)} г.`,
      ),
    `pending P04 must name the pending report ${nas} and the latest ${get(latest(), 'asOf')}`,
  );
  const n = get(core, 'counts'),
    mfiles = ctx.jsonFiles().filter((f) => f.startsWith('ministries/')),
    data = get(ex, 'data');
  const reports = entries(data).reduce((sum, [, v]) => sum + len(get(v, 'files')), 0);
  const want = {
    functions: len(get(get(e, 'functions'), 'items')),
    budgets: len(get(mins, 'items')),
    programBudgets: mfiles.length,
    programs: len(get(progs, 'items')),
    terms: len(get(gl, 'terms')),
    municipalities: len(get(mu, 'items')),
    measures: len(get(me, 'items')),
    kfpReports: reports,
  };
  c.ok(equal(n, want), `counts ${pyRepr(n)} differ from the datasets ${pyRepr(want)}`);
  c.ok(
    equal(get(get(mins, 'totals'), 'count'), get(n, 'budgets')) &&
      equal(get(get(mins, 'programTotals'), 'budgets'), get(n, 'programBudgets')),
    'counts vs ministries.json totals',
  );
  c.ok(
    equal(opt(get(mu, 'totals'), 'count', get(n, 'municipalities')), get(n, 'municipalities')),
    'counts.municipalities vs municipalities.totals',
  );
  const p = get(core, 'population'),
    ser = get(p, 'series'),
    sy = get(ser, 'years'),
    persons = get(ser, 'persons');
  c.ok(
    len(sy) === len(persons) &&
      len(persons) === 7 &&
      equal(sy, [2020, 2021, 2022, 2023, 2024, 2025, 2026]) &&
      iterable(persons).every((x) => isnum(x) && x > 6e6),
    'population.series shape',
  );
  c.ok(
    equal(get(p, 'persons'), get(persons, -1)) &&
      equal(get(p, 'year'), get(sy, -1)) &&
      equal(get(sy, -1), 2026) &&
      equal(get(p, 'date'), '2026-01-01'),
    'population: persons/year/date vs the series',
  );
  const pro: any = ctx.proto('src/population.json');
  c.ok(
    equal(
      iterable(get(pro, 'years')).map((x) => pythonInt(x)),
      sy,
    ) && equal(get(pro, 'persons'), persons),
    'population.series must equal the frozen Eurostat series',
  );
  const k = kpis(),
    lat = get(latest(), 'kfp');
  for (const [key, row] of [
    ['revenue', 'rev'],
    ['expenditure', 'exp.total'],
    ['balance', 'balance'],
    ['capex', 'exp.capex'],
  ] as const) {
    const q = get(k, key),
      w = get(lat, row);
    c.ok(
      equal(get(q, 'planMln'), get(w, 'plan')) && equal(get(q, 'execMln'), get(w, 'cum')),
      `kpis.${key}: planMln/execMln vs execution.latest.${row}`,
    );
    if (key !== 'balance')
      c.ok(
        equal(get(q, 'execPct'), get(w, 'pctPlan')) && equal(opt(q, 'yoyPct'), opt(w, 'yoyPct')),
        `kpis.${key}: execPct/yoyPct`,
      );
    if (['revenue', 'expenditure', 'balance'].includes(key))
      c.ok(equal(get(q, 'prevYearMln'), get(w, 'prevYearCum')), `kpis.${key}: prevYearMln`);
    const href = get(q, 'href');
    c.ok(
      starts(href, '#/') && routes.match(href) !== null,
      `kpis.${key}: href ${pyRepr(href)} matches no route`,
    );
  }
  c.ok(
    ['revenue', 'expenditure', 'balance'].every((key) =>
      equal(get(get(k, key), 'planMln'), get(get(get(get(o, 'kfp'), key), 'mln'), 2)),
    ),
    'kpis plan values must equal Annex 3 2026 (outlook)',
  );
  const capexPct = get(get(k, 'capex'), 'pctGdp');
  const capexPlan = get(get(k, 'capex'), 'planMln');
  if (typeof capexPlan !== 'number' && typeof capexPlan !== 'boolean')
    error('TypeError', `unsupported operand type(s) for *: 'float' and '${kind(capexPlan)}'`);
  const capexNumerator = 100 * number(capexPlan),
    divisorValue = get(get(get(o, 'gdp'), 'mlnPrecise'), 2);
  if (typeof divisorValue !== 'number' && typeof divisorValue !== 'boolean')
    error('TypeError', `unsupported operand type(s) for /: 'float' and '${kind(divisorValue)}'`);
  const divisor = number(divisorValue);
  if (divisor === 0) error('ZeroDivisionError', 'float division by zero');
  c.near(capexPct, capexNumerator / divisor, 0.006, 'kpis.capex.pctGdp');
  const g = get(k, 'gdp');
  c.ok(
    equal(get(g, 'mln'), get(get(get(o, 'gdp'), 'mln'), 2)) &&
      equal(get(g, 'mlnPrecise'), get(get(get(o, 'gdp'), 'mlnPrecise'), 2)) &&
      equal(get(g, 'year'), 2026) &&
      equal(get(g, 'vintage'), 'plan'),
    'kpis.gdp vs outlook',
  );
  const z = get(debt, 'zdd'),
    kd = get(k, 'debt');
  c.ok(
    equal(get(kd, 'zddMln'), get(get(z, 'totalMln'), 2)) &&
      equal(get(kd, 'pctGdp'), get(get(z, 'pctGdp'), 2)) &&
      equal(get(kd, 'year'), 2026) &&
      equal(get(get(z, 'years'), 2), 2026) &&
      equal(get(kd, 'scope'), 'zdd'),
    'kpis.debt vs debt.zdd',
  );
  const cfValue = get(core, 'functions'),
    cfLength = len(cfValue);
  const efValue = get(get(e, 'functions'), 'items');
  c.ok(cfLength === len(efValue), 'core.functions length');
  const cf = iterable(cfValue),
    ef = iterable(efValue);
  for (let i = 0; i < Math.min(cf.length, ef.length); i++) {
    const a = cf[i],
      it = ef[i];
    c.ok(
      equal(
        [get(a, 'id'), get(a, 'name'), get(a, 'short'), get(a, 'mln')],
        [get(it, 'id'), get(it, 'name'), get(it, 'short'), get(get(it, 'mln'), 1)],
      ),
      `core.functions ${get(it, 'id')}: id/name/short/mln`,
    );
    c.near(
      get(a, 'pctGdp'),
      get(get(it, 'pctGdp'), 1),
      0.0011,
      `core.functions ${get(it, 'id')} pctGdp`,
    );
    c.near(
      get(a, 'share'),
      get(get(it, 'share'), 1),
      0.0011,
      `core.functions ${get(it, 'id')} share`,
    );
    c.near(
      get(a, 'yoyPct'),
      get(it, 'yoy2026Pct'),
      0.051,
      `core.functions ${get(it, 'id')} yoyPct`,
    );
  }
  const cgValue = get(core, 'revenueGroups'),
    cgLength = len(cgValue);
  const rgValue = get(r, 'groups');
  c.ok(cgLength === len(rgValue), 'core.revenueGroups length');
  const cg = iterable(cgValue),
    rg = iterable(rgValue);
  for (let i = 0; i < Math.min(cg.length, rg.length); i++) {
    const a = cg[i],
      gr = rg[i];
    c.ok(
      equal(
        [get(a, 'id'), get(a, 'name'), get(a, 'mln'), get(a, 'share')],
        [get(gr, 'id'), get(gr, 'name'), get(get(gr, 'mln'), 2), get(gr, 'share2026')],
      ),
      `core.revenueGroups ${get(gr, 'id')}`,
    );
  }
  c.fact(
    `core 2026: revenue ${fmt(get(get(k, 'revenue'), 'execMln'))} / ${fmt(get(get(k, 'revenue'), 'planMln'))}, expenditure ${fmt(get(get(k, 'expenditure'), 'execMln'))} / ${fmt(get(get(k, 'expenditure'), 'planMln'))}, balance ${fmt(get(get(k, 'balance'), 'execMln'))} / ${fmt(get(get(k, 'balance'), 'planMln'))}, debt ${fmt(get(kd, 'zddMln'))}; counts ${pstr(get(n, 'budgets'))} budgets, ${pstr(get(n, 'programs'))} programs, ${pstr(get(n, 'municipalities'))} municipalities; 7 pending blocks`,
  );
  return c;
}

function schema(obj: any): any[] {
  return entries(obj)
    .filter(([k]) => k !== 'meta')
    .map(([key, v]) => {
      const type =
        typeof v === 'boolean'
          ? 'boolean'
          : typeof v === 'number'
            ? 'number'
            : typeof v === 'string'
              ? 'string'
              : Array.isArray(v)
                ? 'array'
                : v !== null && typeof v === 'object'
                  ? 'object'
                  : 'null';
      return type === 'array' || type === 'object' ? { key, type, length: len(v) } : { key, type };
    });
}
function pageNeeds(ctx: Context): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const path of files(ctx.root, 'apps/web/client/pages')
    .filter((p) => /^s\d\d-.*\.js$/.test(p))
    .sort()) {
    const text = readFileSync(safePath(ctx.root, `apps/web/client/pages/${path}`), 'utf8');
    const match = /export const needs\s*=\s*\[([^\]]*)\]/.exec(text);
    if (match)
      result[path.slice(0, 3).toUpperCase()] = match[1]!
        .split(',')
        .map(strip)
        .filter(Boolean)
        .map((s) => s.replace(/^['"]+|['"]+$/g, ''));
  }
  return result;
}
export function catalog(ctx: Context): Check {
  const c = new Check('CATALOG'),
    cat = ctx.get('catalog.json'),
    core = ctx.get('core.json'),
    mins = ctx.get('ministries.json'),
    routes = ctx.routes().ids;
  c.ok(
    sameSet(cat, ['meta', 'groups', 'counts', 'datasets', 'traps', 'methodology', 'files']),
    `catalog keys ${pyRepr(iterable(cat).sort())}`,
  );
  const meta = get(cat, 'meta');
  c.ok(
    equal(get(meta, 'id'), 'D25') &&
      equal(get(meta, 'status'), 'real') &&
      equal(get(meta, 'source'), ['wg']),
    'catalog meta',
  );
  const groups = iterable(get(cat, 'groups')),
    gids = groups.map((x) => get(x, 'id'));
  c.ok(
    gids.length === uniq(gids).length &&
      groups.every((x) => typeof get(x, 'label') === 'string' && pyTruth(get(x, 'label'))),
    'groups',
  );
  const dss = iterable(get(cat, 'datasets')),
    slugs = dss.map((d) => get(d, 'slug'));
  c.ok(slugs.length === uniq(slugs).length, 'dataset slugs must be unique');
  const ids = dss.map((d) => get(d, 'id')),
    dup = uniq(ids.filter((i) => ids.filter((x) => equal(x, i)).length > 1)).sort();
  c.ok(equal(dup, ['D09', 'feed']), `ids may repeat only for D09 and feed: ${pyRepr(dup)}`);
  const listed = new Set<string>();
  let real = 0,
    mock = 0,
    pend = 0;
  for (const d of dss) {
    const sl = get(d, 'slug'),
      need = [
        'id',
        'slug',
        'title',
        'description',
        'group',
        'status',
        'source',
        'screens',
        'eager',
        'contains',
        'mock',
      ];
    const missing = need.filter((x) => !Object.hasOwn(d, x));
    c.ok(!missing.length, `${sl}: missing keys ${pyRepr(missing)}`);
    if (missing.length) continue;
    const status = get(d, 'status'),
      source = get(d, 'source'),
      screens = get(d, 'screens');
    c.ok(
      ['real', 'mock', 'pending'].includes(status) &&
        gids.includes(get(d, 'group')) &&
        equal(get(d, 'mock'), status === 'mock'),
      `${sl}: status/group/mock`,
    );
    c.ok(
      pyTruth(source) && iterable(source).every((x) => contains(get(core, 'sources'), x)),
      `${sl}: source keys ${pstr(source)}`,
    );
    c.ok(
      iterable(screens).every((x) => routes.has(x)) &&
        len(screens) === uniq(iterable(screens)).length,
      `${sl}: screens ${pstr(screens)}`,
    );
    c.ok(
      ['title', 'description'].every((x) => strField(get(d, x))),
      `${sl}: title/description`,
    );
    real += Number(status === 'real');
    mock += Number(status === 'mock');
    pend += Number(status === 'pending');
    if (status === 'pending') {
      c.ok(
        ['file', 'bytes', 'gzipBytes', 'schema'].every((x) => !Object.hasOwn(d, x)),
        `${sl}: a pending dataset has no file`,
      );
      const id = get(d, 'id'),
        pending = get(core, 'pending');
      c.ok(
        equal(sl, id.toLowerCase()) && equal(get(d, 'contains'), [id]) && contains(pending, id),
        `${sl}: pending id`,
      );
      const p = get(pending, id);
      c.ok(
        equal(get(d, 'title'), get(p, 'title')) &&
          equal(screens, get(p, 'screens')) &&
          equal(get(d, 'expected'), get(p, 'expected')) &&
          equal(source, get(p, 'source')),
        `${sl}: must equal core.pending.${id}`,
      );
      continue;
    }
    const asOf = opt(d, 'asOf');
    c.ok(
      typeof asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOf) && asOf <= ctx.buildDate,
      `${sl}: asOf ${pyRepr(asOf)}`,
    );
    const format = get(d, 'format'),
      media = get(d, 'mediaType');
    if (format !== null && typeof format === 'object')
      error('TypeError', "unhashable type: '" + kind(format) + "'");
    c.ok(
      equal(contains(formats, format) ? formats[format] : null, media),
      `${sl}: format/mediaType ${pstr(format)} / ${pstr(media)}`,
    );
    if (pyTruth(opt(d, 'fileTemplate'))) {
      const parts = iterable(get(d, 'parts')),
        template = get(d, 'fileTemplate');
      c.ok(
        get(d, 'file') === null && template === 'data/ministries/<код>.json',
        `${sl}: fileTemplate`,
      );
      const codes = parts.map((pp) => get(pp, 'code')),
        expected = get(get(core, 'counts'), 'programBudgets');
      c.ok(
        parts.length === uniq(codes).length && uniq(codes).length === expected,
        `${sl}: ${parts.length} parts, expected ${pstr(expected)}`,
      );
      const minids = iterable(get(mins, 'items')).map((m) => get(m, 'id'));
      c.ok(
        codes.every((cc) => minids.includes(cc)),
        `${sl}: part codes must be ministry ids`,
      );
      let total = 0,
        gz = 0;
      for (const pp of parts) {
        const file = get(pp, 'file'),
          code = get(pp, 'code'),
          rel = pyMethod(file, 'removeprefix').startsWith('data/') ? file.slice(5) : file;
        if (
          !c.ok(
            ctx.exists(rel) && file === `data/ministries/${code}.json`,
            `${sl}: part file ${pstr(file)}`,
          )
        )
          continue;
        listed.add(file.slice(5));
        const raw = ctx.bytes(rel),
          size = raw.length,
          gzip = gzipSize(raw);
        c.ok(
          equal(get(pp, 'bytes'), size) && equal(get(pp, 'gzipBytes'), gzip),
          `${sl}: part ${code} bytes ${pstr(get(pp, 'bytes'))}/${pstr(get(pp, 'gzipBytes'))} vs ${size}/${gzip}`,
        );
        total += size;
        gz += gzip;
      }
      c.ok(
        equal(get(d, 'bytes'), total) && equal(get(d, 'gzipBytes'), gz),
        `${sl}: bytes/gzipBytes ${pstr(get(d, 'bytes'))}/${pstr(get(d, 'gzipBytes'))} must be the sums of the parts ${total}/${gz}`,
      );
      continue;
    }
    const file = get(d, 'file'),
      rel = pySlice(file, 5);
    c.ok(starts(file, 'data/') && ctx.exists(rel), `${sl}: file ${pstr(file)} does not exist`);
    if (!ctx.exists(rel)) continue;
    listed.add(rel);
    const raw = ctx.bytes(rel),
      size = raw.length,
      gzip = gzipSize(raw);
    if (get(d, 'id') === 'D25')
      c.ok(
        !Object.hasOwn(d, 'bytes') && !Object.hasOwn(d, 'gzipBytes'),
        `${sl}: the catalog must not state its own size`,
      );
    else
      c.ok(
        equal(get(d, 'bytes'), size) && equal(get(d, 'gzipBytes'), gzip),
        `${sl}: bytes/gzipBytes ${pstr(opt(d, 'bytes'))}/${pstr(opt(d, 'gzipBytes'))} vs the file ${size}/${gzip} (rebuild the catalog)`,
      );
    if (['JSON', 'GeoJSON'].includes(format)) {
      const doc = ctx.get(rel),
        m = opt(doc, 'meta', {});
      c.ok(
        equal(status, opt(m, 'status')) &&
          equal(get(d, 'mock'), pyTruth(opt(m, 'mock', false))) &&
          sameSet(source, opt(m, 'source', [])),
        `${sl}: status/mock/source vs meta`,
      );
      for (const kk of ['asOf', 'unit'])
        if (Object.hasOwn(d, kk))
          c.ok(
            equal(get(d, kk), opt(m, kk)),
            `${sl}: ${kk} ${pyRepr(get(d, kk))} vs meta ${pyRepr(opt(m, kk))}`,
          );
      const mid = pyMethod(opt(m, 'id', ''), 'split').split('+');
      if (mid.every((x: string) => /^[DMP]\d\d$/.test(x)))
        c.ok(
          sameSet(get(d, 'contains'), mid),
          `${sl}: contains ${pstr(get(d, 'contains'))} vs meta.id ${pstr(opt(m, 'id'))}`,
        );
      else
        c.ok(
          equal(get(d, 'contains'), get(d, 'id') === 'core' ? ['D18'] : []) &&
            equal(opt(m, 'id'), sl),
          `${sl}: contains ${pstr(get(d, 'contains'))} vs meta.id ${pstr(opt(m, 'id'))}`,
        );
      c.ok(
        sameSet(opt(d, 'pending', []), opt(m, 'pending', [])),
        `${sl}: pending ${pstr(opt(d, 'pending'))} vs meta.pending ${pstr(opt(m, 'pending'))}`,
      );
      c.ok(
        equal(opt(d, 'schema'), schema(doc)),
        `${sl}: schema differs from the top-level keys of the file`,
      );
    }
    c.ok(equal(get(d, 'eager'), get(d, 'id') === 'core'), `${sl}: only core.json is eager`);
  }
  const disk = ctx.dataFiles(),
    notListed = disk.filter((x) => !listed.has(x)),
    notDisk = [...listed].filter((x) => !disk.includes(x)).sort();
  c.ok(
    !notListed.length && !notDisk.length,
    `files on disk but not in the catalog: ${pyRepr(notListed)}; in the catalog but not on disk: ${pyRepr(notDisk)}`,
  );
  const n = get(cat, 'counts'),
    fs = iterable(get(cat, 'files')),
    want = {
      datasets: dss.length,
      files: disk.length,
      real,
      mock,
      pending: pend,
      primarySources: fs.length,
    };
  c.ok(equal(n, want), `counts ${pyRepr(n)} do not match the catalog ${pyRepr(want)}`);
  const traps = iterable(get(cat, 'traps')),
    methodology = iterable(get(cat, 'methodology'));
  c.ok(
    traps.length === 6 && methodology.length === 6,
    `traps ${traps.length} / methodology ${methodology.length}, expected 6 / 6`,
  );
  for (const kind of ['traps', 'methodology']) {
    const rows = iterable(get(cat, kind));
    c.ok(uniq(rows.map((x) => get(x, 'id'))).length === rows.length, `${kind}: ids`);
    for (const x of rows)
      c.ok(
        ['id', 'title', 'text'].every((kk) => strField(opt(x, kk))),
        `${kind} ${pstr(opt(x, 'id'))}: title/text`,
      );
  }
  c.ok(
    traps.some((x) => get(x, 'id') === 'two-versions'),
    'the two-versions trap must be listed',
  );
  for (const f of fs) {
    const name = opt(f, 'name');
    c.ok(
      ['name', 'title', 'sha256', 'bytes', 'source', 'role', 'usedBy'].every((x) =>
        Object.hasOwn(f, x),
      ),
      `files ${pstr(name)}: keys`,
    );
    const sha = get(f, 'sha256'),
      bytes = get(f, 'bytes');
    if (typeof sha !== 'string')
      error('TypeError', `expected string or bytes-like object, got '${kind(sha)}'`);
    c.ok(
      /^[0-9a-f]{64}$/.test(sha) &&
        ((Number.isInteger(bytes) && pythonNumberAt(f, 'bytes', bytes).kind === 'int') ||
          typeof bytes === 'boolean') &&
        number(bytes) > 0,
      `files ${pstr(get(f, 'name'))}: sha256/bytes`,
    );
    c.ok(
      pyTruth(get(f, 'source')) &&
        iterable(get(f, 'source')).every((x) => contains(get(core, 'sources'), x)),
      `files ${pstr(get(f, 'name'))}: source keys`,
    );
    c.ok(
      pyTruth(get(f, 'usedBy')) && iterable(get(f, 'usedBy')).every((x) => slugs.includes(x)),
      `files ${pstr(get(f, 'name'))}: usedBy ${pstr(get(f, 'usedBy'))} are not dataset slugs`,
    );
    c.ok(
      ['url', 'page', 'note'].filter((x) => pyTruth(opt(f, x))).length >= 1,
      `files ${pstr(get(f, 'name'))}: needs url, page or note`,
    );
    for (const kk of ['url', 'page'])
      if (pyTruth(opt(f, kk)))
        c.ok(
          starts(get(f, kk), 'https://'),
          `files ${pstr(get(f, 'name'))}: ${kk} ${pyRepr(get(f, kk))}`,
        );
    const blob = entries(f)
      .map(([, v]) => pstr(v))
      .join(' ')
      .toLowerCase();
    c.ok(
      !blob.includes('private channel') && !internal.some((x) => blob.includes(x)),
      `files ${pstr(get(f, 'name'))}: internal or private wording`,
    );
  }
  c.ok(
    uniq(fs.map((f) => get(f, 'name'))).length === fs.length &&
      uniq(fs.map((f) => get(f, 'sha256'))).length === fs.length,
    'files: names and checksums must be unique',
  );
  const kfpFiles = entries(get(ctx.get('execution.json'), 'data')).flatMap(([, y]) =>
      iterable(get(y, 'files')),
    ),
    got = new Map(fs.map((f) => [get(f, 'name'), get(f, 'sha256')]));
  c.ok(
    kfpFiles.every((x) => equal(got.get(get(x, 'file')) ?? null, get(x, 'sha256'))),
    'the 19 KFP reports of execution.json must be listed with the same checksums',
  );
  const needs = pageNeeds(ctx),
    fileDs = new Map<string, any>();
  for (const d of dss) {
    if (pyTruth(opt(d, 'file'))) fileDs.set(get(d, 'file'), d);
    for (const pp of iterable(opt(d, 'parts', []))) fileDs.set(get(pp, 'file'), d);
  }
  let warn = 0;
  for (const rid of Object.keys(needs).sort())
    for (const nm of needs[rid]!) {
      const fn = `data/${nm.replace(/\?+$/, '')}.json`,
        d = fileDs.get(fn);
      if (d === undefined) {
        if (!ctx.exists(fn.slice(5))) {
          c.warn(`${rid} needs '${nm}' but there is no such file in data/release`);
          warn++;
        }
        continue;
      }
      if (!contains(get(d, 'screens'), rid) && get(d, 'id') !== 'core') {
        c.warn(
          `${rid} reads ${get(d, 'slug')} but the catalog lists screens ${iterable(get(d, 'screens')).join(',')} for it`,
        );
        warn++;
      }
    }
  const pages = new Set(Object.keys(needs).filter((rid) => needs[rid]!.length > 0));
  for (const d of dss) {
    if (get(d, 'id') === 'core' || get(d, 'status') === 'pending') continue;
    for (const rid of iterable(get(d, 'screens')))
      if (
        pages.has(rid) &&
        !needs[rid]!.some((nm) => fileDs.get(`data/${nm.replace(/\?+$/, '')}.json`) === d)
      ) {
        c.warn(
          `catalog lists ${rid} for ${get(d, 'slug')} but that page's needs do not include it`,
        );
        warn++;
      }
  }
  c.fact(
    `${dss.length} datasets (${real} real, ${mock} mock, ${pend} pending) describe ${disk.length} files; ${fs.length} primary source files; ${warn} screen/needs differences (warnings)`,
  );
  return c;
}
