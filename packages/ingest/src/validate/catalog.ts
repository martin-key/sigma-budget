/** Independent ports of the Python CORE and CATALOG validation groups. */
import { readFileSync } from 'node:fs';
import { Check, fmt, gzipSize, isnum, pyRepr as baseRepr, pyTruth } from './checks.js';
import { Context, files, safePath } from './context.js';
import { pythonNumberAt } from '../common/numbers.js';
import { catalogDecimalText, catalogIntegerRepr, catalogIntegerText } from './catalog-integer.js';

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
function kind(v: any, holder?: object, key?: string | number): string {
  if (typeof v === 'number' && holder && key !== undefined)
    return pythonNumberAt(holder, String(key), v).kind;
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
function get(v: any, k: any, sourceType = kind(v)): any {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean')
    error('TypeError', `'${sourceType}' object is not subscriptable`);
  if (Array.isArray(v) || typeof v === 'string') {
    if (typeof k !== 'number' || !Number.isInteger(k))
      error(
        'TypeError',
        typeof v === 'string'
          ? `string indices must be integers, not '${kind(k)}'`
          : `list indices must be integers or slices, not ${kind(k)}`,
      );
    const i = k < 0 ? v.length + k : k;
    if (i < 0 || i >= v.length) error('IndexError', `${kind(v)} index out of range`);
    return v[i];
  }
  if (!contains(v, k)) error('KeyError', pyRepr(k));
  return v[k];
}
function getAt(holder: any, key: string | number, field: any): any {
  const value = get(holder, key);
  return get(value, field, kind(value, holder, key));
}
function opt(v: any, k: string, fallback: any = null, sourceType = kind(v)): any {
  if (v === null || typeof v !== 'object' || Array.isArray(v))
    error('AttributeError', `'${sourceType}' object has no attribute 'get'`);
  return Object.hasOwn(v, k) ? v[k] : fallback;
}
function iterable(v: any, sourceType = kind(v)): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [...v];
  if (v && typeof v === 'object') return Object.keys(v);
  return error('TypeError', `'${sourceType}' object is not iterable`);
}
function entries(v: any, sourceType = kind(v)): [string, any][] {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    error('AttributeError', `'${sourceType}' object has no attribute 'items'`);
  return Object.entries(v);
}
function len(v: any, sourceType = kind(v)): number {
  if (typeof v === 'string') return [...v].length;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return error('TypeError', `object of type '${sourceType}' has no len()`);
}
function lenAt(holder: any, key: string | number): number {
  const value = get(holder, key);
  return len(value, kind(value, holder, key));
}
function hasRoute(routes: ReadonlySet<unknown>, value: unknown): boolean {
  if (value !== null && typeof value === 'object')
    error('TypeError', `unhashable type: '${kind(value)}'`);
  return routes.has(value);
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
const sameSet = (a: any, b: any, sourceType = kind(a)) => {
  const aa = uniq(iterable(a, sourceType)),
    bb = uniq(iterable(b));
  return aa.length === bb.length && aa.every((x) => bb.includes(x));
};
function floatRepr(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf';
  if (Object.is(value, -0)) return '-0.0';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16)) {
    const [mantissa, exponent] = value.toExponential().split('e');
    const e = Number(exponent);
    return `${mantissa}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
function pyRepr(value: any, sourceType = kind(value)): string {
  if (typeof value === 'string') return catalogIntegerRepr(value);
  if (typeof value === 'number' && sourceType === 'float') return floatRepr(value);
  if (Array.isArray(value))
    return `[${value.map((item, index) => pyRepr(item, kind(item, value, index))).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${pyRepr(key)}: ${pyRepr(item, kind(item, value, key))}`)
      .join(', ')}}`;
  return baseRepr(value);
}
const pstr = (v: any, sourceType = kind(v)): string =>
  typeof v === 'string' ? v : pyRepr(v, sourceType);
function starts(v: any, x: string): boolean {
  if (typeof v !== 'string')
    error('AttributeError', `'${kind(v)}' object has no attribute 'startswith'`);
  return v.startsWith(x);
}
function contains(v: any, needle: any, sourceType = kind(v)): boolean {
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
  return error('TypeError', `argument of type '${sourceType}' is not iterable`);
}
function joinStrings(value: any, separator: string): string {
  if (value == null || typeof value === 'number' || typeof value === 'boolean')
    error('TypeError', 'can only join an iterable');
  const values = iterable(value);
  for (const [index, item] of values.entries())
    if (typeof item !== 'string')
      error(
        'TypeError',
        `sequence item ${index}: expected str instance, ${kind(item, values, index)} found`,
      );
  return values.join(separator);
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
    dataver = getAt(core, 'build', 'dataVersion');
  const latest = () => get(ex, 'latest'),
    kpis = () => get(core, 'kpis');
  if (typeof dataver !== 'string')
    error(
      'TypeError',
      `expected string or bytes-like object, got '${kind(dataver, b, 'dataVersion')}'`,
    );
  c.ok(
    /^\d{4}-\d{2}-\d{2}\.\d+\n?$/.test(catalogDecimalText(dataver)) &&
      dataver.startsWith(ctx.buildDate),
    `build.dataVersion ${catalogIntegerRepr(dataver)}`,
  );
  c.ok(
    equal(
      get(b, 'kfpLatest', kind(b, core, 'build')),
      get(latest(), 'asOf', kind(latest(), ex, 'latest')),
    ) &&
      equal(
        get(latest(), 'asOf', kind(latest(), ex, 'latest')),
        get(kpis(), 'asOf', kind(kpis(), core, 'kpis')),
      ) &&
      equal(
        get(kpis(), 'asOf', kind(kpis(), core, 'kpis')),
        get(get(core, 'meta'), 'asOf', kind(get(core, 'meta'), core, 'meta')),
      ),
    'build.kfpLatest / kpis.asOf / meta.asOf must equal execution.latest.asOf',
  );
  const ms = get(
    get(get(ex, 'data'), '2026', kind(get(ex, 'data'), ex, 'data')),
    'months',
    kind(get(get(ex, 'data'), '2026', kind(get(ex, 'data'), ex, 'data')), get(ex, 'data'), '2026'),
  );
  c.ok(
    equal(
      get(b, 'kfpMonths2026', kind(b, core, 'build')),
      Array.isArray(ms)
        ? len(
            ms,
            kind(ms, get(get(ex, 'data'), '2026', kind(get(ex, 'data'), ex, 'data')), 'months'),
          )
        : ms,
    ),
    'build.kfpMonths2026',
  );
  c.ok(
    equal(
      get(b, 'kfpMonths2026', kind(b, core, 'build')),
      get(latest(), 'month', kind(latest(), ex, 'latest')),
    ) &&
      equal(
        get(latest(), 'month', kind(latest(), ex, 'latest')),
        get(kpis(), 'month', kind(kpis(), core, 'kpis')),
      ),
    'kfpMonths2026 vs execution.latest.month vs kpis.month',
  );
  const nxt = get(get(ex, 'pendingMonths'), 0, kind(get(ex, 'pendingMonths'), ex, 'pendingMonths')),
    count = get(b, 'kfpMonths2026', kind(b, core, 'build'));
  c.ok(
    equal(
      get(b, 'kfpNext', kind(b, core, 'build')),
      get(nxt, 'asOf', kind(nxt, get(ex, 'pendingMonths'), 0)),
    ) && equal(get(nxt, 'month', kind(nxt, get(ex, 'pendingMonths'), 0)), pythonMonth(count)),
    'build.kfpNext must be the first pending month of execution.json',
  );
  c.ok(
    equal(get(b, 'eurRate', kind(b, core, 'build')), 1.95583),
    `build.eurRate ${pstr(get(b, 'eurRate', kind(b, core, 'build')), kind(get(b, 'eurRate', kind(b, core, 'build')), b, 'eurRate'))}`,
  );
  const years = get(core, 'years'),
    oy = get(o, 'years');
  c.ok(
    equal(get(years, 'list', kind(years, core, 'years')), oy) &&
      equal(
        iterable(oy, kind(oy, o, 'years')).map((y) =>
          get(
            get(years, 'vintage', kind(years, core, 'years')),
            String(y),
            kind(get(years, 'vintage', kind(years, core, 'years')), years, 'vintage'),
          ),
        ),
        get(o, 'vintage'),
      ),
    'years must equal outlook',
  );
  const src = get(core, 'sources');
  c.ok(
    equal(iterable(src, kind(src, core, 'sources')).sort(), [...sources].sort()),
    `sources: keys ${pyRepr(iterable(src, kind(src, core, 'sources')).sort())}`,
  );
  for (const [key, s] of entries(src, kind(src, core, 'sources'))) {
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
      c.ok(
        starts(get(s, 'url'), 'https://'),
        `source ${key}: url ${pyRepr(get(s, 'url'), kind(get(s, 'url'), s, 'url'))}`,
      );
    c.ok(
      iterable(s).every((x) => ['title', 'publisher', 'url', 'kind', 'access', 'note'].includes(x)),
      `source ${key}: keys ${pyRepr(iterable(s).sort())}`,
    );
  }
  const routes = ctx.routes(),
    pending = get(core, 'pending');
  c.ok(
    equal(
      iterable(pending, kind(pending, core, 'pending')).sort(),
      Array.from({ length: 7 }, (_, i) => `P0${i + 1}`),
    ),
    `pending ids ${pyRepr(iterable(pending, kind(pending, core, 'pending')).sort())}`,
  );
  for (const [key, p] of entries(pending, kind(pending, core, 'pending'))) {
    c.ok(
      get(p, 'status') === 'pending' &&
        equal(get(p, 'id'), key) &&
        ['title', 'reason', 'expected'].every((x) => strField(opt(p, x))),
      `pending ${key}: shape`,
    );
    c.ok(
      pyTruth(get(p, 'source')) &&
        iterable(get(p, 'source'), kind(get(p, 'source'), p, 'source')).every((x) =>
          contains(src, x, kind(src, core, 'sources')),
        ),
      `pending ${key}: source keys`,
    );
    c.ok(
      pyTruth(get(p, 'screens')) &&
        iterable(get(p, 'screens'), kind(get(p, 'screens'), p, 'screens')).every((x) =>
          hasRoute(routes.ids, x),
        ),
      `pending ${key}: screens ${pstr(get(p, 'screens'), kind(get(p, 'screens'), p, 'screens'))}`,
    );
  }
  const p04 = opt(pending, 'P04', {}, kind(pending, core, 'pending')),
    nas = get(nxt, 'asOf', kind(nxt, get(ex, 'pendingMonths'), 0)),
    ny = nas.slice(0, 4),
    reason = opt(p04, 'reason', ''),
    title = opt(p04, 'title', '');
  c.ok(
    starts(title, `Отчетът към ${nas.split('-').reverse().join('.')} г.`) &&
      contains(reason, `за ${monthName(nxt, 'month')} ${ny} г. още не е добавен`) &&
      pyMethod(reason, 'endswith').endsWith(
        `е за ${monthName(latest(), 'month')} ${get(latest(), 'asOf', kind(latest(), ex, 'latest')).slice(0, 4)} г.`,
      ),
    `pending P04 must name the pending report ${nas} and the latest ${get(latest(), 'asOf', kind(latest(), ex, 'latest'))}`,
  );
  const n = get(core, 'counts'),
    mfiles = ctx.jsonFiles().filter((f) => f.startsWith('ministries/')),
    data = get(ex, 'data');
  const reports = entries(data, kind(data, ex, 'data')).reduce(
    (sum, [, v]) => sum + len(get(v, 'files'), kind(get(v, 'files'), v, 'files')),
    0,
  );
  const want = {
    functions: len(
      get(get(e, 'functions'), 'items', kind(get(e, 'functions'), e, 'functions')),
      kind(
        get(get(e, 'functions'), 'items', kind(get(e, 'functions'), e, 'functions')),
        get(e, 'functions'),
        'items',
      ),
    ),
    budgets: len(get(mins, 'items'), kind(get(mins, 'items'), mins, 'items')),
    programBudgets: mfiles.length,
    programs: len(get(progs, 'items'), kind(get(progs, 'items'), progs, 'items')),
    terms: len(get(gl, 'terms'), kind(get(gl, 'terms'), gl, 'terms')),
    municipalities: len(get(mu, 'items'), kind(get(mu, 'items'), mu, 'items')),
    measures: len(get(me, 'items'), kind(get(me, 'items'), me, 'items')),
    kfpReports: reports,
  };
  c.ok(
    equal(n, want),
    `counts ${pyRepr(n, kind(n, core, 'counts'))} differ from the datasets ${pyRepr(want)}`,
  );
  c.ok(
    equal(
      get(get(mins, 'totals'), 'count', kind(get(mins, 'totals'), mins, 'totals')),
      get(n, 'budgets', kind(n, core, 'counts')),
    ) &&
      equal(
        get(
          get(mins, 'programTotals'),
          'budgets',
          kind(get(mins, 'programTotals'), mins, 'programTotals'),
        ),
        get(n, 'programBudgets', kind(n, core, 'counts')),
      ),
    'counts vs ministries.json totals',
  );
  c.ok(
    equal(
      opt(
        get(mu, 'totals'),
        'count',
        get(n, 'municipalities', kind(n, core, 'counts')),
        kind(get(mu, 'totals'), mu, 'totals'),
      ),
      get(n, 'municipalities', kind(n, core, 'counts')),
    ),
    'counts.municipalities vs municipalities.totals',
  );
  const p = get(core, 'population'),
    ser = get(p, 'series', kind(p, core, 'population')),
    sy = get(ser, 'years', kind(ser, p, 'series')),
    persons = get(ser, 'persons', kind(ser, p, 'series'));
  c.ok(
    len(sy, kind(sy, ser, 'years')) === len(persons, kind(persons, ser, 'persons')) &&
      len(persons, kind(persons, ser, 'persons')) === 7 &&
      equal(sy, [2020, 2021, 2022, 2023, 2024, 2025, 2026]) &&
      iterable(persons, kind(persons, ser, 'persons')).every((x) => isnum(x) && x > 6e6),
    'population.series shape',
  );
  c.ok(
    equal(
      get(p, 'persons', kind(p, core, 'population')),
      get(persons, -1, kind(persons, ser, 'persons')),
    ) &&
      equal(get(p, 'year', kind(p, core, 'population')), get(sy, -1, kind(sy, ser, 'years'))) &&
      equal(get(sy, -1, kind(sy, ser, 'years')), 2026) &&
      equal(get(p, 'date', kind(p, core, 'population')), '2026-01-01'),
    'population: persons/year/date vs the series',
  );
  const pro: any = ctx.proto('src/population.json');
  c.ok(
    equal(
      iterable(get(pro, 'years'), kind(get(pro, 'years'), pro, 'years')).map((x) => pythonInt(x)),
      sy,
    ) && equal(get(pro, 'persons'), persons),
    'population.series must equal the frozen Eurostat series',
  );
  const k = kpis(),
    lat = get(latest(), 'kfp', kind(latest(), ex, 'latest'));
  for (const [key, row] of [
    ['revenue', 'rev'],
    ['expenditure', 'exp.total'],
    ['balance', 'balance'],
    ['capex', 'exp.capex'],
  ] as const) {
    const q = get(k, key, kind(k, core, 'kpis')),
      w = get(lat, row, kind(lat, latest(), 'kfp'));
    c.ok(
      equal(get(q, 'planMln', kind(q, k, key)), get(w, 'plan', kind(w, lat, row))) &&
        equal(get(q, 'execMln', kind(q, k, key)), get(w, 'cum', kind(w, lat, row))),
      `kpis.${key}: planMln/execMln vs execution.latest.${row}`,
    );
    if (key !== 'balance')
      c.ok(
        equal(get(q, 'execPct', kind(q, k, key)), get(w, 'pctPlan', kind(w, lat, row))) &&
          equal(
            opt(q, 'yoyPct', undefined, kind(q, k, key)),
            opt(w, 'yoyPct', undefined, kind(w, lat, row)),
          ),
        `kpis.${key}: execPct/yoyPct`,
      );
    if (['revenue', 'expenditure', 'balance'].includes(key))
      c.ok(
        equal(get(q, 'prevYearMln', kind(q, k, key)), get(w, 'prevYearCum', kind(w, lat, row))),
        `kpis.${key}: prevYearMln`,
      );
    const href = get(q, 'href', kind(q, k, key));
    c.ok(
      starts(href, '#/') && routes.match(href) !== null,
      `kpis.${key}: href ${pyRepr(href, kind(href, q, 'href'))} matches no route`,
    );
  }
  c.ok(
    ['revenue', 'expenditure', 'balance'].every((key) =>
      equal(
        get(
          get(k, key, kind(k, core, 'kpis')),
          'planMln',
          kind(get(k, key, kind(k, core, 'kpis')), k, key),
        ),
        get(
          get(
            get(get(o, 'kfp'), key, kind(get(o, 'kfp'), o, 'kfp')),
            'mln',
            kind(get(get(o, 'kfp'), key, kind(get(o, 'kfp'), o, 'kfp')), get(o, 'kfp'), key),
          ),
          2,
          kind(
            get(
              get(get(o, 'kfp'), key, kind(get(o, 'kfp'), o, 'kfp')),
              'mln',
              kind(get(get(o, 'kfp'), key), get(o, 'kfp'), key),
            ),
            get(get(o, 'kfp'), key, kind(get(o, 'kfp'), o, 'kfp')),
            'mln',
          ),
        ),
      ),
    ),
    'kpis plan values must equal Annex 3 2026 (outlook)',
  );
  const capexPct = get(
    get(k, 'capex', kind(k, core, 'kpis')),
    'pctGdp',
    kind(get(k, 'capex', kind(k, core, 'kpis')), k, 'capex'),
  );
  const capexPlan = get(
    get(k, 'capex', kind(k, core, 'kpis')),
    'planMln',
    kind(get(k, 'capex', kind(k, core, 'kpis')), k, 'capex'),
  );
  if (typeof capexPlan !== 'number' && typeof capexPlan !== 'boolean')
    error('TypeError', `unsupported operand type(s) for *: 'float' and '${kind(capexPlan)}'`);
  const capexNumerator = 100 * number(capexPlan),
    divisorValue = get(
      get(get(o, 'gdp'), 'mlnPrecise', kind(get(o, 'gdp'), o, 'gdp')),
      2,
      kind(
        get(get(o, 'gdp'), 'mlnPrecise', kind(get(o, 'gdp'), o, 'gdp')),
        get(o, 'gdp'),
        'mlnPrecise',
      ),
    );
  if (typeof divisorValue !== 'number' && typeof divisorValue !== 'boolean')
    error('TypeError', `unsupported operand type(s) for /: 'float' and '${kind(divisorValue)}'`);
  const divisor = number(divisorValue);
  if (divisor === 0) error('ZeroDivisionError', 'float division by zero');
  c.near(capexPct, capexNumerator / divisor, 0.006, 'kpis.capex.pctGdp');
  const g = get(k, 'gdp', kind(k, core, 'kpis'));
  c.ok(
    equal(
      get(g, 'mln', kind(g, k, 'gdp')),
      get(
        get(get(o, 'gdp'), 'mln', kind(get(o, 'gdp'), o, 'gdp')),
        2,
        kind(get(get(o, 'gdp'), 'mln', kind(get(o, 'gdp'), o, 'gdp')), get(o, 'gdp'), 'mln'),
      ),
    ) &&
      equal(
        get(g, 'mlnPrecise', kind(g, k, 'gdp')),
        get(
          get(get(o, 'gdp'), 'mlnPrecise', kind(get(o, 'gdp'), o, 'gdp')),
          2,
          kind(
            get(get(o, 'gdp'), 'mlnPrecise', kind(get(o, 'gdp'), o, 'gdp')),
            get(o, 'gdp'),
            'mlnPrecise',
          ),
        ),
      ) &&
      equal(get(g, 'year', kind(g, k, 'gdp')), 2026) &&
      equal(get(g, 'vintage', kind(g, k, 'gdp')), 'plan'),
    'kpis.gdp vs outlook',
  );
  const z = get(debt, 'zdd'),
    kd = get(k, 'debt', kind(k, core, 'kpis'));
  c.ok(
    equal(
      get(kd, 'zddMln', kind(kd, k, 'debt')),
      get(
        get(z, 'totalMln', kind(z, debt, 'zdd')),
        2,
        kind(get(z, 'totalMln', kind(z, debt, 'zdd')), z, 'totalMln'),
      ),
    ) &&
      equal(
        get(kd, 'pctGdp', kind(kd, k, 'debt')),
        get(
          get(z, 'pctGdp', kind(z, debt, 'zdd')),
          2,
          kind(get(z, 'pctGdp', kind(z, debt, 'zdd')), z, 'pctGdp'),
        ),
      ) &&
      equal(get(kd, 'year', kind(kd, k, 'debt')), 2026) &&
      equal(
        get(
          get(z, 'years', kind(z, debt, 'zdd')),
          2,
          kind(get(z, 'years', kind(z, debt, 'zdd')), z, 'years'),
        ),
        2026,
      ) &&
      equal(get(kd, 'scope', kind(kd, k, 'debt')), 'zdd'),
    'kpis.debt vs debt.zdd',
  );
  const cfValue = get(core, 'functions'),
    cfLength = len(cfValue, kind(cfValue, core, 'functions'));
  const efValue = get(get(e, 'functions'), 'items', kind(get(e, 'functions'), e, 'functions'));
  c.ok(
    cfLength === len(efValue, kind(efValue, get(e, 'functions'), 'items')),
    'core.functions length',
  );
  const cf = iterable(cfValue, kind(cfValue, core, 'functions')),
    ef = iterable(efValue, kind(efValue, get(e, 'functions'), 'items'));
  for (let i = 0; i < Math.min(cf.length, ef.length); i++) {
    const a = cf[i],
      it = ef[i];
    c.ok(
      equal(
        [get(a, 'id'), get(a, 'name'), get(a, 'short'), get(a, 'mln')],
        [
          get(it, 'id'),
          get(it, 'name'),
          get(it, 'short'),
          get(get(it, 'mln'), 1, kind(get(it, 'mln'), it, 'mln')),
        ],
      ),
      `core.functions ${get(it, 'id')}: id/name/short/mln`,
    );
    c.near(
      get(a, 'pctGdp'),
      get(get(it, 'pctGdp'), 1, kind(get(it, 'pctGdp'), it, 'pctGdp')),
      0.0011,
      `core.functions ${get(it, 'id')} pctGdp`,
    );
    c.near(
      get(a, 'share'),
      get(get(it, 'share'), 1, kind(get(it, 'share'), it, 'share')),
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
    cgLength = len(cgValue, kind(cgValue, core, 'revenueGroups'));
  const rgValue = get(r, 'groups');
  c.ok(cgLength === len(rgValue, kind(rgValue, r, 'groups')), 'core.revenueGroups length');
  const cg = iterable(cgValue, kind(cgValue, core, 'revenueGroups')),
    rg = iterable(rgValue, kind(rgValue, r, 'groups'));
  for (let i = 0; i < Math.min(cg.length, rg.length); i++) {
    const a = cg[i],
      gr = rg[i];
    c.ok(
      equal(
        [get(a, 'id'), get(a, 'name'), get(a, 'mln'), get(a, 'share')],
        [
          get(gr, 'id'),
          get(gr, 'name'),
          get(get(gr, 'mln'), 2, kind(get(gr, 'mln'), gr, 'mln')),
          get(gr, 'share2026'),
        ],
      ),
      `core.revenueGroups ${get(gr, 'id')}`,
    );
  }
  c.fact(
    `core 2026: revenue ${fmt(get(get(k, 'revenue', kind(k, core, 'kpis')), 'execMln', kind(get(k, 'revenue', kind(k, core, 'kpis')), k, 'revenue')))} / ${fmt(get(get(k, 'revenue', kind(k, core, 'kpis')), 'planMln', kind(get(k, 'revenue', kind(k, core, 'kpis')), k, 'revenue')))}, expenditure ${fmt(get(get(k, 'expenditure', kind(k, core, 'kpis')), 'execMln', kind(get(k, 'expenditure', kind(k, core, 'kpis')), k, 'expenditure')))} / ${fmt(get(get(k, 'expenditure', kind(k, core, 'kpis')), 'planMln', kind(get(k, 'expenditure', kind(k, core, 'kpis')), k, 'expenditure')))}, balance ${fmt(get(get(k, 'balance', kind(k, core, 'kpis')), 'execMln', kind(get(k, 'balance', kind(k, core, 'kpis')), k, 'balance')))} / ${fmt(get(get(k, 'balance', kind(k, core, 'kpis')), 'planMln', kind(get(k, 'balance', kind(k, core, 'kpis')), k, 'balance')))}, debt ${fmt(get(kd, 'zddMln', kind(kd, k, 'debt')))}; counts ${pstr(get(n, 'budgets', kind(n, core, 'counts')), kind(get(n, 'budgets', kind(n, core, 'counts')), n, 'budgets'))} budgets, ${pstr(get(n, 'programs', kind(n, core, 'counts')), kind(get(n, 'programs', kind(n, core, 'counts')), n, 'programs'))} programs, ${pstr(get(n, 'municipalities', kind(n, core, 'counts')), kind(get(n, 'municipalities', kind(n, core, 'counts')), n, 'municipalities'))} municipalities; 7 pending blocks`,
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
    equal(get(meta, 'id', kind(meta, cat, 'meta')), 'D25') &&
      equal(get(meta, 'status', kind(meta, cat, 'meta')), 'real') &&
      equal(get(meta, 'source', kind(meta, cat, 'meta')), ['wg']),
    'catalog meta',
  );
  const groups = iterable(get(cat, 'groups'), kind(get(cat, 'groups'), cat, 'groups')),
    gids = groups.map((x) => get(x, 'id'));
  c.ok(
    gids.length === uniq(gids).length &&
      groups.every((x) => typeof get(x, 'label') === 'string' && pyTruth(get(x, 'label'))),
    'groups',
  );
  const dss = iterable(get(cat, 'datasets'), kind(get(cat, 'datasets'), cat, 'datasets')),
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
      pyTruth(source) &&
        iterable(source, kind(source, d, 'source')).every((x) =>
          contains(get(core, 'sources'), x, kind(get(core, 'sources'), core, 'sources')),
        ),
      `${sl}: source keys ${pstr(source, kind(source, d, 'source'))}`,
    );
    c.ok(
      iterable(screens, kind(screens, d, 'screens')).every((x) => hasRoute(routes, x)) &&
        len(screens, kind(screens, d, 'screens')) ===
          uniq(iterable(screens, kind(screens, d, 'screens'))).length,
      `${sl}: screens ${pstr(screens, kind(screens, d, 'screens'))}`,
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
        equal(sl, id.toLowerCase()) &&
          equal(get(d, 'contains'), [id]) &&
          contains(pending, id, kind(pending, core, 'pending')),
        `${sl}: pending id`,
      );
      const p = get(pending, id, kind(pending, core, 'pending'));
      c.ok(
        equal(get(d, 'title'), get(p, 'title', kind(p, pending, id))) &&
          equal(screens, get(p, 'screens', kind(p, pending, id))) &&
          equal(get(d, 'expected'), get(p, 'expected', kind(p, pending, id))) &&
          equal(source, get(p, 'source', kind(p, pending, id))),
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
      `${sl}: format/mediaType ${pstr(format, kind(format, d, 'format'))} / ${pstr(media, kind(media, d, 'mediaType'))}`,
    );
    if (pyTruth(opt(d, 'fileTemplate'))) {
      const parts = iterable(get(d, 'parts'), kind(get(d, 'parts'), d, 'parts')),
        template = get(d, 'fileTemplate');
      c.ok(
        get(d, 'file') === null && template === 'data/ministries/<код>.json',
        `${sl}: fileTemplate`,
      );
      const codes = parts.map((pp) => get(pp, 'code')),
        expected = get(
          get(core, 'counts'),
          'programBudgets',
          kind(get(core, 'counts'), core, 'counts'),
        );
      c.ok(
        parts.length === uniq(codes).length && uniq(codes).length === expected,
        `${sl}: ${parts.length} parts, expected ${pstr(expected, kind(expected, get(core, 'counts'), 'programBudgets'))}`,
      );
      const minids = iterable(get(mins, 'items'), kind(get(mins, 'items'), mins, 'items')).map(
        (m) => get(m, 'id'),
      );
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
            `${sl}: part file ${pstr(file, kind(file, pp, 'file'))}`,
          )
        )
          continue;
        listed.add(file.slice(5));
        const raw = ctx.bytes(rel),
          size = raw.length,
          gzip = gzipSize(raw);
        c.ok(
          equal(get(pp, 'bytes'), size) && equal(get(pp, 'gzipBytes'), gzip),
          `${sl}: part ${code} bytes ${pstr(get(pp, 'bytes'), kind(get(pp, 'bytes'), pp, 'bytes'))}/${pstr(get(pp, 'gzipBytes'), kind(get(pp, 'gzipBytes'), pp, 'gzipBytes'))} vs ${size}/${gzip}`,
        );
        total += size;
        gz += gzip;
      }
      c.ok(
        equal(get(d, 'bytes'), total) && equal(get(d, 'gzipBytes'), gz),
        `${sl}: bytes/gzipBytes ${pstr(get(d, 'bytes'), kind(get(d, 'bytes'), d, 'bytes'))}/${pstr(get(d, 'gzipBytes'), kind(get(d, 'gzipBytes'), d, 'gzipBytes'))} must be the sums of the parts ${total}/${gz}`,
      );
      continue;
    }
    const file = get(d, 'file'),
      rel = pySlice(file, 5);
    c.ok(
      starts(file, 'data/') && ctx.exists(rel),
      `${sl}: file ${pstr(file, kind(file, d, 'file'))} does not exist`,
    );
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
          sameSet(source, opt(m, 'source', []), kind(source, d, 'source')),
        `${sl}: status/mock/source vs meta`,
      );
      for (const kk of ['asOf', 'unit'])
        if (Object.hasOwn(d, kk))
          c.ok(
            equal(get(d, kk), opt(m, kk)),
            `${sl}: ${kk} ${pyRepr(get(d, kk), kind(get(d, kk), d, kk))} vs meta ${pyRepr(opt(m, kk))}`,
          );
      const mid = pyMethod(opt(m, 'id', ''), 'split').split('+');
      if (mid.every((x: string) => /^[DMP]\d\d$/.test(x)))
        c.ok(
          sameSet(get(d, 'contains'), mid, kind(get(d, 'contains'), d, 'contains')),
          `${sl}: contains ${pstr(get(d, 'contains'), kind(get(d, 'contains'), d, 'contains'))} vs meta.id ${pstr(opt(m, 'id'))}`,
        );
      else
        c.ok(
          equal(get(d, 'contains'), get(d, 'id') === 'core' ? ['D18'] : []) &&
            equal(opt(m, 'id'), sl),
          `${sl}: contains ${pstr(get(d, 'contains'), kind(get(d, 'contains'), d, 'contains'))} vs meta.id ${pstr(opt(m, 'id'))}`,
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
    rawFiles = get(cat, 'files'),
    want = {
      datasets: dss.length,
      files: disk.length,
      real,
      mock,
      pending: pend,
      primarySources: len(rawFiles, kind(rawFiles, cat, 'files')),
    };
  c.ok(
    equal(n, want),
    `counts ${pyRepr(n, kind(n, cat, 'counts'))} do not match the catalog ${pyRepr(want)}`,
  );
  c.ok(
    lenAt(cat, 'traps') === 6 && lenAt(cat, 'methodology') === 6,
    `traps ${lenAt(cat, 'traps')} / methodology ${lenAt(cat, 'methodology')}, expected 6 / 6`,
  );
  for (const section of ['traps', 'methodology']) {
    const rows = iterable(get(cat, section), kind(get(cat, section), cat, section));
    c.ok(uniq(rows.map((x) => get(x, 'id'))).length === rows.length, `${section}: ids`);
    for (const x of rows)
      c.ok(
        ['id', 'title', 'text'].every((kk) => strField(opt(x, kk))),
        `${section} ${pstr(opt(x, 'id'))}: title/text`,
      );
  }
  c.ok(
    iterable(get(cat, 'traps'), kind(get(cat, 'traps'), cat, 'traps')).some(
      (x) => get(x, 'id') === 'two-versions',
    ),
    'the two-versions trap must be listed',
  );
  const fs = iterable(rawFiles, kind(rawFiles, cat, 'files'));
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
      `files ${pstr(get(f, 'name'), kind(get(f, 'name'), f, 'name'))}: sha256/bytes`,
    );
    c.ok(
      pyTruth(get(f, 'source')) &&
        iterable(get(f, 'source'), kind(get(f, 'source'), f, 'source')).every((x) =>
          contains(get(core, 'sources'), x, kind(get(core, 'sources'), core, 'sources')),
        ),
      `files ${pstr(get(f, 'name'), kind(get(f, 'name'), f, 'name'))}: source keys`,
    );
    c.ok(
      pyTruth(get(f, 'usedBy')) &&
        iterable(get(f, 'usedBy'), kind(get(f, 'usedBy'), f, 'usedBy')).every((x) =>
          slugs.includes(x),
        ),
      `files ${pstr(get(f, 'name'), kind(get(f, 'name'), f, 'name'))}: usedBy ${pstr(get(f, 'usedBy'), kind(get(f, 'usedBy'), f, 'usedBy'))} are not dataset slugs`,
    );
    c.ok(
      ['url', 'page', 'note'].filter((x) => pyTruth(opt(f, x))).length >= 1,
      `files ${pstr(get(f, 'name'), kind(get(f, 'name'), f, 'name'))}: needs url, page or note`,
    );
    for (const kk of ['url', 'page'])
      if (pyTruth(opt(f, kk)))
        c.ok(
          starts(get(f, kk), 'https://'),
          `files ${pstr(get(f, 'name'), kind(get(f, 'name'), f, 'name'))}: ${kk} ${pyRepr(get(f, kk), kind(get(f, kk), f, kk))}`,
        );
    const blob = entries(f)
      .map(([, v]) => pstr(v))
      .join(' ')
      .toLowerCase();
    c.ok(
      !blob.includes('private channel') && !internal.some((x) => blob.includes(x)),
      `files ${pstr(get(f, 'name'), kind(get(f, 'name'), f, 'name'))}: internal or private wording`,
    );
  }
  c.ok(
    uniq(fs.map((f) => get(f, 'name'))).length === fs.length &&
      uniq(fs.map((f) => get(f, 'sha256'))).length === fs.length,
    'files: names and checksums must be unique',
  );
  const kfpFiles = entries(
      get(ctx.get('execution.json'), 'data'),
      kind(get(ctx.get('execution.json'), 'data'), ctx.get('execution.json'), 'data'),
    ).flatMap(([, y]) => iterable(get(y, 'files'), kind(get(y, 'files'), y, 'files'))),
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
      if (
        !contains(get(d, 'screens'), rid, kind(get(d, 'screens'), d, 'screens')) &&
        get(d, 'id') !== 'core'
      ) {
        c.warn(
          `${rid} reads ${get(d, 'slug')} but the catalog lists screens ${joinStrings(get(d, 'screens'), ',')} for it`,
        );
        warn++;
      }
    }
  const pages = new Set(Object.keys(needs).filter((rid) => needs[rid]!.length > 0));
  for (const d of dss) {
    if (get(d, 'id') === 'core' || get(d, 'status') === 'pending') continue;
    for (const rid of iterable(get(d, 'screens'), kind(get(d, 'screens'), d, 'screens')))
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
