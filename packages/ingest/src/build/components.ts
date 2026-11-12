/** State budget transformation from the independently built law article 1. */
export interface StateLawLine {
  sec: string;
  no: string;
  text: string;
  law: number;
  level: number;
  header?: boolean;
}
export interface StateLaw {
  art1: { lines: StateLawLine[] };
}
export interface StateBudget {
  revKhil: number;
  taxKhil: number;
  nonTaxKhil: number;
  grantsKhil: number;
  expKhil: number;
  transfersNetKhil: number;
  euContributionKhil: number;
  balanceKhil: number;
  financingKhil: number;
  providedKhil: number;
  receivedKhil: number;
  nzokFromHealthMinistryKhil: number;
}
export interface StateTransfers {
  municipalities: number;
  doo: number;
  nzok: number;
  euNf: number;
  euDfz: number;
}
export interface StateResult {
  state: StateBudget;
  transfers: StateTransfers;
}
function same(label: string, a: number, b: number): void {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 0.051)
    throw new Error(`components: ${label} differs: ${a} vs ${b}`);
}
export function transformState(law: StateLaw): StateResult {
  const top = new Map<string, StateLawLine>(),
    sub = new Map<string, StateLawLine>();
  for (const line of law.art1.lines) {
    if (line.header) continue;
    if (!top.has(line.sec)) top.set(line.sec, line);
    if (line.level > 0) sub.set(`${line.sec}:${line.no}`, line);
  }
  function total(sec: string): number {
    const line = top.get(sec);
    if (!line) throw new Error(`components: missing state section ${sec}`);
    return line.law;
  }
  function row(sec: string, no: string, must: string): number {
    const line = sub.get(`${sec}:${no}`);
    if (!line || !line.text.toLowerCase().includes(must))
      throw new Error(`components: ЗДБ art. 1 row ${sec}.${no} expected ${must}`);
    return line.law;
  }
  const state: StateBudget = {
    revKhil: total('I'),
    taxKhil: row('I', '1', 'данъчни'),
    nonTaxKhil: row('I', '2', 'неданъчни'),
    grantsKhil: row('I', '3', 'помощи'),
    expKhil: total('II'),
    transfersNetKhil: total('III'),
    euContributionKhil: total('IV'),
    balanceKhil: total('V'),
    financingKhil: total('VI'),
    providedKhil: row('III', '1', 'предоставени трансфери'),
    receivedKhil: row('III', '2', 'получени трансфери'),
    nzokFromHealthMinistryKhil: row('III', '1.3.1', 'здравеопазването'),
  };
  const transfers: StateTransfers = {
    municipalities: row('III', '1.1', 'общините'),
    doo: row('III', '1.2', 'обществено осигуряване'),
    nzok: row('III', '1.3', 'здравноосигурителна каса'),
    euNf: row('III', '1.4', 'националния фонд'),
    euDfz: row('III', '1.5', 'земеделие'),
  };
  same(
    'ЗДБ rev - exp - transfers - EU contribution = balance',
    state.revKhil - state.expKhil - state.transfersNetKhil - state.euContributionKhil,
    state.balanceKhil,
  );
  same('ЗДБ financing = -balance', state.financingKhil, -state.balanceKhil);
  same(
    'ЗДБ provided - received = net transfers',
    state.providedKhil - state.receivedKhil,
    state.transfersNetKhil,
  );
  same(
    'ЗДБ revenue = tax + non-tax + grants',
    state.taxKhil + state.nonTaxKhil + state.grantsKhil,
    state.revKhil,
  );
  return { state, transfers };
}

import { transformDoo, transformNzok } from './components-social.js';
import {
  transformMunicipal,
  transformNational,
  transformOther,
  type ComponentEvidenceTables,
} from './components-tables.js';
import type { LawBlock } from './rates.js';
import { roundForPython } from '../common/format.js';
import { metadata } from '../common/metadata.js';
import { formatMoney, formatNumber } from '../common/format.js';
import { componentNotes } from './components-notes.js';
export interface ComponentSummary {
  budgets_2026_law: {
    state_budget: {
      rev: number;
      exp: number;
      transfers_net: number;
      eu_contribution: number;
      transfers_to: {
        municipalities: number;
        doo: number;
        nzok: number;
        eu_nf: number;
        eu_dfz: number;
      };
    };
    doo: { rev_and_transfers: number; own_rev: number; contributions: number };
    nzok: { rev_and_transfers: number; own_rev: number; contributions: number };
    municipalities: { exp_mln: number; main_transfers: number };
    eu_accounts: {
      rev: number;
      exp_incl_eu_contribution: number;
      balance: number;
      transfer_from_state_budget_net: number;
    };
    other_transfers: {
      bnt: number;
      bnr: number;
      bta: number;
      ban_and_universities: number;
      military_universities: number;
    };
  };
  national_vs_eu_2026: {
    exec_2026_07_31: {
      national: { rev: number; exp_incl_eu_contribution: number; balance: number };
      eu: { rev: number; exp_incl_eu_contribution: number; balance: number };
    };
  };
}
export interface ComponentEvidence extends ComponentEvidenceTables {
  law: StateLaw;
  doo: LawBlock[];
  nzok: LawBlock[];
  summary: ComponentSummary;
}
const componentRound = (v: number) => roundForPython(v, 1);
function check(label: string, a: number, b: number, tol = 0.051) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tol)
    throw new Error(`components: ${label} differs ${a} vs ${b}`);
}
const interpolate = (s: string, ...values: string[]) => {
  let i = 0;
  return s.replace(/%s/gu, () => values[i++]!);
};
export function buildComponents(e: ComponentEvidence, buildDate: string) {
  const { state, transfers: to } = transformState(e.law),
    doo = transformDoo(e.doo),
    nzok = transformNzok(e.nzok),
    mun = transformMunicipal(e, to.municipalities),
    nve = transformNational(e),
    other = transformOther(e);
  check('ДОО receives state transfer', doo.transfersFromCentralKhil, to.doo);
  check('НЗОК receives state transfer', nzok.transfersFromStateKhil, to.nzok);
  check('НЗОК health ministry', nzok.rev[3]!.khil, state.nzokFromHealthMinistryKhil);
  const itemised = componentRound(Object.values(to).reduce((a, b) => a + b, 0)),
    otherKhil = componentRound(state.providedKhil - itemised);
  if (otherKhil < 0) throw new Error('components: itemised transfers exceed provided transfers');
  const B = e.summary.budgets_2026_law;
  const checks: [string, number, number][] = [
    ['state rev', state.revKhil, B.state_budget.rev],
    ['state exp', state.expKhil, B.state_budget.exp],
    ['state transfers', state.transfersNetKhil, B.state_budget.transfers_net],
    ['EU contribution', state.euContributionKhil, B.state_budget.eu_contribution],
    ['to municipalities', to.municipalities, B.state_budget.transfers_to.municipalities],
    ['to ДОО', to.doo, B.state_budget.transfers_to.doo],
    ['to НЗОК', to.nzok, B.state_budget.transfers_to.nzok],
    ['to EU NF', to.euNf, B.state_budget.transfers_to.eu_nf],
    ['to EU DFZ', to.euDfz, B.state_budget.transfers_to.eu_dfz],
    ['ДОО total', doo.revAndTransfersKhil, B.doo.rev_and_transfers],
    ['ДОО own', doo.ownRevKhil, B.doo.own_rev],
    ['ДОО contributions', doo.rev[0]!.khil, B.doo.contributions],
    ['НЗОК total', nzok.revAndTransfersKhil, B.nzok.rev_and_transfers],
    ['НЗОК own', nzok.ownRevKhil, B.nzok.own_rev],
    ['НЗОК contributions', nzok.rev[0]!.khil, B.nzok.contributions],
    ['municipal expenditure', mun.expMln, B.municipalities.exp_mln],
    ['municipal transfers', mun.transfers.mainKhil[0]!, B.municipalities.main_transfers],
    ['EU revenue', nve.eu.revMln[2]!, B.eu_accounts.rev],
    ['EU expenditure', nve.eu.expMln[2]!, B.eu_accounts.exp_incl_eu_contribution],
    ['EU balance', nve.eu.balanceMln[2]!, B.eu_accounts.balance],
    ['EU transfer', nve.eu.transferFromStateMln[2]!, B.eu_accounts.transfer_from_state_budget_net],
    ['БНТ', other.items[0]!.khil[0]!, B.other_transfers.bnt],
    ['БНР', other.items[1]!.khil[0]!, B.other_transfers.bnr],
    ['БТА', other.items[2]!.khil[0]!, B.other_transfers.bta],
    [
      'БАН and universities',
      other.items[3]!.khil[0]! + other.items[4]!.khil[0]!,
      B.other_transfers.ban_and_universities,
    ],
    ['military universities', other.items[6]!.khil[0]!, B.other_transfers.military_universities],
  ];
  for (const [name, a, b] of checks) check(`frozen input summary ${name}`, a, b);
  const july = e.execution.data['2026'];
  if (!july || july.asOf[6] !== '2026-07-31') throw new Error('components: missing July execution');
  for (const [name, key] of [
    ['national', 'nat'],
    ['eu', 'eu'],
  ] as const)
    for (const [src, id] of [
      ['rev', 'rev'],
      ['exp_incl_eu_contribution', 'exp.total'],
      ['balance', 'balance'],
    ] as const)
      check(
        `July ${name} ${id}`,
        componentRound(july[key][id]![6]!),
        e.summary.national_vs_eu_2026.exec_2026_07_31[name][src],
        0.0001,
      );
  const stateOut = {
    ...state,
    name: 'Държавен бюджет',
    unit: 'хил. €',
    source: ['zdb'],
    sourceNote: 'ЗДБ 2026, чл. 1, ал. 1–4 (ДВ бр. 69 от 31.07.2026 г.)',
  };
  const dooOut = {
    ...doo,
    name: 'Държавно обществено осигуряване (ДОО)',
    short: 'ДОО',
    unit: 'хил. €',
    source: ['zbdoo'],
    sourceNote: 'ЗБДОО 2026, чл. 1 и 2 (ДВ бр. 68 от 28.07.2026 г.)',
  };
  const nzokOut = {
    ...nzok,
    name: 'Национална здравноосигурителна каса (НЗОК)',
    short: 'НЗОК',
    unit: 'хил. €',
    source: ['zbnzok'],
    sourceNote: 'ЗБНЗОК 2026, чл. 1 и 2 (ДВ бр. 68 от 28.07.2026 г.)',
  };
  const euOut = {
    name: 'Сметки за средства от ЕС',
    unit: 'млн. €',
    year: 2026,
    vintage: 'draft',
    revMln: nve.eu.revMln[2]!,
    expMln: nve.eu.expMln[2]!,
    transferFromStateMln: nve.eu.transferFromStateMln[2]!,
    balanceMln: nve.eu.balanceMln[2]!,
    fromStateBudgetKhil: { nf: to.euNf, dfz: to.euDfz, sum: componentRound(to.euNf + to.euDfz) },
    source: ['asbp', 'zdb'],
    sourceNote:
      'Мотиви към законопроекта (АСБП 2026–2028), таблица II-4 (с. 32); ЗДБ 2026, чл. 1, III.1.4 и III.1.5',
  };
  const transfers = {
    unit: 'хил. €',
    toMunicipalitiesKhil: to.municipalities,
    toDooKhil: to.doo,
    toNzokKhil: to.nzok,
    toEuNfKhil: to.euNf,
    toEuDfzKhil: to.euDfz,
    itemisedKhil: itemised,
    otherKhil,
    providedKhil: state.providedKhil,
    receivedKhil: state.receivedKhil,
    netKhil: state.transfersNetKhil,
    toNzokFromHealthMinistryKhil: state.nzokFromHealthMinistryKhil,
    source: ['zdb'],
    sourceNote:
      'ЗДБ 2026, чл. 1, раздел III. „Други“ е разликата между всички предоставени трансфери и изброените в закона получатели (общини, ДОО, НЗОК, двете сметки за средства от ЕС): законът не ги назовава.',
  };
  const nodes = [
    ['state', 'Държавен бюджет'],
    ['municipalities', 'Общини'],
    ['doo', 'ДОО'],
    ['nzok', 'НЗОК'],
    ['euNf', 'Национален фонд (средства от ЕС)'],
    ['euDfz', 'Държавен фонд „Земеделие“ (средства от ЕС)'],
    ['other', 'Други получатели (не са посочени поименно в закона)'],
  ] as const;
  const links = Object.entries({ ...to, other: otherKhil }).map(([target, khil]) => ({
    source: 'state',
    target,
    value: componentRound(khil / 1000),
    khil,
  }));
  check(
    'sankey transfers',
    links.reduce((s, v) => s + v.value, 0),
    state.providedKhil / 1000,
    0.31,
  );
  const split = [2024, 2025]
    .map(
      (y, i) =>
        `${y}: ${formatNumber(nve.textSplit.nationalMln[i], 1, true)} / ${formatNumber(nve.textSplit.euMln[i], 1, true)} срещу ${formatNumber(nve.national.balanceMln[i], 1, true)} / ${formatNumber(nve.eu.balanceMln[i], 1, true)}`,
    )
    .join('; ');
  const notes = [
    componentNotes[0]!,
    interpolate(componentNotes[1]!, formatMoney(nve.eu.transferFromStateMln[2]!)),
    interpolate(componentNotes[2]!, split),
    interpolate(
      componentNotes[3]!,
      formatMoney(euOut.fromStateBudgetKhil.sum / 1000),
      formatMoney(nve.eu.transferFromStateMln[2]!),
    ),
    interpolate(
      componentNotes[4]!,
      formatMoney(mun.transfers.mainKhil[0]! / 1000),
      formatMoney(mun.transfers.otherTargetedKhil / 1000),
    ),
    interpolate(componentNotes[5]!, formatMoney(other.sumKhil[0]! / 1000)),
    componentNotes[6]!,
  ];
  const pending = {
    status: 'pending',
    id: 'P02',
    title: 'Месечно изпълнение по съставни бюджети (държавен бюджет, ДОО, НЗОК, общини)',
    reason:
      'Месечните отчети, които са извлечени, дават консолидираната програма, националния бюджет и европейските средства. Разбивката на националния бюджет по съставни бюджети е в отделни таблици на МФ, които още не са извлечени.',
    expected: 'Отделни таблици към месечната информация за КФП, minfin.bg',
    source: ['minfin'],
    screens: ['S15'],
  };
  return {
    meta: metadata('D07', 'Съставни бюджети и трансфери', buildDate, {
      status: 'real',
      source: ['zdb', 'zbdoo', 'zbnzok', 'asbp', 'kfp'],
      sourceNote: `ЗДБ 2026 (ДВ бр. 69), ЗБДОО и ЗБНЗОК 2026 (ДВ бр. 68), мотиви към законопроекта (АСБП 2026–2028), месечен отчет на КФП към ${e.execution.latest.asOf.split('-').reverse().join('.')}`,
      asOf: '2026-07-31',
      unit: 'хил. €',
      extra: { pending: ['P02'] },
    }),
    budgets: {
      state: stateOut,
      doo: dooOut,
      nzok: nzokOut,
      municipalities: mun,
      euAccounts: euOut,
      other,
    },
    transfers,
    nationalVsEu: nve,
    sankey: { unit: 'млн. €', nodes: nodes.map(([id, name]) => ({ id, name })), links },
    monthlyByBudget: pending,
    notes,
    pending: ['P02'],
  };
}
export type ComponentsResult = ReturnType<typeof buildComponents>;
