import type { Json } from '@sigma-budget/dataset-schema';
import { metadata } from '../common/metadata.js';
import { formatNumber, pythonRound } from '../common/format.js';
import { isNumber } from '../io/data.js';

type PageRef = number | string;
interface Quotation {
  quote: string;
  page: PageRef;
}
interface IntroItem extends Quotation {
  name: string;
  what: string;
  stated: number | null;
  signed_2026: number;
  flag?: string;
  see?: string;
}
interface TableRow {
  label: string;
  values: (number | null)[];
  short?: string;
  text_quote?: string;
  what: string;
  text_page: PageRef;
  row_page: number;
}
interface MeasureTable {
  rows: TableRow[];
  sum_check: number[];
  text: { quote: string }[];
}
export interface MeasureSource {
  document: string;
  url: string;
  bill_page: string;
  sha256: string;
  adopted: Json;
  intro: {
    revenue: IntroItem[];
    expenditure: IntroItem[];
    revenue_no_estimate: IntroItem[];
    expenditure_no_estimate: IntroItem[];
    gambling_context: Quotation;
    revenue_heading: string;
    revenue_heading_page: number;
    expenditure_heading: string;
    expenditure_heading_page: number;
    tax_changes_heading: string;
    tax_changes_page: number;
    sign_note: string;
  };
  esa: {
    tables: Record<string, MeasureTable>;
    basis: string;
    gdp_share_2026: { revenue: number; expenditure: number };
  };
  part8: { section: string; pages: string; items: IntroItem[] };
}
interface Evidence {
  quote: string;
  page: { docx: number; to?: number };
  source: string;
}
export type MeasureExcerpts = Record<
  string,
  { excerptEvidence: Record<string, Evidence>; [key: string]: Json | Record<string, Evidence> }
>;
interface MeasureItem {
  id: string;
  tab: string;
  kind: string;
  name: string;
  text: string;
  hasEstimate: boolean;
  quote: string;
  page: { docx: number; to?: number };
  stage: string;
  effectMln?: Record<string, number>;
  balanceEffectMln?: Record<string, number>;
  estimateKind?: string;
  from?: string;
  context?: { quote: string; page: { docx: number; to?: number } };
  table?: string;
  label?: string;
  basis?: string;
  tablePage?: number;
  related?: string[];
  [key: string]: unknown;
}
const years = [2026, 2027, 2028];
const pairs = [
  ['kr1', 'd8-5'],
  ['kr2', 'd8-6'],
  ['kr3', 'd8-7'],
  ['kr7', 'd8-3'],
  ['kx2', 'd9-2'],
  ['kx3', 'd9-6'],
  ['kx5', 'd9-5'],
];
const months: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};
const ws = (s: string) => s.replace(/\s+/gu, ' ').trim();
const round = (v: number) => pythonRound(v, 1);
function date(s: string): string | undefined {
  const numeric = /считано от (\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  const words =
    /считано от (\d{1,2}) (януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември) (\d{4})/.exec(
      s,
    );
  const m = numeric ?? words;
  return m
    ? `${m[3]}-${String(numeric ? Number(m[2]) : months[m[2]!]!).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
    : undefined;
}
function page(p: PageRef): { docx: number; to?: number } {
  const [a, b] = String(p).replace('-', '–').split('–');
  if (!/^\d+$/.test(a!) || (b && !/^\d+$/.test(b))) throw new Error(`Invalid page ${p}`);
  return { docx: Number(a), ...(b ? { to: Number(b) } : {}) };
}
function samePage(
  a: { docx: number; to?: number } | undefined,
  b: { docx: number; to?: number },
): boolean {
  return !!a && a.docx === b.docx && a.to === b.to;
}
function quote(s: Quotation, inferDate = true) {
  const from = inferDate ? date(s.quote) : undefined;
  return { quote: ws(s.quote), page: page(s.page), stage: 'bill', ...(from ? { from } : {}) };
}

/** Build the 2026 budget-measure dataset from extracted, authored source evidence. */
export function buildMeasures(
  m: MeasureSource,
  excerpts: MeasureExcerpts,
  buildDate: string,
): Record<string, Json> {
  const { intro, esa, part8 } = m,
    items: MeasureItem[] = [];
  const add = (item: MeasureItem) => {
    if (items.some((x) => x.id === item.id)) throw new Error(`duplicate measure id ${item.id}`);
    items.push(item);
  };
  for (const [kind, key, prefix] of [
    ['revenue', 'revenue', 'kr'],
    ['expenditure', 'expenditure', 'kx'],
  ] as const) {
    intro[key].forEach((s, i) => {
      if (
        !isNumber(s.signed_2026) ||
        !isNumber(s.stated) ||
        Math.abs(Math.abs(s.signed_2026) - s.stated) > 1e-9
      )
        throw new Error(`signed amount differs: ${s.name}`);
      if (s.signed_2026 > 0 !== (kind === 'revenue'))
        throw new Error(`sign contradicts list: ${s.name}`);
      if (s.flag && !['indicative_avoided', 'indicative'].includes(s.flag))
        throw new Error(`unknown flag ${s.flag}`);
      add({
        id: `${prefix}${i + 1}`,
        tab: 'short',
        kind,
        name: ws(s.name),
        text: ws(s.what),
        effectMln: { '2026': s.signed_2026 },
        hasEstimate: true,
        estimateKind:
          s.flag === 'indicative_avoided'
            ? 'avoided'
            : s.flag === 'indicative'
              ? 'indicative'
              : 'stated',
        ...quote(s),
      });
    });
  }
  const gam = items.find((x) => x.id === 'kr7');
  if (!gam || gam.name !== 'Хазарт') throw new Error('kr7 is not the gambling measure');
  gam.context = {
    quote: ws(intro.gambling_context.quote),
    page: page(intro.gambling_context.page),
  };
  const see: Record<string, string> = {};
  let n = 0;
  for (const [kind, key] of [
    ['revenue', 'revenue_no_estimate'],
    ['expenditure', 'expenditure_no_estimate'],
  ] as const) {
    for (const s of intro[key]) {
      if (s.stated !== null) throw new Error(`measure has an amount: ${s.name}`);
      const id = `kn${++n}`;
      if (s.see) see[id] = s.see;
      add({
        id,
        tab: 'short',
        kind,
        name: ws(s.name),
        text: ws(s.what),
        hasEstimate: false,
        ...quote(s),
      });
    }
  }
  const check: Record<string, number> = {},
    rowSums: Record<string, number[]> = {},
    printed: Record<string, number[]> = {},
    period: Record<string, number> = {};
  for (const [name, kind, prefix] of [
    ['II-8', 'revenue', 'd8'],
    ['II-9', 'expenditure', 'd9'],
  ] as const) {
    const t = esa.tables[name]!;
    const rows = t.rows.filter((r) => !r.label.startsWith('Общо'));
    const total = t.rows.find((r) => r.label.startsWith('Общо'));
    if (!total || total.values.length !== 3 || !total.values.every(isNumber))
      throw new Error(`${name}: missing total`);
    const sums = years.map((_, k) => round(rows.reduce((a, r) => a + (r.values[k] ?? 0), 0)));
    if (
      sums.some((v, i) => Math.abs(v - total.values[i]!) > 0.15) ||
      sums.some((v, i) => v !== t.sum_check[i])
    )
      throw new Error(`${name}: row sums differ`);
    rowSums[name] = sums;
    printed[name] = total.values as number[];
    check[name] = total.values[0]!;
    const p = /(?:в размер на|с) (\d[\d\s ]*,\d) млн\. евро за периода/.exec(
      t.text.map((x) => x.quote).join(' '),
    );
    if (!p) throw new Error(`${name}: missing narrative total`);
    period[name] = Number(p[1]!.replace(/[\s ]/gu, '').replace(',', '.'));
    if (Math.abs(period[name]! - printed[name]!.reduce((a, b) => a + b, 0)) > 0.15)
      throw new Error(`${name}: narrative total differs`);
    rows.forEach((r, i) => {
      if (!r.short || !r.text_quote) throw new Error(`${name} row ${i + 1} lacks evidence`);
      const effect: Record<string, number> = {};
      years.forEach((y, k) => {
        const v = r.values[k];
        if (v !== null && v !== undefined) {
          if (!isNumber(v)) throw new Error('non-numeric amount');
          effect[y] = v;
        }
      });
      if (!Object.keys(effect).length) throw new Error('measure without amount');
      add({
        id: `${prefix}-${i + 1}`,
        tab: 'discretionary',
        kind,
        table: name,
        name: ws(r.short),
        text: ws(r.what),
        label: ws(r.label),
        effectMln: effect,
        hasEstimate: true,
        basis: 'accrual',
        ...quote({ quote: r.text_quote, page: r.text_page }),
        tablePage: r.row_page,
      });
    });
  }
  part8.items.forEach((s, i) =>
    add({
      id: `p8-${i + 1}`,
      tab: 'laws',
      kind: 'law',
      name: ws(s.name),
      text: ws(s.what),
      hasEstimate: false,
      // Part VIII preserves the legal quotation without inferring a date.
      ...quote(s, false),
    }),
  );
  const byid = Object.fromEntries(items.map((x) => [x.id, x]));
  const related: Record<string, string[]> = Object.fromEntries(items.map((x) => [x.id, []]));
  for (const it of items)
    if (it.effectMln)
      it.balanceEffectMln = Object.fromEntries(
        Object.entries(it.effectMln).map(([y, v]) => [
          y,
          round((it.kind === 'revenue' ? 1 : -1) * v),
        ]),
      );
  for (const [a, b] of pairs) {
    const va = byid[a!]!.effectMln!['2026']!,
      vb = byid[b!]!.effectMln!['2026']!;
    if (Math.abs(Math.abs(va) - Math.abs(vb)) > 1e-9)
      throw new Error(`related amounts differ: ${a}, ${b}`);
    related[a!]!.push(b!);
    related[b!]!.push(a!);
  }
  for (const [id, ref] of Object.entries(see)) {
    const [table, num] = ref.split(':');
    const target = `${table === 'II-8' ? 'd8' : table === 'II-9' ? 'd9' : 'invalid'}-${num}`;
    if (!byid[target]) throw new Error(`invalid reference ${ref}`);
    related[id]!.push(target);
    related[target]!.push(id);
  }
  for (const it of items)
    if (related[it.id]!.length) it.related = [...new Set(related[it.id])].sort();
  for (const [id, fields] of Object.entries(excerpts)) {
    const it = byid[id];
    if (!it) throw new Error(`unknown excerpt ${id}`);
    for (const [field, e] of Object.entries(fields.excerptEvidence)) {
      const candidates = [
        [it.quote, it.page],
        [it.context?.quote, it.context?.page],
      ] as const;
      if (!candidates.some(([q, p]) => q?.includes(e.quote) && samePage(p, e.page)))
        throw new Error(`unverified measure excerpt: ${id}:${field}`);
      if (field !== 'since' && fields[field] !== e.quote) throw new Error(`excerpt differs: ${id}`);
      if (field === 'since' && fields[field] !== it.from)
        throw new Error(`effective date differs: ${id}`);
    }
    Object.assign(it, fields);
  }
  const rev = items.filter((x) => x.tab === 'short' && x.kind === 'revenue' && x.hasEstimate),
    exp = items.filter((x) => x.tab === 'short' && x.kind === 'expenditure' && x.hasEstimate);
  const sum = (xs: MeasureItem[]) => round(xs.reduce((a, x) => a + x.effectMln!['2026']!, 0));
  const rt = sum(rev),
    et = sum(exp),
    ew = sum(exp.filter((x) => x.estimateKind === 'stated'));
  if (rt !== 745 || et !== -1710.5 || ew !== -1060.8)
    throw new Error('introduction totals changed');
  const ne = items.filter((x) => x.tab === 'short' && !x.hasEstimate),
    ind = exp.filter((x) => x.estimateKind !== 'stated');
  if (ind.length !== 2) throw new Error('expected two indicative measures');
  const groups = [
    {
      id: 'short-revenue',
      tab: 'short',
      kind: 'revenue',
      title: ws(intro.revenue_heading),
      page: intro.revenue_heading_page,
      items: rev.map((x) => x.id),
      totalMln: rt,
    },
    {
      id: 'short-expenditure',
      tab: 'short',
      kind: 'expenditure',
      title: ws(intro.expenditure_heading),
      page: intro.expenditure_heading_page,
      items: exp.map((x) => x.id),
      totalMln: et,
      totalMlnWithoutIndicative: ew,
    },
    {
      id: 'short-revenue-noestimate',
      tab: 'short',
      kind: 'revenue',
      title: ws(intro.tax_changes_heading),
      page: intro.tax_changes_page,
      items: ne.filter((x) => x.kind === 'revenue').map((x) => x.id),
    },
    {
      id: 'short-expenditure-noestimate',
      tab: 'short',
      kind: 'expenditure',
      title: 'Разходни мерки без посочена сума',
      page: ne.at(-1)!.page.docx,
      items: ne.filter((x) => x.kind === 'expenditure').map((x) => x.id),
    },
  ];
  const notes = [
    {
      id: 'stage',
      text: 'Мерките са по законопроекта, внесен на 01.07.2026 г. Законът е приет на 24.07.2026 г. и обнародван в ДВ, бр. 69 от 31.07.2026 г.; приетият текст може да се различава и не е проверен мярка по мярка.',
    },
    {
      id: 'sign',
      text: 'Сумите в текста на мотивите са без знак. Тук приходните мерки са със знак плюс, а намаленията на разходите (спестяванията) – със знак минус. Ефектът върху бюджетното салдо е със знак плюс, когато го подобрява (повече приходи или по-малко разходи).',
    },
    {
      id: 'indicative',
      text: `Две от разходните мерки в списъка са индикативни: ${ind.map((x) => `„${x.name}“`).join(' и ')}. Без тях разходните мерки са ${formatNumber(ew, 1)} млн. €, а заедно с тях са ${formatNumber(et, 1)} млн. €.`,
    },
    {
      id: 'basis',
      text: `Табл. II-8 и II-9 са на начислена основа (ЕСС), сектор „Държавно управление“, като изменение спрямо предходната година; затова сумите не съвпадат с краткия списък в увода, който е на други основания. Сборът на редовете от II-8 за 2028 г. е ${formatNumber(rowSums['II-8']![2], 1)}, а отпечатаният общ ред е ${formatNumber(printed['II-8']![2], 1)} (закръгляване).`,
    },
  ];
  const result = {
    meta: metadata('D12', 'Мерки в бюджета за 2026 г.', buildDate, {
      source: ['asbp', 'bill'],
      sourceNote:
        'Мотиви към законопроекта (внесен на 01.07.2026 г.): въведение, Табл. II-8, Табл. II-9 и Част VIII; страниците са по номерацията на документа',
      asOf: '2026-07-01',
      unit: 'млн. €',
    }),
    document: {
      title: m.document,
      url: m.url,
      billPage: m.bill_page,
      sha256: m.sha256,
      pagesNote:
        'Номерата на страниците са тези на документа (.docx) с мотивите към законопроекта, както са отпечатани в долния колонтитул.',
      adopted: m.adopted,
    },
    tabs: ['short', 'discretionary', 'laws'],
    tabLabels: {
      short: 'Краткосрочни мерки',
      discretionary: 'Дискреционни мерки',
      laws: 'Промени в други закони',
    },
    tabNotes: {
      short: intro.sign_note,
      discretionary: `Табл. II-8 и II-9, ${esa.basis}.`,
      laws: `${part8.section} (страници ${part8.pages}).`,
    },
    stageLabels: { bill: 'В законопроекта; по приетия закон не е проверено' },
    estimateKinds: {
      stated: 'Посочена сума',
      indicative: 'Индикативна сума',
      avoided: 'Индикативна сума на избегнат разход',
    },
    totals: {
      revenueMln: rt,
      expenditureMln: et,
      expenditureMlnWithoutIndicative: ew,
      discretionary2026: { 'II-8': printed['II-8']![0], 'II-9': printed['II-9']![0] },
      discretionary: Object.fromEntries(
        ['II-8', 'II-9'].map((t) => [
          t,
          Object.fromEntries(years.map((y, i) => [y, printed[t]![i]])),
        ]),
      ),
      discretionaryPeriod: period,
      gdpShare2026: esa.gdp_share_2026,
      basis: 'начислена основа за II-8/II-9',
    },
    counts: {
      short: {
        revenue: rev.length,
        expenditure: exp.length,
        noEstimate: ne.length,
        all: rev.length + exp.length + ne.length,
      },
      discretionary: {
        revenue: items.filter((x) => x.tab === 'discretionary' && x.kind === 'revenue').length,
        expenditure: items.filter((x) => x.tab === 'discretionary' && x.kind === 'expenditure')
          .length,
      },
      laws: items.filter((x) => x.tab === 'laws').length,
      all: items.length,
    },
    groups,
    items,
    check: { 'II-8': check['II-8'], 'II-9': check['II-9'], rowSums },
    notes,
  };
  return result as unknown as Record<string, Json>;
}
