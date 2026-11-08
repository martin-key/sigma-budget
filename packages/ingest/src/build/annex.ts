import { spec, sumRules } from './annex-spec.js';

export const YEARS = [2024, 2025, 2026, 2027, 2028] as const;
export const VINTAGE = ['actual', 'prelim', 'plan', 'forecast', 'forecast'] as const;
export interface TableRow {
  label: string;
  values: (number | null)[];
}
export interface AnnexTables {
  annex3_mln: { rows: TableRow[] };
  annex3_pct_gdp: { rows: TableRow[] };
}
export interface Annex {
  mln: Record<string, (number | null)[]>;
  pct: Record<string, (number | null)[]>;
  labels: Record<string, string>;
  tree: { id: string; label: string; level: number; parent: string | null; memo: boolean }[];
  gdp: (number | null)[];
}
export function loadAnnex(tables: AnnexTables): Annex {
  const rows = (table: { rows: TableRow[] }) =>
    table.rows.filter((r) => !['191', '192', '193', '194'].includes(r.label.trim()));
  const mln = rows(tables.annex3_mln),
    pct = rows(tables.annex3_pct_gdp);
  if (mln.length !== spec.length)
    throw new Error(`annex3_mln: ${mln.length} content rows, expected ${spec.length}`);
  const out: Annex = {
    mln: {},
    pct: {},
    labels: {},
    tree: [],
    gdp: pct[pct.length - 1]?.values ?? [],
  };
  spec.forEach(([id, label, parent, level], i) => {
    if (mln[i]!.label.trim() !== label)
      throw new Error(
        `annex3_mln label mismatch for ${id}: ${JSON.stringify(mln[i]!.label)} != ${JSON.stringify(label)}`,
      );
    out.mln[id] = mln[i]!.values;
    out.labels[id] = label;
    out.tree.push({ id, label, level, parent, memo: id === 'x.nonint' });
  });
  if (pct.length !== spec.length + 1 || pct[pct.length - 1]!.label.replaceAll(' ', '') !== 'БВП')
    throw new Error('annex3_pct_gdp layout changed');
  spec.forEach(([id, label], i) => {
    if (pct[i]!.label.trim() !== label)
      throw new Error(
        `annex3_pct_gdp label mismatch for ${id}: ${JSON.stringify(pct[i]!.label)} != ${JSON.stringify(label)}`,
      );
    out.pct[id] = pct[i]!.values;
  });
  return out;
}
export function checkAnnexSums(a: Annex, tol = 0.3): string[] {
  const problems: string[] = [];
  const requiredIds = new Set([
    ...Object.keys(sumRules),
    ...Object.values(sumRules).flat(),
    'r.total',
    'x.total',
    'x.balance',
    'x.fin',
    'x.exp',
    'x.interest',
    'x.nonint',
  ]);
  for (const id of requiredIds) {
    const values = a.mln[id];
    if (!Array.isArray(values) || values.length < YEARS.length)
      throw new Error(`Missing or short annex series: ${id}`);
  }
  const num = (id: string, i: number): number | null => {
    const values = a.mln[id];
    if (!Array.isArray(values) || values.length < YEARS.length)
      throw new Error(`Missing or short annex series: ${id}`);
    const value = values[i];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value)))
      throw new Error(`Invalid annex value: ${id}[${i}]`);
    return value;
  };
  const required = (id: string, i: number): number => {
    const value = num(id, i);
    if (value === null) throw new Error(`Missing annex identity operand: ${id}[${i}]`);
    return value;
  };
  for (const [parent, kids] of Object.entries(sumRules))
    YEARS.forEach((year, i) => {
      const pv = num(parent, i);
      if (pv === null) return;
      const sum = kids.reduce((s, k) => s + (num(k, i) || 0), 0);
      if (Math.abs(pv - sum) > tol + 1e-9)
        problems.push(
          `${parent} ${year}: ${pv.toFixed(1)} != sum(${kids.join(',')})=${sum.toFixed(1)}`,
        );
    });
  YEARS.forEach((year, i) => {
    const balance = required('r.total', i) - required('x.total', i),
      actual = required('x.balance', i);
    if (Math.abs(balance - actual) > tol + 1e-9)
      problems.push(`balance ${year}: ${balance.toFixed(1)} != ${actual.toFixed(1)}`);
    if (Math.abs(required('x.fin', i) + actual) > 1e-9) problems.push(`fin != -balance ${year}`);
    const nonint = required('x.exp', i) - required('x.interest', i),
      printed = required('x.nonint', i);
    if (Math.abs(nonint - printed) > tol + 1e-9)
      problems.push(`nonint ${year}: ${nonint.toFixed(1)} != ${printed.toFixed(1)}`);
  });
  return problems;
}
