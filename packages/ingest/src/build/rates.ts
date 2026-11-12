/** Transform the two pairs of annex grids captured by the independent law reader.
 * Raw HTML and PDF reading remains in Python until the extraction wave.
 */
export type LawBlock = ['p', string] | ['t', string[][]];
export interface MinimumIncomeRow {
  no: number;
  code: string;
  name: string;
  until: (number | null)[];
  from: (number | null)[];
}
export interface ActivityRate {
  code: string;
  name: string;
  until: number;
  from: number;
}
export interface RatesAnnexes {
  groups: string[];
  minimumIncome: MinimumIncomeRow[];
  minimumNotes: string[];
  activities: ActivityRate[];
  activityNote: string;
  nameFixes: number;
}
const ws = (s: string) => (s ?? '').replace(/\s+/gu, ' ').trim();
const fixName = (s: string) =>
  ws(s)
    .replaceAll('Произовдство', 'Производство')
    .replace(/началник-\s*клиника/gu, 'началник клиника');
const number = (s: string): number | null => {
  const match = /^\s*(-?\d+(?:[.,]\d+)?)/u.exec(s ?? '');
  return match ? Number(match[1]!.replace(',', '.')) : null;
};
function paragraph(blocks: LawBlock[], prefix: string, after = 0): number {
  const i = blocks.findIndex(
    (b, index) => index >= after && b[0] === 'p' && b[1].startsWith(prefix),
  );
  if (i < 0) throw new Error(`rates: paragraph starting ${prefix} not found`);
  return i;
}
function tableAfter(blocks: LawBlock[], heading: string): string[][] {
  const i = paragraph(blocks, heading);
  for (let j = i + 1; j < Math.min(i + 6, blocks.length); j++) {
    const block = blocks[j]!;
    if (block[0] === 't') return block[1];
  }
  throw new Error(`rates: no table after ${heading}`);
}
function notesAfter(blocks: LawBlock[], heading: string, stop: string): string[] {
  const start = paragraph(blocks, 'Забележки:', paragraph(blocks, heading) + 1);
  const end = paragraph(blocks, stop, start + 1);
  return blocks.slice(start + 1, end).flatMap((b) => (b[0] === 'p' ? [ws(b[1])] : []));
}
const section = (s: string) =>
  ws(s).replace(
    /[АВЕСНКМОРТХ]/gu,
    (c) =>
      (
        ({
          А: 'A',
          В: 'B',
          Е: 'E',
          С: 'C',
          Н: 'H',
          К: 'K',
          М: 'M',
          О: 'O',
          Р: 'P',
          Т: 'T',
          Х: 'X',
        }) as Record<string, string>
      )[c]!,
  );
const sameRow = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

export function transformRatesAnnexes(blocks: LawBlock[]): RatesAnnexes {
  const h1 = 'Приложение № 1 към чл. 9',
    h1a = 'Приложение № 1А към чл. 9';
  const h2 = 'Приложение № 2 към чл. 14',
    h2a = 'Приложение № 2А към чл. 14';
  const a = tableAfter(blocks, h1),
    b = tableAfter(blocks, h1a);
  if (
    !a[0] ||
    !a[1] ||
    !b[0] ||
    !b[1] ||
    a[0].length !== 13 ||
    !sameRow(a[0], b[0]) ||
    !sameRow(a[1], b[1])
  )
    throw new Error('rates: Приложения 1 and 1А have different headers');
  const groups = a[0].slice(4).map(ws);
  let nameFixes = 0;
  if (a.length !== b.length)
    throw new Error('rates: Приложения 1 and 1А row numbering is not 1..n');
  const minimumIncome = a.slice(2).map((row, index): MinimumIncomeRow => {
    const other = b[index + 2]!;
    const name = fixName(row[3]!),
      otherName = fixName(other[3]!);
    nameFixes += Number(name !== ws(row[3]!)) + Number(otherName !== ws(other[3]!));
    const sec = section(row[1]!);
    if (
      !(
        /^(?:[A-V](?:, [A-V])*)?$/u.test(sec) &&
        sec === section(other[1]!) &&
        row[0] === other[0] &&
        ws(row[2]!) === ws(other[2]!) &&
        name === otherName
      )
    )
      throw new Error(`rates: Приложения 1 and 1А are not aligned at row ${row[0]}`);
    if (Number(row[0]) !== index + 1)
      throw new Error('rates: Приложения 1 and 1А row numbering is not 1..n');
    const parse = (cells: string[]) =>
      cells.slice(4).map((cell) => {
        const value = number(cell);
        if (cell && value === null)
          throw new Error(`rates: non-numeric minimum insurable income in row ${row[0]}`);
        return value;
      });
    const until = parse(row),
      from = parse(other);
    if (
      until.length !== groups.length ||
      from.length !== groups.length ||
      until.some((v, i) => (v === null) !== (from[i] === null))
    )
      throw new Error('rates: a minimum-income cell is empty in only one of Приложения 1 and 1А');
    return { no: Number(row[0]), code: ws(row[2]!), name, until, from };
  });
  const notes1 = notesAfter(blocks, h1, h1a),
    notes2 = notesAfter(blocks, h1a, h2);
  const normalized = (notes: string[]) =>
    notes.map((n) => ws(n).toLowerCase().replaceAll('№ ', '№'));
  if (!sameRow(normalized(notes1), normalized(notes2)))
    throw new Error('rates: the notes under Приложения 1 and 1А differ');
  const x = tableAfter(blocks, h2),
    y = tableAfter(blocks, h2a);
  const index = (table: string[][]) => {
    const rows = table.slice(2),
      map = new Map(rows.map((row) => [ws(row[0]!), row]));
    if (map.size !== rows.length) throw new Error('rates: duplicate activity code');
    return map;
  };
  const xa = index(x),
    ya = index(y);
  if (xa.size !== ya.size || [...xa.keys()].some((code) => !ya.has(code)))
    throw new Error('rates: Приложения 2 and 2А do not list the same activity codes');
  const activities = [...xa.keys()].sort().map((code): ActivityRate => {
    const left = xa.get(code)!,
      right = ya.get(code)!;
    const name = fixName(left[1]!),
      other = fixName(right[1]!);
    if (name !== other) throw new Error(`rates: activity ${code} is named differently`);
    nameFixes += Number(name !== ws(left[1]!)) + Number(other !== ws(right[1]!));
    const until = number(left[2]!),
      from = number(right[2]!);
    if (until === null || from === null) throw new Error('rates: a ТЗПБ rate is missing');
    return { code, name, until, from };
  });
  const noteIndex = paragraph(blocks, 'Забележка:', paragraph(blocks, h2));
  const note = blocks[noteIndex + 1];
  if (!note || note[0] !== 'p') throw new Error('rates: activity note missing');
  return {
    groups,
    minimumIncome,
    minimumNotes: notes2,
    activities,
    activityNote: ws(note[1]),
    nameFixes,
  };
}

export interface ContributionRow {
  page: number;
  label: string;
  cells: string[];
}
export interface FundRates {
  doo: number;
  upf: number;
  health: number;
}
export interface ContributionSplit {
  total: FundRates;
  employee: FundRates;
  employer: FundRates;
}
const requiredContributionRows = [
  '1.1.',
  '1.2.',
  '5.1.2.',
  '5.2.2.',
  '10.1.2.',
  '10.2.2.',
] as const;
/** Read the NAP reader's 15-column grid and check each total against both shares. */
export function transformContributionRows(
  rows: Record<string, ContributionRow>,
): Record<string, ContributionSplit> {
  const output: Record<string, ContributionSplit> = {};
  for (const id of requiredContributionRows) {
    const row = rows[id];
    if (!row || row.cells.length !== 15) throw new Error(`rates: missing 15-column NAP row ${id}`);
    const funds = (offset: number): FundRates => ({
      doo: number(row.cells[offset]!) ?? 0,
      upf: number(row.cells[offset + 1]!) ?? 0,
      health: number(row.cells[offset + 2]!) ?? 0,
    });
    const split = { total: funds(4), employee: funds(8), employer: funds(12) };
    for (const fund of ['doo', 'upf', 'health'] as const) {
      if (Math.abs(split.total[fund] - split.employee[fund] - split.employer[fund]) >= 0.0051)
        throw new Error(
          `rates: NAP row ${id}: ${fund} total differs from employee and employer shares`,
        );
    }
    output[id] = split;
  }
  return output;
}

import { metadata } from '../common/metadata.js';
import { roundForPython } from '../common/format.js';
import {
  assumptionRows,
  reconcileRates,
  transformAssumptions,
  transformRatesLaw,
  type RatePeriod,
} from './rates-sources.js';
export interface RatesEvidence {
  doo: LawBlock[];
  nzok: LawBlock[];
  bill: LawBlock[];
  nap: Record<string, ContributionRow>;
}
const round2 = (n: number) => roundForPython(n, 2);
const sumFunds = (v: FundRates) => round2(v.doo + v.upf + v.health);
const periods = (v: RatePeriod) => [
  { id: 'until', from: '2026-01-01', to: '2026-07-31', eur: v.until },
  { id: 'from', from: '2026-08-01', to: '2026-12-31', eur: v.from },
];
function numeric(s: string): number {
  const v = number(s);
  if (v === null) throw new Error(`rates: missing number ${s}`);
  return v;
}
export function buildRates(e: RatesEvidence, buildDate: string) {
  const { nap } = e;
  for (const id of [
    ...requiredContributionRows,
    ...Array.from({ length: 19 }, (_, i) => `${i + 1}.`),
  ])
    if (!nap[id]) throw new Error(`rates: missing NAP row ${id}`);
  const law = transformRatesLaw(e.doo, e.nzok),
    annex = transformRatesAnnexes(e.doo),
    bill = transformAssumptions(e.bill),
    funds = transformContributionRows(nap);
  if (
    annex.minimumIncome.length !== 86 ||
    annex.activities.length !== 87 ||
    annex.groups.length !== 9
  )
    throw new Error('rates: annex sizes differ');
  reconcileRates(nap, funds, law, bill, annex.activities);
  const acts = annex.activities,
    lo = Math.min(...acts.flatMap((a) => [a.until, a.from])),
    hi = Math.max(...acts.flatMap((a) => [a.until, a.from])),
    tz = { min: lo, max: hi, used: lo };
  const max = periods(law.max),
    min = periods(law.minSelf),
    e12 = funds['1.2.']!,
    e11 = funds['1.1.']!,
    s1 = funds['10.1.2.']!,
    s2 = funds['10.2.2.']!,
    tax = numeric(bill['3']!.years['2026']!);
  const split = (row: ContributionSplit) => ({
      employee: { ...row.employee },
      employer: { ...row.employer },
    }),
    without = sumFunds(e12.employer);
  const sameTotals =
    sumFunds(e11.employee) === sumFunds(e12.employee) &&
    sumFunds(e11.employer) === sumFunds(e12.employer);
  const employment = {
    id: 'employment',
    label: 'Трудов договор',
    status: 'real',
    source: ['nap', 'zbdoo', 'zbnzok', 'asbp'],
    basis: `НАП, Приложение № 1, ред 1.2 (с. ${nap['1.2.']!.page}); ЗБДОО чл. 9, 14, 15; ЗБНЗОК чл. 2; АСБП, Приложение № 2, ред 3`,
    appliesTo:
      'Лица на трудов договор, родени след 31.12.1959 г., които се осигуряват и в универсален пенсионен фонд (ред 1.2 от таблицата на НАП). ' +
      (sameTotals
        ? 'За родените преди 1960 г. вноските са разпределени различно по фондове, но общата сума е същата. '
        : '') +
      'Различни са ставките за първа и втора категория труд, за учителите, за държавните служители (от 01.08.2026 г. те внасят част от осигуровките), за военнослужещите и за другите категории от таблицата.',
    employeePct: sumFunds(e12.employee),
    employerPct: round2(without + lo),
    employerPctWithoutTzpb: without,
    incomeTaxPct: tax,
    split: split(e12),
    tzpbPct: tz,
    gvrsPct: law.gvrsPct,
    maxInsurableIncomeEur: max,
    variants: [
      {
        id: 'born-before-1960',
        label: 'Родени преди 1 януари 1960 г.',
        nap: '1.1',
        employeePct: sumFunds(e11.employee),
        employerPctWithoutTzpb: sumFunds(e11.employer),
        split: split(e11),
        note: 'Няма вноска за универсален пенсионен фонд; вноската за ДОО е по-голяма с размера на тази за УПФ.',
      },
    ],
  };
  const management = {
    id: 'management-contract',
    label: 'Договор за управление',
    status: 'real',
    source: ['nap', 'zbdoo', 'zbnzok', 'asbp'],
    basis: `НАП, Приложение № 1, ред 1 и 1.2 (с. ${nap['1.2.']!.page}); ЗБДОО чл. 9, 14, 15; ЗБНЗОК чл. 2`,
    appliesTo:
      'Управители и прокуристи на търговски дружества, членове на съвети на директорите, на управителни и надзорни съвети, контрольори, синдици и ликвидатори, лица по договори за управление на неперсонифицирани дружества и лица, на които е възложено управлението или контролът на държавни и общински предприятия (ред 1 от таблицата на НАП). Ставките са същите като при трудов договор; показани са тези за родените след 31.12.1959 г., осигурени и в УПФ.',
    employeePct: sumFunds(e12.employee),
    employerPct: round2(without + lo),
    employerPctWithoutTzpb: without,
    split: split(e12),
    tzpbPct: tz,
    gvrsPct: law.gvrsPct,
    maxInsurableIncomeEur: max,
    sameRatesAs: 'employment',
    pending: [
      {
        field: 'incomeTaxPct',
        reason:
          'Как се облага доходът по договор за управление не е записано в източниците на проекта, затова данък не се изчислява.',
        expected: 'ЗДДФЛ (действаща редакция) или указания на НАП',
        source: ['nap'],
      },
    ],
  };
  const zero = { doo: 0, upf: 0, health: 0 };
  const self = {
    id: 'self-employed',
    label: 'Самоосигуряващ се',
    status: 'real',
    source: ['nap', 'zbdoo', 'zbnzok'],
    basis: `НАП, Приложение № 1, ред 10.1.2 и 10.2.2 (с. ${nap['10.1.2.']!.page}–${nap['10.2.2.']!.page}); ЗБДОО чл. 9`,
    appliesTo:
      'Еднолични търговци, собственици и съдружници в търговски дружества, лица със свободна професия или занаятчийска дейност по регистрация, регистрирани земеделски стопани и тютюнопроизводители (ред 10 от таблицата на НАП), родени след 31.12.1959 г., осигурени и в УПФ. Вноските са върху избран месечен доход между минималния и максималния осигурителен доход.',
    employeePct: sumFunds(s1.employee),
    employerPct: 0,
    split: { employee: { ...s1.employee }, employer: zero },
    minInsurableIncomeEur: min,
    maxInsurableIncomeEur: max,
    variants: [
      {
        id: 'with-sickness-maternity',
        label: 'Осигурен и за общо заболяване и майчинство',
        nap: '10.2',
        employeePct: sumFunds(s2.employee),
        split: { employee: { ...s2.employee }, employer: zero },
      },
    ],
    pending: [
      {
        field: 'incomeTaxPct',
        reason:
          'Основната ставка е 10%, а за стопанската дейност на едноличните търговци Приложение № 2 към АСБП посочва 15%. Данъчната основа (признати разходи, годишна декларация) не е в източниците на проекта, затова данък не се изчислява.',
        expected:
          'ЗДДФЛ (действаща редакция) и указания на НАП за облагането на самоосигуряващите се лица',
        source: ['asbp'],
      },
    ],
  };
  const pension = {
    id: 'pensioner',
    label: 'Пенсионер',
    status: 'pending',
    source: ['nap'],
    reason:
      'В таблицата на НАП няма ред за пенсионери. Ставките при работа след пенсиониране не са в източниците на проекта и не се предполагат.',
    expected:
      'Официален текст на КСО, ЗЗО и ЗДДФЛ или разяснение на НАП за осигуряването на работещите пенсионери',
  };
  const pairs = annex.minimumIncome.flatMap((r) => r.until.map((v, i) => [v, r.from[i]!] as const)),
    filled = pairs.filter((v): v is readonly [number, number] => v[0] !== null && v[1] !== null);
  if (pairs.some(([a, b]) => (a === null) !== (b === null)) || !filled.length)
    throw new Error('rates: inconsistent minimum income cells');
  const minBlock = {
    unit: 'евро на месец',
    groups: annex.groups,
    rows: annex.minimumIncome,
    selfEmployedEur: min,
    notes: annex.minimumNotes,
    cells: pairs.length,
    emptyCells: pairs.length - filled.length,
    basis:
      'ЗБДОО, Приложение № 1 (до 31.07.2026 г.) и Приложение № 1А (от 01.08.2026 г.) към чл. 9',
    source: ['zbdoo'],
  };
  const minStats = {
    cells: pairs.length,
    filled: filled.length,
    changed: filled.filter(([a, b]) => a !== b).length,
    untilMin: Math.min(...filled.map((p) => p[0])),
    untilMax: Math.max(...filled.map((p) => p[0])),
    fromMin: Math.min(...filled.map((p) => p[1])),
    fromMax: Math.max(...filled.map((p) => p[1])),
  };
  const change = (
    id: string,
    label: string,
    unit: string,
    a: number,
    b: number,
    basis: string,
    source: string[],
  ) => ({
    id,
    label,
    unit,
    until: a,
    from: b,
    delta: round2(b - a),
    ...(a ? { deltaPct: roundForPython((100 * (b - a)) / a, 2) } : {}),
    basis,
    source,
  });
  const changed = acts.filter((a) => a.until !== a.from).map((a) => a.code),
    civilBasis = `НАП, Приложение № 1, ред 5.1.2 и 5.2.2 (с. ${nap['5.1.2.']!.page})`;
  const changes = [
    change(
      'max-insurable',
      'Максимален месечен размер на осигурителния доход',
      'евро',
      law.max.until,
      law.max.from,
      'ЗБДОО чл. 9, т. 1 и т. 2',
      ['zbdoo'],
    ),
    change(
      'min-self-employed',
      'Минимален месечен размер на осигурителния доход на самоосигуряващите се лица',
      'евро',
      law.minSelf.until,
      law.minSelf.from,
      'ЗБДОО чл. 9, т. 1 и т. 2',
      ['zbdoo'],
    ),
    {
      id: 'min-income-by-activity',
      label: 'Минимален осигурителен доход по икономически дейности и групи професии',
      unit: 'евро',
      ...minStats,
      basis: 'ЗБДОО, Приложения № 1 и № 1А към чл. 9',
      source: ['zbdoo'],
    },
    {
      id: 'tzpb-by-activity',
      label: 'Вноска за фонд „Трудова злополука и професионална болест“ по икономически дейности',
      unit: '%',
      activities: acts.length,
      changed: changed.length,
      changedCodes: changed,
      basis: 'ЗБДОО, Приложения № 2 и № 2А към чл. 14',
      source: ['zbdoo'],
    },
    change(
      'civil-servant-employee-share',
      'Част от осигуровките, внасяна от самия държавен служител (категория 5 в таблицата на НАП)',
      '% от осигурителния доход',
      sumFunds(funds['5.1.2.']!.employee),
      sumFunds(funds['5.2.2.']!.employee),
      civilBasis,
      ['nap'],
    ),
    change(
      'civil-servant-employer-share',
      'Част от осигуровките, внасяна от работодателя за държавен служител (категория 5)',
      '% от осигурителния доход',
      sumFunds(funds['5.1.2.']!.employer),
      sumFunds(funds['5.2.2.']!.employer),
      civilBasis,
      ['nap'],
    ),
  ];
  const years = ['2025', '2026', '2027', '2028'];
  const incomeTax = {
    ratePct: tax,
    years: Object.fromEntries(years.map((y) => [y, number(bill['3']!.years[y]!)])),
    soleTraderBusinessPct: Object.fromEntries(
      years.map((y) => [y, number(bill['3']!.sub[0]!.years[y]!)]),
    ),
    basis: 'АСБП, Приложение № 2 „Основни допускания“, ред 3',
    source: ['asbp'],
    note: 'Основната ставка е 10%. Приложението посочва отделно 15% за доходите от стопанска дейност на едноличните търговци; тази ставка не се използва в калкулатора.',
  };
  const categories = Array.from({ length: 19 }, (_, i) => {
    const no = i + 1,
      r = nap[`${no}.`]!,
      s = r.label.replace(/:+$/u, '').trim(),
      chars = Array.from(s),
      prefix = chars.slice(0, 150).join(''),
      lastSpace = prefix.lastIndexOf(' '),
      label =
        chars.length <= 150
          ? s
          : (lastSpace < 0 ? prefix : prefix.slice(0, lastSpace)).replace(/[,;]+$/u, '') + '…';
    return {
      no,
      label,
      page: r.page,
      modelledBy:
        no === 1 ? ['employment', 'management-contract'] : no === 10 ? ['self-employed'] : [],
    };
  });
  const notes = [
    `Таблицата на НАП има 19 категории осигурени лица и ${Object.keys(nap).length} номерирани реда. Моделирани са категория 1 (трудов договор и договор за управление) и категория 10 (самоосигуряващи се); останалите са изброени в „napCategories“ и не се изчисляват.`,
    `Вноската за фонд „Трудова злополука и професионална болест“ зависи от икономическата дейност на работодателя (от ${String(lo).replace('.', ',')} до ${String(hi).replace('.', ',')}%); по подразбиране се използва най-ниската.`,
    'Ставките са сверени автоматично: сборът по фондове от таблицата на НАП съвпада с Приложение № 2 към АСБП (общо и между осигурител и осигурено лице), а границите на осигурителния доход съвпадат със ЗБДОО и с Приложение № 2.',
    'Данъкът върху дохода се изчислява само за трудов договор. За договор за управление и за самоосигуряващите се данъчната основа не е в източниците на проекта, затова данъкът е отбелязан като предстоящ.',
    'За 2027 и 2028 г. Приложение № 2 запазва максимален осигурителен доход 2 300 евро; минималният доход на самоосигуряващите се е „на равнището на МРЗ, съгласно нов механизъм“ и размерът му още не е определен.',
    `В двойките приложения към ЗБДОО (1 и 1А, 2 и 2А) имената на някои дейности са изписани различно; ${annex.nameFixes} правописни разлики са уеднаквени, без да се променя смисълът.`,
    `${minBlock.emptyCells} от ${minBlock.cells} клетки в Приложения № 1 и № 1А са празни в текста на закона; в данните те са null (няма стойност).`,
  ];
  return {
    meta: metadata('D17', 'Данъци и осигуровки: ставки за 2026 г.', buildDate, {
      status: 'real',
      source: ['nap', 'zbdoo', 'zbnzok', 'asbp'],
      sourceNote:
        'Ставките и разпределението им са от таблицата на НАП (изх. ВК-30-10237 от 12.08.2026 г.), сверени със ЗБДОО и ЗБНЗОК за 2026 г. и с Приложение № 2 към АСБП. Сценарият „Пенсионер“ и данъкът при самоосигуряване и договор за управление предстоят.',
      asOf: '2026-08-12',
      unit: '%',
      extra: { pending: [] },
    }),
    scenarios: [employment, management, self, pension],
    rules: { validTo: '2026-07-31', from: '2026-08-01', year: 2026 },
    incomeTax,
    tzpb: {
      unit: '% от осигурителния доход',
      ...tz,
      usedWhy:
        'Ставката зависи от икономическата дейност на работодателя; калкулаторът използва най-ниската.',
      activities: acts,
      changed: changed.length,
      note: annex.activityNote,
      basis:
        'ЗБДОО, Приложение № 2 (до 31.07.2026 г.) и Приложение № 2А (от 01.08.2026 г.) към чл. 14',
      source: ['zbdoo'],
    },
    minInsurableIncome: minBlock,
    changes,
    napCategories: categories,
    assumptions: assumptionRows.map((n) => bill[n]!),
    quotes: law.quotes,
    notes,
    checks: {
      napRowsAddUp: true,
      napTotalsVsBill: true,
      napSplitVsBill: true,
      limitsVsLawAndBill: true,
      tzpbRangeVsBill: true,
      annexesAligned: true,
      annexRows: annex.minimumIncome.length,
      activities: acts.length,
      nameFixes: annex.nameFixes,
    },
  };
}
export type RatesResult = ReturnType<typeof buildRates>;
