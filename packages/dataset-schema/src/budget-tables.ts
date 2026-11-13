import { record, string, number, array, shape, literal, metaGuard, type Json } from './guards.js';
const amount = (v: unknown): v is number | null => v === null || number(v);
const integer = (v: unknown): v is number => number(v) && Number.isSafeInteger(v);
const integers = (v: unknown): v is (number | null)[] =>
  Array.isArray(v) && v.every((x) => x === null || integer(x));
const amounts = (v: unknown): v is (number | null)[] => Array.isArray(v) && v.every(amount);
const column = shape({ id: string, unit: (v: unknown): v is string => v === 'BGN' || v === 'EUR' });
const row = shape({ row: integer, label: string, source: integers, eur: amounts });
const table = shape({
  file: string,
  sha256: string,
  sheet: string,
  year: integer,
  period: integer,
  scope: string,
  columns: array,
  rows: array,
  checks: record,
});
export function budgetTablesGuard(v: unknown): v is Record<string, Json> {
  if (
    !record(v) ||
    !metaGuard(v.meta) ||
    !string(v.schema) ||
    !string(v.scope) ||
    !string(v.frequency) ||
    !array(v.tables) ||
    v.sourceIntegerScale !== 10000000 ||
    v.conversionRate !== 1.95583 ||
    v.unit !== 'млн. €' ||
    !array(v.notes) ||
    !array(v.limitations)
  )
    return false;
  const monthly = v.schema === 'state-budget/1';
  if (!monthly && v.schema !== 'kfp-subsectors/1') return false;
  if (v.tables.length !== (monthly ? 21 : 11)) return false;
  const keys = new Set<string>();
  for (const t of v.tables) {
    if (
      !table(t) ||
      !/^\w[\w .()\-]*\.xls$/i.test(t.file) ||
      !/^[a-f0-9]{64}$/.test(t.sha256) ||
      !['state', 'consolidated', 'central', 'social', 'local'].includes(t.scope)
    )
      return false;
    if (
      monthly
        ? t.scope !== 'state' ||
          ![2025, 2026].includes(t.year) ||
          t.period < 1 ||
          t.period > (t.year === 2025 ? 12 : 9) ||
          t.columns.length !== 2
        : t.scope === 'state' ||
          ![2024, 2025, 2026].includes(t.year) ||
          t.period !== (t.year === 2026 ? 2 : 4) ||
          t.columns.length !== t.period ||
          (t.scope === 'central' && t.year === 2025)
    )
      return false;
    const key = `${t.scope}/${t.year}/${t.period}`;
    if (keys.has(key)) return false;
    keys.add(key);
    if (!t.columns.every(column) || !t.rows.every(row) || !Object.values(t.checks).every(integer))
      return false;
    for (const r of t.rows) {
      if (!row(r) || r.source.length !== t.columns.length || r.eur.length !== t.columns.length)
        return false;
    }
  }
  return (
    monthly ||
    (array(v.missing) &&
      v.missing.length === 1 &&
      shape({
        year: (v: unknown): v is number => v === 2025,
        scope: literal('central'),
        reason: string,
      })(v.missing[0]))
  );
}
