import type { LawBlock, ContributionRow, ContributionSplit, ActivityRate } from './rates.js';
import { roundForPython } from '../common/format.js';

export interface RatePeriod {
  until: number;
  from: number;
}
export interface RatesLaw {
  minSelf: RatePeriod;
  max: RatePeriod;
  gvrsPct: number;
  healthPct: number;
  quotes: { zbdoo_art9: string; zbdoo_art14: string; zbdoo_art15: string; zbnzok_art2: string };
}
export interface AssumptionSub {
  label: string;
  unit: string;
  years: Record<string, string>;
}
export interface Assumption extends AssumptionSub {
  no: string;
  sub: AssumptionSub[];
}
export type Assumptions = Record<string, Assumption>;
export const assumptionRows = [
  '3',
  '10',
  '11.1',
  '11.3',
  '11.4',
  '11.5',
  '12',
  '13',
  '14',
  '16',
  '18',
  '19',
  '20.1',
  '20.2',
  '20.3',
];
const years = ['2025', '2026', '2027', '2028'];
const ws = (s: string) => (s ?? '').replace(/\s+/gu, ' ').trim();
const clean = (s: string) =>
  ws(s)
    .replace(/\s+,/gu, ',')
    .replace(/(\d), (\d{2})(?=[,;. ]|$)/gu, '$1,$2');
const bg = (s: string) => Number(s.replace(/\s/gu, '').replace(',', '.'));
const num = (s: string): number => {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/u.exec(s ?? '');
  if (!m) throw new Error(`rates: expected number in ${s}`);
  return bg(m[1]!);
};
function find(blocks: LawBlock[], prefix: string, after = 0): number {
  const i = blocks.findIndex((v, n) => n >= after && v[0] === 'p' && v[1].startsWith(prefix));
  if (i < 0) throw new Error(`rates: paragraph ${prefix} missing`);
  return i;
}
function para(blocks: LawBlock[], prefix: string): string {
  const b = blocks[find(blocks, prefix)]!;
  if (b[0] !== 'p') throw new Error('rates: expected paragraph');
  return b[1];
}
function range(blocks: LawBlock[], start: string, end: string): string[] {
  const i = find(blocks, start),
    j = find(blocks, end, i + 1);
  return blocks.slice(i, j).flatMap((b) => (b[0] === 'p' ? [b[1]] : []));
}
export function transformRatesLaw(doo: LawBlock[], nzok: LawBlock[]): RatesLaw {
  const art9 = range(doo, 'Чл. 9. ', 'Чл. 10. '),
    parts = art9.join(' ').split(' 2. от 1 август до 31 декември');
  if (parts.length !== 2) throw new Error('rates: art. 9 periods missing');
  function eur(part: string, label: string) {
    const m = new RegExp(label + ' – (\\d[\\d ]*(?:,\\d+)?) евро', 'u').exec(part);
    if (!m) throw new Error(`rates: art. 9 amount missing ${label}`);
    return bg(m[1]!);
  }
  const own = 'самоосигуряващите се лица',
    top = 'максимален месечен размер на осигурителния доход';
  const art14 = range(doo, 'Чл. 14. ', 'Чл. 15. '),
    art15 = para(doo, 'Чл. 15. (1)'),
    art2 = para(nzok, 'Чл. 2. ');
  const health = /е (\d+(?:,\d+)?) на сто/u.exec(art2);
  if (
    !health ||
    !art15.includes(
      'не се внасят вноски за Фонд „Гарантирани вземания на работниците и служителите“',
    )
  )
    throw new Error('rates: unexpected law text');
  return {
    minSelf: { until: eur(parts[0]!, own), from: eur(parts[1]!, own) },
    max: { until: eur(parts[0]!, top), from: eur(parts[1]!, top) },
    gvrsPct: 0,
    healthPct: bg(health[1]!),
    quotes: {
      zbdoo_art9: art9.join('\n'),
      zbdoo_art14: art14.join('\n'),
      zbdoo_art15: art15,
      zbnzok_art2: art2,
    },
  };
}
export function transformAssumptions(blocks: LawBlock[]): Assumptions {
  const tabs = blocks.flatMap((b) =>
    b[0] === 't' && b[1][0]?.length === 7 && ws(b[1][0]![1]!).toUpperCase() === 'ОСНОВНИ ДОПУСКАНИЯ'
      ? [b[1]]
      : [],
  );
  const t = tabs[0];
  if (
    tabs.length !== 1 ||
    !t ||
    JSON.stringify(t[0]!.slice(3).map(ws)) !== JSON.stringify(years.map((y) => `${y} г.`))
  )
    throw new Error('rates: assumptions table or years missing');
  const items: Assumptions = {};
  let current: Assumption | undefined;
  for (const row of t.slice(2)) {
    if (row.length !== 7) {
      current = undefined;
      continue;
    }
    const no = ws(row[0]!).replace(/\.+$/u, ''),
      label = clean(row[1]!),
      unit = clean(row[2]!);
    const vals = row.slice(3).map(clean),
      byYear = Object.fromEntries(years.map((y, i) => [y, vals[i]!]));
    if (no) {
      current = { no, label, unit, years: byYear, sub: [] };
      items[no] = current;
    } else if (!current || ['в т.ч.', 'в т.ч'].includes(label.replace(/:+$/u, ''))) continue;
    else if (label.startsWith('-'))
      current.sub.push({ label: label.replace(/^[- ]+/u, '').trim(), unit, years: byYear });
    else if (!label && vals.some(Boolean))
      for (const y of years)
        if (byYear[y]) current.years[y] = `${current.years[y]} ${byYear[y]}`.trim();
  }
  const missing = assumptionRows.filter((n) => !items[n]);
  if (missing.length) throw new Error(`rates: missing assumption rows ${missing.join(', ')}`);
  return items;
}
function round(v: number) {
  return roundForPython(v, 2);
}
function ratio(s: string): [number, number] {
  const m = /^(\d+):(\d+)$/u.exec(s.trim());
  if (!m) throw new Error('rates: invalid ratio');
  const a = Number(m[1]),
    b = Number(m[2]);
  return [a / (a + b), b / (a + b)];
}
/** Independently reconcile NAP rows with law limits and the bill's fund rates and splits. */
export function reconcileRates(
  nap: Record<string, ContributionRow>,
  funds: Record<string, ContributionSplit>,
  law: RatesLaw,
  bill: Assumptions,
  acts: ActivityRate[],
): void {
  const yrs = (n: string) => {
    const v = bill[n]?.years['2026'];
    if (v === undefined) throw new Error(`rates: missing bill row ${n}`);
    return v;
  };
  const required = (s: string, pattern: RegExp) => {
    const m = pattern.exec(s);
    if (!m) throw new Error('rates: missing bill pension split');
    return bg(m[1]!);
  };
  const post = required(yrs('11.1'), /(\d+,\d+) за родените след 31 декември 1959/u),
    pre = required(yrs('11.1'), /(\d+,\d+) за родените преди 1 януари 1960/u);
  const ozm = num(yrs('11.3')),
    unemp = num(yrs('11.5')),
    upf = num(yrs('13')),
    health = num(yrs('12'));
  const expected: Record<string, [number, number, number]> = {
    '1.2.': [post + ozm + unemp, upf, health],
    '1.1.': [pre + ozm + unemp, 0, health],
    '10.1.2.': [post, upf, health],
    '10.2.2.': [post + ozm, upf, health],
  };
  for (const [id, [d, u, h]] of Object.entries(expected)) {
    const t = funds[id]?.total;
    if (!t || round(d) !== t.doo || round(u) !== t.upf || round(h) !== t.health)
      throw new Error(`rates: NAP totals differ from bill ${id}`);
  }
  if (health !== law.healthPct || num(yrs('16')) !== law.gvrsPct)
    throw new Error('rates: bill disagrees with law');
  const [er, ee] = ratio(yrs('20.1')),
    [hr, he] = ratio(yrs('20.3'));
  const pairs = [...yrs('20.2').matchAll(/(\d+,\d+):(\d+,\d+)/gu)];
  if (pairs.length !== 2) throw new Error('rates: bill pension splits missing');
  for (const [id, index] of [
    ['1.1.', 0],
    ['1.2.', 1],
  ] as const) {
    const f = funds[id]!,
      p = pairs[index]!,
      shared = ozm + unemp;
    const derived = {
      employee: { doo: round(bg(p[2]!) + ee * shared), health: round(he * health) },
      employer: { doo: round(bg(p[1]!) + er * shared), health: round(hr * health) },
    };
    for (const who of ['employee', 'employer'] as const)
      for (const fund of ['doo', 'health'] as const)
        if (Math.abs(f[who][fund] - derived[who][fund]) >= 0.0051)
          throw new Error(`rates: NAP split differs from bill ${id}`);
  }
  const max = [law.max.until, law.max.from],
    min = [law.minSelf.until, law.minSelf.from];
  const amounts = (s: string) => [...s.matchAll(/(\d+(?:,\d+)?) евро/gu)].map((m) => bg(m[1]!));
  const equal = (a: number[], b: number[]) => JSON.stringify(a) === JSON.stringify(b);
  if (
    !equal(amounts(nap['1.2.']!.cells[2]!), max) ||
    ['10.1.2.', '10.2.2.'].some((id) => !equal(amounts(nap[id]!.cells[2]!), [...min, ...max]))
  )
    throw new Error('rates: NAP limits disagree with law');
  const has = (s: string, n: number) =>
    s
      .replace(/(?<=\d) (?=\d)/gu, '')
      .includes((n % 1 === 0 ? String(n) : n.toFixed(2)).replace('.', ','));
  if (!max.every((v) => has(yrs('18'), v)) || !min.every((v) => has(yrs('19'), v)))
    throw new Error('rates: bill limits disagree with law');
  const lo = Math.min(...acts.flatMap((a) => [a.until, a.from])),
    hi = Math.max(...acts.flatMap((a) => [a.until, a.from]));
  if (
    !yrs('11.4').includes(`от ${String(lo).replace('.', ',')} до ${String(hi).replace('.', ',')}`)
  )
    throw new Error('rates: activity range disagrees with bill');
  if (funds['1.1.']!.employee.upf !== 0 || funds['1.1.']!.employer.upf !== 0)
    throw new Error('rates: unexpected UPF share');
  for (const id of ['5.1.2.', '5.2.2.'])
    if (JSON.stringify(funds[id]!.total) !== JSON.stringify(funds['1.2.']!.total))
      throw new Error('rates: civil servant total differs');
  if (
    bill['3']!.sub.length !== 1 ||
    !bill['3']!.sub[0]!.label.startsWith(
      'Данъчна ставка за данъка върху доходите от стопанска дейност',
    )
  )
    throw new Error('rates: missing tax sub-row');
}
