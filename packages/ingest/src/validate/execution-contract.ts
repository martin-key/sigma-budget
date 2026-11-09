import { pythonFloat } from '../build/context.js';
import { clonePythonNumbers } from '../common/numbers.js';
import { pyTruth } from './checks.js';
import {
  executionContains,
  executionGet,
  executionIterable,
  executionItems,
  executionRequired,
  executionValues,
} from './execution-python.js';

/** Wave 14: execution.json v2 decimal projections. Independent of the builders. */
export const CONTRACT = {
  schema: 2,
  money: {
    encoding: 'decimal-string',
    currency: 'EUR',
    unit: 'млн. €',
    scale: 1000000,
    rounding: 'half away from zero (as Excel and the MF releases)',
    places: {
      data: 3,
      monthly: 3,
      plan2026: 1,
      latest: 1,
      'reconcile.kfp': 3,
      'reconcile.annex3': 1,
      'reconcile.diff': 1,
    },
  },
  scope: {
    kfp: 'Консолидирана фискална програма (к.2 на отчета)',
    nat: 'Национален бюджет (к.3)',
    eu: 'Европейски средства (к.4)',
  },
  accountingBasis: 'cash',
  missing: 'null; a missing value is never 0',
  conversion: {
    from: 'BGN',
    rate: '1 € = 1.95583 лв.',
    years: '2024 and 2025',
    rule: 'the original number in млн. лв. ÷ 1.95583, rounded to 3 places after dividing',
  },
  blocks: {
    data: {
      evidence: 'real',
      budget: 'report',
      value: 'observed',
      note: 'cumulative since 1 January; 2024 and 2025 are derived by the conversion from BGN',
    },
    monthly: {
      evidence: 'real',
      budget: 'report',
      value: 'derived',
      rule: 'cumulative(m) − cumulative(m − 1); January = cumulative(1)',
    },
    plan2026: {
      evidence: 'real',
      budget: 'law',
      value: 'observed',
      note: 'Програма по ЗДБРБ 2026, МФ, приложение 1',
    },
    latest: {
      evidence: 'real',
      budget: 'report',
      value: 'derived',
      rule: 'cum and prevYearCum: data at the latest month, rounded to 1 place; plan: plan2026 (budget status law); pctPlan and yoyPct: % from the unrounded cumulative values',
    },
    pace: {
      evidence: 'real',
      budget: 'report',
      value: 'derived',
      rule: "% of the year's December cumulative value",
    },
    reconcile: {
      evidence: 'real',
      budget: 'report',
      value: 'derived',
      rule: 'the December report against Приложение 3 (annex3: budget status report for 2024, expected report for 2025)',
    },
  },
  provenance: 'execution-provenance.json',
} as const;

const cols = ['kfp', 'nat', 'eu'] as const;
const latest = ['cum', 'plan', 'prevYearCum'] as const;
const reconcile = ['kfp', 'annex3', 'diff'] as const;

/** Quantize a decimal input with Python Decimal's default 28-digit precision. */
export function moneyDecimal(value: string | null, places: number): string | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(places) || Math.abs(places) > 28)
    throw new RangeError('Invalid places');
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!match) throw new TypeError('Invalid decimal');
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 999999)
    throw new RangeError('Invalid decimal exponent');
  const fraction = match[3] ?? match[4] ?? '';
  const digits = BigInt((match[2] ?? '0') + fraction);
  const shift = places + exponent - fraction.length;
  let rounded: bigint;
  if (shift >= 0) {
    if (digits !== 0n && digits.toString().length + shift > 28)
      throw new RangeError('Decimal precision exceeded');
    rounded = digits === 0n ? 0n : digits * 10n ** BigInt(shift);
  } else if (-shift > digits.toString().length + 1) rounded = 0n;
  else {
    const divisor = 10n ** BigInt(-shift);
    rounded = digits / divisor;
    if ((digits % divisor) * 2n >= divisor) rounded++;
  }
  if (rounded.toString().length > 28) throw new RangeError('Decimal precision exceeded');
  const sign = match[1] === '-' && rounded !== 0n ? '-' : '';
  if (rounded === 0n && places <= 0) return '0.';
  if (places <= 0) return sign + rounded.toString() + '0'.repeat(-places);
  const s = rounded.toString().padStart(places + 1, '0');
  return sign + s.slice(0, -places) + '.' + s.slice(-places);
}

/** Python money takes non-Decimal values through float first. */
export function money(value: unknown, places: number): string | null {
  if (value === null) return null;
  const converted = pythonFloat(value);
  if (converted === null) return null;
  if (Number.isNaN(converted)) return 'NaN';
  if (!Number.isFinite(converted)) throw new RangeError('Non-finite money');
  return moneyDecimal(String(converted), places);
}

export type MoneyValue = string | number | boolean | null;
export type ExecutionColumns<T> = {
  kfp: Record<string, T>;
  nat: Record<string, T>;
  eu: Record<string, T>;
};
export type LatestRow = Record<string, unknown> &
  Partial<Record<'cum' | 'plan' | 'prevYearCum', MoneyValue>>;
/** Fields touched by the projection; all other fields pass through unchanged. */
export interface ExecutionProjection {
  meta: Record<string, unknown>;
  data: Record<string, ExecutionColumns<MoneyValue[]>>;
  monthly: Record<string, ExecutionColumns<MoneyValue[]>>;
  plan2026: ExecutionColumns<MoneyValue>;
  latest: ExecutionColumns<LatestRow>;
  reconcile: Record<string, unknown>;
  [key: string]: unknown;
}

type Dict = Record<string, any>;
function mapMoney(doc: Dict, fn: (v: any, places: number) => unknown): Dict {
  const out = clonePythonNumbers(doc);
  for (const name of ['data', 'monthly'] as const)
    for (const block of executionValues(executionRequired(out, name)) as Dict[])
      for (const col of cols)
        for (const [id, arr] of executionItems(executionRequired(block, col)) as [
          string,
          unknown[],
        ][])
          block[col][id] = executionIterable(arr).map((v) => fn(v, 3));
  for (const col of cols) {
    for (const [id, value] of executionItems(
      executionRequired(executionRequired(out, 'plan2026'), col),
    ))
      out.plan2026[col][id] = fn(value, 1);
    for (const [, row] of executionItems(executionRequired(executionRequired(out, 'latest'), col)))
      for (const key of latest)
        if (executionContains(row, key)) row[key] = fn(executionRequired(row, key), 1);
  }
  for (const [key, rec] of executionItems(executionRequired(out, 'reconcile'))) {
    if (key.startsWith('dec') && rec !== null && typeof rec === 'object' && !Array.isArray(rec))
      for (const [, row] of executionItems(rec))
        for (const field of reconcile)
          row[field] = fn(executionRequired(row, field), field === 'kfp' ? 3 : 1);
  }
  return out;
}

export function canonical(doc: ExecutionProjection): ExecutionProjection {
  const out = mapMoney(doc as unknown as Dict, money);
  out.meta.schema = 'execution/2';
  const { meta, ...rest } = out;
  return { meta, contract: structuredClone(CONTRACT), ...rest } as unknown as ExecutionProjection;
}

export function numbers(doc: ExecutionProjection): ExecutionProjection;
export function numbers<T>(doc: T): T;
export function numbers<T>(doc: T): T {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const contract = (doc as Dict).contract;
  if (executionGet(pyTruth(contract) ? contract : {}, 'schema') !== 2) return doc;
  return mapMoney(doc as Dict, (value) => pythonFloat(value)) as T;
}
