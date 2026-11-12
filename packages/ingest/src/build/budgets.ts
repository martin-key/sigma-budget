import { artEbk, budgetInfo, nomFirst } from './law-definitions.js';
import type { ProgrammeBudgetDifference, ProgrammePolicy } from './programmes.js';
import {
  loadProgrammes,
  lawPolicyName,
  YEARS,
  SRC_YEARS,
  VINTAGE,
  COLS_OUT,
  type ProgrammeEvidence,
} from './programmes.js';
import { isNumber, roundNumber } from '../io/data.js';
import { metadata } from '../common/metadata.js';
export interface BudgetMetadata {
  id: string;
  title: string;
  status: string;
  source: string[];
  sourceNote?: string;
  asOf: string;
  retrieved: string;
  unit?: string;
  pending?: string[];
  mock: boolean;
}
export interface BudgetLawPolicy {
  n: string | number;
  name: string;
  khil: number | null;
  parts?: { n: string; name: string; khil: number | null }[];
}
export interface BudgetItem {
  id: string;
  art: number;
  name: string;
  lawName: string;
  short: string;
  kind: string;
  revKhil?: number;
  expKhil: number;
  transfersKhil?: number;
  policyTotalKhil?: number;
  policiesKind: string;
  policies: BudgetLawPolicy[];
  bodies?: { name: string; khil: number | null }[];
  programs:
    | { status: 'pending'; id: string; reasonKind: string; reason: string }
    | {
        status: 'real';
        tier: 'validated' | 'program-budget-differs';
        count: number;
        policyCount: number;
        file: string;
      };
  exp2025Khil?: number;
  change?: { pct: number; basis: 'law' | 'program-budget' };
  billVsLaw?: { lines: Record<string, number> } & Partial<
    Record<'revKhil' | 'expKhil' | 'transfersKhil', { bill: number; law: number; diff: number }>
  >;
  programBudgetVsLaw?: ProgrammeBudgetDifference;
}
export interface MinistriesDataset {
  meta: BudgetMetadata;
  totals: { count: number; revKhil: number; expKhil: number };
  kinds: Record<string, string>;
  tiers: Record<string, string>;
  programTotals: {
    budgets: number;
    policies: number;
    programs: number;
    pending: number;
    differ: number;
  };
  scopeNote: string;
  items: BudgetItem[];
}
export interface MinistryProgrammeDataset {
  meta: BudgetMetadata;
  id: string;
  art: number;
  name: string;
  short: string;
  tier: 'validated' | 'program-budget-differs';
  years: number[];
  yearLabels: string[];
  vintage: string[];
  cols: string[];
  policiesKind: string;
  total: Record<string, number[]>;
  policies: ProgrammePolicy[];
  yearsComplete: number[];
  check: {
    prbTotal2026: number;
    zdbExp: number | null;
    matchesLaw: boolean;
    policiesSumToTotal: true;
    programsSumToPolicies: true;
    diffKhil?: number | null;
  };
  skipped: string[];
  skippedTotal: number;
  doc: {
    file: string;
    pages: number[];
    pagesByYear: Record<string, number[]>;
    archive: string;
    archiveUrl: string;
  };
}
export type ProgrammeIndexRow = [
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface ProgrammeIndexDataset {
  meta: BudgetMetadata;
  fields: string[];
  sentinels: { noData: number; noGrowth: number };
  note: string;
  items: ProgrammeIndexRow[];
}
export type BudgetOutputs = {
  'ministries.json': MinistriesDataset;
  'programs.json': ProgrammeIndexDataset;
} & { [file: `ministries/${string}.json`]: MinistryProgrammeDataset };
const ARCHIVE =
  'архив към законопроекта 52-602-01-19, папка „7. Програмни формати на бюджети на ПРБ с бюджет по ДБ“';
const ARCHIVE_URL = 'https://www.parliament.bg/bills/52/52-602-01-19.zip';
const LAW_NOTE =
  'Закон за държавния бюджет на Република България за 2026 г., ДВ бр. 69 от 31.07.2026 г. (чл. 2–47)';
const PRB_NOTE =
  'Програмни бюджети на първостепенните разпоредители към законопроект 52-602-01-19, внесен на 01.07.2026 г. (колона „Проект 2026“ е на законопроекта; приетият закон може да се различава)';
const TIERS = {
  validated: 'Програмният бюджет съвпада със закона',
  'program-budget-differs': 'Програмният бюджет към законопроекта се различава от приетия закон',
  pending: 'Програмите предстои да бъдат добавени',
};
const KINDS: Record<string, string> = {
  ministry: 'Министерства',
  agency: 'Агенции и служби',
  commission: 'Комисии и съвети',
  judiciary: 'Съдебна власт',
  constitutional: 'Конституционни органи',
  legislature: 'Законодателна власт',
  fund: 'Фондове',
  other: 'Други',
};
const round = (x: number) => roundNumber(x, 1)!;
function nominative(name: string): string {
  const [first, ...rest] = name.split(' ');
  return [nomFirst[first!] || first, ...rest].join(' ').trim();
}
function billVsLaw(law: any, art: number): any {
  const d = law.diff[String(art)];
  if (!d) return null;
  const out: any = {},
    h = d.headline || {};
  for (const [key, name] of [
    ['rev', 'revKhil'],
    ['exp', 'expKhil'],
    ['transfers', 'transfersKhil'],
  ]) {
    const bill = h[key!]?.bill,
      current = h[key!]?.law;
    if (isNumber(bill) && isNumber(current) && Math.abs(current - bill) >= 0.05)
      out[name!] = { bill, law: current, diff: round(current - bill) };
  }
  const ops: Record<string, number> = { chg: 0, add: 0, del: 0 };
  for (const line of d.lines || []) ops[line.op] = (ops[line.op] || 0) + 1;
  out.lines = ops;
  return out;
}
function lawPolicies(L: any): any[] {
  return (L.policies || []).map((q: any) => {
    const item: any = {
      n: /^\d+$/u.test(String(q.n)) ? Number(q.n) : q.n,
      name: lawPolicyName(q.name),
      khil: q.khil,
    };
    if (q.parts?.length)
      item.parts = q.parts
        .filter((p: any) => p.n)
        .map((p: any) => ({ n: p.n, name: lawPolicyName(p.name), khil: p.khil }));
    return item;
  });
}
function row(code: string, node: any, level: string, parent: string): any[] {
  const t26 = node.values['2026'] || Array(9).fill(null),
    t25 = node.values['2025'] || Array(9).fill(null);
  const pick = (a: any[], i: number) => (isNumber(a[i]) ? a[i] : -1);
  const y26 = pick(t26, 0),
    y25 = pick(t25, 0),
    growth = y26 !== -1 && y25 !== -1 && y25 > 0 ? round(100 * (y26 / y25 - 1)) : -101;
  return [
    code,
    node.code,
    node.name,
    level,
    parent,
    y26,
    y25,
    growth,
    y25 === 0 && y26 !== -1 && y26 !== 0 ? 1 : 0,
    pick(t26, 1),
    pick(t25, 1),
  ];
}
export function buildBudgets(e: ProgrammeEvidence, buildDate: string): BudgetOutputs {
  const recs = loadProgrammes(e),
    law = e.law.law,
    byCode = Object.fromEntries(Object.entries(artEbk).map(([art, code]) => [code, Number(art)]));
  const items: any[] = [];
  let totRev = 0,
    totExp = 0;
  for (const code of Object.keys(byCode).sort()) {
    const art = byCode[code]!,
      L = law[String(art)]!,
      rec = recs[code]!,
      h = L.headline,
      lawExp = h.exp,
      [short, kind] = budgetInfo[code]!;
    if (!isNumber(lawExp)) throw new Error(`missing expenditure for ministry ${code}`);
    const it: any = { id: code, art, name: nominative(L.name), lawName: L.name, short, kind };
    if (isNumber(h.rev)) {
      it.revKhil = h.rev;
      totRev += h.rev;
    }
    it.expKhil = lawExp;
    totExp += lawExp;
    if (isNumber(h.transfers)) it.transfersKhil = h.transfers;
    if (isNumber(L.policyTotal)) it.policyTotalKhil = L.policyTotal;
    it.policiesKind = L.policiesKind || 'policies';
    it.policies = lawPolicies(L);
    if (L.bodies?.length) it.bodies = L.bodies.map((b: any) => ({ name: b.name, khil: b.khil }));
    it.programs =
      rec.tier === 'pending'
        ? { status: 'pending', id: 'P03', reasonKind: rec.reasonKey, reason: rec.reason }
        : {
            status: 'real',
            tier: rec.tier,
            count: rec.programCount,
            policyCount: rec.policyCount,
            file: `ministries/${code}.json`,
          };
    if (isNumber(rec.exp2025Khil)) it.exp2025Khil = rec.exp2025Khil;
    const base = rec.exp2025Khil,
      cur = rec.tier === 'program-budget-differs' ? rec.check.prbTotal2026 : lawExp;
    if (isNumber(base) && base > 0 && isNumber(cur))
      it.change = {
        pct: round(100 * (cur / base - 1)),
        basis: rec.tier === 'program-budget-differs' ? 'program-budget' : 'law',
      };
    const bvl = billVsLaw(e.law, art);
    if (bvl) it.billVsLaw = bvl;
    if ('programBudgetVsLaw' in rec && rec.programBudgetVsLaw)
      it.programBudgetVsLaw = rec.programBudgetVsLaw;
    items.push(it);
  }
  if (!isNumber(e.law.sums.expKhil) || !isNumber(e.law.sums.revKhil))
    throw new Error('missing law budget sums');
  if (Math.abs(totExp - e.law.sums.expKhil) > 0.05 || Math.abs(totRev - e.law.sums.revKhil) > 0.05)
    throw new Error('budget sums differ from the law');
  const records = Object.values(recs),
    published = records.filter((r) => r.tier !== 'pending');
  const meta = (
    id: string,
    title: string,
    source: string[],
    sourceNote: string,
    asOf: string,
    pending?: string[],
  ) =>
    metadata(id, title, buildDate, {
      source,
      sourceNote,
      asOf,
      unit: 'хил. €',
      ...(pending ? { extra: { pending } } : {}),
    });
  const out: Record<string, any> = {};
  out['ministries.json'] = {
    meta: meta(
      'D08+D09',
      'Бюджети на първостепенните разпоредители за 2026 г. и техните програми',
      ['zdb', 'bill', 'prb'],
      LAW_NOTE + '; програмите — ' + PRB_NOTE,
      '2026-07-31',
      ['P03'],
    ),
    totals: { count: items.length, revKhil: round(totRev), expKhil: round(totExp) },
    kinds: Object.fromEntries(
      Object.entries(KINDS).filter(([k]) => items.some((i) => i.kind === k)),
    ),
    tiers: TIERS,
    programTotals: {
      budgets: published.length,
      policies: published.reduce((n, r) => n + r.policyCount, 0),
      programs: published.reduce((n, r) => n + r.programCount, 0),
      pending: records.filter((r) => r.tier === 'pending').length,
      differ: records.filter((r) => r.tier === 'program-budget-differs').length,
    },
    scopeNote:
      'Сумата на бюджетите е разходите на първостепенните разпоредители по чл. 2–47 от закона; не е целият държавен бюджет (без трансфери към общините и ЕС, осигурителните системи и др.).',
    items,
  };
  const rows: any[] = [];
  for (const code of Object.keys(recs).sort()) {
    const rec = recs[code]!;
    if (rec.tier === 'pending') continue;
    const L = law[String(rec.art)]!,
      check: any = {
        prbTotal2026: rec.check.prbTotal2026,
        zdbExp: rec.check.lawExp,
        matchesLaw: rec.check.matchesLaw,
        policiesSumToTotal: true,
        programsSumToPolicies: true,
      };
    if (!rec.check.matchesLaw) check.diffKhil = rec.programBudgetVsLaw!.diffKhil;
    out[`ministries/${code}.json`] = {
      meta: meta('D09', 'Програмен бюджет: ' + nominative(L.name), ['prb'], PRB_NOTE, '2026-07-01'),
      id: code,
      art: rec.art,
      name: nominative(L.name),
      short: budgetInfo[code]![0],
      tier: rec.tier,
      years: YEARS,
      yearLabels: SRC_YEARS,
      vintage: VINTAGE,
      cols: COLS_OUT,
      policiesKind: L.policiesKind || 'policies',
      total: rec.total,
      policies: rec.policies,
      yearsComplete: rec.yearsComplete,
      check,
      skipped: rec.skipped.slice(0, 8),
      skippedTotal: rec.skipped.length,
      doc: {
        file: rec.file,
        pages: rec.pages,
        pagesByYear: rec.pagesByYear,
        archive: ARCHIVE,
        archiveUrl: ARCHIVE_URL,
      },
    };
    for (const p of rec.policies) {
      rows.push(row(code, p, p.kind, ''));
      for (const q of p.programs || []) rows.push(row(code, q, 'program', p.code));
    }
  }
  out['programs.json'] = {
    meta: meta(
      'D09',
      'Програми и политики на програмните бюджети: индекс за търсене и подреждане',
      ['prb', 'zdb'],
      PRB_NOTE,
      '2026-07-01',
      ['P03'],
    ),
    fields: [
      'ministry',
      'code',
      'name',
      'level',
      'policy',
      'y2026',
      'y2025',
      'growthPct',
      'isNew',
      'prb2026',
      'prb2025',
    ],
    sentinels: { noData: -1, noGrowth: -101 },
    note: 'y2026 и y2025 са консолидираните разходи (колона „общо“: бюджетът на разпоредителя плюс европейските и другите средства), prb2026 и prb2025 — само по бюджета на разпоредителя (колоната, която съвпада със закона). −1 = няма данни; growthPct −101 = не може да се изчисли; isNew 1 = нямало е средства през 2025 г.',
    items: rows,
  };
  return out as BudgetOutputs;
}
