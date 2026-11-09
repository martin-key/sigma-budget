import { metadata } from '../common/metadata.js';
import { monthName, pythonRound } from '../common/format.js';
import { pythonNumericText } from '../common/numbers.js';

interface ExecutionRow {
  plan: number;
  cum: number;
  prevYearCum: number;
  pctPlan: number;
  yoyPct?: number;
}
interface Population {
  latest: { date: string; persons: number };
  years: (string | number)[];
  persons: (string | number)[];
}
export interface PendingDefinition {
  title: string | null;
  reason: string | null;
  expected: string;
  source: string[];
  screens: string[];
}
interface FunctionItem {
  id: string;
  name: string;
  short: string;
  mln: number[];
  pctGdp: number[];
  share: number[];
  yoy2026Pct: number;
}
interface RevenueGroup {
  id: string;
  name: string;
  mln: number[];
  share2026: number;
}

export interface ZddTable {
  totalMln: number[];
  totalPctGdp: number[];
  externalMln: number[];
  externalPctGdp: number[];
  domesticMln: number[];
  domesticPctGdp: number[];
  gdpMln: number[];
}
export function zddTable(rows: { label: string; values: number[] }[]): ZddTable {
  const t = Object.fromEntries(rows.map((r) => [r.label, r.values]));
  const out = {
    totalMln: t['Държавен дълг, млн. евро']!,
    totalPctGdp: t['Държавен дълг/БВП (%)*']!,
    externalMln: t['Външен дълг, млн. евро']!,
    externalPctGdp: t['Външен дълг/БВП (%)']!,
    domesticMln: t['Вътрешен дълг, млн. евро']!,
    domesticPctGdp: t['Вътрешен дълг/БВП (%)']!,
    gdpMln: t['БВП, млн. евро']!,
  };
  return validateZdd(out);
}
function validateZdd(out: ZddTable): ZddTable {
  for (const key of [
    'totalMln',
    'totalPctGdp',
    'externalMln',
    'externalPctGdp',
    'domesticMln',
    'domesticPctGdp',
    'gdpMln',
  ] as const) {
    const values = out[key];
    if (
      !values ||
      values.length !== 5 ||
      values.some((v) => typeof v !== 'number' || !Number.isFinite(v))
    )
      throw new Error(`VI-1 ${key} is incomplete`);
  }
  for (let i = 0; i < 5; i++)
    if (Math.abs(out.totalMln[i]! - out.externalMln[i]! - out.domesticMln[i]!) > 0.25)
      throw new Error('VI-1: external + domestic != total');
  return out;
}
export function aggregationInt(value: unknown): number {
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const s = pythonNumericText(value);
    if (/^[+-]?[0-9](?:_?[0-9])*$/.test(s)) return Number(s.replaceAll('_', ''));
  }
  throw new Error('invalid integer');
}

/** Derive P04 from the execution report before any aggregation builder runs. */
export function pendingFromExecution(
  pending: Record<string, PendingDefinition>,
  execution: {
    pendingMonths: { month: number; asOf: string }[];
    latest: { month: number; asOf: string };
  },
): Record<string, PendingDefinition> {
  const result = structuredClone(pending),
    next = execution.pendingMonths[0]!,
    last = execution.latest;
  const [year, month, day] = next.asOf.split('-');
  result.P04 = {
    ...result.P04!,
    title: `Отчетът към ${day}.${month}.${year} г. и следващите`,
    reason: `Отчетът за ${monthName(next.month)} ${year} г. още не е добавен: страницата на МФ с месечните отчети се отваря само през браузър (отказ 403 към автоматични заявки), а последният наличен файл е за ${monthName(last.month)} ${last.asOf.slice(0, 4)} г.`,
  };
  return result;
}

/** Explicit dependencies, including the donor's DATA/glossary and cache fallbacks. */
export interface CoreInput {
  buildDate: string;
  outlook: { gdp: { mln: number[]; mlnPrecise: number[] } };
  revenue: { groups: RevenueGroup[] };
  expenditure: { functions: { items: FunctionItem[] } };
  measures: { items: unknown[] };
  execution: {
    latest: { asOf: string; month: number; kfp: Record<string, ExecutionRow> };
    pendingMonths: { asOf: string; month: number }[];
    data: Record<string, { months: number | string }>;
  };
  law: { sums: { budgets: number } };
  budgetCount: number;
  sources: Record<string, unknown>;
  pending: Record<string, PendingDefinition>;
  population: Population;
  populationAsOf: string;
  zdd: ZddTable;
  ministries?: { items: { programs: { status: string } }[] } | null;
  programs?: { items: unknown[] } | null;
  municipalities?: { items: unknown[] } | null;
  gisco?: { items: unknown[] } | null;
  glossaryDataset?: { terms: unknown[] } | null;
  glossaryInput: { terms: unknown[] };
}

export function buildCore(input: CoreInput) {
  const { outlook, revenue, expenditure, measures, execution, population } = input;
  validateZdd(input.zdd);
  for (const [name, value] of Object.entries({ outlook, revenue, expenditure, measures }))
    if (value == null) throw new Error(`core.json needs ${name}.json built first`);
  if (input.law.sums.budgets !== input.budgetCount)
    throw new Error('law and EBK budget counts differ');
  const latest = execution.latest,
    kfp = latest.kfp,
    gdp = outlook.gdp.mlnPrecise[2]!;
  const pair = (row: ExecutionRow) => ({
    planMln: row.plan,
    execMln: row.cum,
    execPct: row.pctPlan,
    ...('yoyPct' in row ? { yoyPct: row.yoyPct } : {}),
  });
  const rev = kfp.rev!,
    exp = kfp['exp.total']!,
    bal = kfp.balance!,
    cap = kfp['exp.capex']!;
  if (gdp === 0) throw new Error('division by zero');
  const functions = expenditure.functions.items.map((it) => ({
    id: it.id,
    name: it.name,
    short: it.short,
    mln: it.mln[1],
    pctGdp: it.pctGdp[1],
    share: it.share[1],
    yoyPct: it.yoy2026Pct,
  }));
  const groups = revenue.groups.map((g) => ({
    id: g.id,
    name: g.name,
    mln: g.mln[2],
    share: g.share2026,
  }));
  const popYear = aggregationInt(population.latest.date.slice(0, 4));
  if (
    popYear !== 2026 ||
    !Number.isFinite(population.latest.persons) ||
    aggregationInt(population.years.at(-1)) !== popYear ||
    population.persons.at(-1) !== population.latest.persons
  )
    throw new Error('population latest differs from series');
  const years = population.years.map(aggregationInt),
    persons = population.persons.map(aggregationInt);
  if (years.length !== persons.length || years.some((year, i) => year !== years[0]! + i))
    throw new Error('population years are not consecutive or differ in length');
  const municipalities = input.municipalities ?? input.gisco;
  if (!municipalities) throw new Error('municipalities and gisco are missing');
  const counts = {
    functions: functions.length,
    budgets: input.budgetCount,
    ...(input.ministries
      ? {
          programBudgets: input.ministries.items.filter((m) => m.programs.status === 'real').length,
        }
      : {}),
    ...(input.programs ? { programs: input.programs.items.length } : {}),
    terms: (input.glossaryDataset ?? input.glossaryInput).terms.length,
    municipalities: municipalities.items.length,
    measures: measures.items.length,
    kfpReports: Object.values(execution.data).reduce((sum, d) => sum + aggregationInt(d.months), 0),
  };
  const pending = Object.fromEntries(
    Object.keys(input.pending)
      .sort()
      .map((id) => {
        const d = input.pending[id]!;
        return [
          id,
          {
            status: 'pending',
            id,
            title: d.title,
            reason: d.reason,
            expected: d.expected,
            source: [...d.source],
            screens: [...d.screens],
          },
        ];
      }),
  );
  return {
    meta: metadata('core', 'Ядро: източници, предстоящи набори и основни числа', input.buildDate, {
      source: ['asbp', 'kfp', 'eurostat'],
      sourceNote:
        'Числата са копирани от наборите, които ги притежават (Прогноза, Изпълнение, Дълг, Разходи, Приходи)',
      asOf: latest.asOf,
      unit: 'млн. €',
    }),
    build: {
      dataVersion: input.buildDate + '.1',
      kfpLatest: latest.asOf,
      kfpMonths2026: latest.month,
      kfpNext: execution.pendingMonths[0]!.asOf,
      eurRate: 1.95583,
    },
    years: {
      list: [2024, 2025, 2026, 2027, 2028],
      vintage: {
        '2024': 'actual',
        '2025': 'prelim',
        '2026': 'plan',
        '2027': 'forecast',
        '2028': 'forecast',
      },
    },
    sources: structuredClone(input.sources),
    pending,
    counts,
    population: {
      year: popYear,
      date: population.latest.date,
      persons: Math.trunc(population.latest.persons),
      source: ['eurostat'],
      asOf: input.populationAsOf,
      series: { years, persons },
    },
    kpis: {
      gdp: {
        mln: outlook.gdp.mln[2],
        mlnPrecise: gdp,
        year: 2026,
        vintage: 'plan',
        href: '#/prognoza',
      },
      revenue: { ...pair(rev), prevYearMln: rev.prevYearCum, href: '#/izpalnenie' },
      expenditure: { ...pair(exp), prevYearMln: exp.prevYearCum, href: '#/izpalnenie' },
      balance: {
        planMln: bal.plan,
        execMln: bal.cum,
        prevYearMln: bal.prevYearCum,
        href: '#/izpalnenie',
      },
      capex: {
        ...pair(cap),
        pctGdp: pythonRound((100 * cap.plan) / gdp, 2),
        href: '#/izpalnenie?pera=exp',
      },
      debt: {
        zddMln: input.zdd.totalMln[2],
        pctGdp: input.zdd.totalPctGdp[2],
        year: 2026,
        scope: 'zdd',
        href: '#/dalg',
      },
      asOf: latest.asOf,
      month: latest.month,
    },
    functions,
    revenueGroups: groups,
  };
}
