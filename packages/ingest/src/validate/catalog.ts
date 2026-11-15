import { isPublishedDataset } from '@sigma-budget/dataset-schema';
/** Independent ports of the Python CORE and CATALOG validation groups. */
import { readFileSync } from 'node:fs';
import { Check, fmt, gzipSize, isnum, pyRepr as baseRepr, pyTruth } from './checks.js';
import { Context, files, safePath } from './context.js';
import { pythonNumberAt } from '../common/numbers.js';
import { catalogDecimalText, catalogIntegerRepr, catalogIntegerText } from './catalog-integer.js';
import { pythonKeys } from './ordered-json.js';

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
  if (v && typeof v === 'object') return pythonKeys(v);
  return error('TypeError', `'${sourceType}' object is not iterable`);
}
function entries(v: any, sourceType = kind(v)): [string, any][] {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    error('AttributeError', `'${sourceType}' object has no attribute 'items'`);
  return pythonKeys(v).map((key) => [key, v[key]]);
}
function values(v: any, sourceType = kind(v)): any[] {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    error('AttributeError', `'${sourceType}' object has no attribute 'values'`);
  return pythonKeys(v).map((key) => v[key]);
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
function setContains(values: ReadonlySet<unknown>, value: unknown): boolean {
  if (value !== null && typeof value === 'object')
    error('TypeError', `unhashable type: '${kind(value)}'`);
  return [...values].some((other) => equal(other, value));
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
function dictSet(map: Map<any, any>, key: any, value: any): void {
  if (key !== null && typeof key === 'object')
    error('TypeError', `unhashable type: '${kind(key)}'`);
  const existing = [...map.keys()].find((other) => equal(other, key));
  map.set(existing === undefined ? key : existing, value);
}
function dictGet(map: Map<any, any>, key: any): any {
  if (key !== null && typeof key === 'object')
    error('TypeError', `unhashable type: '${kind(key)}'`);
  return [...map].find(([other]) => equal(other, key))?.[1] ?? null;
}
function uniq(values: Iterable<any>): any[] {
  const result: any[] = [];
  for (const value of values) {
    if (value && typeof value === 'object') error('TypeError', `unhashable type: '${kind(value)}'`);
    if (!result.some((other) => equal(value, other))) result.push(value);
  }
  return result;
}
const sameSet = (a: any, b: any, sourceType = kind(a), otherType = kind(b)) => {
  const aa = uniq(iterable(a, sourceType)),
    bb = uniq(iterable(b, otherType));
  return aa.length === bb.length && aa.every((x) => bb.some((other) => equal(x, other)));
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
    return `[${value.map((item, index, __rowValues11) => pyRepr(item, kind(item, value, index))).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${entries(value)
      .map(([key, item]) => `${pyRepr(key)}: ${pyRepr(item, kind(item, value, key))}`)
      .join(', ')}}`;
  return baseRepr(value);
}
const pstr = (v: any, sourceType = kind(v)): string =>
  typeof v === 'string' ? v : pyRepr(v, sourceType);
function strAt(holder: any, key: string | number, sourceType = kind(holder)): string {
  const value = get(holder, key, sourceType);
  return pstr(value, kind(value, holder, key));
}
function starts(v: any, x: string, sourceType = kind(v)): boolean {
  if (typeof v !== 'string')
    error('AttributeError', `'${sourceType}' object has no attribute 'startswith'`);
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
function pySlice(
  v: any,
  start: number | null,
  sourceType = kind(v),
  end: number | null = null,
): any {
  if (typeof v === 'string') return [...v].slice(start ?? 0, end ?? undefined).join('');
  if (Array.isArray(v)) return v.slice(start ?? 0, end ?? undefined);
  if (v && typeof v === 'object')
    return error('KeyError', `slice(${start ?? 'None'}, ${end ?? 'None'}, None)`);
  return error('TypeError', `'${sourceType}' object is not subscriptable`);
}
function prefixText(v: any, end: number, sourceType = kind(v)): string {
  const prefix = pySlice(v, null, sourceType, end);
  return Array.isArray(prefix)
    ? `[${prefix.map((value, index) => pyRepr(value, kind(value, v, index))).join(', ')}]`
    : prefix;
}
function pyMethod(v: any, method: string, sourceType = kind(v)): string {
  if (typeof v !== 'string')
    return error('AttributeError', `'${sourceType}' object has no attribute '${method}'`);
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
        iterable(oy, kind(oy, o, 'years')).map((y, index, sourceYears) =>
          get(
            get(years, 'vintage', kind(years, core, 'years')),
            pstr(y, kind(y, sourceYears, index)),
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
      ['title', 'publisher', 'kind', 'access'].every((x) =>
        strField(opt(s, x, undefined, kind(s, src, key))),
      ),
      `source ${key}: title/publisher/kind/access`,
    );
    c.ok(
      ['xls', 'pdf', 'html', 'doc', 'api', 'generator'].includes(
        opt(s, 'kind', undefined, kind(s, src, key)),
      ) &&
        ['open', 'browser-only', 'none'].includes(opt(s, 'access', undefined, kind(s, src, key))),
      `source ${key}: kind ${pyRepr(opt(s, 'kind', undefined, kind(s, src, key)), kind(opt(s, 'kind'), s, 'kind'))} / access ${pyRepr(opt(s, 'access', undefined, kind(s, src, key)), kind(opt(s, 'access'), s, 'access'))}`,
    );
    if (pyTruth(opt(s, 'url', undefined, kind(s, src, key))))
      c.ok(
        starts(get(s, 'url', kind(s, src, key)), 'https://', kind(get(s, 'url'), s, 'url')),
        `source ${key}: url ${pyRepr(get(s, 'url', kind(s, src, key)), kind(get(s, 'url', kind(s, src, key)), s, 'url'))}`,
      );
    c.ok(
      iterable(s, kind(s, src, key)).every((x) =>
        ['title', 'publisher', 'url', 'kind', 'access', 'note'].includes(x),
      ),
      `source ${key}: keys ${pyRepr(iterable(s, kind(s, src, key)).sort())}`,
    );
  }
  const routes = ctx.routes(),
    pending = get(core, 'pending');
  c.ok(
    equal(
      iterable(pending, kind(pending, core, 'pending')).sort(),
      Array.from({ length: 7 }, (_, i) => `P0${i + 1}`).filter(
        (id) =>
          (id !== 'P03' ||
            !(
              Array.isArray(ctx.get('ministries.json')?.items) &&
              ctx
                .get('ministries.json')
                .items.some((item: any) => item?.programs?.tier === 'source-verified') &&
              ['0100', '1800', '2300', '7400'].every(
                (code) =>
                  ctx.exists(`ministries/${code}.json`) &&
                  isPublishedDataset(`ministries/${code}.json`, ctx.get(`ministries/${code}.json`)),
              )
            )) &&
          (id !== 'P05' || !Object.hasOwn(ctx.get('execution.json').data, '2022')) &&
          (id !== 'P06' ||
            !(
              ctx.exists('debt-issues.json') &&
              isPublishedDataset('debt-issues.json', ctx.get('debt-issues.json'))
            )) &&
          (id !== 'P01' ||
            !['state-budget.json', 'kfp-subsectors.json'].every(
              (name) => ctx.exists(name) && isPublishedDataset(name, ctx.get(name)),
            )),
      ),
    ),
    `pending ids ${pyRepr(iterable(pending, kind(pending, core, 'pending')).sort())}`,
  );
  for (const [key, p] of entries(pending, kind(pending, core, 'pending'))) {
    c.ok(
      get(p, 'status', kind(p, pending, key)) === 'pending' &&
        equal(get(p, 'id', kind(p, pending, key)), key) &&
        ['title', 'reason', 'expected'].every((x) =>
          strField(opt(p, x, undefined, kind(p, pending, key))),
        ),
      `pending ${key}: shape`,
    );
    c.ok(
      pyTruth(get(p, 'source', kind(p, pending, key))) &&
        iterable(
          get(p, 'source', kind(p, pending, key)),
          kind(get(p, 'source', kind(p, pending, key)), p, 'source'),
        ).every((x) => contains(src, x, kind(src, core, 'sources'))),
      `pending ${key}: source keys`,
    );
    c.ok(
      pyTruth(get(p, 'screens', kind(p, pending, key))) &&
        iterable(
          get(p, 'screens', kind(p, pending, key)),
          kind(get(p, 'screens', kind(p, pending, key)), p, 'screens'),
        ).every((x) => setContains(routes.ids, x)),
      `pending ${key}: screens ${pstr(get(p, 'screens', kind(p, pending, key)), kind(get(p, 'screens', kind(p, pending, key)), p, 'screens'))}`,
    );
  }
  const p04 = opt(pending, 'P04', {}, kind(pending, core, 'pending')),
    nas = get(nxt, 'asOf', kind(nxt, get(ex, 'pendingMonths'), 0)),
    ny = pySlice(nas, null, kind(nas, nxt, 'asOf'), 4),
    reason = opt(p04, 'reason', '', kind(p04, pending, 'P04')),
    title = opt(p04, 'title', '', kind(p04, pending, 'P04'));
  c.ok(
    pyMethod(title, 'startswith', kind(title, p04, 'title')).startsWith(
      `Отчетът към ${pyMethod(nas, 'split', kind(nas, nxt, 'asOf'))
        .split('-')
        .reverse()
        .join('.')} г.`,
    ) &&
      (reason ===
        `Последният месечен отчет в портала е за ${monthName(latest(), 'month')} ${prefixText(get(latest(), 'asOf', kind(latest(), ex, 'latest')), 4, kind(get(latest(), 'asOf'), latest(), 'asOf'))} г. Отчетът за ${monthName(nxt, 'month')} ${pstr(ny)} г. не е включен.` ||
        (contains(
          reason,
          `за ${monthName(nxt, 'month')} ${pstr(ny)} г. още не е добавен`,
          kind(reason, p04, 'reason'),
        ) &&
          pyMethod(reason, 'endswith', kind(reason, p04, 'reason')).endsWith(
            `е за ${monthName(latest(), 'month')} ${prefixText(get(latest(), 'asOf', kind(latest(), ex, 'latest')), 4, kind(get(latest(), 'asOf'), latest(), 'asOf'))} г.`,
          ))),
    `pending P04 must name the pending report ${pstr(nas, kind(nas, nxt, 'asOf'))} and the latest ${strAt(latest(), 'asOf', kind(latest(), ex, 'latest'))}`,
  );
  const n = get(core, 'counts'),
    mfiles = ctx.jsonFiles().filter((f) => f.startsWith('ministries/')),
    data = get(ex, 'data');
  const reports = entries(data, kind(data, ex, 'data')).reduce(
    (sum, [dataKey, v]) =>
      sum +
      len(
        get(v, 'files', kind(v, data, dataKey)),
        kind(get(v, 'files', kind(v, data, dataKey)), v, 'files'),
      ),
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
      starts(href, '#/', kind(href, q, 'href')) && routes.match(href) !== null,
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
              kind(get(get(o, 'kfp'), key, kind(get(o, 'kfp'), o, 'kfp')), get(o, 'kfp'), key),
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
        [
          get(a, 'id', kind(a, cf, i)),
          get(a, 'name', kind(a, cf, i)),
          get(a, 'short', kind(a, cf, i)),
          get(a, 'mln', kind(a, cf, i)),
        ],
        [
          get(it, 'id', kind(it, ef, i)),
          get(it, 'name', kind(it, ef, i)),
          get(it, 'short', kind(it, ef, i)),
          get(get(it, 'mln', kind(it, ef, i)), 1, kind(get(it, 'mln', kind(it, ef, i)), it, 'mln')),
        ],
      ),
      `core.functions ${strAt(it, 'id', kind(it, ef, i))}: id/name/short/mln`,
    );
    c.near(
      get(a, 'pctGdp', kind(a, cf, i)),
      get(
        get(it, 'pctGdp', kind(it, ef, i)),
        1,
        kind(get(it, 'pctGdp', kind(it, ef, i)), it, 'pctGdp'),
      ),
      0.0011,
      `core.functions ${strAt(it, 'id', kind(it, ef, i))} pctGdp`,
    );
    c.near(
      get(a, 'share', kind(a, cf, i)),
      get(
        get(it, 'share', kind(it, ef, i)),
        1,
        kind(get(it, 'share', kind(it, ef, i)), it, 'share'),
      ),
      0.0011,
      `core.functions ${strAt(it, 'id', kind(it, ef, i))} share`,
    );
    c.near(
      get(a, 'yoyPct', kind(a, cf, i)),
      get(it, 'yoy2026Pct', kind(it, ef, i)),
      0.051,
      `core.functions ${strAt(it, 'id', kind(it, ef, i))} yoyPct`,
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
        [
          get(a, 'id', kind(a, cg, i)),
          get(a, 'name', kind(a, cg, i)),
          get(a, 'mln', kind(a, cg, i)),
          get(a, 'share', kind(a, cg, i)),
        ],
        [
          get(gr, 'id', kind(gr, rg, i)),
          get(gr, 'name', kind(gr, rg, i)),
          get(get(gr, 'mln', kind(gr, rg, i)), 2, kind(get(gr, 'mln', kind(gr, rg, i)), gr, 'mln')),
          get(gr, 'share2026', kind(gr, rg, i)),
        ],
      ),
      `core.revenueGroups ${strAt(gr, 'id', kind(gr, rg, i))}`,
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
      return type === 'array' || type === 'object'
        ? { key, type, length: len(v, kind(v, obj, key)) }
        : { key, type };
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
    gids = groups.map((x, __rowIndex20, __rowValues21) =>
      get(x, 'id', kind(x, __rowValues21, __rowIndex20)),
    );
  c.ok(
    gids.length === uniq(gids).length &&
      groups.every(
        (x, __rowIndex22, __rowValues23) =>
          typeof get(x, 'label', kind(x, __rowValues23, __rowIndex22)) === 'string' &&
          pyTruth(get(x, 'label', kind(x, __rowValues23, __rowIndex22))),
      ),
    'groups',
  );
  const dss = iterable(get(cat, 'datasets'), kind(get(cat, 'datasets'), cat, 'datasets')),
    slugs = dss.map((d, __rowIndex24, __rowValues25) =>
      get(d, 'slug', kind(d, __rowValues25, __rowIndex24)),
    );
  c.ok(slugs.length === uniq(slugs).length, 'dataset slugs must be unique');
  const ids = dss.map((d, __rowIndex26, __rowValues27) =>
      get(d, 'id', kind(d, __rowValues27, __rowIndex26)),
    ),
    dup = uniq(ids.filter((i) => ids.filter((x) => equal(x, i)).length > 1)).sort();
  c.ok(equal(dup, ['D09', 'feed']), `ids may repeat only for D09 and feed: ${pyRepr(dup)}`);
  const listed = new Set<string>();
  let real = 0,
    mock = 0,
    pend = 0;
  for (const [__rowIndex0, d] of dss.entries()) {
    const sl = get(d, 'slug', kind(d, dss, __rowIndex0)),
      slText = pstr(sl, kind(sl, d, 'slug')),
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
    c.ok(!missing.length, `${slText}: missing keys ${pyRepr(missing)}`);
    if (missing.length) continue;
    const status = get(d, 'status', kind(d, dss, __rowIndex0)),
      source = get(d, 'source', kind(d, dss, __rowIndex0)),
      screens = get(d, 'screens', kind(d, dss, __rowIndex0));
    c.ok(
      ['real', 'mock', 'pending'].includes(status) &&
        contains(gids, get(d, 'group', kind(d, dss, __rowIndex0))) &&
        equal(get(d, 'mock', kind(d, dss, __rowIndex0)), status === 'mock'),
      `${slText}: status/group/mock`,
    );
    c.ok(
      pyTruth(source) &&
        iterable(source, kind(source, d, 'source')).every((x) =>
          contains(get(core, 'sources'), x, kind(get(core, 'sources'), core, 'sources')),
        ),
      `${slText}: source keys ${pstr(source, kind(source, d, 'source'))}`,
    );
    c.ok(
      iterable(screens, kind(screens, d, 'screens')).every((x) => setContains(routes, x)) &&
        len(screens, kind(screens, d, 'screens')) ===
          uniq(iterable(screens, kind(screens, d, 'screens'))).length,
      `${slText}: screens ${pstr(screens, kind(screens, d, 'screens'))}`,
    );
    c.ok(
      ['title', 'description'].every((x) => strField(get(d, x, kind(d, dss, __rowIndex0)))),
      `${slText}: title/description`,
    );
    real += Number(status === 'real');
    mock += Number(status === 'mock');
    pend += Number(status === 'pending');
    if (status === 'pending') {
      c.ok(
        ['file', 'bytes', 'gzipBytes', 'schema'].every((x) => !Object.hasOwn(d, x)),
        `${slText}: a pending dataset has no file`,
      );
      const id = get(d, 'id', kind(d, dss, __rowIndex0)),
        pending = get(core, 'pending');
      c.ok(
        equal(sl, pyMethod(id, 'lower', kind(id, d, 'id')).toLowerCase()) &&
          equal(get(d, 'contains', kind(d, dss, __rowIndex0)), [id]) &&
          contains(pending, id, kind(pending, core, 'pending')),
        `${slText}: pending id`,
      );
      const p = get(pending, id, kind(pending, core, 'pending'));
      c.ok(
        equal(get(d, 'title', kind(d, dss, __rowIndex0)), get(p, 'title', kind(p, pending, id))) &&
          equal(screens, get(p, 'screens', kind(p, pending, id))) &&
          equal(
            get(d, 'expected', kind(d, dss, __rowIndex0)),
            get(p, 'expected', kind(p, pending, id)),
          ) &&
          equal(source, get(p, 'source', kind(p, pending, id))),
        `${slText}: must equal core.pending.${id}`,
      );
      continue;
    }
    const asOf = opt(d, 'asOf', undefined, kind(d, dss, __rowIndex0));
    c.ok(
      typeof asOf === 'string' &&
        /^\d{4}-\d{2}-\d{2}\n?$/.test(catalogDecimalText(asOf)) &&
        asOf <= ctx.buildDate,
      `${slText}: asOf ${pyRepr(asOf, kind(asOf, d, 'asOf'))}`,
    );
    const format = get(d, 'format', kind(d, dss, __rowIndex0)),
      media = get(d, 'mediaType', kind(d, dss, __rowIndex0));
    if (format !== null && typeof format === 'object')
      error('TypeError', "unhashable type: '" + kind(format) + "'");
    c.ok(
      equal(contains(formats, format) ? formats[format] : null, media),
      `${slText}: format/mediaType ${pstr(format, kind(format, d, 'format'))} / ${pstr(media, kind(media, d, 'mediaType'))}`,
    );
    if (pyTruth(opt(d, 'fileTemplate', undefined, kind(d, dss, __rowIndex0)))) {
      const parts = iterable(
          get(d, 'parts', kind(d, dss, __rowIndex0)),
          kind(get(d, 'parts', kind(d, dss, __rowIndex0)), d, 'parts'),
        ),
        template = get(d, 'fileTemplate', kind(d, dss, __rowIndex0));
      c.ok(
        get(d, 'file', kind(d, dss, __rowIndex0)) === null &&
          template === 'data/ministries/<код>.json',
        `${slText}: fileTemplate`,
      );
      const codes = parts.map((pp, __rowIndex32, __rowValues33) =>
          get(pp, 'code', kind(pp, __rowValues33, __rowIndex32)),
        ),
        expected = () =>
          get(get(core, 'counts'), 'programBudgets', kind(get(core, 'counts'), core, 'counts'));
      c.ok(
        parts.length === uniq(codes).length && equal(uniq(codes).length, expected()),
        `${slText}: ${parts.length} parts, expected ${pstr(expected(), kind(expected(), get(core, 'counts'), 'programBudgets'))}`,
      );
      const minids = function* () {
        const items = iterable(get(mins, 'items'), kind(get(mins, 'items'), mins, 'items'));
        for (const [index, item] of items.entries())
          yield get(item, 'id', kind(item, items, index));
      };
      c.ok(
        codes.every((cc) => contains(uniq(minids()), cc)),
        `${slText}: part codes must be ministry ids`,
      );
      let total = 0,
        gz = 0;
      for (const [__rowIndex1, pp] of parts.entries()) {
        const file = get(pp, 'file', kind(pp, parts, __rowIndex1)),
          code = get(pp, 'code', kind(pp, parts, __rowIndex1)),
          codeText = pstr(code, kind(code, pp, 'code')),
          rel = pyMethod(file, 'removeprefix', kind(file, pp, 'file')).startsWith('data/')
            ? file.slice(5)
            : file;
        if (
          !c.ok(
            ctx.exists(rel) && file === `data/ministries/${codeText}.json`,
            `${slText}: part file ${pstr(file, kind(file, pp, 'file'))}`,
          )
        )
          continue;
        listed.add(file.slice(5));
        const raw = ctx.bytes(rel),
          size = raw.length,
          gzip = gzipSize(raw);
        c.ok(
          equal(get(pp, 'bytes', kind(pp, parts, __rowIndex1)), size) &&
            equal(get(pp, 'gzipBytes', kind(pp, parts, __rowIndex1)), gzip),
          `${slText}: part ${codeText} bytes ${pstr(get(pp, 'bytes', kind(pp, parts, __rowIndex1)), kind(get(pp, 'bytes', kind(pp, parts, __rowIndex1)), pp, 'bytes'))}/${pstr(get(pp, 'gzipBytes', kind(pp, parts, __rowIndex1)), kind(get(pp, 'gzipBytes', kind(pp, parts, __rowIndex1)), pp, 'gzipBytes'))} vs ${size}/${gzip}`,
        );
        total += size;
        gz += gzip;
      }
      c.ok(
        equal(get(d, 'bytes', kind(d, dss, __rowIndex0)), total) &&
          equal(get(d, 'gzipBytes', kind(d, dss, __rowIndex0)), gz),
        `${slText}: bytes/gzipBytes ${pstr(get(d, 'bytes', kind(d, dss, __rowIndex0)), kind(get(d, 'bytes', kind(d, dss, __rowIndex0)), d, 'bytes'))}/${pstr(get(d, 'gzipBytes', kind(d, dss, __rowIndex0)), kind(get(d, 'gzipBytes', kind(d, dss, __rowIndex0)), d, 'gzipBytes'))} must be the sums of the parts ${total}/${gz}`,
      );
      continue;
    }
    const file = get(d, 'file', kind(d, dss, __rowIndex0)),
      rel = pySlice(file, 5, kind(file, d, 'file'));
    c.ok(
      starts(file, 'data/', kind(file, d, 'file')) && ctx.exists(rel),
      `${slText}: file ${pstr(file, kind(file, d, 'file'))} does not exist`,
    );
    if (!ctx.exists(rel)) continue;
    listed.add(rel);
    const raw = ctx.bytes(rel),
      size = raw.length,
      gzip = gzipSize(raw);
    if (get(d, 'id', kind(d, dss, __rowIndex0)) === 'D25')
      c.ok(
        !Object.hasOwn(d, 'bytes') && !Object.hasOwn(d, 'gzipBytes'),
        `${slText}: the catalog must not state its own size`,
      );
    else
      c.ok(
        equal(get(d, 'bytes', kind(d, dss, __rowIndex0)), size) &&
          equal(get(d, 'gzipBytes', kind(d, dss, __rowIndex0)), gzip),
        `${slText}: bytes/gzipBytes ${pstr(opt(d, 'bytes', undefined, kind(d, dss, __rowIndex0)), kind(opt(d, 'bytes'), d, 'bytes'))}/${pstr(opt(d, 'gzipBytes', undefined, kind(d, dss, __rowIndex0)), kind(opt(d, 'gzipBytes'), d, 'gzipBytes'))} vs the file ${size}/${gzip} (rebuild the catalog)`,
      );
    if (['JSON', 'GeoJSON'].includes(format)) {
      const doc = ctx.get(rel),
        m = opt(doc, 'meta', {});
      c.ok(
        equal(status, opt(m, 'status', undefined, kind(m, doc, 'meta'))) &&
          equal(
            get(d, 'mock', kind(d, dss, __rowIndex0)),
            pyTruth(opt(m, 'mock', false, kind(m, doc, 'meta'))),
          ) &&
          sameSet(
            source,
            opt(m, 'source', [], kind(m, doc, 'meta')),
            kind(source, d, 'source'),
            kind(opt(m, 'source', []), m, 'source'),
          ),
        `${slText}: status/mock/source vs meta`,
      );
      for (const kk of ['asOf', 'unit'])
        if (Object.hasOwn(d, kk))
          c.ok(
            equal(
              get(d, kk, kind(d, dss, __rowIndex0)),
              opt(m, kk, undefined, kind(m, doc, 'meta')),
            ),
            `${slText}: ${kk} ${pyRepr(get(d, kk, kind(d, dss, __rowIndex0)), kind(get(d, kk, kind(d, dss, __rowIndex0)), d, kk))} vs meta ${pyRepr(opt(m, kk, undefined, kind(m, doc, 'meta')), kind(opt(m, kk), m, kk))}`,
          );
      const mid = pyMethod(
        opt(m, 'id', '', kind(m, doc, 'meta')),
        'split',
        kind(opt(m, 'id', ''), m, 'id'),
      ).split('+');
      if (mid.every((x: string) => /^[DMP]\d\d\n?$/.test(catalogDecimalText(x))))
        c.ok(
          sameSet(
            get(d, 'contains', kind(d, dss, __rowIndex0)),
            mid,
            kind(get(d, 'contains', kind(d, dss, __rowIndex0)), d, 'contains'),
            kind(mid),
          ),
          `${slText}: contains ${pstr(get(d, 'contains', kind(d, dss, __rowIndex0)), kind(get(d, 'contains', kind(d, dss, __rowIndex0)), d, 'contains'))} vs meta.id ${pstr(opt(m, 'id', undefined, kind(m, doc, 'meta')), kind(opt(m, 'id'), m, 'id'))}`,
        );
      else
        c.ok(
          equal(
            get(d, 'contains', kind(d, dss, __rowIndex0)),
            get(d, 'id', kind(d, dss, __rowIndex0)) === 'core' ? ['D18'] : [],
          ) && equal(opt(m, 'id', undefined, kind(m, doc, 'meta')), sl),
          `${slText}: contains ${pstr(get(d, 'contains', kind(d, dss, __rowIndex0)), kind(get(d, 'contains', kind(d, dss, __rowIndex0)), d, 'contains'))} vs meta.id ${pstr(opt(m, 'id', undefined, kind(m, doc, 'meta')), kind(opt(m, 'id'), m, 'id'))}`,
        );
      c.ok(
        sameSet(
          opt(d, 'pending', [], kind(d, dss, __rowIndex0)),
          opt(m, 'pending', [], kind(m, doc, 'meta')),
          kind(opt(d, 'pending', []), d, 'pending'),
          kind(opt(m, 'pending', []), m, 'pending'),
        ),
        `${slText}: pending ${pstr(opt(d, 'pending', undefined, kind(d, dss, __rowIndex0)), kind(opt(d, 'pending'), d, 'pending'))} vs meta.pending ${pstr(opt(m, 'pending', undefined, kind(m, doc, 'meta')), kind(opt(m, 'pending'), m, 'pending'))}`,
      );
      c.ok(
        equal(opt(d, 'schema', undefined, kind(d, dss, __rowIndex0)), schema(doc)),
        `${slText}: schema differs from the top-level keys of the file`,
      );
    }
    c.ok(
      equal(
        get(d, 'eager', kind(d, dss, __rowIndex0)),
        get(d, 'id', kind(d, dss, __rowIndex0)) === 'core',
      ),
      `${slText}: only core.json is eager`,
    );
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
    c.ok(
      uniq(
        rows.map((x, __rowIndex36, __rowValues37) =>
          get(x, 'id', kind(x, __rowValues37, __rowIndex36)),
        ),
      ).length === rows.length,
      `${section}: ids`,
    );
    for (const [__rowIndex4, x] of rows.entries())
      c.ok(
        ['id', 'title', 'text'].every((kk) =>
          strField(opt(x, kk, undefined, kind(x, rows, __rowIndex4))),
        ),
        `${section} ${pstr(opt(x, 'id', undefined, kind(x, rows, __rowIndex4)), kind(opt(x, 'id'), x, 'id'))}: title/text`,
      );
  }
  c.ok(
    iterable(get(cat, 'traps'), kind(get(cat, 'traps'), cat, 'traps')).some(
      (x, __rowIndex40, __rowValues41) =>
        get(x, 'id', kind(x, __rowValues41, __rowIndex40)) === 'two-versions',
    ),
    'the two-versions trap must be listed',
  );
  const fs = iterable(rawFiles, kind(rawFiles, cat, 'files'));
  for (const [__rowIndex5, f] of fs.entries()) {
    const hasRequired = ['name', 'title', 'sha256', 'bytes', 'source', 'role', 'usedBy'].every(
      (x) => contains(f, x, kind(f, fs, __rowIndex5)),
    );
    const name = opt(f, 'name', undefined, kind(f, fs, __rowIndex5));
    c.ok(hasRequired, `files ${pstr(name, kind(name, f, 'name'))}: keys`);
    const sha = get(f, 'sha256', kind(f, fs, __rowIndex5));
    if (typeof sha !== 'string')
      error('TypeError', `expected string or bytes-like object, got '${kind(sha, f, 'sha256')}'`);
    c.ok(
      /^[0-9a-f]{64}\n?$/.test(sha) &&
        (() => {
          const bytes = get(f, 'bytes', kind(f, fs, __rowIndex5));
          return (
            ((Number.isInteger(bytes) && pythonNumberAt(f, 'bytes', bytes).kind === 'int') ||
              typeof bytes === 'boolean') &&
            number(bytes) > 0
          );
        })(),
      `files ${pstr(get(f, 'name', kind(f, fs, __rowIndex5)), kind(get(f, 'name', kind(f, fs, __rowIndex5)), f, 'name'))}: sha256/bytes`,
    );
    c.ok(
      pyTruth(get(f, 'source', kind(f, fs, __rowIndex5))) &&
        iterable(
          get(f, 'source', kind(f, fs, __rowIndex5)),
          kind(get(f, 'source', kind(f, fs, __rowIndex5)), f, 'source'),
        ).every((x) =>
          contains(get(core, 'sources'), x, kind(get(core, 'sources'), core, 'sources')),
        ),
      `files ${pstr(get(f, 'name', kind(f, fs, __rowIndex5)), kind(get(f, 'name', kind(f, fs, __rowIndex5)), f, 'name'))}: source keys`,
    );
    c.ok(
      pyTruth(get(f, 'usedBy', kind(f, fs, __rowIndex5))) &&
        iterable(
          get(f, 'usedBy', kind(f, fs, __rowIndex5)),
          kind(get(f, 'usedBy', kind(f, fs, __rowIndex5)), f, 'usedBy'),
        ).every((x) => contains(slugs, x)),
      `files ${pstr(get(f, 'name', kind(f, fs, __rowIndex5)), kind(get(f, 'name', kind(f, fs, __rowIndex5)), f, 'name'))}: usedBy ${pstr(get(f, 'usedBy', kind(f, fs, __rowIndex5)), kind(get(f, 'usedBy', kind(f, fs, __rowIndex5)), f, 'usedBy'))} are not dataset slugs`,
    );
    c.ok(
      ['url', 'page', 'note'].filter((x) => pyTruth(opt(f, x, undefined, kind(f, fs, __rowIndex5))))
        .length >= 1,
      `files ${pstr(get(f, 'name', kind(f, fs, __rowIndex5)), kind(get(f, 'name', kind(f, fs, __rowIndex5)), f, 'name'))}: needs url, page or note`,
    );
    for (const kk of ['url', 'page'])
      if (pyTruth(opt(f, kk, undefined, kind(f, fs, __rowIndex5))))
        c.ok(
          starts(get(f, kk, kind(f, fs, __rowIndex5)), 'https://', kind(get(f, kk), f, kk)),
          `files ${pstr(get(f, 'name', kind(f, fs, __rowIndex5)), kind(get(f, 'name', kind(f, fs, __rowIndex5)), f, 'name'))}: ${kk} ${pyRepr(get(f, kk, kind(f, fs, __rowIndex5)), kind(get(f, kk, kind(f, fs, __rowIndex5)), f, kk))}`,
        );
    const blob = entries(f, kind(f, fs, __rowIndex5))
      .map(([, v]) => pstr(v))
      .join(' ')
      .toLowerCase();
    c.ok(
      !blob.includes('private channel') && !internal.some((x) => blob.includes(x)),
      `files ${pstr(get(f, 'name', kind(f, fs, __rowIndex5)), kind(get(f, 'name', kind(f, fs, __rowIndex5)), f, 'name'))}: internal or private wording`,
    );
  }
  c.ok(
    uniq(
      fs.map((f, __rowIndex48, __rowValues49) =>
        get(f, 'name', kind(f, __rowValues49, __rowIndex48)),
      ),
    ).length === fs.length &&
      uniq(
        fs.map((f, __rowIndex50, __rowValues51) =>
          get(f, 'sha256', kind(f, __rowValues51, __rowIndex50)),
        ),
      ).length === fs.length,
    'files: names and checksums must be unique',
  );
  const execution = ctx.get('execution.json'),
    data = get(execution, 'data'),
    years = values(data, kind(data, execution, 'data')),
    yearKeys = pythonKeys(data),
    kfpFiles = new Map<any, any>(),
    got = new Map<any, any>();
  for (const [yearIndex, year] of years.entries()) {
    const files = iterable(
      get(year, 'files', kind(year, data, yearKeys[yearIndex])),
      kind(get(year, 'files', kind(year, data, yearKeys[yearIndex])), year, 'files'),
    );
    for (const [fileIndex, file] of files.entries())
      dictSet(
        kfpFiles,
        get(file, 'file', kind(file, files, fileIndex)),
        get(file, 'sha256', kind(file, files, fileIndex)),
      );
  }
  for (const [index, file] of fs.entries())
    dictSet(
      got,
      get(file, 'name', kind(file, fs, index)),
      get(file, 'sha256', kind(file, fs, index)),
    );
  c.ok(
    [...kfpFiles].every(([key, sha]) => equal(dictGet(got, key), sha)),
    'the 19 KFP reports of execution.json must be listed with the same checksums',
  );
  const needs = pageNeeds(ctx),
    fileDs = new Map<string, any>();
  for (const [__rowIndex7, d] of dss.entries()) {
    if (pyTruth(opt(d, 'file', undefined, kind(d, dss, __rowIndex7))))
      fileDs.set(get(d, 'file', kind(d, dss, __rowIndex7)), d);
    for (const [__rowIndex8, pp] of iterable(
      opt(d, 'parts', [], kind(d, dss, __rowIndex7)),
      kind(opt(d, 'parts', []), d, 'parts'),
    ).entries())
      fileDs.set(get(pp, 'file', kind(pp, iterable(opt(d, 'parts', [])), __rowIndex8)), d);
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
          `${rid} reads ${pstr(get(d, 'slug'), kind(get(d, 'slug'), d, 'slug'))} but the catalog lists screens ${joinStrings(get(d, 'screens'), ',')} for it`,
        );
        warn++;
      }
    }
  const pages = new Set(Object.keys(needs).filter((rid) => needs[rid]!.length > 0));
  for (const [__rowIndex10, d] of dss.entries()) {
    if (
      get(d, 'id', kind(d, dss, __rowIndex10)) === 'core' ||
      get(d, 'status', kind(d, dss, __rowIndex10)) === 'pending'
    )
      continue;
    for (const rid of iterable(
      get(d, 'screens', kind(d, dss, __rowIndex10)),
      kind(get(d, 'screens', kind(d, dss, __rowIndex10)), d, 'screens'),
    ))
      if (
        setContains(pages, rid) &&
        !needs[rid]!.some((nm) => fileDs.get(`data/${nm.replace(/\?+$/, '')}.json`) === d)
      ) {
        c.warn(
          `catalog lists ${pstr(rid)} for ${pstr(get(d, 'slug', kind(d, dss, __rowIndex10)), kind(get(d, 'slug'), d, 'slug'))} but that page's needs do not include it`,
        );
        warn++;
      }
  }
  c.fact(
    `${dss.length} datasets (${real} real, ${mock} mock, ${pend} pending) describe ${disk.length} files; ${fs.length} primary source files; ${warn} screen/needs differences (warnings)`,
  );
  return c;
}
