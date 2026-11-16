import { type Json } from '@sigma-budget/dataset-schema';
export interface PrecisionRule {
  dataset: string;
  pointer: string;
  decimals: number;
  unit: string;
}
export interface AcceptedDifference {
  dataset: string;
  file: string;
  pointer: string;
  expected: Json;
  actual: Json;
  rationale: string;
}
export interface Policy {
  precision: PrecisionRule[];
  accepted: AcceptedDifference[];
}
export const exactPolicy: Policy = { precision: [], accepted: [] };
export function matches(pattern: string, pointer: string): boolean {
  const a = pattern.split('/'),
    b = pointer.split('/');
  return a.length === b.length && a.every((s, i) => s === '*' || s === b[i]);
}
export function precision(
  policy: Policy,
  dataset: string,
  pointer: string,
): PrecisionRule | undefined {
  const tokens = pointer.split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (
    tokens.some((s) =>
      /^(?:id|ids|.*Id|.*Ids|year|years|.*Year|.*Years|count|counts|.*Count|.*Counts)$/i.test(s),
    )
  )
    return;
  const rules = policy.precision.filter(
    (r) => r.dataset === dataset && matches(r.pointer, pointer),
  );
  if (rules.length > 1) throw new Error(`Ambiguous precision at ${dataset}${pointer}`);
  return rules[0];
}
