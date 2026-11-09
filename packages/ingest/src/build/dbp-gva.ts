import { metadata } from '../common/metadata.js';
import type { Json } from '@sigma-budget/dataset-schema';
import { pythonRound } from '../common/format.js';
import { pythonFloatSum } from '../common/numbers.js';
import { isIsoDay } from '../common/dates.js';
import type { JsonStat } from '../io/data.js';

type FigureValue = number | string | null;
export interface PlanFigure {
  id: string;
  value: FigureValue;
  unit?: string | null;
  page: number;
  basis: string;
  year?: number | null;
  table?: string | null;
}
export interface PlanDerived {
  id: string;
  value: FigureValue;
  unit: string | null;
  year: number;
  formula: string;
}
export interface PlanInput {
  figures: PlanFigure[];
  derived: PlanDerived[];
}
type Extra = [string, number, string, number, number, string, string];
export interface SourceMeta {
  id: string;
  title: string;
  status: string;
  source: string[];
  sourceNote: string;
  asOf?: string;
  retrieved: string;
  unit: string;
  mock: boolean;
  links?: Record<string, string>;
}
export interface PlanEditorial {
  EXTRA: Extra[];
  steps: unknown[];
  measures: Record<string, unknown>;
  missing: unknown[];
  meta: SourceMeta;
  doc: Record<string, unknown>;
  deficitFormula: string;
}
function sourceMeta(m: SourceMeta, asOf: string, extra: Record<string, Json> = {}) {
  return metadata(m.id, m.title, m.retrieved, {
    status: m.status,
    source: m.source,
    sourceNote: m.sourceNote,
    asOf,
    unit: m.unit,
    extra,
  });
}
const USE = ['t4.', 't6.', 'rule.', 'n26.', 'n27.', 'm.', 'm27.', 'd.', 'def.'];
const DERIVED = new Set(['deficit.2027.eur', 'gdp.2026', 'gdp.2027']);
const unit = (u: string | null | undefined) => (u == null ? null : u.replaceAll('EUR', '€'));
/** Transform the extracted plan evidence. Editorial text and additions come from the frozen donor source. */
export function buildBudgetPlan(input: PlanInput, editorial: PlanEditorial, pdfSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(pdfSha256)) throw new Error('Invalid PDF hash');
  const figures: Record<string, Record<string, unknown>> = {};
  for (const f of input.figures) {
    if (typeof f.id !== 'string') throw new Error('Missing figure id');
    if (!USE.some((p) => f.id.startsWith(p)) || f.id === 'n27.MOD') continue;
    if (['value', 'page', 'basis'].some((key) => !Object.hasOwn(f, key)))
      throw new Error(`Missing figure field: ${f.id}`);
    if (f.table != null && typeof f.table !== 'string')
      throw new Error(`Invalid figure table: ${f.id}`);
    const e: Record<string, unknown> = { v: f.value, u: unit(f.unit), p: f.page, b: f.basis };
    if (f.year != null) e.y = f.year;
    if (f.table) e.t = f.table;
    e.k = 'reported';
    figures[f.id] = e;
  }
  for (const [id, v, u, y, p, t, b] of editorial.EXTRA) {
    if (Object.hasOwn(figures, id)) throw new Error(`duplicate id ${id}`);
    figures[id] = { v, u, y, p, t, b, k: 'reported' };
  }
  for (const f of input.derived) {
    if (typeof f.id !== 'string') throw new Error('Missing derived id');
    if (DERIVED.has(f.id)) {
      if (['value', 'unit', 'year', 'formula'].some((key) => !Object.hasOwn(f, key)))
        throw new Error(`Missing derived field: ${f.id}`);
      figures[f.id] = {
        v: f.value,
        u: unit(f.unit),
        y: f.year,
        b: 'DERIVED',
        k: 'derived',
        f: f.formula,
      };
    }
  }
  if (!figures['deficit.2027.eur']) throw new Error('Missing derived deficit');
  figures['deficit.2027.eur'].f = editorial.deficitFormula;
  return {
    meta: sourceMeta(editorial.meta, editorial.meta.asOf!),
    doc: { ...editorial.doc, sha256: pdfSha256 },
    figures: Object.fromEntries(
      Object.entries(figures).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    edp: { steps: editorial.steps },
    measures: editorial.measures,
    missing: editorial.missing,
  };
}

type Branch = [string, string, string];
type Part = [string, string, string, string];
export interface GvaEditorial {
  BRANCHES: Branch[];
  PART: Part;
  meta: SourceMeta;
}
export interface GvaStat extends JsonStat {
  extension: { annotation: { type: string; date: string }[] };
}
export interface Outlook {
  years: number[];
  gdp: { mlnPrecise: number[] };
}
type Cell = [number, string | null];
function annualYear(key: string): number {
  if (!/^\d{4}$/.test(key) || Number(key) < 1) throw new Error(`Invalid time year: ${key}`);
  return Number(key);
}
/** Slice JSON-stat in declared dimension order; absent and null cells are missing, not zero. */
export function gvaSeries(doc: GvaStat, dim: string, key: string): Map<number, Cell> {
  if (
    Object.hasOwn(doc, 'status') &&
    (!doc.status || typeof doc.status !== 'object' || Array.isArray(doc.status))
  )
    throw new Error('Invalid observation status map');
  if (
    !doc.id.includes(dim) ||
    !doc.id.includes('time') ||
    doc.id.length !== doc.size.length ||
    new Set(doc.id).size !== doc.id.length
  )
    throw new Error('Invalid dimensions');
  for (const [i, d] of doc.id.entries()) {
    const size = doc.size[i],
      category = doc.dimension[d]?.category.index;
    if (!Number.isSafeInteger(size) || size! <= 0 || !category || typeof category !== 'object')
      throw new Error(`Invalid dimension ${d}`);
    const indices = Array.isArray(category) ? category.map((_, i) => i) : Object.values(category);
    if (
      indices.length !== size ||
      new Set(indices).size !== size ||
      indices.some((n) => !Number.isSafeInteger(n) || n < 0 || n >= size!) ||
      (Array.isArray(category) &&
        (new Set(category).size !== size ||
          category.some((key) => typeof key !== 'string' || !key)))
    )
      throw new Error(`Invalid dimension category indices ${d}`);
  }
  const index = (d: string, k: string): number => {
    const cat = doc.dimension[d]?.category.index;
    const n = Array.isArray(cat) ? cat.indexOf(k) : cat?.[k];
    if (!Number.isSafeInteger(n) || n! < 0 || n! >= doc.size[doc.id.indexOf(d)]!)
      throw new Error(`Missing category ${d}:${k}`);
    return n!;
  };
  for (let i = 0; i < doc.id.length; i++)
    if (doc.id[i] !== dim && doc.id[i] !== 'time' && doc.size[i] !== 1)
      throw new Error(`Unspecified dimension ${doc.id[i]}`);
  const times = doc.dimension.time?.category.index;
  if (!times || Array.isArray(times)) throw new Error('Invalid time dimension');
  const out = new Map<number, Cell>();
  for (const [year, ti] of Object.entries(times)) {
    const calendarYear = annualYear(year);
    let pos = 0,
      stride = 1;
    for (let i = doc.id.length - 1; i >= 0; i--) {
      const d = doc.id[i]!;
      pos += (d === 'time' ? ti : d === dim ? index(dim, key) : 0) * stride;
      stride *= doc.size[i]!;
    }
    const value = (doc.value as Record<string, number | null>)[String(pos)];
    if (value != null) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid cell');
      out.set(calendarYear, [value, doc.status?.[String(pos)] ?? null]);
    }
  }
  return out;
}
export function buildGva(
  nama: GvaStat,
  gdpDoc: GvaStat,
  outlook: Outlook,
  editorial: GvaEditorial,
) {
  const updated = (d: GvaStat) => {
    for (const annotation of d.extension.annotation) {
      if (
        !annotation ||
        typeof annotation !== 'object' ||
        Array.isArray(annotation) ||
        typeof annotation.type !== 'string'
      )
        throw new Error('Invalid source update annotation');
      if (annotation.type !== 'UPDATE_DATA') continue;
      const date = annotation.date;
      if (typeof date !== 'string' || !isIsoDay(date.slice(0, 10)))
        throw new Error('Missing or invalid source update date');
      return date;
    }
    throw new Error('Missing source update date');
  };
  const asOf = [updated(nama), updated(gdpDoc)].sort()[0]!.slice(0, 10);
  const yearsOf = (d: GvaStat) => Object.keys(d.dimension.time!.category.index).map(annualYear);
  const other = new Set(yearsOf(gdpDoc));
  const years = yearsOf(nama)
    .filter((y) => other.has(y))
    .sort((a, b) => a - b);
  if (!years.length) throw new Error('No common years');
  const total = gvaSeries(nama, 'nace_r2', 'TOTAL'),
    part = gvaSeries(nama, 'nace_r2', editorial.PART[0]),
    gdp = gvaSeries(gdpDoc, 'na_item', 'B1GQ'),
    tax = gvaSeries(gdpDoc, 'na_item', 'D21X31');
  const branches = editorial.BRANCHES.map(([id, name, desc]) => ({
    id,
    name,
    desc,
    series: gvaSeries(nama, 'nace_r2', id),
  }));
  const cell = (s: Map<number, Cell>, y: number): Cell => {
    const v = s.get(y);
    if (!v) throw new Error(`Missing observation ${y}`);
    return v;
  };
  for (const y of years) {
    const sum = pythonRound(pythonFloatSum(branches.map((b) => cell(b.series, y)[0])), 1);
    if (Math.abs(sum - cell(total, y)[0]) > 0.3) throw new Error(`${y}: branches vs total`);
    if (Math.abs(pythonRound(cell(total, y)[0] + cell(tax, y)[0], 1) - cell(gdp, y)[0]) > 0.3)
      throw new Error(`${y}: GVA + taxes vs GDP`);
    cell(part, y);
  }
  for (const [i, y] of outlook.years.entries())
    if (
      gdp.has(y) &&
      (typeof outlook.gdp.mlnPrecise[i] !== 'number' ||
        Math.abs(outlook.gdp.mlnPrecise[i]! - cell(gdp, y)[0]) > 0.15)
    )
      throw new Error(`${y}: GDP differs from outlook`);
  const vals = (s: Map<number, Cell>) => years.map((y) => pythonRound(cell(s, y)[0], 1));
  const provisionalYears = years.filter((y) => branches.some((b) => cell(b.series, y)[1] === 'p'));
  return {
    meta: sourceMeta(editorial.meta, asOf, { provisionalYears, links: editorial.meta.links ?? {} }),
    years,
    gva: vals(total),
    taxesNet: vals(tax),
    gdp: vals(gdp),
    branches: branches.map(({ id, name, desc, series }) => ({ id, name, desc, mln: vals(series) })),
    parts: [
      {
        id: editorial.PART[0],
        name: editorial.PART[1],
        desc: editorial.PART[2],
        of: editorial.PART[3],
        mln: vals(part),
      },
    ],
  };
}
