import { isNumber } from '../io/data.js';
import { YEARS, type TableRow } from './annex.js';

/** Cleaned Table VI-1 evidence, independently extracted from the source document. */
export interface StateDebtTableInput {
  rows: TableRow[];
}

export interface StateDebtTable {
  totalMln: number[];
  totalPctGdp: number[];
  externalMln: number[];
  externalPctGdp: number[];
  domesticMln: number[];
  domesticPctGdp: number[];
  gdpMln: number[];
}

/** Table VI-1: state debt under the State Debt Act, not general-government debt. */
export function stateDebtTable(input: StateDebtTableInput): StateDebtTable {
  const rows = new Map(input.rows.map((row) => [row.label, row.values]));
  function required(label: string): number[] {
    const values = rows.get(label);
    if (!values || values.length !== 5 || !values.every(isNumber))
      throw new Error(`VI-1 ${label} is incomplete`);
    return [...values];
  }
  const result: StateDebtTable = {
    totalMln: required('Държавен дълг, млн. евро'),
    totalPctGdp: required('Държавен дълг/БВП (%)*'),
    externalMln: required('Външен дълг, млн. евро'),
    externalPctGdp: required('Външен дълг/БВП (%)'),
    domesticMln: required('Вътрешен дълг, млн. евро'),
    domesticPctGdp: required('Вътрешен дълг/БВП (%)'),
    gdpMln: required('БВП, млн. евро'),
  };
  for (let i = 0; i < YEARS.length; i++) {
    if (Math.abs(result.totalMln[i]! - result.externalMln[i]! - result.domesticMln[i]!) > 0.25)
      throw new Error(`VI-1: external + domestic != total in ${YEARS[i]}`);
  }
  return result;
}

import type { Json } from '@sigma-budget/dataset-schema';
import { metadata, span } from '../common/metadata.js';
import { formatNumber, pythonRound } from '../common/format.js';
import { VINTAGE, type Annex } from './annex.js';
import { I2_GROUPS, I2_ROWS, REVENUE_GROUP_DEFS } from './fiscal-definitions.js';

export interface CleanPage {
  page: number;
  body: string;
}
export interface FiscalVersion {
  table: string;
  label: string;
  pdf: number[];
  docx: number[];
}
export interface FiscalTable {
  rows: TableRow[];
}
export interface FiscalEvidence {
  annex: Annex;
  tables: Record<string, FiscalTable>;
  pages: CleanPage[];
  differingRows: FiscalVersion[];
}
export interface MacroRow {
  id: string;
  label: string;
  short: string;
  group: string;
  level: number;
  unit: string;
  values: number[];
  parent?: string;
}
export function findFiscalPage(pages: CleanPage[], ...needles: string[]): number {
  const i = pages.findIndex((p) => needles.every((n) => p.body.includes(n)));
  if (i < 0) throw new Error(`PDF page not found: ${needles.join(', ')}`);
  return i;
}
export function parseMacro(pages: CleanPage[]): MacroRow[] {
  const i = findFiscalPage(pages, 'Брутен вътрешен продукт \nБВП (млн. евро)');
  const lines = pages[i]!.body.split('\n').map((x) => x.trim());
  const start = lines.indexOf('Брутен вътрешен продукт');
  const end = lines.findIndex((x, j) => j >= start && x.startsWith('Източник:'));
  if (start < 0 || end < 0) throw new Error('Табл. I-2 boundaries missing');
  const headings = new Set<string>(I2_GROUPS.map((x) => x[1]));
  const rows: { label: string; values: number[] }[] = [];
  let label: string[] = [],
    values: number[] = [];
  for (const line of lines.slice(start, end)) {
    if (!line || (headings.has(line) && !label.length && !values.length)) continue;
    const token = line.replaceAll('\u00a0', ' ').replaceAll('−', '-').trim();
    if (/^-?\d{1,3}(?: \d{3})*(?:,\d+)?$/.test(token)) {
      values.push(Number(token.replaceAll(' ', '').replace(',', '.')));
      if (values.length === 5) {
        rows.push({ label: label.join(' '), values });
        label = [];
        values = [];
      }
    } else {
      if (values.length) throw new Error('Табл. I-2 partial number run');
      label.push(line);
    }
  }
  if (label.length || values.length || rows.length !== I2_ROWS.length)
    throw new Error('Табл. I-2 incomplete rows');
  const parents: Record<string, string> = {
    consumption: 'gdpGrowth',
    gfcf: 'gdpGrowth',
    exports: 'gdpGrowth',
    imports: 'gdpGrowth',
  };
  return I2_ROWS.map(([id, expected, group, level, short, unit], j) => {
    const row = rows[j]!;
    if (row.label.replace(/\s+/gu, ' ') !== expected)
      throw new Error(`Табл. I-2 label mismatch for ${id}`);
    return {
      id,
      label: expected,
      short,
      group,
      level,
      unit,
      values: row.values.map((v) => (unit === 'млн. €' ? Math.trunc(v) : v)),
      ...(parents[id] ? { parent: parents[id] } : {}),
    };
  });
}
type AnnexNode = Annex['tree'][number];
export function numbers(values: (number | null)[] | undefined, id: string): number[] {
  if (!values || !values.every(isNumber)) throw new Error(`Annex 3 row ${id} has blank cells`);
  return [...values];
}
export function annexSeries(a: Annex, id: string): { mln: number[]; pctGdp: number[] } {
  return { mln: numbers(a.mln[id], id), pctGdp: numbers(a.pct[id], id) };
}
export function annexRow(a: Annex, node: AnnexNode): Record<string, Json> {
  const [y0, mln] = span(a.mln[node.id]!),
    [p0, pc] = span(a.pct[node.id]!);
  if (y0 !== p0 || mln.length !== pc.length)
    throw new Error(`Annex 3: blank pattern differs for ${node.id}`);
  return {
    id: node.id,
    label: node.label,
    level: node.level,
    ...(node.parent ? { parent: node.parent } : {}),
    ...(node.memo ? { memo: true } : {}),
    ...(y0 ? { y0 } : {}),
    mln,
    pctGdp: pc,
  };
}
export const rnd = (x: number, n = 1) => pythonRound(x, n);
export const percentage = (x: number, y: number, n = 2) => {
  if (y === 0) throw new Error('division by zero');
  return pythonRound((100 * x) / y, n);
};
export const mln = (x: number) => `${formatNumber(x, 1)} млн. €`;
export const metaFiscal = (
  id: string,
  title: string,
  date: string,
  source: string[],
  sourceNote: string,
  extra: Record<string, Json> = {},
) => metadata(id, title, date, { source, sourceNote, asOf: '2026-07-01', unit: 'млн. €', extra });

export function buildOutlook(e: FiscalEvidence, buildDate: string): Record<string, Json> {
  const a = e.annex,
    gdp = numbers(a.gdp, 'gdp'),
    macroRows = parseMacro(e.pages),
    byid = Object.fromEntries(macroRows.map((r) => [r.id, r]));
  if (byid.gdp!.values.some((x, i) => Math.abs(x - gdp[i]!) > 0.5))
    throw new Error('Табл. I-2 GDP differs from Annex 3');
  const revenue = annexSeries(a, 'r.total'),
    expenditure = annexSeries(a, 'x.total'),
    balance = annexSeries(a, 'x.balance'),
    interest = annexSeries(a, 'x.interest'),
    financing = annexSeries(a, 'x.fin');
  const primaryMln = balance.mln.map((x, i) => rnd(x + interest.mln[i]!));
  const primaryBalance = {
    mln: primaryMln,
    pctGdp: primaryMln.map((v, i) => percentage(v, gdp[i]!)),
    computed: true,
    note: 'Изчислено: бюджетно салдо + лихви. Лихвените приходи не са извадени, затова е ориентир, не официален показател.',
  };
  const versions = e.differingRows.map((r) => {
    if (r.table !== 'annex3_mln') throw new Error(`unexpected differing table ${r.table}`);
    const nodes = a.tree.filter((n) => n.label === r.label.trim());
    if (nodes.length !== 1) throw new Error(`cannot map differing label ${r.label}`);
    return {
      id: nodes[0]!.id,
      label: r.label.trim(),
      pdf: r.pdf,
      docx: r.docx,
      diff: r.pdf.map((p, i) => rnd(r.docx[i]! - p)),
    };
  });
  const maximum = Math.max(...versions.flatMap((v) => v.diff.map(Math.abs)));
  const table = e.tables.II_3?.rows;
  if (!table) throw new Error('II-3 missing');
  const rev = table.find((r) => r.label === 'ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ'),
    exp = table.find((r) => r.label === 'ОБЩО РАЗХОДИ И ВНОСКА В БЮДЖЕТА НА ЕС'),
    pc = table.filter((r) => r.label === '% от БВП');
  const implied = [
    (numbers(rev?.values, 'II-3 revenue')[0]! / numbers(pc[0]?.values, 'II-3 pct')[0]!) * 100,
    (numbers(exp?.values, 'II-3 expenditure')[0]! / numbers(pc[1]?.values, 'II-3 pct')[0]!) * 100,
  ];
  if (!implied.every((v) => v > 92000 && v < 97000))
    throw new Error('II-3 2024 implied GDP changed');
  const notes = [
    {
      id: 'twoVersions',
      text: `Числата на Приложение 3 са от PDF версията на мотивите (проект от юни 2026 г.). Внесеният на 01.07.2026 г. документ (.docx) се различава в ${versions.length} реда само за 2026–2028 г., най-много с ${mln(maximum)}; общите суми и осемте групи приходи са еднакви. Различията са в „versions“.`,
    },
    {
      id: 'gdp',
      text: 'БВП в Табл. I-2 е закръглен до цели милиони евро (2026: 125 247); процентите от БВП в Приложение 3 са изчислени от незакръглената стойност (125 246,7), която е в „gdp.mlnPrecise“.',
    },
    {
      id: 'rounding',
      text: 'Всяка клетка в източника е закръглена до 0,1 млн. €, затова сборът на съставните редове може да се различава от общия ред с до 0,1–0,3 млн. €.',
    },
    {
      id: 'balance',
      text: 'Бюджетното салдо е за консолидираната фискална програма (КФП), с вноската в общия бюджет на ЕС в разходите. Финансирането е със същата стойност и обратен знак.',
    },
    {
      id: 'pct2024',
      text: `В Табл. II-3 и II-4 колоната „% от БВП“ за 2024 г. е изчислена с по-малък БВП (около ${formatNumber((implied[0]! + implied[1]!) / 2 / 1000, 1)} млрд. €), а не с 104,8 млрд. € от Приложение 3 (напр. приходите на националния бюджет са отпечатани като 37,1%, а при БВП от Приложение 3 са ${formatNumber(percentage(rev!.values[0]!, gdp[0]!, 1), 1)}%). Ползваме Приложение 3 и изчислени дялове.`,
    },
  ];
  return {
    meta: metaFiscal(
      'D01+D02+D15',
      'Рамка на КФП и макроикономическа прогноза 2024–2028',
      buildDate,
      ['asbp'],
      'Приложение 3 „Консолидирана фискална програма за периода 2023–2028 г.“ и Табл. I-2 на мотивите към законопроекта',
    ),
    years: [...YEARS],
    vintage: [...VINTAGE],
    gdp: { mln: byid.gdp!.values, mlnPrecise: gdp },
    kfp: { revenue, expenditure, balance, interest, primaryBalance, financing },
    macro: {
      gdpRealGrowthPct: byid.gdpGrowth!.values,
      hicpPct: byid.hicp!.values,
      unemploymentPct: byid.unemployment!.values,
    },
    macroVintage: ['actual', 'actual', 'forecast', 'forecast', 'forecast'],
    macroGroups: I2_GROUPS.map(([id, name]) => ({
      id,
      name,
      rows: macroRows.filter((r) => r.group === id).map((r) => r.id),
    })),
    macroRows: macroRows as unknown as Json,
    versions,
    notes,
  };
}
export function buildRevenue(e: FiscalEvidence, buildDate: string): Record<string, Json> {
  const a = e.annex,
    gdp = numbers(a.gdp, 'gdp'),
    total = annexSeries(a, 'r.total'),
    sums = [0, 0, 0, 0, 0];
  const groups = REVENUE_GROUP_DEFS.map(([id, name, rows, glossary]) => {
    const values = YEARS.map((_, i) =>
      rnd(rows.reduce((sum, r) => sum + numbers(a.mln[r], r)[i]!, 0)),
    );
    values.forEach((v, i) => {
      sums[i]! += v;
    });
    return {
      id,
      name,
      rowIds: [...rows],
      annex3Rows: rows.map((r) => a.labels[r]!),
      mln: values,
      pctGdp: values.map((v, i) => percentage(v, gdp[i]!)),
      share2026: percentage(values[2]!, total.mln[2]!),
      yoy2026Pct: rnd(100 * (values[2]! / values[1]! - 1)),
      glossary,
    };
  });
  const groupSums = sums.map((v) => rnd(v));
  if (groupSums.some((v, i) => Math.abs(v - total.mln[i]!) > 0.35))
    throw new Error('revenue groups do not add up');
  return {
    meta: metaFiscal(
      'D05',
      'Приходи на КФП по видове 2024–2028',
      buildDate,
      ['asbp'],
      'Приложение 3, редове „Приходи, помощи и дарения“ и съставните им; групите са сборове от редове на приложението',
      { pending: ['P01'] },
    ),
    years: [...YEARS],
    vintage: [...VINTAGE],
    total,
    groups,
    groupSums,
    rows: a.tree.filter((n) => n.id.startsWith('r.')).map((n) => annexRow(a, n)),
    execution: {
      ref: 'execution',
      rows: {
        'rev.tax': 'Данъчни приходи',
        'rev.nontax': 'Неданъчни приходи',
        'rev.grants': 'Помощи и дарения',
      },
    },
    notes: [
      {
        id: 'groups',
        text: 'Осемте групи са сборове от редове на Приложение 3. „Други данъци и мита“ са данъкът върху застрахователните премии, митата и митническите такси и другите данъци. Дяловете и процентите от БВП са изчислени от нас.',
      },
      {
        id: 'rounding',
        text: 'Сборът на групите се различава от общия ред с до 0,1 млн. € заради закръгляването в източника (виж „groupSums“).',
      },
      {
        id: 'byTax',
        text: 'Изпълнението по видове данъци (ДДС, ДДФЛ, корпоративен данък, акцизи) предстои: месечният отчет в .xls дава само общата сума на данъчните приходи.',
      },
    ],
  };
}
