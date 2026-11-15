import {
  formatDate,
  formatEuro,
  formatMoney,
  formatNumber,
  formatPercent,
  monthName,
  pythonRound,
} from '../common/format.js';
import { isIsoDay } from '../common/dates.js';
import { metadata } from '../common/metadata.js';
import { jsonstatSeries, type JsonStat } from '../io/data.js';
import { buildRss, DEFAULT_RSS_ORIGIN, type RssEvent } from './aggregation-rss.js';
import { aggregationInt } from './aggregation-core.js';

export interface FeedEvent extends RssEvent {
  dateKind: string;
  status: string;
  source: string[];
  dateTo?: string;
  planBasis?: PlanBasis;
}
export interface PlanBasis {
  periodKey: string;
  basis: string;
  source: string[];
  citation: string;
}
interface ExecutionRow {
  cum: number;
  prevYearCum: number;
  pctPlan: number;
  yoyPct: number;
}
interface Monthly {
  months: number;
  asOf: string[];
  kfp: Record<string, number[]>;
}
interface Execution {
  data: Record<string, Monthly>;
  latest: { month: number; asOf: string; kfp: Record<string, ExecutionRow> };
  pendingMonths: { id: string; month: number; asOf: string }[];
  plan2026: { periodKey: string; basis: string; source: string[] };
}
interface Law {
  timeline: {
    phase?: string;
    date: string;
    dateTo?: string;
    kind: string;
    title: string;
    detail?: string;
    source?: string[];
  }[];
  next: { title: string; status: string; note: string; expected: string };
}
interface Rates {
  meta: { asOf: string };
  changes: { id: string; from: number; until: number; changed: number; filled: number }[];
  napCategories: unknown[];
}
interface DebtValue {
  year: number;
  mln: number;
  pctGdp: number;
  asOf: string;
  quarter: { id: string; mln: number; pctGdp: number; asOf: string };
}
interface Expenditure {
  cofog: { years: number[]; total: { mln: number[]; pctGdp: number[] } };
}
interface Population {
  latest: { date: string; persons: number };
  years: (number | string)[];
  persons: (number | string)[];
}
export interface FeedInput {
  buildDate: string;
  execution: Execution;
  law: Law;
  rates: Rates;
  debt: { latest: { maastricht: DebtValue } };
  expenditure: Expenditure;
  sebra: {
    publication: { files: { listedOn: string; day: string }[] };
    overall: { count: number; eur: number };
  };
  budget2027: { publication: string };
  annualUpdated: string;
  quarterUpdated: string;
  cofogUpdated: string;
  population: Population;
  populationStat: JsonStat;
  populationAsOf: string;
  pending: Record<string, { reason: string | null; expected: string }>;
  baseUrl?: string;
  /** Site identity from the editorial input metadata, including historical replays. */
  siteName: string;
}
const KINDS = [
  { id: 'report', label: 'Месечен отчет' },
  { id: 'law', label: 'Законодателен път' },
  { id: 'plenary', label: 'Гласуване в залата' },
  { id: 'rates', label: 'Данъци и осигуровки' },
  { id: 'eurostat', label: 'Евростат' },
  { id: 'data', label: 'Нови данни' },
];
const DATE_KINDS = {
  occurred: 'Дата на събитието',
  asOf: 'Данни към',
  published: 'Публикувано на',
  effective: 'В сила от',
};
const SOURCE_ORDER = [
  'kfp',
  'budget2027',
  'parliament',
  'zdb',
  'zbdoo',
  'zbnzok',
  'nap',
  'eurostat',
  'sebra',
];
const more = (v: number) => `с ${formatPercent(Math.abs(v))} ${v >= 0 ? 'повече' : 'по-малко'}`;
const planBasis = (ex: Execution): PlanBasis => ({
  periodKey: ex.plan2026.periodKey,
  basis: ex.plan2026.basis,
  source: [...ex.plan2026.source],
  citation: 'Програма по ЗДБРБ 2026, МФ, приложение 1',
});

export function buildFeed(input: FeedInput) {
  for (const key of [
    'execution',
    'law',
    'rates',
    'debt',
    'expenditure',
    'sebra',
    'budget2027',
  ] as const)
    if (!input[key]) throw new Error(`feed needs ${key} built first`);
  const ex = input.execution,
    basis = planBasis(ex),
    d26 = ex.data['2026']!,
    d25 = ex.data['2025']!,
    n = aggregationInt(d26.months);
  const events: FeedEvent[] = [];
  for (let m = 1; m <= n; m++) {
    const rev = d26.kfp.rev![m - 1]!,
      exp = d26.kfp['exp.total']![m - 1]!,
      bal = d26.kfp.balance![m - 1]!,
      prev = d25.kfp.rev![m - 1]!;
    if (prev === 0) throw new Error('division by zero');
    const yoy = pythonRound(100 * (rev / prev - 1), 1),
      word = bal < 0 ? 'дефицитът' : 'излишъкът';
    let text = `От началото на годината приходите са ${formatMoney(rev)}, разходите — ${formatMoney(exp)}, ${word} е ${formatMoney(Math.abs(bal))}. Приходите са ${more(yoy)} от същия период на 2025 г.`;
    if (m === n) {
      const lat = ex.latest.kfp.rev!;
      if (Math.abs(lat.yoyPct - yoy) > 0.05) throw new Error('feed: YoY differs');
      text += ` Това е ${formatPercent(lat.pctPlan)} от годишния план за приходите. ${basis.citation}.`;
    }
    events.push({
      id: `kfp-2026-${String(m).padStart(2, '0')}`,
      date: d26.asOf[m - 1]!,
      dateKind: 'asOf',
      kind: 'report',
      title: `Месечен отчет на КФП към края на ${monthName(m)} 2026 г.`,
      text,
      href: `#/izpalnenie?mesec=${m}`,
      status: 'real',
      source: ['kfp', ...(m === n ? basis.source : [])],
      ...(m === n ? { planBasis: basis } : {}),
    });
  }
  const seen = new Map<string, number>();
  let laws = 0;
  for (const e of input.law.timeline) {
    if (e.phase !== 'parliament') continue;
    laws++;
    const base = `law-${e.date}-${e.kind}`,
      count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    events.push({
      id: count === 1 ? base : `${base}-${count}`,
      date: e.date,
      dateKind: 'occurred',
      ...(e.dateTo ? { dateTo: e.dateTo } : {}),
      kind: ['plenary-1', 'plenary-2', 'adopted'].includes(e.kind) ? 'plenary' : 'law',
      title: e.title,
      ...(e.detail ? { text: e.detail } : {}),
      href: '#/zakon',
      status: 'real',
      source: e.source?.length ? [...e.source] : ['parliament'],
    });
  }
  if (laws !== 11) throw new Error(`feed: expected 11 parliament events, found ${laws}`);
  const rates = input.rates,
    ch = Object.fromEntries(rates.changes.map((c) => [c.id, c])),
    mx = ch['max-insurable']!,
    mn = ch['min-self-employed']!,
    emp = ch['civil-servant-employee-share']!,
    employer = ch['civil-servant-employer-share']!,
    mi = ch['min-income-by-activity']!;
  const cells =
    mi.changed === mi.filled
      ? `във всички ${mi.filled} попълнени клетки`
      : `в ${mi.changed} от ${mi.filled} попълнени клетки`;
  events.push({
    id: 'rates-2026-08-01',
    date: '2026-08-01',
    dateKind: 'effective',
    kind: 'rates',
    title: 'Нови граници на осигурителния доход от 1 август',
    text: `Максималният месечен осигурителен доход става ${formatEuro(mx.from, 0)} (дотогава ${formatEuro(mx.until, 2)}). Минималният за самоосигуряващите се е ${formatEuro(mn.from, 2)} (дотогава ${formatEuro(mn.until, 2)}). Минималният доход по икономически дейности и групи професии се променя ${cells} на таблицата.`,
    href: '#/danaci',
    status: 'real',
    source: ['zbdoo'],
  });
  events.push({
    id: 'rates-2026-08-12',
    date: rates.meta.asOf,
    dateKind: 'published',
    kind: 'rates',
    title: 'НАП публикува таблицата с осигурителните ставки',
    text: `Писмо ВК-30-10237 от ${formatDate(rates.meta.asOf, true)} г. подрежда осигурителните ставки в ${rates.napCategories.length} категории осигурени лица. За държавните служители (категория 5) от 1 август ${formatPercent(emp.from)} от осигурителния доход се внася от самия служител (дотогава ${formatPercent(emp.until)}), а работодателят внася ${formatPercent(employer.from)} вместо ${formatPercent(employer.until)}.`,
    href: '#/danaci',
    status: 'real',
    source: ['nap'],
  });
  const mst = input.debt.latest.maastricht,
    q = mst.quarter,
    annual = input.annualUpdated.slice(0, 10),
    quarter = input.quarterUpdated.slice(0, 10),
    cofog = input.cofogUpdated.slice(0, 10);
  if (mst.asOf !== annual || q.asOf !== quarter)
    throw new Error('feed: debt latest differs from Eurostat dates');
  const pop = input.population,
    year = aggregationInt(pop.latest.date.slice(0, 4));
  if (
    year !== 2026 ||
    typeof pop.latest.persons !== 'number' ||
    !Number.isFinite(pop.latest.persons) ||
    aggregationInt(pop.years.at(-1)) !== year ||
    pop.persons.at(-1) !== pop.latest.persons
  )
    throw new Error('population latest differs from series');
  const stat = jsonstatSeries(input.populationStat, 'time', { geo: 'BG' });
  for (let i = 0; i < Math.min(pop.years.length, pop.persons.length); i++) {
    const v = stat[String(pop.years[i])];
    if (v && aggregationInt(v[0]) !== aggregationInt(pop.persons[i]))
      throw new Error('feed: population disagreement');
  }
  const [qy, qn] = q.id.split('-Q'),
    ordinal = ['', 'първото', 'второто', 'третото', 'четвъртото'][Number(qn)];
  if (!ordinal) throw new Error('Invalid quarter');
  const cy = input.expenditure.cofog.years.at(-1)!;
  events.push({
    id: 'eurostat-gov_10dd_edpt1-' + annual,
    date: annual,
    dateKind: 'published',
    kind: 'eurostat',
    title: `Евростат: дългът на държавното управление за ${mst.year} г.`,
    text: `Дългът по Маастрихт е ${formatMoney(mst.mln)} (${formatPercent(mst.pctGdp)} от БВП). Това е друг обхват от държавния дълг в закона.`,
    href: `#/dalg?obhvat=maastricht&per=${mst.year}.report&to=s17-b-maastricht`,
    status: 'real',
    source: ['eurostat'],
  });
  events.push({
    id: 'eurostat-gov_10q_ggdebt-' + quarter,
    date: quarter,
    dateKind: 'published',
    kind: 'eurostat',
    title: `Евростат: дългът в края на ${ordinal} тримесечие на ${qy} г.`,
    text: `Дългът по Маастрихт е ${formatMoney(q.mln)} (${formatPercent(q.pctGdp)} от БВП); данните са предварителни.`,
    href: `#/dalg?obhvat=maastricht&per=${mst.year}.report&to=s17-b-quarterly`,
    status: 'real',
    source: ['eurostat'],
  });
  events.push({
    id: 'eurostat-gov_10a_exp-' + cofog,
    date: cofog,
    dateKind: 'published',
    kind: 'eurostat',
    title: `Евростат: разходите по функции (COFOG) са допълнени до ${cy} г.`,
    text: `Разходите на сектор „Държавно управление“ за ${cy} г. са ${formatMoney(input.expenditure.cofog.total.mln.at(-1))} (${formatPercent(input.expenditure.cofog.total.pctGdp.at(-1))} от БВП). Разрезът по функции на Евростат не съвпада с функциите на КФП.`,
    href: `#/razhodi?per=${cy}.report`,
    status: 'real',
    source: ['eurostat'],
  });
  events.push({
    id: 'eurostat-tps00001-' + input.populationAsOf,
    date: input.populationAsOf,
    dateKind: 'published',
    kind: 'eurostat',
    title: `Евростат: населението на 1 януари ${year} г.`,
    text: `Населението на България е ${formatNumber(pop.latest.persons)} души. Ползваме го за показателите „на човек“.`,
    href: '#/pari',
    status: 'real',
    source: ['eurostat'],
  });
  const files = input.sebra.publication.files,
    listed = [...new Set(files.map((f) => f.listedOn))];
  if (listed.length !== 1) throw new Error('feed: СЕБРА files listed on different days');
  const dayList = files.map((f) => formatDate(f.day).split('.').slice(0, -1).join('.')),
    days =
      dayList.length === 1 ? dayList[0] : dayList.slice(0, -1).join(', ') + ' и ' + dayList.at(-1);
  events.push({
    id: 'sebra-' + listed[0],
    date: listed[0]!,
    dateKind: 'published',
    kind: 'data',
    title: 'СЕБРА: дневни обобщения на плащанията за август',
    text: `Страницата на МИДТ показва ${files.length} дневни файла (${days}): общо ${input.sebra.overall.count} плащания на стойност ${formatEuro(input.sebra.overall.eur, 2)}. Файловете не съдържат получателите и не са сума за месеца.`,
    href: '#/plashtania',
    status: 'real',
    source: ['sebra'],
  });
  events.push({
    id: 'mf-budget-2027',
    date: input.budget2027.publication,
    dateKind: 'published',
    kind: 'data',
    title: 'Проектът за бюджет 2027 и АСБП 2027–2029 са публикувани от МФ',
    text: 'Налични са проектът за държавния бюджет за 2027 г. и средносрочната рамка за 2027–2029 г.: ведомствени бюджети, общини и предложени граници на дълга. Проектът не е приет закон.',
    href: '#/byudzhet-2027',
    status: 'real',
    source: ['budget2027'],
  });
  const ids = new Set<string>();
  for (const e of events) {
    if (ids.has(e.id)) throw new Error('feed: duplicate event ids');
    ids.add(e.id);
    if (typeof e.date !== 'string' || !isIsoDay(e.date)) throw new Error('feed: invalid date');
    if (e.date > input.buildDate) throw new Error('feed: event dated after build day');
  }
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) =>
      a.event.date === b.event.date ? b.index - a.index : a.event.date < b.event.date ? 1 : -1,
    )
    .map((x) => x.event);
  const lat = ex.latest,
    k = lat.kfp,
    h = {
      month: lat.month,
      asOf: lat.asOf,
      revenueMln: k.rev!.cum,
      revenueYoyPct: k.rev!.yoyPct,
      expenditureMln: k['exp.total']!.cum,
      expenditureYoyPct: k['exp.total']!.yoyPct,
      deficitMln: -k.balance!.cum,
      deficitPrevYearMln: -k.balance!.prevYearCum,
      capexPctPlan: k['exp.capex']!.pctPlan,
      planBasis: basis,
      newBorrowingMln: k['fin.ext.markets']!.cum,
      newBorrowingPrevYearMln: k['fin.ext.markets']!.prevYearCum,
    };
  const when = `към края на ${monthName(h.month)} 2026 г.`,
    sentences = [
      `Приходите на консолидираната фискална програма ${when} са ${formatMoney(h.revenueMln)} — ${more(h.revenueYoyPct)} от година по-рано.`,
      `Разходите (с вноската в бюджета на ЕС) са ${formatMoney(h.expenditureMln)} — ${more(h.expenditureYoyPct)}.`,
      `Дефицитът е ${formatMoney(h.deficitMln)}, при ${formatMoney(h.deficitPrevYearMln)} година по-рано.`,
      `Капиталовите разходи са ${formatPercent(h.capexPctPlan)} от годишния план. ${basis.citation}.`,
      `Нетното външно финансиране от международните капиталови пазари е ${formatMoney(h.newBorrowingMln)}, при ${formatMoney(h.newBorrowingPrevYearMln)} година по-рано.`,
    ];
  const expected = ex.pendingMonths.map((p) => ({
    id: p.id,
    title: `Месечен отчет на КФП към края на ${monthName(p.month)} ${p.asOf.slice(0, 4)} г.`,
    status: 'pending',
    note: input.pending[p.id]!.reason,
    expected: input.pending[p.id]!.expected,
  }));
  const next = input.law.next;
  expected.push({
    title: next.title,
    status: next.status,
    note: next.note,
    expected: next.expected,
  } as (typeof expected)[number]);
  const kinds = KINDS.filter((k) => sorted.some((e) => e.kind === k.id)),
    sources = SOURCE_ORDER.filter((s) => sorted.some((e) => e.source.includes(s)));
  const feed = {
    meta: metadata('feed', 'Какво е ново: събития по данните за бюджета', input.buildDate, {
      source: sources,
      sourceNote:
        'Събитията са изведени от наборите на сайта (месечни отчети на КФП, законодателен път, ставки, Евростат, СЕБРА); датите са по източниците.',
      asOf: sorted[0]!.date,
    }),
    kinds,
    dateKinds: DATE_KINDS,
    events: sorted,
    expected,
    highlights: h,
    sentences,
  };
  return {
    feed,
    rss: buildRss(feed, input.baseUrl ?? DEFAULT_RSS_ORIGIN, input.buildDate, input.siteName),
  };
}
