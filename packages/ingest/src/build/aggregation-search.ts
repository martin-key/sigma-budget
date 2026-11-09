import { isMap, isScalar, parseDocument } from 'yaml';
import { metadata } from '../common/metadata.js';
import {
  formatEuro as eur,
  formatMoney as money,
  formatNumber as num,
  formatPercent as pct,
  formatThousands as khil,
  monthName,
} from '../common/format.js';
import { isNumber } from '../io/data.js';
import { pythonTextSpace } from '../common/text.js';
import { aggregationInt } from './aggregation-core.js';

export const SEARCH_GROUPS = [
  'indicators',
  'institutions',
  'municipalities',
  'measures',
  'terms',
  'datasets',
] as const;
type Group = (typeof SEARCH_GROUPS)[number];
export type SearchRow = [number, string, string, string, string, string, string, string];
interface CatalogDefinition {
  file: string;
  title: string;
  slug: string;
  group: string;
  self?: boolean;
  multi?: boolean;
  contains?: string[];
  search?: { period?: string; kw?: string };
}
interface Authored {
  sources: Record<string, unknown>;
  pending: Record<string, { title: string; reason: string; expected: string }>;
  functionDefs: [string, string, string, string[]][];
  budgetInfo: Record<string, [string, ...unknown[]]>;
  catalogDefinitions: CatalogDefinition[];
  catalogGroups: { id: string; label: string }[];
  searchKeywords: {
    revenue: Record<string, string>;
    function: Record<string, string>;
    economic: Record<string, string>;
    measure: Record<string, string>;
    status: Record<string, string>;
  };
}
interface Envelope {
  meta: { source?: string[]; status?: string };
}
interface CoreDoc extends Envelope {
  kpis: {
    month: number;
    revenue: { planMln: number; execPct: number; execMln: number };
    expenditure: { planMln: number; execPct: number; execMln: number };
    balance: { planMln: number; execMln: number };
    capex: { planMln: number };
    gdp: { mln: number };
  };
  revenueGroups: { id: string; name: string; share: number; mln: number }[];
  functions: { id: string; name: string; share: number; mln: number }[];
}
interface OutlookDoc extends Envelope {
  years: number[];
  macroRows: { id: string; short: string; unit?: string; values: (number | null)[] }[];
  kfp: { interest: { mln: number[] } };
}
interface ExpenditureDoc extends Envelope {
  economic: { years: number[]; rows: { id: string; label: string; mln: (number | null)[] }[] };
}
interface DebtItem {
  year: number;
  pctGdp: number;
  mln: number;
}
interface DebtDoc extends Envelope {
  latest: { zdd: DebtItem & { next: DebtItem }; maastricht: DebtItem };
  limits: { year: number; items: { art?: number; label: string; mln: number }[] };
}
interface RatesDoc extends Envelope {
  scenarios: { id: string; employeePct: number; employerPctWithoutTzpb: number }[];
  changes: { id: string; from: number; until: number }[];
  incomeTax: { ratePct: number };
}
interface ComponentsDoc extends Envelope {
  budgets: {
    state: { expKhil: number };
    doo: { expAndTransfersKhil: number };
    nzok: { expAndTransfersKhil: number };
  };
}
interface Ministry {
  id: string;
  short: string;
  art: number;
}
interface MinistriesDoc extends Envelope {
  items: Ministry[];
}
interface ProgramsDoc extends Envelope {
  fields: string[];
  items: (string | number | null)[][];
  sentinels: { noData: string | number | null };
}
interface Cell {
  value: number | null;
}
interface ForecastRow {
  label: string;
  cells: Record<string, Cell>;
  gaps: Record<string, string>;
}
interface BudgetDoc extends Envelope {
  budgets: { bill: Record<string, { name: string; rows: { no: string; cell: Cell }[] }> };
  municipal: { art52: { name: string; region: string; cells: Cell[] }[] };
  forecast: Record<string, ForecastRow[]>;
  debtLimits: Record<string, { value: number }>;
}
interface Municipality {
  name: string;
  lawName?: string;
  region: string;
  id: string;
}
interface MunicipalitiesDoc extends Envelope {
  items: Municipality[];
}
interface MeasuresDoc extends Envelope {
  items: {
    id: string;
    name: string;
    kind: string;
    effectMln?: Record<string, number | null>;
    hasEstimate: boolean;
    text?: string;
  }[];
}
interface GlossaryDoc {
  terms: {
    name?: string;
    title?: string;
    slug: string;
    abbr?: string;
    def?: string;
    aliases?: string[];
  }[];
}
interface ProjectsDoc {
  items: { id: string; name: string; region: string; totalMln: number }[];
}
interface ActivitiesDoc {
  functions: { id: string; name: string }[];
  items: { id: string; name: string; function: string; mln: number[] }[];
}
interface PaymentsDoc {
  recipients: { name: string; kind: string; eur: number; eik: string }[];
}
// Documents are explicit owner outputs; optional disk fallbacks are passed separately.
export interface SearchInput {
  buildDate: string;
  out: Record<string, unknown>;
  fallback: Record<string, unknown>;
  texts: Record<string, string>;
  authored: Authored;
  billOrder: string[];
  debtLimitOrder: string[];
}
export function orderedKeysFromJson(text: string, path: string[]): string[] {
  const doc = parseDocument(text, { schema: 'json' }),
    node = doc.getIn(path, true);
  if (doc.errors.length || !isMap(node)) throw new Error('Invalid budget bill JSON');
  return node.items.map((pair) => {
    if (!isScalar(pair.key)) throw new Error('Invalid bill key');
    return String(pair.key.value);
  });
}
const stripPython = (s: string) =>
  s.replace(
    /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,
    '',
  );
const truth = (v: unknown): boolean =>
  v != null &&
  v !== false &&
  v !== 0 &&
  v !== '' &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 0);
function pythonRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'string') {
    const quote = v.includes("'") && !v.includes('"') ? '"' : "'";
    return (
      quote +
      v
        .replaceAll('\\', '\\\\')
        .replaceAll(quote, '\\' + quote)
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '\\r')
        .replaceAll('\t', '\\t') +
      quote
    );
  }
  if (Array.isArray(v)) return '[' + v.map(pythonRepr).join(', ') + ']';
  if (typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .map(([k, x]) => pythonRepr(k) + ': ' + pythonRepr(x))
        .join(', ') +
      '}'
    );
  return String(v);
}
const clean = (v: unknown) =>
  stripPython(
    (v == null ? '' : typeof v === 'string' ? v : pythonRepr(v)).replace(/[ \t\r\n]+/g, ' '),
  );
const words = (...parts: unknown[]) => {
  const seen = new Set<string>(),
    out: string[] = [];
  for (const p of parts)
    for (const w of clean(p).split(' ')) {
      const k = w.toLowerCase();
      if (w && !seen.has(k)) {
        seen.add(k);
        out.push(w);
      }
    }
  return out.join(' ');
};
const first = (v: unknown) => {
  const t = clean(v),
    m =
      /^(.{20,160}?[.!?])([\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|$)/u.exec(
        t,
      );
  return m ? m[1]! : Array.from(t).slice(0, 160).join('');
};
const moneyKhil = (v: unknown) =>
  !isNumber(v) ? '' : Math.abs(v) >= 1000 ? money(v / 1000) : khil(v, 1);
export class SearchRows {
  readonly rows: SearchRow[] = [];
  readonly seen = new Set<string>();
  readonly bytesByGroup: Record<Group, number> = Object.fromEntries(
    SEARCH_GROUPS.map((g) => [g, 0]),
  ) as Record<Group, number>;
  add(
    group: Group,
    title: unknown,
    sub: unknown = '',
    value: unknown = '',
    period: unknown = '',
    status = 'real',
    href = '',
    kw: unknown = '',
  ) {
    let t = clean(title);
    href = clean(href);
    if (
      group === 'indicators' &&
      truth(value) &&
      !href.includes('per=') &&
      /^#\/(?:pari|prihodi|razhodi|prognoza|bvp)(?:[/?]|$)/.test(href)
    ) {
      if (!['2024', '2025'].includes(String(period))) return;
      href += (href.includes('?') ? '&' : '?') + 'per=' + String(period) + '.report';
    }
    if (!href.includes('per=') && /#\/(vedomstv|obshtin|dalg|merki|danaci)/.test(href))
      href +=
        (href.includes('?') ? '&' : '?') +
        'per=' +
        (String(period) === '2025' && href.startsWith('#/dalg') ? '2025.report' : '2026.law');
    if (!t) throw new Error('search-index: missing title');
    if (!href.startsWith('#/')) throw new Error('search-index: invalid link');
    if (!['real', 'mock', 'pending'].includes(status))
      throw new Error('search-index: invalid status');
    const key = JSON.stringify([group, t, href]);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const row: SearchRow = [
      SEARCH_GROUPS.indexOf(group),
      t,
      clean(sub),
      clean(value),
      clean(period),
      status,
      href,
      clean(kw),
    ];
    this.rows.push(row);
    this.bytesByGroup[group] += Buffer.byteLength(JSON.stringify(row)) + 1;
  }
}
const norm = (s: string) =>
  pythonTextSpace(
    s
      .replace(/[„“”"«»]/g, '')
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replace(/[\-–—]/gu, ' '),
  );
const homoglyphs: Record<string, string> = Object.fromEntries(
  Array.from('ABCEHKMOPTXYabcehkmoptxy').map((c, i) => [
    c,
    Array.from('АВСЕНКМОРТХУавсенкмортху')[i]!,
  ]),
);
const nameKey = (s: string) => {
  const v = norm(Array.from(s, (c) => homoglyphs[c] ?? c).join(''));
  const aliases: Record<string, string> = {
    добричка: 'добрич селска',
    'столична община': 'столична',
    бобовдол: 'бобов дол',
  };
  return (aliases[v] ?? v).replace(/[^а-я0-9]/g, '');
};
export function buildSearch(input: SearchInput) {
  const { authored: a } = input,
    rows = new SearchRows();
  const obj = <T>(name: string, optional = false): T => {
    if (Object.hasOwn(input.out, name)) return input.out[name] as T;
    if (Object.hasOwn(input.fallback, name)) return input.fallback[name] as T;
    if (optional) return null as T;
    throw new Error(`search-index: ${name} is missing`);
  };
  const core = obj<CoreDoc>('core.json'),
    outlook = obj<OutlookDoc>('outlook.json'),
    exp = obj<ExpenditureDoc>('expenditure.json'),
    debt = obj<DebtDoc>('debt.json'),
    rates = obj<RatesDoc>('rates.json'),
    comp = obj<ComponentsDoc>('components.json'),
    k = core.kpis,
    Y = '2026',
    mon = k.month > 1 ? `януари–${monthName(k.month)} ${Y}` : `януари ${Y}`;
  const add = (title: string, sub: string, value: unknown, period: string, href: string, kw = '') =>
    rows.add('indicators', title, sub, value, period, 'real', href, kw);
  add(
    'Приходи на КФП',
    `Консолидирана фискална програма, бюджет ${Y}`,
    money(k.revenue.planMln),
    Y,
    '#/prihodi',
    'приходи постъпления бюджет общо кфп',
  );
  add(
    'Разходи на КФП',
    `Консолидирана фискална програма, бюджет ${Y}`,
    money(k.expenditure.planMln),
    Y,
    '#/razhodi',
    'разходи харчене бюджет общо кфп',
  );
  add(
    'Бюджетно салдо (дефицит) на КФП',
    `Приходи минус разходи, бюджет ${Y}`,
    money(k.balance.planMln),
    Y,
    '#/pari',
    'дефицит салдо недостиг излишък бюджет',
  );
  add(
    'Брутен вътрешен продукт (БВП)',
    `Макроикономическа прогноза, ${Y}`,
    money(k.gdp.mln),
    Y,
    '#/prognoza',
    'бвп икономика размер на икономиката',
  );
  add(
    'Капиталови разходи на КФП',
    `Инвестиции от бюджета, ${Y}`,
    money(k.capex.planMln),
    Y,
    '#/izpalnenie?pera=exp',
    'инвестиции капиталови разходи строителство',
  );
  add(
    `Изпълнение на приходите на КФП, ${mon}`,
    `${pct(k.revenue.execPct)} от годишния план`,
    money(k.revenue.execMln),
    Y,
    '#/izpalnenie',
    'приходи събрани изпълнение отчет',
  );
  add(
    `Изпълнение на разходите на КФП, ${mon}`,
    `${pct(k.expenditure.execPct)} от годишния план`,
    money(k.expenditure.execMln),
    Y,
    '#/izpalnenie',
    'разходи изпълнени изпълнение отчет',
  );
  add(
    `Салдо на КФП, ${mon}`,
    'Приходи минус разходи към края на периода',
    money(k.balance.execMln),
    Y,
    '#/izpalnenie',
    'дефицит салдо изпълнение отчет',
  );
  for (const g of core.revenueGroups)
    add(
      g.name,
      `Приходи на КФП по видове, ${Y} · ${pct(g.share)} от приходите`,
      money(g.mln),
      Y,
      `#/prihodi/${g.id}`,
      a.searchKeywords.revenue[g.id] ?? '',
    );
  const mains = Object.fromEntries(a.functionDefs.map((f) => [f[0], f[3]]));
  for (const f of core.functions) {
    const names = (mains[f.id] ?? [])
      .filter((c) => c in a.budgetInfo)
      .map((c) => a.budgetInfo[c]![0]);
    add(
      f.name,
      `Разходи на КФП по функции, ${Y} · ${pct(f.share)} от разходите`,
      money(f.mln),
      Y,
      `#/razhodi/${f.id}`,
      words(a.searchKeywords.function[f.id] ?? '', ...names),
    );
  }
  const yearIndex = (years: number[]) => {
    const i = years.indexOf(2026);
    if (i < 0) throw new Error('search-index: year missing');
    return i;
  };
  const ei = yearIndex(exp.economic.years);
  for (const r of exp.economic.rows)
    if (r.id in a.searchKeywords.economic && isNumber(r.mln[ei]))
      add(
        r.label,
        `Разходи на КФП по икономически вид, ${Y}`,
        money(r.mln[ei]),
        Y,
        '#/razhodi?po=vid',
        a.searchKeywords.economic[r.id],
      );
  const mi = yearIndex(outlook.years),
    macro: Record<string, string> = {
      hicp: 'инфлация цени',
      unemployment: 'безработица',
      gdpGrowth: 'растеж икономика',
      employment: 'работа',
      compensation: 'заплати доходи',
      gfcf: 'инвестиции',
      currentAccount: 'износ внос платежен баланс',
    };
  for (const r of outlook.macroRows) {
    const v = r.values[mi];
    if (!isNumber(v)) continue;
    const unit = r.unit ?? '',
      val = unit === 'млн. €' ? money(v) : unit === '%' ? pct(v) : num(v, 1) + unit;
    add(r.short, `Макроикономическа прогноза, ${Y}`, val, Y, '#/prognoza', macro[r.id] ?? '');
  }
  const z = debt.latest.zdd,
    ms = debt.latest.maastricht;
  add(
    `Държавен дълг към края на ${z.next.year} г.`,
    `${pct(z.next.pctGdp)} от БВП · по бюджет ${z.next.year}`,
    money(z.next.mln),
    String(z.next.year),
    '#/dalg',
    'дълг задлъжнялост заеми държавен дълг',
  );
  add(
    `Държавен дълг към края на ${z.year} г.`,
    `${pct(z.pctGdp)} от БВП · отчет`,
    money(z.mln),
    String(z.year),
    '#/dalg',
    'дълг задлъжнялост заеми държавен дълг',
  );
  add(
    `Дълг по Маастрихт към края на ${ms.year} г.`,
    `Дълг на сектор „Държавно управление“ · ${pct(ms.pctGdp)} от БВП`,
    money(ms.mln),
    String(ms.year),
    '#/dalg?obhvat=maastricht',
    'дълг маастрихт критерий 60% евростат',
  );
  add(
    'Лихви по държавния дълг',
    `Разходи за лихви в КФП, бюджет ${Y}`,
    money(outlook.kfp.interest.mln[yearIndex(outlook.years)]),
    Y,
    '#/dalg',
    'лихви разходи за лихви дълг',
  );
  for (const it of debt.limits.items)
    add(
      it.label,
      `Закон за държавния бюджет${it.art ? `, чл. ${it.art}` : ''}`,
      money(it.mln),
      String(debt.limits.year),
      '#/dalg',
      'таван лимит дълг заеми',
    );
  const emp = rates.scenarios.find((s) => s.id === 'employment')!,
    ch = Object.fromEntries(rates.changes.map((c) => [c.id, c])) as Record<
      string,
      { id: string; from: number; until: number }
    >;
  add(
    'Осигурителни вноски за наето лице',
    `От служителя ${pct(emp.employeePct, 2)}, от работодателя ${pct(emp.employerPctWithoutTzpb, 2)} (от 01.08.${Y} г.)`,
    '',
    Y,
    '#/danaci',
    'осигуровки вноски заплата нето брутно трудов договор калкулатор',
  );
  add(
    'Данък върху доходите на физическите лица',
    'Основна ставка по Приложение 2 към законопроекта',
    pct(rates.incomeTax.ratePct),
    Y,
    '#/danaci',
    'ддфл данък доходи заплата нето брутно подоходен',
  );
  if (ch['max-insurable']) {
    const c = ch['max-insurable'];
    add(
      'Максимален месечен осигурителен доход',
      `От 01.08.${Y} г. (до тогава ${eur(c.until, 2)})`,
      eur(c.from, 0),
      Y,
      '#/danaci',
      'осигурителен доход таван осигуровки заплата',
    );
  }
  if (ch['min-self-employed']) {
    const c = ch['min-self-employed'];
    add(
      'Минимален осигурителен доход на самоосигуряващите се',
      `От 01.08.${Y} г. (до тогава ${eur(c.until, 2)})`,
      eur(c.from, 2),
      Y,
      '#/danaci',
      'самоосигуряващи свободна професия еднолични търговци осигуровки',
    );
  }
  add(
    'Държавен бюджет',
    `Разходи по Закона за държавния бюджет ${Y}`,
    moneyKhil(comp.budgets.state.expKhil),
    Y,
    '#/izpalnenie/byudzheti',
    'държавен бюджет съставни бюджети',
  );
  add(
    'Бюджет на държавното обществено осигуряване (ДОО)',
    `Разходи и трансфери по Закона за бюджета на ДОО ${Y}`,
    moneyKhil(comp.budgets.doo.expAndTransfersKhil),
    Y,
    '#/izpalnenie/byudzheti',
    'доо нои пенсии осигуровки съставни бюджети',
  );
  add(
    'Бюджет на Националната здравноосигурителна каса (НЗОК)',
    `Разходи и трансфери по Закона за бюджета на НЗОК ${Y}`,
    moneyKhil(comp.budgets.nzok.expAndTransfersKhil),
    Y,
    '#/izpalnenie/byudzheti',
    'нзок здравна каса болници лечение съставни бюджети',
  );
  add(
    'Плащания на бюджетните организации (СЕБРА)',
    'Дневни плащания, публикувани от Министерството на иновациите и дигиталната трансформация',
    '',
    '',
    '#/plashtania',
    'плащания доставчици фирми договори себра',
  );
  const ministries = obj<MinistriesDoc>('ministries.json'),
    programs = obj<ProgramsDoc>('programs.json'),
    names = Object.fromEntries(ministries.items.map((b: Ministry) => [b.id, b])) as Record<
      string,
      Ministry
    >,
    f = Object.fromEntries(programs.fields.map((n: string, i: number) => [n, i])) as Record<
      string,
      number
    >;
  for (const r of programs.items) {
    const code = r[f.code!],
      name = r[f.name!],
      level = r[f.level!],
      y26 = r[f.y2026!];
    if (!name) continue;
    const id = String(r[f.ministry!]),
      who = names[id] ? names[id]!.short : id,
      val = y26 === programs.sentinels.noData ? '' : moneyKhil(y26);
    rows.add(
      'institutions',
      name,
      `${who} · ${level === 'policy' ? 'политика' : 'програма'} ${code}`,
      val,
      'Проект 2026',
      'real',
      `#/vedomstvo/${id}${level === 'policy' ? '' : '/' + code}`,
    );
  }
  const doc = obj<BudgetDoc>('budget2027.json'),
    articleCodes = Object.fromEntries(
      ministries.items.map((b: Ministry) => [b.art + (b.art >= 32 ? 1 : 0), b.id]),
    ) as Record<string, string>;
  if (
    input.billOrder.length !== Object.keys(doc.budgets.bill).length ||
    input.billOrder.some((key) => !Object.hasOwn(doc.budgets.bill, key)) ||
    new Set(input.billOrder).size !== input.billOrder.length
  )
    throw new Error('Invalid bill source order');
  for (const article of input.billOrder) {
    const budget = doc.budgets.bill[article]!;
    if (aggregationInt(article) < 2) continue;
    const expense =
        budget.rows.find((r: { no: string; cell: Cell }) => r.no === 'II.')?.cell.value ?? null,
      code = articleCodes[article] ?? 'art' + article,
      identity = ministries.items.find((b: Ministry) => b.id === code),
      short = identity?.short ?? '',
      abbr = /^[A-Za-zА-Яа-я]{2,8}$/.test(short) && /^[A-ZА-Я]/.test(short) ? short : '';
    rows.add(
      'institutions',
      budget.name + (abbr ? ' – ' + abbr : ''),
      `чл. ${article} от проекта за 2027 г., основен вариант`,
      moneyKhil(expense),
      'Проект 2027',
      'real',
      `#/vedomstvo/${code}?per=2027.draft`,
      words(code, short),
    );
  }
  const identities = obj<MunicipalitiesDoc>('municipalities.json').items;
  for (const row of doc.municipal.art52) {
    let matches = identities.filter((m: Municipality) =>
      [nameKey(m.name), nameKey(m.lawName ?? '')].includes(nameKey(row.name)),
    );
    if (matches.length > 1)
      matches = matches.filter(
        (m: Municipality) => nameKey(m.region) === nameKey(row.region.replace(/^ОБЛАСТ\s+/u, '')),
      );
    if (matches.length !== 1)
      throw new Error('2027 municipality identity is ambiguous: ' + row.name);
    const municipality = matches[0]!;
    rows.add(
      'municipalities',
      municipality.name,
      'Основни бюджетни взаимоотношения, чл. 52, проект 2027',
      moneyKhil(row.cells[0]!.value),
      'Проект 2027',
      'real',
      `#/obshtina/${municipality.id}?per=2027.draft`,
      words('община', municipality.id),
    );
  }
  for (const [key, column] of [
    ['2027.draft', '2'],
    ['2028.forecast', '3'],
    ['2029.forecast', '4'],
  ]) {
    const cell = doc.forecast.VI_1![0]!.cells[column!]!;
    rows.add(
      'indicators',
      'Държавен дълг по ЗДД ' + key!.slice(0, 4),
      'Таблица VI-1, АСБП 2027–2029, прогноза на МФ',
      money(cell.value),
      'Прогноза ' + key!.slice(0, 4),
      'real',
      '#/dalg?per=' + key,
    );
  }
  const debtLabels: Record<string, string> = {
    '66': 'Минимален фискален резерв',
    '67': 'Максимален държавен дълг',
    '68': 'Максимален нов държавен дълг',
  };
  if (
    input.debtLimitOrder.length !== Object.keys(doc.debtLimits).length ||
    new Set(input.debtLimitOrder).size !== input.debtLimitOrder.length ||
    input.debtLimitOrder.some((key) => !Object.hasOwn(doc.debtLimits, key))
  )
    throw new Error('Invalid debt limit source order');
  for (const article of input.debtLimitOrder) {
    const cell = doc.debtLimits[article]!;
    if (typeof cell.value !== 'number' || !Number.isFinite(cell.value))
      throw new Error('Missing debt limit');
    rows.add(
      'indicators',
      debtLabels[article] + ' 2027',
      `Предложена граница, чл. ${article}, не прогноза и не приет закон`,
      money(cell.value * 1000),
      'Проект 2027',
      'real',
      '#/dalg?per=2027.draft',
    );
  }
  for (const [table, kind] of [
    ['II_7', 'Приходна мярка'],
    ['II_8', 'Разходна мярка'],
  ])
    for (const [rowIndex, row] of doc.forecast[table!]!.entries()) {
      const labelKind = row.label.trim().toLowerCase().startsWith('общо:') ? 'Общ ред' : kind;
      for (const [column, period] of ['2027.draft', '2028.forecast', '2029.forecast'].entries()) {
        const cell = row.cells[String(column)],
          publication = (column === 0 ? 'Проект ' : 'Прогноза ') + period.slice(0, 4),
          gap = row.gaps[String(column)] ?? '';
        rows.add(
          'measures',
          row.label,
          `${labelKind} · Таблица ${table!.replace('_', '-')}${gap ? ' · ' + gap : ''}`,
          cell ? money(cell.value) : '',
          publication,
          'real',
          `#/merki?per=${period}&to=s12-${table}-${rowIndex}-${column}`,
        );
      }
    }
  const me = obj<MeasuresDoc>('measures.json');
  for (const it of me.items) {
    const effect = (it.effectMln ?? {})['2026'],
      kind = a.searchKeywords.measure[it.kind] ?? 'Мярка',
      has = isNumber(effect) && it.hasEstimate,
      sub = has
        ? `${kind} · ефект върху салдото през 2026 г.: ${money(effect)}`
        : `${kind} · без обявена оценка на ефекта`;
    rows.add(
      'measures',
      it.name,
      sub,
      has ? money(effect) : '',
      '2026',
      'real',
      `#/merki/${it.id}`,
      it.text ?? '',
    );
  }
  const glossary = obj<GlossaryDoc | null>('glossary.json', true);
  if (glossary)
    for (const t of glossary.terms) {
      const title = t.abbr ? `${t.name || t.title} – ${t.abbr}` : t.title || t.name || t.slug;
      rows.add(
        'terms',
        title,
        first(t.def ?? ''),
        '',
        '',
        'real',
        `#/rechnik/${t.slug}`,
        words((t.aliases ?? []).join(' '), t.abbr ?? '', t.name ?? ''),
      );
    }
  const groups = Object.fromEntries(a.catalogGroups.map((g) => [g.id, g.label]));
  for (const d of a.catalogDefinitions) {
    let status: string | null = null;
    if (d.self || d.file === 'search-index.json') status = 'real';
    else if (d.multi) {
      const prefix = d.file.split('*')[0]!;
      const firstKey = Object.keys(input.out)
        .sort()
        .find((x) => x.startsWith(prefix));
      status = firstKey ? (input.out[firstKey] as Envelope).meta.status! : 'real';
    } else if (Object.hasOwn(input.texts, d.file)) status = 'real';
    else {
      const o = obj<Envelope | null>(d.file, true);
      if (o && typeof o.meta === 'object' && o.meta !== null) status = o.meta.status ?? 'real';
    }
    if (status === null) continue;
    if (!['real', 'mock', 'pending'].includes(status)) status = 'real';
    const s = d.search ?? {},
      ids = d.contains ?? [];
    rows.add(
      'datasets',
      d.title,
      `${groups[d.group]} · ${a.searchKeywords.status[status]}`,
      '',
      s.period ?? '',
      status,
      `#/danni/${d.slug}`,
      s.kw || words(d.slug.replaceAll('-', ' '), ...ids, d.file.split('/').at(-1)),
    );
  }
  for (const id of Object.keys(a.pending).sort()) {
    const p = a.pending[id]!;
    rows.add(
      'datasets',
      p.title,
      `Предстои · ${first(p.reason)}`,
      '',
      '',
      'pending',
      `#/danni/${id.toLowerCase()}`,
      words(id, p.expected),
    );
  }
  const pr = obj<ProjectsDoc | null>('mock/projects.json', true);
  if (pr)
    for (const it of pr.items)
      rows.add(
        'datasets',
        it.name,
        `Примерен проект · област ${it.region}`,
        money(it.totalMln),
        '',
        'mock',
        `#/proekti/${it.id}`,
        words('проект капиталови инвестиции', it.id),
      );
  const ac = obj<ActivitiesDoc | null>('mock/activities.json', true);
  if (ac) {
    const fn = Object.fromEntries(
      ac.functions.map((x: { id: string; name: string }) => [x.id, x.name]),
    );
    for (const it of ac.items) {
      const yi = it.mln.length > 1 ? 1 : 0;
      rows.add(
        'datasets',
        it.name,
        `Примерна дейност · ${fn[it.function] ?? ''}`,
        money(it.mln[yi]),
        '2026',
        'mock',
        `#/razhodi/${it.function}/deynosti`,
        'дейност',
      );
    }
  }
  const pa = obj<PaymentsDoc | null>('mock/payments.json', true);
  if (pa)
    for (const it of pa.recipients)
      rows.add(
        'datasets',
        it.name,
        `Примерен получател · ${it.kind}`,
        money(it.eur / 1e6),
        '',
        'mock',
        `#/plashtania/${it.eik}`,
        words('получател плащания фирма', it.eik),
      );
  const srcs = new Set<string>();
  for (const rel of [
    'core.json',
    'outlook.json',
    'ministries.json',
    'programs.json',
    'municipalities.json',
    'measures.json',
    'debt.json',
    'rates.json',
    'budget2027.json',
  ])
    for (const s of obj<Envelope>(rel).meta.source ?? []) srcs.add(s);
  srcs.add('wg');
  const sources = Object.keys(a.sources).filter((s) => srcs.has(s));
  const result = {
    meta: metadata(
      'search-index',
      'Индекс за търсене: показатели, институции, общини, мерки, понятия и набори от данни',
      input.buildDate,
      {
        source: sources,
        sourceNote:
          'Редовете са изведени от наборите на сайта; числата са копирани от тях. Редовете с примерни данни са отбелязани и се скриват при „Само реални данни“. Екраните на сайта добавя самото търсене.',
      },
    ),
    version: 1,
    groups: [...SEARCH_GROUPS],
    fields: ['g', 'title', 'sub', 'value', 'period', 'status', 'href', 'kw'],
    items: rows.rows,
  };
  const size = Buffer.byteLength(JSON.stringify(result) + '\n');
  if (size >= 250000)
    throw new Error(`search-index.json is ${size} B raw, the budget is < 250000 B`);
  return result;
}
