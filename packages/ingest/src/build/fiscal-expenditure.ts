import type { Json } from '@sigma-budget/dataset-schema';
import { formatNumber } from '../common/format.js';
import { isNumber } from '../io/data.js';
import { YEARS, VINTAGE } from './annex.js';
import {
  annexRow,
  findFiscalPage,
  numbers,
  rnd,
  percentage,
  mln,
  metaFiscal,
  type FiscalEvidence,
  type CleanPage,
} from './fiscal.js';
import {
  FUNCTION_DEFS,
  FUNCTION_NAMES,
  FUNCTION_SHORT,
  FUNCTIONS_MINISTRIES_NOTE,
  COFOG_NAMES,
  COFOG_TO_FUNCTION,
} from './fiscal-definitions.js';

export interface FunctionPart {
  name: string;
  mln: number[];
  pc_gdp: number[];
}
export interface FunctionInput extends FunctionPart {
  parts: FunctionPart[];
}
export interface CofogInput {
  years: (string | number)[];
  MIO_EUR: Record<string, number[]>;
  PC_GDP: Record<string, number[]>;
  labels: Record<string, string>;
  updated: string;
  dataset: string;
}
export interface PopulationInput {
  latest: { date: string; persons: number };
  years: (string | number)[];
  persons: number[];
}
export interface ExpenditureEvidence extends FiscalEvidence {
  functions: FunctionInput[];
  cofog: CofogInput;
  population: PopulationInput;
}
interface PdfRow {
  name: string;
  part: boolean;
  mln: number[];
  pct: number[];
}
interface PdfFunction {
  name: string;
  mln: number[];
  pct: number[];
  parts: PdfRow[];
}
interface OutputFunction {
  id: string;
  name: string;
  short: string;
  mln: number[];
  pctGdp: number[];
  parts?: { name: string; mln: number[]; pctGdp: number[] }[];
  ministries: readonly string[];
  glossary: string;
  share?: number[];
  yoy2026Pct?: number;
}
interface FunctionVersion {
  id: string;
  label: string;
  pdf: number[];
  docx: number[];
  part?: string;
  pdfPct?: number[];
  docxPct?: number[];
}
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export function parseFunctionTable(pages: CleanPage[]): PdfRow[] {
  const i = findFiscalPage(
    pages,
    'Табл. III-1: Разходи по функции по КФП',
    'ПОКАЗАТЕЛИ \nмлн. евро',
  );
  if (!pages[i + 1]) throw new Error('Табл. III-1 continuation missing');
  const lines = (pages[i]!.body + '\n' + pages[i + 1]!.body).split('\n').map((s) => s.trim());
  const a = lines.indexOf('Общи държавни служби'),
    b = lines.findIndex((s, k) => k >= a && s.startsWith('Източник:'));
  if (a < 0 || b < 0) throw new Error('Табл. III-1 boundaries missing');
  const headers = new Set([
    'ПОКАЗАТЕЛИ',
    'млн. евро',
    '% от БВП',
    '2025',
    '2026',
    '2027',
    '2028',
    'Програма',
    'Проект',
    'Прогноза',
  ]);
  const output: PdfRow[] = [];
  let label: string[] = [],
    money: number[] = [],
    pcts: number[] = [];
  const flush = () => {
    if (!label.length && !money.length && !pcts.length) return;
    if (money.length !== 4 || pcts.length !== 4)
      throw new Error(`Табл. III-1 partial row ${label.join(' ')}`);
    let name = label.join(' ').replace(/\s+/gu, ' ').trim();
    const part = name.startsWith('- ');
    if (part) name = name.slice(2).trim();
    output.push({ name, part, mln: money, pct: pcts });
    label = [];
    money = [];
    pcts = [];
  };
  for (const line of lines.slice(a, b)) {
    if (!line || headers.has(line)) continue;
    if (/^-?\d{1,3}(?: \d{3})*,\d$/.test(line)) {
      if (money.length === 4) throw new Error('Табл. III-1 too many amounts');
      money.push(Number(line.replaceAll(' ', '').replace(',', '.')));
    } else if (/^-?\d+,\d%$/.test(line)) pcts.push(Number(line.slice(0, -1).replace(',', '.')));
    else {
      if (money.length || pcts.length) flush();
      label.push(line);
    }
  }
  flush();
  return output;
}
export function buildFunctions(e: ExpenditureEvidence): Record<string, Json> {
  const a = e.annex,
    gdp = numbers(a.gdp, 'gdp'),
    pdf = parseFunctionTable(e.pages),
    docx = e.functions;
  if (docx.length !== 9) throw new Error('kfp_functions_2026: expected 9 functions');
  const pdfFunctions: PdfFunction[] = [];
  for (const r of pdf)
    if (!r.part) pdfFunctions.push({ name: r.name, mln: r.mln, pct: r.pct, parts: [] });
    else {
      if (!pdfFunctions.length) throw new Error('PDF part before function');
      pdfFunctions.at(-1)!.parts.push(r);
    }
  if (pdfFunctions.length !== 9) throw new Error('Табл. III-1 expected 9 functions');
  const items: OutputFunction[] = [],
    versions: FunctionVersion[] = [];
  FUNCTION_DEFS.forEach(([slug, prefix, gloss, mins], i) => {
    const d = docx[i]!,
      p = pdfFunctions[i]!;
    if (!d.name.startsWith(prefix) || p.name !== d.name)
      throw new Error(`function name mismatch: ${slug}`);
    if (d.parts.length !== p.parts.length || d.parts.some((x, j) => x.name !== p.parts[j]!.name))
      throw new Error(`function parts mismatch: ${slug}`);
    const names: Record<string, string> = FUNCTION_NAMES,
      shorts: Record<string, string> = FUNCTION_SHORT;
    const it: OutputFunction = {
      id: slug,
      name: names[slug] ?? d.name,
      short: shorts[slug]!,
      mln: d.mln,
      pctGdp: d.pc_gdp,
      ministries: mins,
      glossary: gloss,
    };
    if (d.parts.length) {
      it.parts = d.parts.map((x) => ({ name: x.name, mln: x.mln, pctGdp: x.pc_gdp }));
      const sums = [0, 1, 2, 3].map((k) => rnd(d.parts.reduce((s, x) => s + x.mln[k]!, 0)));
      if (sums.some((v, k) => Math.abs(v - d.mln[k]!) > 0.45))
        throw new Error(`parts do not add up: ${slug}`);
    }
    items.push(it);
    const pairs = [
      { part: undefined, label: d.name, dm: d.mln, pm: p.mln, dp: d.pc_gdp, pp: p.pct },
      ...d.parts.map((x, j) => ({
        part: x.name,
        label: x.name,
        dm: x.mln,
        pm: p.parts[j]!.mln,
        dp: x.pc_gdp,
        pp: p.parts[j]!.pct,
      })),
    ];
    for (const { part, label, dm, pm, dp, pp } of pairs)
      if (!same(dm, pm) || !same(dp, pp))
        versions.push({
          id: slug,
          label,
          pdf: pm,
          docx: dm,
          ...(part ? { part } : {}),
          ...(!same(dp, pp) ? { pdfPct: pp, docxPct: dp } : {}),
        });
  });
  const ycols = [1, 2, 3, 4];
  const total = ycols.map((_, k) => rnd(items.reduce((s, x) => s + x.mln[k]!, 0))),
    totalPdf = ycols.map((_, k) => rnd(pdfFunctions.reduce((s, x) => s + x.mln[k]!, 0)));
  const annexExp = ycols.map((i) => numbers(a.mln['x.exp'], 'x.exp')[i]!),
    diff = total.map((t, i) => rnd(t - annexExp[i]!));
  const gaps = diff.flatMap((v, i) => (Math.abs(v) > 0.35 ? [YEARS[ycols[i]!]!] : []));
  if (gaps.length !== 1 || gaps[0] !== 2025) throw new Error('III-1 unexpected gap years');
  items.forEach((it) => {
    it.share = it.mln.map((v, i) => percentage(v, total[i]!));
    it.yoy2026Pct = rnd(100 * (it.mln[1]! / it.mln[0]! - 1));
  });
  const gdp4 = ycols.map((i) => gdp[i]!),
    pctGap = ycols.map((_, k) =>
      rnd(
        Math.max(...items.map((it) => Math.abs(it.pctGdp[k]! - (100 * it.mln[k]!) / gdp4[k]!))),
        2,
      ),
    );
  if (!(pctGap[0]! > 0.2 && pctGap.slice(1).every((v) => v < 0.1)))
    throw new Error('III-1 printed GDP check changed');
  const health = items.find((it) => it.id === 'zdraveopazvane')!,
    other = items.find((it) => it.id === 'drugi')!,
    interest = ycols.map((i) => numbers(a.mln['x.interest'], 'x.interest')[i]!);
  const notes = [
    {
      id: 'base',
      text: `Таблицата няма ред „Общо“. Сборът на деветте функции за 2026 г. е ${mln(total[1]!)} и е равен на разходите по КФП без вноската в общия бюджет на ЕС (Приложение 3); с вноската от ${mln(numbers(a.mln['x.eucontrib'], 'x.eucontrib')[2]!)} общо разходите са ${mln(numbers(a.mln['x.total'], 'x.total')[2]!)}.`,
    },
    {
      id: 'col2025',
      text: `Колоната „2025 Програма“ е програмата, както е отпечатана в таблицата (${mln(total[0]!)}), а не предварителният отчет за 2025 г. в Приложение 3 (${mln(annexExp[0]!)} разходи без вноската в ЕС). Отпечатаните там проценти от БВП са с по-малък БВП: напр. за здравеопазване са 5,5%, а при БВП от Приложение 3 са ${formatNumber(percentage(health.mln[0]!, gdp4[0]!, 1), 1)}%. За 2026–2028 г. отпечатаните проценти съвпадат с изчислените.`,
    },
    {
      id: 'version',
      text: `Редовете са по внесения на 01.07.2026 г. документ (.docx). PDF версията на мотивите се различава в ${versions.length} от ${pdf.length} реда (виж „versions“); сборовете им са ${mln(total[1]!)} и ${mln(totalPdf[1]!)} за 2026 г.`,
    },
  ];
  if (other.mln.slice(1).every((v, i) => v === interest[i + 1]) && other.mln[0] !== interest[0])
    notes.push({
      id: 'drugi',
      text: `Разходите „Некласифицирани в другите функции“ за 2026–2028 г. са равни на лихвите по КФП в Приложение 3 (${mln(interest[1]!)}, ${mln(interest[2]!)} и ${mln(interest[3]!)}), но за 2025 г. не са (${mln(other.mln[0]!)} срещу ${mln(interest[0]!)}).`,
    });
  return {
    years: [2025, 2026, 2027, 2028],
    vintage: ['prelim', 'plan', 'forecast', 'forecast'],
    yearLabels: ['2025 Програма', '2026 Проект', '2027 Прогноза', '2028 Прогноза'],
    totalMln: total,
    totalPctGdp: total.map((v, i) => percentage(v, gdp4[i]!)),
    items: items as unknown as Json,
    ministriesNote: FUNCTIONS_MINISTRIES_NOTE,
    reconcile: {
      annex3ExpenditureMln: annexExp,
      diffMln: diff,
      pdfTotalMln: totalPdf,
      printedPctGdpMaxGap: pctGap,
    },
    versions: versions as unknown as Json,
    notes,
  };
}
export function buildCofog(c: CofogInput): Record<string, Json> {
  const years = c.years.map(Number),
    divisions = ['GF01', 'GF02', 'GF03', 'GF04', 'GF05', 'GF06', 'GF07', 'GF08', 'GF09', 'GF10'];
  for (const key of ['MIO_EUR', 'PC_GDP'] as const)
    for (const [code, v] of Object.entries(c[key]))
      if (v.length !== years.length || !v.every(isNumber))
        throw new Error(`cofog ${key} ${code}: blank or short series`);
  years.forEach((y, i) => {
    const sum = divisions.reduce((s, d) => s + c.MIO_EUR[d]![i]!, 0);
    if (Math.abs(sum - c.MIO_EUR.TOTAL![i]!) > 0.55)
      throw new Error(`COFOG divisions do not add up in ${y}`);
  });
  const names: Record<string, string> = COFOG_NAMES,
    links: Record<string, readonly string[]> = COFOG_TO_FUNCTION;
  return {
    years,
    unit: 'млн. €',
    source: ['eurostat'],
    asOf: c.updated.slice(0, 10),
    sector: 'S13 (държавно управление)',
    dataset: c.dataset,
    total: { mln: c.MIO_EUR.TOTAL!, pctGdp: c.PC_GDP.TOTAL! },
    items: [divisions[0]!, 'GF0107', ...divisions.slice(1)].map((code) => ({
      code,
      name: names[code]!,
      nameEn: c.labels[code]!,
      mln: c.MIO_EUR[code]!,
      pctGdp: c.PC_GDP[code]!,
      ...(code === 'GF0107' ? { memoOf: 'GF01' } : { kfpFunctions: [...links[code]!] }),
    })),
    note: 'Разходите по функции на сектор „Държавно управление“ (COFOG, Евростат) са друг разрез от функциите на КФП в Табл. III-1: различен обхват и методика, затова числата не са сравними един към един. „Операции с публичния дълг“ е част от „Общи държавни служби“.',
  };
}
export function buildExpenditure(e: ExpenditureEvidence, buildDate: string): Record<string, Json> {
  const p = e.population,
    year = Number(p.latest.date.slice(0, 4));
  if (
    year !== 2026 ||
    !isNumber(p.latest.persons) ||
    Number(p.years.at(-1)) !== year ||
    p.persons.at(-1) !== p.latest.persons
  )
    throw new Error('population latest differs from 2026 series');
  return {
    meta: metaFiscal(
      'D03+D04+D05',
      'Разходи на КФП: по функции, по икономически вид и по COFOG',
      buildDate,
      ['asbp', 'eurostat'],
      'Табл. III-1 (функции), Приложение 3 (икономически вид), Евростат gov_10a_exp (COFOG)',
    ),
    functions: buildFunctions(e),
    economic: {
      years: [...YEARS],
      vintage: [...VINTAGE],
      rows: e.annex.tree
        .filter((n) => n.id.startsWith('x.') && !['x.balance', 'x.fin'].includes(n.id))
        .map((n) => annexRow(e.annex, n)),
    },
    cofog: buildCofog(e.cofog),
    perCapita: { population: Math.trunc(p.latest.persons), year },
  };
}
