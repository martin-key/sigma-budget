import { metadata } from '../../common/metadata.js';
import { pythonRound } from '../../common/format.js';
import { pythonFloatSum } from '../../common/numbers.js';
import { decimalSum } from '../../build/fiscal-annual.js';
import {
  canonical,
  moneyDecimal,
  type ExecutionProjection,
} from '../../validate/execution-contract.js';
import { EXP_TOTAL, HEADLINE, LATEST_ROWS, PACE_ROWS, ROWS, SUM_IDENTITIES } from './layout.js';
import {
  lastDay,
  readExecutionReport,
  SCOPES,
  SHEET,
  type Columns,
  type ExecutionReport,
  type ExecutionSourceDifferences,
} from './report.js';
import {
  readExecutionAnnual,
  type ExecutionAnnualFiles,
  type ExecutionAnnualInput,
} from './annual.js';
import type { PinnedFile } from '../workbooks/index.js';

export interface ExecutionHeadline {
  year: number;
  month: number;
  /** Independently reviewed MF press-release headlines, in million EUR, one decimal. */
  values: readonly [number, number, number];
}
export const EXECUTION_HEADLINES: readonly ExecutionHeadline[] = [
  { year: 2026, month: 7, values: [26347.4, 28548.8, -2201.4] },
  { year: 2026, month: 8, values: [30117.8, 33193.2, -3075.5] },
  { year: 2026, month: 9, values: [33898.5, 37567.6, -3669.2] },
];
export interface ExecutionProvenance {
  meta: Record<string, unknown>;
  schema: 'provenance/1';
  dataset: 'execution';
  record: string;
  sheet: string;
  columns: { kfp: string; nat: string; eu: string };
  rows: Record<string, number>;
  computed: Record<string, unknown>;
  rules: Record<string, string>;
  originals: Record<
    string,
    { source: string; file: string; sha256: string; asOf: string; unit: string }
  >;
  plan2026: Record<string, unknown>;
}
export interface ExecutionReaderEvidence {
  schema: 'execution-reader/1';
  buildDate: string;
  annualBoundary: ExecutionAnnualInput['boundary'];
  reports: (ExecutionReport['evidence'] & {
    file: string;
    sha256: string;
    asOf: string;
    unit: string;
    unitText: string;
  })[];
  warnings: string[];
}
export interface ExecutionResult {
  execution: ExecutionProjection;
  provenance: ExecutionProvenance;
  evidence: ExecutionReaderEvidence;
}
export interface PrepareExecutionOptions {
  reports: readonly PinnedFile[];
  annual: ExecutionAnnualInput;
  buildDate: string;
  headlines?: readonly ExecutionHeadline[];
  firstYear?: 2022 | 2024;
  sourceDifferences?: ExecutionSourceDifferences;
}

function columns<T>(make: () => Record<string, T>): Columns<T> {
  return { kfp: make(), nat: make(), eu: make() };
}
const quantize = (value: number, places: number) => Number(moneyDecimal(String(value), places));
/** Integer ratio rounding, half away from zero. Conversion happens before the 3-place rounding. */
export function convertExecutionMoney(value: number, unit: 'BGN' | 'EUR'): number {
  const micros = BigInt(moneyDecimal(String(value), 6)!.replace('.', ''));
  const numerator = (micros < 0n ? -micros : micros) * (unit === 'BGN' ? 100n : 1n);
  const denominator = unit === 'BGN' ? 195583n : 1000n;
  const result =
    numerator / denominator + ((numerator % denominator) * 2n >= denominator ? 1n : 0n);
  return result === 0n ? 0 : Number(micros < 0n ? -result : result) / 1000;
}
function requireDate(date: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error('Invalid build date');
}
const recMap = [
  ['rev', 'r.total'],
  ['rev.tax', 'r.tax'],
  ['rev.nontax', 'r.nontax'],
  ['rev.grants', 'r.grants'],
  ['exp', 'x.exp'],
  ['exp.personnel', 'x.personnel'],
  ['exp.maint', 'x.maint'],
  ['exp.interest', 'x.interest'],
  ['exp.social', null],
  ['exp.subsidies', 'x.subsidies'],
  ['exp.abroad', 'x.abroad'],
  ['exp.capex', 'x.capex'],
  ['exp.reserve', 'x.reserve'],
  ['eucontrib', 'x.eucontrib'],
  ['exp.total', 'x.total'],
  ['balance', 'x.balance'],
] as const;

/** Production source-to-output API. It reads each pinned XLS itself; callers cannot inject capture grids. */
export function prepareExecution(options: PrepareExecutionOptions): ExecutionResult {
  requireDate(options.buildDate);
  if (!options.reports.length) throw new Error('No execution reports');
  const reports = options.reports
    .map((input) => readExecutionReport(input, options.sourceDifferences))
    .sort((a, b) => a.year - b.year || a.month - b.month);
  const byYear = new Map<number, ExecutionReport[]>();
  for (const report of reports) {
    if (report.asOf > options.buildDate) throw new Error('Report date is after build date');
    const list = byYear.get(report.year) ?? [];
    list.push(report);
    byYear.set(report.year, list);
  }
  const years = [...byYear.keys()];
  if (
    years.join(',') !==
    Array.from(
      { length: 2027 - (options.firstYear ?? 2024) },
      (_, i) => (options.firstYear ?? 2024) + i,
    ).join(',')
  )
    throw new Error(
      'Execution requires consecutive years 2024..2026; generalise the production contract before adding 2027',
    );
  for (const [year, list] of byYear) {
    if (list.some((report, i) => report.month !== i + 1) || list.length > 12)
      throw new Error(`Year ${year}: reports are not months 1..n (duplicate or missing report)`);
    if (year !== 2026 && list.length !== 12)
      throw new Error(`Year ${year}: expected all 12 reports`);
  }
  const headlines = options.headlines ?? EXECUTION_HEADLINES;
  if (!headlines.length) throw new Error('Missing independently reviewed headlines');
  const seen = new Set<string>();
  for (const reference of headlines) {
    lastDay(reference.year, reference.month);
    if (
      reference.year !== 2026 ||
      reference.values.length !== 3 ||
      reference.values.some((v) => !Number.isFinite(v)) ||
      seen.has(`${reference.year}-${reference.month}`)
    )
      throw new Error('Invalid or duplicate reviewed headline');
    seen.add(`${reference.year}-${reference.month}`);
  }
  const newest = [...headlines].sort((a, b) => a.year - b.year || a.month - b.month).at(-1)!;
  const last = reports.at(-1)!;
  if (last.year !== newest.year || last.month !== newest.month)
    throw new Error(
      `Newest report ${last.year}-${last.month} differs from reviewed headline ${newest.year}-${newest.month}; missing/stale or unreviewed report`,
    );
  if (
    options.annual.plan.basis !== 'adopted-law' ||
    options.annual.plan.periodKey !== '2026.law' ||
    options.annual.plan.asOf > options.buildDate ||
    options.annual.boundary.kind !== 'verified-prepared-annual-data'
  )
    throw new Error('Missing verified adopted-law annual input');

  const rows: {
    id: string;
    label: string;
    short: string;
    row?: number;
    level: number;
    parent?: string;
    group: string;
    computed?: string;
  }[] = ROWS.map((r) => ({
    id: r.id,
    label: last.labels[r.id]!,
    short: r.short,
    row: r.row,
    level: r.level,
    ...(r.parent ? { parent: r.parent } : {}),
    group: r.group,
  }));
  rows.splice(rows.findIndex((r) => r.id === 'eucontrib') + 1, 0, { ...EXP_TOTAL });
  type YearData = Columns<number[]> & {
    months: number;
    currency: string;
    converted?: string;
    asOf: string[];
    files: { month: number; file: string; sha256: string }[];
  };
  const data: Record<string, YearData> = {},
    monthly: Record<string, Columns<number[]>> = {};
  for (const [year, list] of byYear) {
    const unit = list[0]!.unit;
    const series = columns<number[]>(() => ({}));
    for (const scope of SCOPES)
      for (const row of rows) {
        series[scope][row.id] = list.map((report) =>
          convertExecutionMoney(
            row.id === 'exp.total'
              ? pythonRound(report.values.exp![scope] + report.values.eucontrib![scope], 6)
              : report.values[row.id]![scope],
            unit,
          ),
        );
      }
    data[year] = {
      months: list.length,
      currency: unit,
      ...(unit === 'BGN' ? { converted: '÷1.95583' } : {}),
      asOf: list.map((r) => r.asOf),
      files: list.map((r) => ({ month: r.month, file: r.filename, sha256: r.sha256 })),
      ...series,
    };
    // Converted identities retain the donor's rounding bounds.
    for (const scope of SCOPES) {
      const s = series[scope];
      for (const [parent, children] of Object.entries(SUM_IDENTITIES))
        list.forEach((_, i) => {
          const bound = (children.length + 1) * (0.0005 + 0.5e-6 * 1.95583) + 1e-9;
          if (Math.abs(s[parent]![i]! - pythonFloatSum(children.map((id) => s[id]![i]!))) > bound)
            throw new Error(`Converted identity failed: ${year}/${scope}/${parent}`);
        });
    }
    for (const row of ROWS)
      list.forEach((_, i) => {
        if (
          Math.abs(series.kfp[row.id]![i]! - series.nat[row.id]![i]! - series.eu[row.id]![i]!) >
          0.0015 + 1e-9
        )
          throw new Error(`Converted к.2=к.3+к.4 failed: ${year}/${row.id}`);
      });
    for (const id of ['rev', 'exp', 'exp.total']) {
      const values = series.kfp[id]!;
      if (values.some((value, i) => i > 0 && value <= values[i - 1]!))
        throw new Error(`Cumulative ${id} does not grow: ${year}`);
    }
    monthly[year] = columns(() => ({}));
    for (const scope of SCOPES)
      for (const id of HEADLINE)
        monthly[year]![scope][id] = series[scope][id]!.map((value, i, arr) =>
          decimalSum([value, -(i ? arr[i - 1]! : 0)]),
        );
  }
  for (const reference of headlines) {
    const series = data[reference.year]!.kfp;
    HEADLINE.forEach((id, i) => {
      const value = series[id]?.[reference.month - 1];
      if (value === undefined || pythonRound(value, 1) !== reference.values[i])
        throw new Error(`Reviewed headline mismatch: ${reference.year}-${reference.month}/${id}`);
    });
  }
  const n = last.month,
    plan = options.annual.plan;
  const latest: Columns<Record<string, number>> & { month: number; asOf: string } = {
    month: n,
    asOf: last.asOf,
    ...columns(() => ({})),
  };
  for (const scope of SCOPES)
    for (const id of scope === 'kfp' ? LATEST_ROWS : HEADLINE) {
      const cum = data['2026']![scope][id]![n - 1]!,
        previous = data['2025']![scope][id]![n - 1]!;
      const row: Record<string, number> = { cum: quantize(cum, 1) },
        base = plan[scope][id];
      if (base !== undefined) {
        row.plan = base;
        if (base > 0 && !['balance', 'fin', 'transfers'].includes(id))
          row.pctPlan = pythonRound((100 * cum) / base, 2);
      }
      row.prevYearCum = quantize(previous, 1);
      if (previous >= 50 && cum >= 0) row.yoyPct = pythonRound(100 * (cum / previous - 1), 1);
      latest[scope][id] = row;
    }
  const pace: Record<string, Record<string, number[]>> = {};
  for (const [year, series] of Object.entries(data))
    if (series.months === 12) {
      pace[year] = {};
      for (const id of PACE_ROWS) {
        const cum = series.kfp[id]!;
        if (cum.at(-1)! > 0)
          pace[year]![id] = cum.map((value) => pythonRound((100 * value) / cum.at(-1)!, 2));
      }
    }
  const reconcileYear = (year: number, index: number) =>
    Object.fromEntries(
      recMap.map(([id, annexId]) => {
        const annex = options.annual.annex3.mln;
        const get = (key: string) => {
          const values = annex[key];
          if (
            !values ||
            values.length !== 5 ||
            typeof values[index] !== 'number' ||
            !Number.isFinite(values[index])
          )
            throw new Error(`Missing historical Annex 3 value: ${key}/${year}`);
          return values[index]!;
        };
        const kfp = data[year]!.kfp[id]!.at(-1)!;
        const annex3 =
          annexId === null ? pythonRound(get('x.social') + get('x.scholarships'), 1) : get(annexId);
        return [id, { kfp, annex3, diff: quantize(decimalSum([kfp, -annex3]), 1) }];
      }),
    );
  const rec24 = reconcileYear(2024, 0),
    rec25 = reconcileYear(2025, 1);
  const formattedDiffs = ['rev', 'exp.total', 'balance'].map((id) => {
    const value = rec24[id]!.diff;
    return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1).replace('.', ',')}`;
  });
  const reconcile = {
    dec2024VsAnnex3: rec24,
    dec2025VsAnnex3: rec25,
    unit: 'млн. €',
    note:
      'Декемврийските отчети на КФП (в лева, превърнати по 1,95583) са сравнени с колоните „2024 Отчет“ и „2025 Предв. отчет“ на Приложение 3. ' +
      'Малки разлики са очаквани („Резерв за непредвидени разходи“ няма отделен ред в отчета). За 2024 г. разликите са по-големи ' +
      `(приходи ${formattedDiffs[0]}, разходи ${formattedDiffs[1]}, салдо ${formattedDiffs[2]} млн. €).`,
  };
  const nextMonth = n < 12 ? n + 1 : 1,
    nextYear = n < 12 ? 2026 : 2027;
  const execution = canonical({
    meta: metadata(
      'D06+D16+D26',
      'Месечно изпълнение на консолидираната фискална програма (КФП)',
      options.buildDate,
      {
        source: ['kfp'],
        sourceNote:
          'лист „стартова“ на месечните отчети на МФ, редове 11–49, колони к.2–к.4 (натрупано от началото на годината)',
        asOf: last.asOf,
        unit: 'млн. €',
        extra: { pending: ['P01', 'P02', 'P04', 'P05'] },
      },
    ),
    cols: [
      { id: 'kfp', label: 'Консолидирана фискална програма', kfpCol: 'к.2' },
      { id: 'nat', label: 'Национален бюджет', kfpCol: 'к.3' },
      { id: 'eu', label: 'Европейски средства', kfpCol: 'к.4' },
    ],
    rows,
    data,
    monthly,
    plan2026: structuredClone(plan),
    latest,
    pace,
    paceNote:
      'Дял (%) от изпълнението за цялата година, достигнат към края на месеца; служи за „изостава / изпреварва“.',
    pendingMonths: [
      { month: nextMonth, asOf: lastDay(nextYear, nextMonth), status: 'pending', id: 'P04' },
    ],
    reconcile,
  });
  const provenance: ExecutionProvenance = {
    meta: metadata(
      'execution-provenance',
      'Произход на числата в execution.json',
      options.buildDate,
      {
        source: ['kfp', 'budget2027'],
        sourceNote:
          'клетката в оригиналния отчет на МФ за всяко число на месечното изпълнение и страницата на Приложение 1 за плана',
        asOf: last.asOf,
      },
    ),
    schema: 'provenance/1',
    dataset: 'execution',
    record:
      '<block>/<ГГГГ-ММ>/<колона>/<ред>, например data/2026-09/kfp/rev: оригиналът на 2026-09, лист „стартова“, клетка B11',
    sheet: SHEET,
    columns: { kfp: 'B', nat: 'C', eu: 'D' },
    rows: Object.fromEntries(ROWS.map((r) => [r.id, r.row])),
    computed: {
      'exp.total': {
        from: ['exp', 'eucontrib'],
        rule: 'exp + eucontrib of the same report, added on the original numbers, then converted',
      },
    },
    rules: {
      data: 'the cell of the original of the month; 2024 and 2025: млн. лв. ÷ 1.95583, rounded to 3 places (contract.conversion)',
      monthly: 'data(m) − data(m − 1) of the same year, column and row; January = data(1)',
      latest:
        'cum and prevYearCum: data of the latest month of this and the previous year, rounded to 1 place; plan: plan2026',
      pace: 'data(m) ÷ data(12) of the same year × 100',
      reconcile:
        'data(12) of 2024 and 2025 against the columns 2024 Отчет and 2025 Предв. отчет of Приложение 3',
    },
    originals: Object.fromEntries(
      reports.map((r) => [
        `${r.year}-${String(r.month).padStart(2, '0')}`,
        { source: 'kfp', file: r.filename, sha256: r.sha256, asOf: r.asOf, unit: r.unit },
      ]),
    ),
    plan2026: structuredClone(options.annual.provenance),
  };
  return {
    execution,
    provenance,
    evidence: {
      schema: 'execution-reader/1',
      buildDate: options.buildDate,
      annualBoundary: options.annual.boundary,
      reports: reports.map((r) => ({
        file: r.filename,
        sha256: r.sha256,
        asOf: r.asOf,
        unit: r.unit,
        unitText: r.unitText,
        ...r.evidence,
      })),
      warnings: reports.flatMap((r) => r.warnings),
    },
  };
}

export interface ExecutionInputConfig {
  schema: 'execution-inputs/1';
  reports: PinnedFile[];
  annual: ExecutionAnnualFiles;
  headlines?: ExecutionHeadline[];
}
/** File-based adapter for the standalone command and future production graph wiring. */
export function prepareExecutionFiles(
  config: ExecutionInputConfig,
  buildDate: string,
): ExecutionResult {
  if (config.schema !== 'execution-inputs/1' || !Array.isArray(config.reports))
    throw new Error('Invalid execution input config');
  return prepareExecution({
    reports: config.reports,
    annual: readExecutionAnnual(config.annual),
    buildDate,
    headlines: config.headlines,
  });
}
