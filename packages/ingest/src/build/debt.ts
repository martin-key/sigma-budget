import type { Json } from '@sigma-budget/dataset-schema';
import { jsonstatSeries, type JsonStat } from '../io/data.js';
import { metadata } from '../common/metadata.js';
import { pythonRound as rnd } from '../common/format.js';
import { stateDebtTable, percentage, type CleanPage, type StateDebtTableInput } from './fiscal.js';
import {
  parseDebtStructure,
  parseDebtInterest,
  parseGuaranteedDebt,
  parseNewDebt,
  parseDebtLawLimits,
} from './debt-text.js';

interface Bnb {
  asOf: string;
  indicator: string;
  quarters: string[];
  mln: number[];
}
interface DebtStat extends JsonStat {
  updated: string;
}
export interface DebtInput {
  table: StateDebtTableInput & { columns: string[] };
  gdp: number[];
  pages: CleanPage[];
  paragraphs: string[];
  stock: {
    state_debt: {
      mln_eur: number[];
      pct_gdp: number[];
      external_mln_eur: number[];
      domestic_mln_eur: number[];
    };
    gg_debt_annual: { mln_eur: number[] };
  };
  gdpCopy: Record<string, Record<string, number>>;
  annual: DebtStat;
  quarterly: DebtStat;
  bnbGg: Bnb;
  bnbCg: Bnb;
  revisions: Record<string, Record<string, Record<string, [number, number]>>>;
  execution: { rows: { id: string; short: string }[]; latest: { asOf: string } };
}
const YEARS = [2024, 2025, 2026, 2027, 2028],
  ASOF = '2026-07-01';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function same(a: number[], b: number[], tol: number, where: string): number {
  if (
    a.length !== b.length ||
    a.some((v, i) => !Number.isFinite(v) || !Number.isFinite(b[i]) || Math.abs(v - b[i]!) > tol)
  )
    throw new Error(`Debt cross-check failed: ${where}`);
  return Math.max(0, ...a.map((v, i) => Math.abs(v - b[i]!)));
}
function revised(
  a: number[],
  b: number[],
  years: number[],
  key: string,
  release: string,
  revisions: DebtInput['revisions'],
) {
  if (a.length !== b.length || a.length !== years.length)
    throw new Error('Debt revision length mismatch');
  const listed = revisions[release]?.[key] ?? {};
  for (let i = 0; i < a.length; i++) {
    const pair = listed[String(years[i])];
    if (!(a[i] === b[i] && !pair) && !(pair && pair[0] === b[i] && pair[1] === a[i]))
      throw new Error(`Unlisted Eurostat revision ${key} ${years[i]}`);
  }
}
function series(js: DebtStat, geo: string, unit: string) {
  return jsonstatSeries(js, 'time', { geo, unit });
}
function validateBnb(b: Bnb, indicator: string) {
  if (
    b.indicator !== indicator ||
    !/^\d{4}-\d\d-\d\d$/.test(b.asOf) ||
    b.quarters.length !== b.mln.length ||
    new Set(b.quarters).size !== b.quarters.length ||
    b.quarters.some(
      (q, i) =>
        !/^\d{4}-Q[1-4]$/.test(q) ||
        (i > 0 && b.quarters[i - 1]! >= q) ||
        !Number.isFinite(b.mln[i]),
    )
  )
    throw new Error('Invalid BNB reader evidence');
}
const byQuarter = (b: Bnb) => Object.fromEntries(b.quarters.map((q, i) => [q, b.mln[i]!]));
function bg(value: number): string {
  const [a, b] = rnd(value, 1).toFixed(1).split('.');
  const whole = a!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return b === '0' ? whole : `${whole},${b}`;
}
export function buildDebt(e: DebtInput, buildDate: string): Record<string, Json> {
  const z = stateDebtTable(e.table),
    columns = e.table.columns,
    vintageMap: Record<string, string> = { Отчет: 'actual', Проект: 'plan', Прогноза: 'forecast' };
  if (
    columns.length !== 5 ||
    columns.some((c, i) => c.split(' ')[0] !== String(YEARS[i]) || !vintageMap[c.slice(5)])
  )
    throw new Error('VI-1 columns changed');
  const vintage = columns.map((c) => vintageMap[c.slice(5)]!);
  const p = e.stock.state_debt;
  for (const [a, b] of [
    [z.totalMln, p.mln_eur],
    [z.totalPctGdp, p.pct_gdp],
    [z.externalMln, p.external_mln_eur],
    [z.domesticMln, p.domestic_mln_eur],
  ] as [number[], number[]][])
    same(a, b, 0, 'state debt');
  same(z.gdpMln, e.gdp, 0.05, 'GDP');
  let dev = 0;
  for (const [v, pct] of [
    [z.totalMln, z.totalPctGdp],
    [z.externalMln, z.externalPctGdp],
    [z.domesticMln, z.domesticPctGdp],
  ])
    dev = Math.max(
      dev,
      same(
        v!.map((x, i) => percentage(x, z.gdpMln[i]!, 2)),
        pct!,
        0.06,
        'printed GDP percentage',
      ),
    );
  const check: Record<string, Json> = { zddPrintedPctMaxDev: rnd(dev, 3) };
  const zdd = {
    years: YEARS,
    vintage,
    columns: [...columns],
    totalMln: z.totalMln,
    externalMln: z.externalMln,
    domesticMln: z.domesticMln,
    pctGdp: z.totalPctGdp,
    externalPctGdp: z.externalPctGdp,
    domesticPctGdp: z.domesticPctGdp,
    gdpMln: z.gdpMln,
    source: ['asbp'],
    asOf: ASOF,
    table: 'VI-1',
  };
  const years = Array.from({ length: 11 }, (_, i) => 2015 + i),
    yearKeys = years.map(String),
    annualAsOf = e.annual.updated.slice(0, 10);
  const annualCol = (geo: string, unit: string) => {
    const s = series(e.annual, geo, unit);
    if (Object.keys(s).sort().join(',') !== yearKeys.join(','))
      throw new Error('Eurostat annual years changed');
    return yearKeys.map((y) => rnd(s[y]![0], 3));
  };
  const bgMln = annualCol('BG', 'MIO_EUR'),
    bgPct = annualCol('BG', 'PC_GDP'),
    euMln = annualCol('EU27_2020', 'MIO_EUR'),
    euPct = annualCol('EU27_2020', 'PC_GDP');
  revised(
    bgPct,
    yearKeys.map((y) => e.gdpCopy.BG![y]!),
    years,
    'BG|PC_GDP',
    annualAsOf,
    e.revisions,
  );
  revised(
    euPct,
    yearKeys.map((y) => e.gdpCopy.EU27_2020![y]!),
    years,
    'EU27_2020|PC_GDP',
    annualAsOf,
    e.revisions,
  );
  revised(
    bgMln.slice(5),
    e.stock.gg_debt_annual.mln_eur,
    years.slice(5),
    'BG|MIO_EUR',
    annualAsOf,
    e.revisions,
  );
  const maastricht = {
    years,
    bg: { mln: bgMln, pctGdp: bgPct },
    eu27: { pctGdp: euPct, mln: euMln },
    thresholdPctGdp: 60,
    thresholdNote:
      'Референтна стойност от 60% от БВП (Протокол за процедурата при прекомерен дефицит към Договорите на ЕС).',
    dataset: 'gov_10dd_edpt1',
    source: ['eurostat'],
    asOf: annualAsOf,
  };
  const qmln = series(e.quarterly, 'BG', 'MIO_EUR'),
    qpct = series(e.quarterly, 'BG', 'PC_GDP'),
    quarters = Object.keys(qmln).sort();
  if (
    !quarters.length ||
    Object.keys(qpct).sort().join(',') !== quarters.join(',') ||
    quarters.some((q) => (qmln[q]![1] ?? '') !== (qpct[q]![1] ?? ''))
  )
    throw new Error('Eurostat quarterly units differ');
  const eq = {
    asOf: e.quarterly.updated.slice(0, 10),
    quarters,
    mln: quarters.map((q) => rnd(qmln[q]![0], 3)),
    pctGdp: quarters.map((q) => rnd(qpct[q]![0], 3)),
    flags: quarters.map((q) => qmln[q]![1] ?? ''),
  };
  validateBnb(e.bnbGg, 'GGALN_G01_XDC');
  validateBnb(e.bnbCg, 'GCALN_G01_AC_XDC');
  const gg = byQuarter(e.bnbGg),
    cg = byQuarter(e.bnbCg);
  check.eurostatQuarterlyVsBnbGgMaxDev = rnd(
    same(
      eq.mln,
      quarters.map((q) => gg[q]!),
      0.06,
      'Eurostat vs BNB',
    ),
    3,
  );
  const q4 = years.filter((y) => `${y}-Q4` in gg);
  check.bnbGgQ4VsEurostatAnnualMaxDev = rnd(
    same(
      q4.map((y) => gg[`${y}-Q4`]!),
      q4.map((y) => bgMln[years.indexOf(y)]!),
      0.06,
      'BNB Q4',
    ),
    3,
  );
  if ([2024, 2025].some((y) => !Number.isFinite(cg[`${y}-Q4`])))
    throw new Error('Missing BNB quarter');
  const quarterly = {
    eurostat: {
      quarters: eq.quarters,
      mln: eq.mln,
      pctGdp: eq.pctGdp,
      flags: eq.flags,
      flagLabels: { p: 'предварителни данни' },
      dataset: 'gov_10q_ggdebt',
      source: ['eurostat'],
      asOf: eq.asOf,
    },
    bnbGg: { ...e.bnbGg, source: ['bnb'] },
    bnbCg: { ...e.bnbCg, source: ['bnb'] },
  };
  const compare = {
    years: [2024, 2025],
    rows: [
      {
        id: 'zdd',
        label:
          'Държавен дълг (таблица VI-1 в мотивите към законопроекта, Министерство на финансите)',
        mln: zdd.totalMln.slice(0, 2),
        source: ['asbp'],
      },
      {
        id: 'cg',
        label: 'Дълг на централното управление (БНБ, край на годината)',
        mln: [cg['2024-Q4'], cg['2025-Q4']],
        source: ['bnb'],
      },
      {
        id: 'gg',
        label: 'Консолидиран брутен дълг на сектор „Държавно управление“ (по Маастрихт, Eurostat)',
        mln: [bgMln[9], bgMln[10]],
        source: ['eurostat'],
      },
    ],
    note: 'Трите реда не са еднакви, защото обхватът им е различен: таблица VI-1 на Министерството на финансите е държавният дълг, БНБ показва дълга на централното управление, а по Маастрихт се брои консолидираният брутен дълг на целия сектор „Държавно управление“. Съпоставката между редовете предстои да бъде проверена от експерт по публични финанси.',
  };
  const last = quarters.length - 1,
    latest = {
      zdd: {
        year: 2025,
        vintage: vintage[1],
        mln: zdd.totalMln[1],
        pctGdp: zdd.pctGdp[1],
        asOf: ASOF,
        next: { year: 2026, vintage: vintage[2], mln: zdd.totalMln[2], pctGdp: zdd.pctGdp[2] },
      },
      maastricht: {
        year: 2025,
        mln: bgMln.at(-1),
        pctGdp: bgPct.at(-1),
        asOf: annualAsOf,
        quarter: {
          id: quarters[last],
          mln: eq.mln[last],
          pctGdp: eq.pctGdp[last],
          flag: eq.flags[last],
          asOf: eq.asOf,
        },
      },
    };
  const scopes = [
    {
      id: 'zdd',
      label: 'Държавен дълг (данни на Министерството на финансите)',
      short: 'Държавен дълг',
      years: [2024, 2028],
      latestActual: 2025,
      source: ['asbp'],
      note: 'Таблица VI-1 в мотивите към законопроекта: 2024 и 2025 г. са отчет, 2026 г. е проект, 2027–2028 г. са прогноза. Разделен е на външен и вътрешен.',
    },
    {
      id: 'maastricht',
      label: 'Дълг по Маастрихт (сектор „Държавно управление“)',
      short: 'Дълг по Маастрихт',
      years: [2015, 2025],
      latestActual: 2025,
      source: ['eurostat', 'bnb'],
      note: 'Консолидиран брутен дълг на сектор „Държавно управление“: показателят, по който България се сравнява с ЕС и с прага от 60% от БВП.',
    },
  ];
  const structure = parseDebtStructure(e.pages),
    group = structure.maxDeviationFrom100 as Record<string, number>;
  delete structure.maxDeviationFrom100;
  check.structureGroupMaxDevFrom100 = group;
  if (Object.values(group).some((v) => v > 0.25)) throw new Error('Debt structure does not add up');
  Object.assign(structure, {
    table: 'VI-2',
    source: ['asbp'],
    asOf: ASOF,
    unit: '% от държавния дълг',
    note: 'Поради закръгления сборът на групите може да се различава от 100%. От 01.01.2026 г. еврото е официалната валута; редът „Левове“ е без стойност за 2026–2028 г. в източника.',
  });
  const interest = parseDebtInterest(e.pages) as unknown as {
    totalMln: number[];
    externalMln: number[];
    domesticMln: number[];
  };
  if (
    [0, 1].some(
      (i) =>
        Math.abs(interest.totalMln[i]! - interest.externalMln[i]! - interest.domesticMln[i]!) >
        0.05,
    )
  )
    throw new Error('Debt interest differs');
  Object.assign(interest, {
    source: ['asbp'],
    asOf: ASOF,
    note: 'Лихвени разходи за обслужването на държавния дълг. Не са същото като реда „Лихви“ в консолидираната фискална програма (Приложение 3): обхватът е различен.',
  });
  const guaranteed = parseGuaranteedDebt(e.pages) as unknown as {
    years: number[];
    totalMln: number[];
    externalMln: number[];
    domesticMln: number[];
    pctGdpPrinted: number[];
    sectors: { values: number[] }[];
  };
  guaranteed.years.forEach((y, i) => {
    if (
      Math.abs(guaranteed.externalMln[i]! + guaranteed.domesticMln[i]! - guaranteed.totalMln[i]!) >
        0.05 ||
      Math.abs(
        percentage(guaranteed.totalMln[i]!, z.gdpMln[YEARS.indexOf(y)]!, 1) -
          guaranteed.pctGdpPrinted[i]!,
      ) > 0.06
    )
      throw new Error('Guaranteed debt differs');
  });
  if ([0, 1].some((i) => Math.abs(sum(guaranteed.sectors.map((s) => s.values[i]!)) - 100) > 0.25))
    throw new Error('Guaranteed sectors differ');
  Object.assign(guaranteed, {
    source: ['asbp'],
    asOf: ASOF,
    note: 'Държавногарантиран дълг: гаранциите на държавата за чужди заеми. Не е част от държавния дълг в таблица VI-1.',
  });
  const newDebt = parseNewDebt(e.pages) as unknown as {
    y2025: { parts: { mln: number }[]; totalMln: number };
    issued2026: { months: { mln: number }[]; totalMln: number };
    plan: { bln: number }[];
    limitEnd2026Bln: number;
  };
  if (
    Math.abs(sum(newDebt.y2025.parts.map((p) => p.mln)) - newDebt.y2025.totalMln) > 0.05 ||
    Math.abs(sum(newDebt.issued2026.months.map((m) => m.mln)) - newDebt.issued2026.totalMln) > 0.05
  )
    throw new Error('New debt parts differ');
  Object.assign(newDebt, {
    source: ['asbp'],
    asOf: ASOF,
    kindLabels: {
      limit: 'Най-голям размер на новия дълг (горна граница по закона)',
      plan: 'Планирано в средносрочната прогноза',
    },
    note: '2026 г. е горна граница по закона (чл. 67, ал. 1), не прогноза; 2027–2028 г. са плановете на Министерството на финансите.',
  });
  const lw = parseDebtLawLimits(e.paragraphs) as Record<string, number>;
  if (
    newDebt.plan[0]!.bln !== lw.newDebtBln ||
    newDebt.limitEnd2026Bln !== lw.debtCapEnd2026Bln ||
    lw.safeLoanMln! >= lw.newDebtBln! * 1000
  )
    throw new Error('Debt law limits differ');
  check.limitsMatchMotives = true;
  const limits = {
    year: 2026,
    source: ['zdb'],
    asOf: '2026-07-31',
    items: [
      {
        id: 'debtCap',
        art: 66,
        label: 'Най-голям размер на държавния дълг към края на 2026 г.',
        mln: rnd(lw.debtCapEnd2026Bln! * 1000, 1),
        printed: `${bg(lw.debtCapEnd2026Bln!)} млрд. евро`,
      },
      {
        id: 'newDebt',
        art: 67,
        para: 1,
        label: 'Най-голям размер на новия държавен дълг, който може да бъде поет през годината',
        mln: rnd(lw.newDebtBln! * 1000, 1),
        printed: `${bg(lw.newDebtBln!)} млрд. евро`,
        includesMln: lw.safeLoanMln,
        includes:
          'заем за финансова подкрепа по линия на инструмента „Мерки за сигурността на Европа (SAFE)“',
      },
      {
        id: 'newGuarantees',
        art: 69,
        para: 1,
        label: 'Най-голям размер на новите държавни гаранции',
        mln: lw.newGuaranteesMln,
        printed: `${bg(lw.newGuaranteesMln!)} млн. евро`,
      },
      {
        id: 'guaranteesAll',
        art: 71,
        label: 'Общ най-голям размер на новите гаранции по чл. 69 и 70',
        mln: lw.guaranteesAllMln,
        printed: `${bg(lw.guaranteesAllMln!)} млн. евро`,
      },
      {
        id: 'fiscalReserve',
        art: 65,
        label: 'Най-малък размер на фискалния резерв към 31 декември 2026 г.',
        mln: rnd(lw.reserveMinBln! * 1000, 1),
        printed: `${bg(lw.reserveMinBln!)} млрд. евро`,
        kind: 'min',
      },
    ],
    note: 'Закон за държавния бюджет на Република България за 2026 г., ДВ бр. 69 от 31.07.2026 г. Горните граници не са прогноза.',
  };
  const ids = [
      'fin',
      'fin.ext',
      'fin.ext.markets',
      'fin.dom',
      'fin.dom.advances',
      'fin.dom.refunds',
      'fin.priv',
    ],
    labels = Object.fromEntries(
      ids.map((id) => {
        const r = e.execution.rows.find((r) => r.id === id);
        if (!r) throw new Error(`Missing financing row ${id}`);
        return [id, r.short];
      }),
    );
  const financing = { ref: 'execution', rows: ids, labels, asOf: e.execution.latest.asOf };
  const notes = [
    {
      id: 'projection',
      text: '2026 г. е проектът към законопроекта (01.07.2026 г.), а 2027–2028 г. са прогноза на Министерството на финансите: това не са отчетени данни.',
    },
    {
      id: 'quarterly',
      text: 'Първото тримесечие на 2026 г. в данните на Eurostat е предварително (отбелязано с „p“).',
    },
    {
      id: 'maturities',
      text: 'Падежите и емисиите на държавните ценни книжа предстоят: регистърът на Министерството на финансите не се изтегля автоматично.',
    },
  ];
  return {
    meta: metadata(
      'D13+D14',
      'Дълг: държавен дълг 2024–2028, дълг по Маастрихт и тримесечни редове',
      buildDate,
      {
        source: ['asbp', 'eurostat', 'bnb'],
        sourceNote:
          'Таблици VI-1 и VI-2 и текстът на част VI от мотивите към законопроекта; Eurostat gov_10dd_edpt1 и gov_10q_ggdebt; БНБ (SDMX): дълг на сектор „Държавно управление“ и на централното управление',
        asOf: [e.bnbCg.asOf, e.bnbGg.asOf, eq.asOf].sort().at(-1),
        unit: 'млн. €',
        extra: { pending: ['P06'] },
      },
    ),
    defaultScope: 'zdd',
    scopes,
    latest,
    zdd,
    maastricht,
    quarterly,
    compare,
    structure,
    interest,
    guaranteed,
    newDebt,
    limits,
    financing,
    notes,
    check,
  } as unknown as Record<string, Json>;
}
