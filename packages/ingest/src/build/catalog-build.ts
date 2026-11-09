import { metadata } from '../common/metadata.js';
import { monthName } from '../common/format.js';
import { clean } from '../io/data.js';
import {
  catalogGzipSize,
  catalogSchema,
  catalogCounts,
  type CatalogDocument,
  type CatalogEntry,
} from './catalog-refresh.js';
import { primaryFiles, type CatalogPrimaryInput } from './catalog-primary.js';
import {
  catalogEditorial,
  catalogPythonStringAt,
  type CatalogEditorialInput,
} from './catalog-editorial.js';

/** Shared authored definitions, also consumed by aggregation search. */
export interface CatalogDefinition {
  slug: string;
  file: string;
  group: string;
  title: string;
  desc: string;
  screens: string[];
  self?: boolean;
  multi?: boolean;
  contains?: string[];
  eager?: boolean;
  format?: string;
  mediaType?: string;
  search?: { period?: string; kw?: string };
}
export interface CatalogPending {
  title: string;
  reason: string;
  source: string[];
  screens: string[];
  expected: string;
}
export interface CatalogOwner {
  object: Record<string, any>;
  bytes: Uint8Array;
}
export interface CatalogBuildInput {
  definitions: readonly CatalogDefinition[];
  groups: readonly { id: string; label: string }[];
  pending: Record<string, CatalogPending>;
  /** Already serialized owner-stage objects and the exact bytes to write. */
  out: ReadonlyMap<string, CatalogOwner>;
  texts: ReadonlyMap<string, Uint8Array>;
  disk: ReadonlyMap<string, Uint8Array>;
  buildDate: string;
  expectedMinistryFiles: readonly string[];
  primary: CatalogPrimaryInput;
  editorial: Omit<CatalogEditorialInput, 'owners'>;
}
const decoder = new TextDecoder('utf-8', { fatal: true });
function parseObject(bytes: Uint8Array): Record<string, any> {
  const obj: unknown = JSON.parse(decoder.decode(bytes));
  clean(obj);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    throw new Error('Expected JSON object');
  return obj as Record<string, any>;
}
function need(input: CatalogBuildInput, name: string): Record<string, any> {
  const obj = input.out.get(name)?.object;
  if (!obj) throw new Error(`catalog needs ${name} built first`);
  clean(obj);
  return obj;
}
function blob(
  input: CatalogBuildInput,
  name: string,
): { obj: Record<string, any> | null; bytes: Uint8Array } | null {
  const owner = input.out.get(name);
  if (owner) {
    const parsed = parseObject(owner.bytes);
    if (JSON.stringify(clean(owner.object)) !== JSON.stringify(clean(parsed)))
      throw new Error(`Owner bytes disagree: ${name}`);
    return { obj: owner.object, bytes: owner.bytes };
  }
  const text = input.texts.get(name);
  if (text) return { obj: null, bytes: text };
  const disk = input.disk.get(name);
  return disk ? { obj: name.endsWith('.json') ? parseObject(disk) : null, bytes: disk } : null;
}
const years = (a: number | string, b: number | string) => {
  if (
    (typeof a !== 'number' && typeof a !== 'string') ||
    (typeof b !== 'number' && typeof b !== 'string') ||
    a === '' ||
    b === '' ||
    (typeof a === 'number' && !Number.isFinite(a)) ||
    (typeof b === 'number' && !Number.isFinite(b))
  )
    throw new Error('Invalid period years');
  return a === b ? String(a) : `${a}–${b}`;
};

interface YearToken {
  value: number;
  text: string;
}
function yearAt(holder: object, key: string): YearToken {
  const raw = (holder as Record<string, unknown>)[key];
  if ((typeof raw !== 'number' || !Number.isFinite(raw)) && typeof raw !== 'boolean')
    throw new Error('Invalid period year');
  return {
    value: typeof raw === 'boolean' ? Number(raw) : (raw as number),
    text: catalogPythonStringAt(holder, key),
  };
}
function yearArray(value: unknown): YearToken[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Missing period years');
  return value.map((_, i) => yearAt(value, String(i)));
}
function byPeriod(value: unknown): YearToken[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid periods');
  return Object.values(value).map((p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid period');
    return yearAt(p, 'year');
  });
}
function yearRange(values: YearToken[]): string {
  if (!values.length) throw new Error('Missing period years');
  let lo = values[0]!,
    hi = lo;
  for (const v of values.slice(1)) {
    if (v.value < lo.value) lo = v;
    if (v.value > hi.value) hi = v;
  }
  return lo.value === hi.value ? lo.text : `${lo.text}–${hi.text}`;
}
function yearEndpoints(value: unknown): string {
  const v = yearArray(value),
    first = v[0]!,
    last = v.at(-1)!;
  return first.value === last.value ? first.text : `${first.text}–${last.text}`;
}

const truth = (v: unknown): boolean =>
  v != null &&
  v !== false &&
  v !== 0 &&
  v !== '' &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 0);
function dates(values: (string | null | undefined)[]) {
  const sorted = values.filter((x): x is string => !!x).sort();
  return sorted.length ? `${sorted[0]} … ${sorted.at(-1)}` : null;
}
function period(slug: string, obj: Record<string, any>, input: CatalogBuildInput): string | null {
  let ys: number[];
  switch (slug) {
    case 'outlook':
    case 'revenue':
    case 'gva-sectors':
      return yearRange([...yearArray(obj.years), ...byPeriod(obj.byPeriod)]);
    case 'core':
      return yearEndpoints(obj.years.list);
    case 'expenditure':
      return yearRange([
        ...yearArray(obj.functions.years),
        ...yearArray(obj.economic.years),
        ...yearArray(obj.cofog.years),
        ...byPeriod(obj.byPeriod),
      ]);
    case 'components':
      return yearEndpoints(obj.nationalVsEu.years);
    case 'ministries':
      return yearAt(need(input, 'outlook.json').years, '2').text;
    case 'programs':
      ys = obj.fields
        .filter((s: string) => /^y\d+$/.test(s))
        .map((s: string) => Number(s.slice(1)))
        .sort((a: number, b: number) => a - b);
      return years(ys[0]!, ys.at(-1)!);
    case 'measures':
      ys = Object.keys(obj.totals.discretionary['II-8'])
        .map((y) => {
          if (!/^\d+$/.test(y)) throw new Error('Invalid measure year');
          return Number(y);
        })
        .sort((a, b) => a - b);
      return years(ys[0]!, ys.at(-1)!);
    case 'law':
      return dates([
        ...obj.timeline.map((e: any) => e.date),
        ...obj.timeline.map((e: any) => e.dateTo),
        ...obj.gazette.map((g: any) => g.date),
      ]);
    case 'execution': {
      const keys = Object.keys(obj.data).sort(),
        last = keys.at(-1)!;
      const month = obj.data[last].months;
      if (!Number.isInteger(month)) throw new Error('Invalid execution month');
      return `${keys[0]}-01 … ${last}-${String(month).padStart(2, '0')}`;
    }
    case 'debt':
      return yearRange([...yearArray(obj.zdd.years), ...yearArray(obj.maastricht.years)]);
    case 'rates':
      return yearAt(obj.rules, 'year').text;
    case 'municipalities':
      return yearAt(obj, 'year').text;
    case 'geo-obshtini':
      return obj.meta.asOf.slice(0, 4);
    case 'sebra':
      return dates(obj.days.map((d: any) => d.date));
    case 'feed':
    case 'feed-rss':
      return dates(need(input, 'feed.json').events.map((e: any) => e.date));
    case 'mock-activities':
      return yearEndpoints(obj.meta.years);
    case 'mock-indicators':
      return '2024–2026';
    case 'mock-municipal-finance':
    case 'mock-projects':
      return yearAt(need(input, 'outlook.json').years, '2').text;
    case 'mock-payments':
      return `${obj.months[0].month} … ${obj.months.at(-1).month}`;
    default:
      return null;
  }
}
function facts(input: CatalogBuildInput): Record<string, string | number> {
  const revenue = need(input, 'revenue.json'),
    exp = need(input, 'expenditure.json'),
    mins = need(input, 'ministries.json'),
    progs = need(input, 'programs.json'),
    meas = need(input, 'measures.json'),
    muni = need(input, 'municipalities.json'),
    rates = need(input, 'rates.json'),
    sebra = need(input, 'sebra.json'),
    feed = need(input, 'feed.json'),
    core = need(input, 'core.json');
  const gl = blob(input, 'glossary.json')?.obj,
    guide = blob(input, 'guide.json')?.obj,
    ind = blob(input, 'mock/indicators.json')?.obj,
    asof = core.kpis.asOf;
  if (typeof asof !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(asof)) throw new Error('Invalid asOf');
  return {
    n_rev_groups: revenue.groups.length,
    n_rev_rows: revenue.rows.length,
    n_functions: exp.functions.items.length,
    cofog_from: yearAt(exp.cofog.years, '0').text,
    cofog_to: yearAt(exp.cofog.years, String(exp.cofog.years.length - 1)).text,
    n_budgets: mins.items.length,
    n_pending_programs: mins.items.filter((m: any) => m.programs.status !== 'real').length,
    n_programs: progs.items.length,
    n_measures: meas.items.length,
    n_munis: muni.items.length,
    n_activities: rates.tzpb.activities.length,
    n_days: sebra.days.length,
    n_terms: gl && Object.keys(gl).length ? gl.terms.length : core.counts.terms,
    n_steps: guide && Object.keys(guide).length ? guide.steps.length : 8,
    n_events: feed.events.length,
    n_indicator_programs: ind && Object.keys(ind).length ? ind.items.length : 0,
    asof_month: `${monthName(Number(asof.slice(5, 7)))} ${asof.slice(0, 4)}`,
  };
}
function entry(
  input: CatalogBuildInput,
  d: CatalogDefinition,
  fct: Record<string, string | number>,
  selfMeta: Record<string, any>,
): CatalogEntry | null {
  let obj: Record<string, any> | null,
    bytes: Uint8Array | undefined,
    m: Record<string, any>,
    raw: number | undefined,
    gz: number | undefined,
    p: string | null,
    asOf: string,
    e: CatalogEntry;
  let parts: { code: string; file: string; bytes: number; gzipBytes: number }[] | undefined;
  if (d.multi) {
    const keys = [...input.out.keys()].filter((k) => k.startsWith('ministries/')).sort();
    if (!keys.length) throw new Error('catalog: no ministries/*.json built');
    const expected = [...input.expectedMinistryFiles].sort();
    if (
      new Set(expected).size !== expected.length ||
      JSON.stringify(keys) !== JSON.stringify(expected)
    )
      throw new Error('catalog: ministry file set differs');
    parts = keys.map((k) => {
      const o = blob(input, k)!;
      return {
        code: k
          .split('/')
          .at(-1)!
          .replace(/\.[^.]*$/, ''),
        file: `data/${k}`,
        bytes: o.bytes.length,
        gzipBytes: catalogGzipSize(o.bytes),
      };
    });
    obj = input.out.get(keys[0]!)!.object;
    bytes = input.out.get(keys[0]!)!.bytes;
    m = obj.meta;
    raw = parts.reduce((n, x) => n + x.bytes, 0);
    gz = parts.reduce((n, x) => n + x.gzipBytes, 0);
    asOf = keys
      .map((k) => input.out.get(k)!.object.meta.asOf as string)
      .sort()
      .at(-1)!;
    p = yearEndpoints(obj.years);
    e = {
      id: m.id,
      slug: d.slug,
      file: null,
      fileTemplate: 'data/ministries/<код>.json',
    } as unknown as CatalogEntry;
  } else if (d.self) {
    obj = null;
    m = selfMeta;
    p = null;
    asOf = m.asOf;
    e = { id: m.id, slug: d.slug, file: `data/${d.file}` } as CatalogEntry;
  } else {
    const b = blob(input, d.file);
    if (!b) return null;
    obj = b.obj;
    bytes = b.bytes;
    m = obj?.meta ?? (d.slug === 'feed-rss' ? need(input, 'feed.json').meta : null);
    if (!m) throw new Error(`catalog: ${d.file} has no meta`);
    raw = bytes.length;
    gz = catalogGzipSize(bytes);
    p = period(d.slug, obj ?? need(input, 'feed.json'), input);
    asOf = m.asOf;
    if (typeof m.id !== 'string') throw new Error('Invalid metadata id');
    e = { id: m.id.split('+')[0]!, slug: d.slug, file: `data/${d.file}` } as CatalogEntry;
  }
  if (!m || typeof m.id !== 'string' || typeof m.status !== 'string' || typeof asOf !== 'string')
    throw new Error(`Invalid metadata: ${d.file}`);
  const stringList = (value: unknown, field: string): string[] => {
    if (
      value == null ||
      (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
    )
      return [];
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
      throw new Error(`Invalid ${field} metadata`);
    return value;
  };
  const source = stringList(m.source, 'source'),
    pending = stringList(m.pending, 'pending');
  if (truth(m.unit) && typeof m.unit !== 'string') throw new Error('Invalid unit metadata');
  const contains = d.contains ?? m.id.split('+').filter((s: string) => /^[DMP]\d{2}$/.test(s));
  const desc = d.desc.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(fct, key)) throw new Error(`Missing catalog fact ${key}`);
    return String(fct[key]);
  });
  const schema = obj && bytes ? catalogSchema(bytes).schema : [];
  Object.assign(e, {
    title: d.title,
    description: desc,
    group: d.group,
    status: m.status,
    source: [...source],
    ...(p ? { period: p } : {}),
    asOf,
    ...(truth(m.unit) ? { unit: m.unit } : {}),
    format: d.format ?? 'JSON',
    mediaType: d.mediaType ?? 'application/json',
    ...(raw !== undefined ? { bytes: raw, gzipBytes: gz } : {}),
    screens: [...d.screens],
    eager: !!d.eager,
    contains: [...contains],
    ...(pending.length ? { pending: [...pending] } : {}),
    mock: truth(m.mock) || m.status === 'mock',
    ...(parts ? { parts } : {}),
    ...(schema.length ? { schema } : {}),
  });
  return e;
}
export function buildCatalog(input: CatalogBuildInput): {
  catalog: CatalogDocument;
  notes: string[];
} {
  const fct = facts(input),
    meta = metadata(
      'D25',
      'Каталог на данните: набори, капани, методика и контролни суми',
      input.buildDate,
      {
        source: ['wg'],
        sourceNote:
          'Описание на файловете на сайта; контролните суми са на първичните файлове, изтеглени от издателите.',
        asOf: input.buildDate,
      },
    );
  const datasets: CatalogEntry[] = [],
    skipped: string[] = [];
  for (const d of input.definitions) {
    const e = entry(input, d, fct, meta);
    if (e) datasets.push(e);
    else skipped.push(d.file);
  }
  for (const id of Object.keys(input.pending).sort()) {
    const p = input.pending[id]!;
    datasets.push({
      id,
      slug: id.toLowerCase(),
      title: p.title,
      description: p.reason,
      group: 'pending',
      status: 'pending',
      source: [...p.source],
      screens: [...p.screens],
      eager: false,
      contains: [id],
      expected: p.expected,
      mock: false,
    });
  }
  const groups = input.groups.filter((g) => datasets.some((e) => e.group === g.id));
  const files = primaryFiles(input.primary);
  const { traps, methodology } = catalogEditorial({ ...input.editorial, owners: input.out });
  const cat: CatalogDocument = {
    meta,
    groups,
    counts: {},
    datasets,
    traps,
    methodology,
    files,
  };
  cat.counts = catalogCounts(cat, true);
  const ownSchema = catalogSchema(Buffer.from(JSON.stringify(cat))).schema;
  for (const e of datasets)
    if (input.definitions.some((d) => d.slug === e.slug && d.self)) e.schema = ownSchema;
  clean(cat);
  return {
    catalog: cat,
    notes: skipped.length ? [`catalog: files not found and left out: ${skipped.join(', ')}`] : [],
  };
}
