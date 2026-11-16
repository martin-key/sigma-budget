import { readFileSync } from 'node:fs';

// Independent oracle: only published JSON is read, never application calculation/formatting code.
type Execution = {
  latest: { month: number; asOf: string; kfp: Record<string, { cum: string; plan: string }> };
  pace: Record<string, Record<string, number[]>>;
  data: Record<string, Record<string, Record<string, string[]>>>;
};
export const execution: Execution = JSON.parse(
  readFileSync(new URL('../../data/release/execution.json', import.meta.url), 'utf8'),
);
// Money records use thousandths of a million EUR. Keep them integral until display.
export function releaseUnits(record: string, decimals = 3): number {
  if (!/^-?\d+(?:\.\d+)?$/.test(record)) throw new Error('Invalid decimal record');
  const negative = record.startsWith('-');
  const [whole, fraction = ''] = record.replace(/^-/, '').split('.');
  if (fraction.length > decimals) throw new Error('Unexpected decimal scale');
  const units = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(units)) throw new Error('Release amount exceeds integer precision');
  return negative ? -units : units;
}
export function formatUnits(units: number, scale: number, decimals = 2, sign = false) {
  const divisor = 10 ** (scale - decimals);
  const rounded = Math.floor((Math.abs(units) + divisor / 2) / divisor);
  const digits = String(rounded).padStart(decimals + 1, '0');
  const text = decimals ? digits.slice(0, -decimals) + ',' + digits.slice(-decimals) : digits;
  return (units < 0 && rounded ? '−' : sign ? '+' : '') + text;
}
export function expectedPlan() {
  const { month, kfp, asOf } = execution.latest;
  const year = Number(asOf.slice(0, 4));
  const rows = ['rev', 'exp.total', 'exp.capex'];
  const current = rows.map((row) => {
    const amount = releaseUnits(kfp[row]!.cum),
      plan = releaseUnits(kfp[row]!.plan);
    const tenths = Math.floor((amount * 1000 + plan / 2) / plan);
    return formatUnits(tenths, 1, 1) + '%';
  });
  const previous = rows.map(
    (row) =>
      formatUnits(
        releaseUnits(String(execution.pace[String(year - 1)]![row]![month - 1]!), 2),
        2,
        1,
      ) + '%',
  );
  const bars = current.flatMap((text, index) => [text, previous[index]!]);
  return {
    month,
    sums: rows.map(
      (row) =>
        `${formatUnits(releaseUnits(kfp[row]!.cum), 6)} от ${formatUnits(releaseUnits(kfp[row]!.plan), 6)}`,
    ),
    cur: current,
    prev: previous,
    bars,
    widths: bars.map((text) => Number(text.replace('%', '').replace(',', '.')) + '%'),
  };
}
function cumulativeUnits(year: number, scope: string, row: string, month: number) {
  return releaseUnits(execution.data[String(year)]![scope]![row]![month - 1]!);
}
export function cumulativeValue(year: number, scope: string, row: string, month: number) {
  return cumulativeUnits(year, scope, row, month) / 1000;
}
export function executionValue(
  year: number,
  scope: string,
  row: string,
  month: number,
  mode: string,
) {
  return (
    (cumulativeUnits(year, scope, row, month) -
      (mode === 'kum' || month === 1 ? 0 : cumulativeUnits(year, scope, row, month - 1))) /
    1000
  );
}
export function expectedComparison() {
  const { month, asOf } = execution.latest;
  const year = Number(asOf.slice(0, 4));
  const rows = ['rev', 'exp.total', 'balance'];
  const previous = rows.map((row) => cumulativeUnits(year - 1, 'kfp', row, month));
  const current = rows.map((row) => cumulativeUnits(year, 'kfp', row, month));
  return {
    prev: previous.map((value) => formatUnits(value, 6)),
    cur: current.map((value) => formatUnits(value, 6)),
    diff: [0, 1].map((index) => formatUnits(current[index]! - previous[index]!, 6, 2, true)),
    balanceDiff: formatUnits(Math.abs(current[2]! - previous[2]!), 6),
  };
}

type Employment = {
  employeePct: number;
  employerPctWithoutTzpb: number;
  incomeTaxPct: number;
  tzpbPct: { min: number; max: number; used: number };
  maxInsurableIncomeEur: { id: string; eur: number }[];
};
const rates = JSON.parse(
  readFileSync(new URL('../../data/release/rates.json', import.meta.url), 'utf8'),
);
const employment: Employment = rates.scenarios.find((s: { id: string }) => s.id === 'employment');
export const insurableIncomeCaps = Object.fromEntries(
  employment.maxInsurableIncomeEur.map((m) => [m.id, m.eur]),
);
// All monetary calculations use integer cents; rates use basis points.
export function salaryModel(gross: string, rule: string, tzpb?: number) {
  const grossCents = Math.round(Number(gross) * 100);
  const basisPoints = (percent: number) => Math.round(percent * 100);
  const accidentRate = Math.min(
    Math.max(tzpb ?? employment.tzpbPct.used, employment.tzpbPct.min),
    employment.tzpbPct.max,
  );
  function month(period: string) {
    const insured = Math.min(grossCents, Math.round(insurableIncomeCaps[period]! * 100));
    const emp = Math.round((insured * basisPoints(employment.employeePct)) / 10_000);
    const tax = Math.round(((grossCents - emp) * basisPoints(employment.incomeTaxPct)) / 10_000);
    const er = Math.round(
      (insured * (basisPoints(employment.employerPctWithoutTzpb) + basisPoints(accidentRate))) /
        10_000,
    );
    return { emp, tax, er };
  }
  const periods =
    rule === 'year'
      ? ([
          [month('until'), 7],
          [month('from'), 5],
        ] as const)
      : ([[month(rule), 12]] as const);
  const yearly = (key: 'emp' | 'tax' | 'er') =>
    periods.reduce((sum, [amount, months]) => sum + amount[key] * months, 0);
  const yEmp = yearly('emp'),
    yTax = yearly('tax'),
    yEr = yearly('er');
  const emp = Math.round(yEmp / 12),
    tax = Math.round(yTax / 12),
    er = Math.round(yEr / 12);
  return {
    emp: emp / 100,
    tax: tax / 100,
    er: er / 100,
    net: (grossCents - emp - tax) / 100,
    yEmp: yEmp / 100,
    yTax: yTax / 100,
    yEr: yEr / 100,
  };
}
