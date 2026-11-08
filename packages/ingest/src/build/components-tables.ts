import { roundForPython } from '../common/format.js';
export interface ComponentTableRow {
  label: string;
  values: (number | null)[];
}
export interface ComponentTables {
  IV_1: { rows: ComponentTableRow[] };
  IV_text: { quote: string; quote_local: string; quote_delegated: string };
  II_3: { rows: ComponentTableRow[] };
  II_4: { rows: ComponentTableRow[] };
  annex6: { rows: ComponentTableRow[] };
}
export interface MunicipalityInput {
  totals: { count: number; transfersKhil: number; allKhil: number; otherTargetedKhil: number };
  columns: string[];
  check: { columnSums: number[] };
}
export interface OutlookInput {
  vintage: string[];
  kfp: { revenue: { mln: number[] }; expenditure: { mln: number[] }; balance: { mln: number[] } };
}
export interface ExecutionItem {
  cum: number;
  plan?: number;
  pctPlan?: number;
  prevYearCum?: number;
  yoyPct?: number;
}
export interface ExecutionLatest {
  asOf: string;
  month: number;
  nat: Record<string, ExecutionItem>;
  eu: Record<string, ExecutionItem>;
  kfp: Record<string, ExecutionItem>;
}
export interface ExecutionYear {
  asOf: string[];
  nat: Record<string, number[]>;
  eu: Record<string, number[]>;
}
export interface ComponentExecution {
  latest: ExecutionLatest;
  data: Record<string, ExecutionYear>;
}
export interface Page {
  page: number;
  body: string;
}
export interface ComponentEvidenceTables {
  tables: ComponentTables;
  municipalities: MunicipalityInput;
  outlook: OutlookInput;
  execution: ComponentExecution;
  pages: Page[];
}
const ws = (s: string) => s.replace(/\s+/gu, ' ').trim();
const fold = (s: string) =>
  ws(s)
    .split(' ')
    .map((t) =>
      /[Ѐ-ӿ]/u.test(t)
        ? t.replace(
            /[ABCEHKMOPTXaceopxyk]/gu,
            (c) =>
              (
                ({
                  A: 'А',
                  B: 'В',
                  C: 'С',
                  E: 'Е',
                  H: 'Н',
                  K: 'К',
                  M: 'М',
                  O: 'О',
                  P: 'Р',
                  T: 'Т',
                  X: 'Х',
                  a: 'а',
                  c: 'с',
                  e: 'е',
                  o: 'о',
                  p: 'р',
                  x: 'х',
                  y: 'у',
                  k: 'к',
                }) as Record<string, string>
              )[c]!,
          )
        : t,
    )
    .join(' ');
const rnd = (v: number) => roundForPython(v, 1);
function same(label: string, a: number, b: number, tol = 0.051) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tol)
    throw new Error(`components: ${label} differs ${a} vs ${b}`);
}
function vals(row: ComponentTableRow): number[] {
  if (row.values.some((v) => v === null)) throw new Error(`components: missing value ${row.label}`);
  return row.values as number[];
}
export function transformMunicipal(e: ComponentEvidenceTables, all: number) {
  const table = e.tables.IV_1.rows;
  const line = (prefix: string) => {
    const rows = table.filter((r) => fold(r.label).toLowerCase().startsWith(prefix));
    if (rows.length !== 1) throw new Error(`components: IV-1 row ${prefix} not unique`);
    return vals(rows[0]!);
  };
  const total = line('общо'),
    kinds = [
      [
        'delegated',
        'Обща субсидия за делегираните от държавата дейности',
        line('обща субсидия за делегираните'),
      ],
      ['equalizing', 'Обща изравнителна субсидия', line('обща изравнителна')],
      [
        'winterRoads',
        'Зимно поддържане и снегопочистване на общински пътища',
        line('трансфер за зимно'),
      ],
      ['capital', 'Целева субсидия за капиталови разходи', line('целева субсидия за капиталови')],
    ] as const;
  const indices = [0, 3, 4];
  for (const j of indices)
    same(
      'IV-1 column',
      kinds.reduce((s, k) => s + k[2][j]!, 0),
      total[j]!,
    );
  const grab = (key: keyof ComponentTables['IV_text'], re: RegExp) => {
    const m = re.exec(e.tables.IV_text[key]);
    if (!m) throw new Error(`components: missing text ${key}`);
    return Number(m[1]!.replace(/ /gu, '').replace(',', '.'));
  };
  const exp = grab('quote', /в размер на ([\d ]+,\d) млн\. евро/u),
    gdp = grab('quote', /([\d,]+)% от БВП/u),
    kfp = grab('quote', /структура на разходите по КФП\D+([\d,]+)%/u),
    local = grab('quote_local', /в размер на ([\d ]+,\d) млн\. евро/u),
    localPct = grab('quote_local', /([\d,]+)% от общите разходи/u),
    delegated = grab('quote_delegated', /в размер на ([\d ]+,\d) млн\. евро/u);
  same('municipal expenditure', exp, local + delegated, 0.151);
  same('delegated expenditure', delegated, total[2]! / 1000, 0.151);
  same('local share', localPct, (100 * local) / exp, 0.06);
  const m = e.municipalities,
    t = m.totals,
    cols = Object.fromEntries(m.columns.map((c, i) => [c, m.check.columnSums[i]!]));
  same('main transfers', total[0]!, t.transfersKhil);
  same('all transfers', all, t.allKhil);
  for (const [id, , v] of kinds) same(id, v[0]!, cols[id]!);
  same('other targeted', t.otherTargetedKhil, cols.otherTargeted!);
  return {
    name: 'Общини',
    unit: 'хил. €',
    count: t.count,
    year: 2026,
    expMln: exp,
    expPctGdp: gdp,
    expPctKfp: kfp,
    localExpMln: local,
    localExpPct: localPct,
    delegatedExpMln: delegated,
    transfers: {
      years: [2026, 2027, 2028],
      mainKhil: indices.map((j) => total[j]!),
      byKind: kinds.map(([id, label, v]) => ({ id, label, khil: indices.map((j) => v[j]!) })),
      mainSplit2026: { localKhil: total[1]!, delegatedKhil: total[2]! },
      otherTargetedKhil: t.otherTargetedKhil,
      allKhil: t.allKhil,
    },
    source: ['zdb', 'asbp'],
    sourceNote:
      'ЗДБ 2026, чл. 51; мотиви към законопроекта (АСБП 2026–2028): таблица IV-1 (с. 128), приложение № 9 и текстът към нея',
    dataset: 'municipalities',
  };
}
export function transformNational(e: ComponentEvidenceTables) {
  const series = (key: 'II_3' | 'II_4', prefix: string) => {
    const rows = e.tables[key].rows.filter(
      (r) => fold(r.label).toUpperCase().startsWith(prefix) && r.values[0] !== null,
    );
    if (rows.length !== 1) throw new Error(`components: ${key} row ${prefix} not unique`);
    return vals(rows[0]!);
  };
  const n = {
    revMln: series('II_3', 'ПРИХОДИ, ПОМОЩИ'),
    expMln: series('II_3', 'ОБЩО РАЗХОДИ И ВНОСКА'),
    spendingMln: series('II_3', 'РАЗХОДИ'),
    euContributionMln: series('II_3', 'ВНОСКА В ОБЩИЯ БЮДЖЕТ'),
    transferToEuMln: series('II_3', 'ТРАНСФЕР ЗА СМЕТКИ'),
    balanceMln: series('II_3', 'БЮДЖЕТНО САЛДО'),
  };
  const u = {
    revMln: series('II_4', 'ПРИХОДИ, ПОМОЩИ'),
    expMln: series('II_4', 'ОБЩО РАЗХОДИ'),
    transferFromStateMln: series('II_4', 'ТРАНСФЕР ОТ/ЗА'),
    balanceMln: series('II_4', 'БЮДЖЕТНО САЛДО'),
  };
  const k = {
    revMln: e.outlook.kfp.revenue.mln,
    expMln: e.outlook.kfp.expenditure.mln,
    balanceMln: e.outlook.kfp.balance.mln,
  };
  for (let i = 0; i < 5; i++) {
    for (const field of ['revMln', 'expMln', 'balanceMln'] as const)
      same(`${field} national + EU`, n[field][i]! + u[field][i]!, k[field][i]!, 0.151);
    same('transfer to EU', n.transferToEuMln[i]!, -u.transferFromStateMln[i]!, 0.0001);
    same(
      'national balance',
      n.revMln[i]! - n.expMln[i]! + n.transferToEuMln[i]!,
      n.balanceMln[i]!,
      0.151,
    );
    same(
      'EU balance',
      u.revMln[i]! - u.expMln[i]! + u.transferFromStateMln[i]!,
      u.balanceMln[i]!,
      0.151,
    );
    same('national spending', n.spendingMln[i]! + n.euContributionMln[i]!, n.expMln[i]!, 0.151);
  }
  const latest = e.execution.latest;
  const pick = (record: Record<string, ExecutionItem>) =>
    Object.fromEntries(
      [
        ['rev', 'rev'],
        ['exp', 'exp.total'],
        ['balance', 'balance'],
      ].map(([name, key]) => {
        const src = record[key!]!;
        if (!src) throw new Error('components: missing execution row');
        if ('plan' in src || 'pctPlan' in src)
          throw new Error(
            'national/EU execution must not use the draft split as a law denominator',
          );
        return [
          name,
          {
            cum: src.cum,
            ...('prevYearCum' in src ? { prevYearCum: src.prevYearCum } : {}),
            ...('yoyPct' in src ? { yoyPct: src.yoyPct } : {}),
          },
        ];
      }),
    ) as Record<'rev' | 'exp' | 'balance', ExecutionItem>;
  const national = pick(latest.nat),
    eu = pick(latest.eu);
  for (const name of ['rev', 'exp', 'balance'] as const)
    same(
      'execution sum',
      national[name].cum + eu[name].cum,
      latest.kfp[name === 'exp' ? 'exp.total' : name]!.cum,
      0.151,
    );
  const page = (p: number) => {
    const v = e.pages.find((x) => x.page === p);
    if (!v) throw new Error(`components: page ${p} missing`);
    return v.body.replace(/\s+/gu, ' ');
  };
  const m1 =
    /(дефицит|излишък) в размер на ([\d ]+,\d) млн\. евро по националния бюджет и (дефицит|излишък) в размер на ([\d ]+,\d) млн\. евро по европейските средства/u.exec(
      page(171),
    );
  const m2 =
    /(дефицит|излишък) по националния бюджет в размер на ([\d ]+,\d) млн\. евро и (дефицит|излишък) по европейските средства в размер на ([\d ]+,\d) млн\. евро/u.exec(
      page(175),
    );
  if (!m1 || !m2) throw new Error('components: balance split sentences missing');
  const value = (m: RegExpExecArray, i: number) =>
    (m[i] === 'дефицит' ? -1 : 1) * Number(m[i + 1]!.replace(/ /gu, '').replace(',', '.'));
  const nat = [value(m1, 1), value(m2, 1)],
    eus = [value(m1, 3), value(m2, 3)];
  for (let i = 0; i < 2; i++)
    same('text split', nat[i]! + eus[i]!, n.balanceMln[i]! + u.balanceMln[i]!, 0.151);
  const textSplit = {
    unit: 'млн. €',
    years: [2024, 2025],
    pages: [171, 175],
    nationalMln: nat,
    euMln: eus,
    diffNationalMln: nat.map((v, i) => rnd(v - n.balanceMln[i]!)),
    diffEuMln: eus.map((v, i) => rnd(v - u.balanceMln[i]!)),
  };
  return {
    unit: 'млн. €',
    years: [2024, 2025, 2026, 2027, 2028],
    vintage: e.outlook.vintage,
    national: n,
    eu: u,
    kfp: k,
    exec: {
      asOf: latest.asOf,
      month: latest.month,
      ref: 'execution',
      unit: 'млн. €',
      national,
      eu,
    },
    textSplit,
    source: ['asbp'],
    sourceNote:
      'Мотиви към законопроекта (АСБП 2026–2028): таблица II-3 (с. 31) и таблица II-4 (с. 32); за 2026 г. това е „Проект“, за 2027–2028 г. — прогноза',
  };
}
export function transformOther(e: ComponentEvidenceTables) {
  const pick: Record<string, ComponentTableRow> = {};
  for (const r of e.tables.annex6.rows.filter((r) => r.values[0] !== null)) {
    const m = /^(\d) /u.exec(r.label);
    if (m) pick[m[1]!] = r;
    else if (r.label.startsWith('- за бюджета на Българската академия')) pick['4a'] = r;
    else if (r.label.startsWith('- за бюджетите на държавните висши училища')) pick['4b'] = r;
  }
  const specs = [
    ['bnt', '1', 'телевизия', 'Българска национална телевизия (БНТ)'],
    ['bnr', '2', 'радио', 'Българско национално радио (БНР)'],
    ['bta', '3', 'телеграфна', 'Българска телеграфна агенция (БТА)'],
    ['banMon', '4a', 'академия', 'Българска академия на науките (БАН), чрез бюджета на МОН'],
    ['universities', '4b', 'висши училища', 'Държавни висши училища, чрез бюджета на МОН'],
    ['banMoew', '5', 'околната среда', 'Българска академия на науките (БАН), чрез бюджета на МОСВ'],
    [
      'militaryUniversities',
      '6',
      'военни училища',
      'Държавни висши военни училища, чрез бюджета на МО',
    ],
  ] as const;
  const items = specs.map(([id, key, must, label]) => {
    const row = pick[key];
    if (!row || !fold(row.label).toLowerCase().includes(must))
      throw new Error(`components: unexpected annex6 ${key}`);
    return { id, label, khil: vals(row) };
  });
  same('annex 6 row 4', items[3]!.khil[0]! + items[4]!.khil[0]!, vals(pick['4']!)[0]!);
  return {
    name: 'БНТ, БНР, БТА, БАН и държавни университети',
    unit: 'хил. €',
    years: [2026, 2027, 2028],
    items,
    sumKhil: [0, 1, 2].map((i) => rnd(items.reduce((a, b) => a + b.khil[i]!, 0))),
    source: ['asbp'],
    sourceNote: 'Мотиви към законопроекта (АСБП 2026–2028), приложение № 6 (с. 197)',
  };
}
