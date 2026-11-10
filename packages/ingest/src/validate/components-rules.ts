/** Independent port of validate/components.py; no expected-result builders. */
import { existsSync, readFileSync } from 'node:fs';
import { originalPins, sha256, type OriginalBytes } from './indirect-rules.js';
import { safePath } from './context.js';
import { Check, fmt, isnum, numbersIn, pyRepr } from './checks.js';
import { Context } from './context.js';
import type { Group } from './runner.js';
import {
  allNumbers,
  cleanText,
  dig,
  equal,
  keys,
  ordered,
  rowIds,
  rowsById,
  sameSet,
  sum,
  text,
  values,
  type Doc,
} from './rule-support.js';

const tolSum = (n: number) => 0.05 * (n + 1) + 0.01;
const budgetKeys = ['state', 'doo', 'nzok', 'municipalities', 'euAccounts', 'other'];
const sources: Doc = {
  state: ['zdb'],
  doo: ['zbdoo'],
  nzok: ['zbnzok'],
  municipalities: ['zdb', 'asbp'],
  euAccounts: ['asbp', 'zdb'],
  other: ['asbp'],
};
const targets = ['municipalities', 'doo', 'nzok', 'euNf', 'euDfz', 'other'];

export function components(ctx: Context): Check {
  const c = new Check('COMPONENTS'),
    d = ctx.get('components.json'),
    lawDoc = ctx.get('law.json');
  const law = new Map<string, unknown>();
  for (const r of lawDoc.art1.lines) if (r.no && 'law' in r) law.set(`${r.sec}/${r.no}`, r.law);
  const line = (sec: string, no: string) => law.get(`${sec}/${no}`);
  const art1 = lawDoc.art1.headline,
    outlook = ctx.get('outlook.json'),
    execu = ctx.get('execution.json'),
    munic = ctx.get('municipalities.json'),
    core = ctx.get('core.json');
  ordered(
    c,
    d,
    [
      'meta',
      'budgets',
      'transfers',
      'nationalVsEu',
      'sankey',
      'monthlyByBudget',
      'notes',
      'pending',
    ],
    `components keys ${pyRepr(keys(d))}`,
  );
  const me = d.meta;
  c.ok(
    me.id === 'D07' &&
      me.status === 'real' &&
      equal(me.source, ['zdb', 'zbdoo', 'zbnzok', 'asbp', 'kfp']) &&
      me.unit === 'хил. €' &&
      me.mock === false,
    'meta id / status / source / unit',
  );
  c.ok(
    equal(me.pending, ['P02']) && equal(d.pending, ['P02']),
    'pending is P02 in meta and at the top',
  );
  c.ok(me.asOf === '2026-07-31' && me.retrieved === ctx.buildDate, 'meta asOf / retrieved');
  c.ok(
    equal(dig(core, 'pending', 'P02'), d.monthlyByBudget),
    'core.pending.P02 equals components.monthlyByBudget',
  );
  const b = d.budgets;
  ordered(c, b, budgetKeys, `budgets keys ${pyRepr(keys(b))}`);
  for (const k of budgetKeys) {
    const blk = b[k] ?? {};
    c.ok(equal(blk.source, sources[k]), `${k}: source ${pyRepr(blk.source)}`);
    c.ok(text(blk.name) && text(blk.unit), `${k}: name / unit`);
    c.ok(cleanText(blk.sourceNote), `${k}: sourceNote`);
  }
  const s = b.state;
  c.ok(
    allNumbers(
      [
        'revKhil',
        'taxKhil',
        'nonTaxKhil',
        'grantsKhil',
        'expKhil',
        'transfersNetKhil',
        'euContributionKhil',
        'balanceKhil',
        'financingKhil',
        'providedKhil',
        'receivedKhil',
        'nzokFromHealthMinistryKhil',
      ].map((k) => s[k]),
    ),
    'state: every figure is a number',
  );
  c.near(
    s.revKhil,
    s.taxKhil + s.nonTaxKhil + s.grantsKhil,
    tolSum(3),
    'state: revenue = tax + non-tax + grants',
  );
  c.near(
    s.balanceKhil,
    s.revKhil - s.expKhil - s.transfersNetKhil - s.euContributionKhil,
    tolSum(4),
    'state: balance = revenue - expenditure - net transfers - EU contribution',
  );
  c.near(s.financingKhil, -s.balanceKhil, 0.011, 'state: financing = - balance');
  c.near(
    s.transfersNetKhil,
    s.providedKhil - s.receivedKhil,
    tolSum(2),
    'state: net transfers = provided - received',
  );
  for (const [key, sec, no] of [
    ['revKhil', 'I', 'I'],
    ['taxKhil', 'I', '1'],
    ['nonTaxKhil', 'I', '2'],
    ['grantsKhil', 'I', '3'],
    ['expKhil', 'II', 'II'],
    ['transfersNetKhil', 'III', 'III'],
    ['providedKhil', 'III', '1'],
    ['receivedKhil', 'III', '2'],
    ['euContributionKhil', 'IV', 'IV'],
    ['balanceKhil', 'V', 'V'],
    ['financingKhil', 'VI', 'VI'],
    ['nzokFromHealthMinistryKhil', 'III', '1.3.1'],
  ] as const)
    c.near(s[key], line(sec, no), 0.011, `state.${key} vs law.json art. 1 line ${sec} ${no}`);
  for (const [key, hk] of [
    ['revKhil', 'rev'],
    ['expKhil', 'exp'],
    ['transfersNetKhil', 'transfers'],
    ['euContributionKhil', 'eucontrib'],
    ['balanceKhil', 'balance'],
    ['financingKhil', 'financing'],
  ] as const)
    c.near(s[key], dig(art1, hk, 'law'), 0.011, `state.${key} vs law.json art1.headline.${hk}.law`);
  const o = b.doo;
  c.ok(o.short === 'ДОО', 'doo: short');
  rowIds(c, o.rev, ['contributions', 'nonTax', 'vat', 'transfers', 'transfersShortage'], 'doo.rev');
  rowIds(c, o.exp, ['pensions', 'benefits', 'programmes', 'defence', 'transfersOut'], 'doo.exp');
  rowIds(c, o.pensionsSplit, ['fromDoo', 'fromState', 'euRights'], 'doo.pensionsSplit');
  const rev = rowsById(o.rev),
    exp = rowsById(o.exp),
    pens = rowsById(o.pensionsSplit);
  c.ok(
    allNumbers([...values(rev), ...values(exp), ...values(pens)]),
    'doo: row values are numbers',
  );
  c.near(sum(values(rev)), o.revAndTransfersKhil, tolSum(5), 'doo: revenue rows add up');
  c.near(sum(values(exp)), o.expAndTransfersKhil, tolSum(5), 'doo: expenditure rows add up');
  c.near(
    o.revAndTransfersKhil,
    o.expAndTransfersKhil,
    0.011,
    'doo: revenue = expenditure (balanced budget)',
  );
  c.near(o.balanceKhil, 0, 0.011, 'doo: balance is zero');
  c.near(
    o.ownRevKhil,
    rev.contributions + rev.nonTax + rev.vat,
    tolSum(3),
    'doo: own revenue = contributions + non-tax + VAT',
  );
  c.near(
    o.transfersFromCentralKhil,
    rev.transfers + rev.transfersShortage,
    tolSum(2),
    'doo: transfers from the centre = two transfer rows',
  );
  c.near(
    o.ownRevKhil + o.transfersFromCentralKhil,
    o.revAndTransfersKhil,
    tolSum(2),
    'doo: own revenue + transfers = total',
  );
  c.near(
    sum(values(pens)),
    exp.pensions,
    tolSum(3),
    'doo: the three pension rows add up to pensions',
  );
  c.near(
    o.transfersFromCentralKhil,
    line('III', '1.2'),
    0.011,
    'doo: transfers from the centre vs law art. 1 III.1.2',
  );
  c.near(exp.transfersOut, line('III', '2.1'), 0.011, 'doo: transfers out vs law art. 1 III.2.1');
  const pf = o.pensionFund;
  c.ok(
    equal(keys(pf), ['revAndTransfersKhil', 'expAndTransfersKhil', 'balanceKhil', 'sourceNote']) &&
      allNumbers([pf.revAndTransfersKhil, pf.expAndTransfersKhil, pf.balanceKhil]),
    'doo.pensionFund keys / numbers',
  );
  c.near(
    pf.balanceKhil,
    pf.revAndTransfersKhil - pf.expAndTransfersKhil,
    tolSum(2),
    'doo.pensionFund: balance = revenue - expenditure',
  );
  c.ok(
    pf.balanceKhil < 0 && pf.expAndTransfersKhil < o.expAndTransfersKhil,
    'doo.pensionFund: a deficit, and a part of the DOO budget',
  );
  const z = b.nzok;
  c.ok(z.short === 'НЗОК', 'nzok: short');
  rowIds(
    c,
    z.rev,
    ['contributions', 'transfersInsurance', 'nonTax', 'transfersHealthMinistry'],
    'nzok.rev',
  );
  rowIds(
    c,
    z.exp,
    ['staff', 'admin', 'payments', 'healthMinistry', 'assets', 'reserve'],
    'nzok.exp',
  );
  rowIds(
    c,
    z.paymentsSplit,
    [
      'primary',
      'specialised',
      'dental',
      'diagnostics',
      'medicines',
      'devicesHospital',
      'hospital',
      'other',
    ],
    'nzok.paymentsSplit',
  );
  const zr = rowsById(z.rev),
    ze = rowsById(z.exp),
    zp = rowsById(z.paymentsSplit);
  c.ok(allNumbers([...values(zr), ...values(ze), ...values(zp)]), 'nzok: row values are numbers');
  c.near(sum(values(zr)), z.revAndTransfersKhil, tolSum(4), 'nzok: revenue rows add up');
  c.near(sum(values(ze)), z.expAndTransfersKhil, tolSum(6), 'nzok: expenditure rows add up');
  c.near(z.revAndTransfersKhil, z.expAndTransfersKhil, 0.011, 'nzok: revenue = expenditure');
  c.near(z.balanceKhil, 0, 0.011, 'nzok: balance is zero');
  c.near(
    z.ownRevKhil,
    zr.contributions + zr.nonTax,
    tolSum(2),
    'nzok: own revenue = contributions + non-tax',
  );
  c.near(
    z.transfersFromStateKhil,
    zr.transfersInsurance + zr.transfersHealthMinistry,
    tolSum(2),
    'nzok: transfers from the state = two rows',
  );
  c.near(
    z.ownRevKhil + z.transfersFromStateKhil,
    z.revAndTransfersKhil,
    tolSum(2),
    'nzok: own revenue + transfers = total',
  );
  c.near(
    sum(values(zp)),
    ze.payments,
    tolSum(8),
    'nzok: the eight payment rows add up to payments',
  );
  c.near(
    zr.transfersHealthMinistry,
    ze.healthMinistry,
    0.011,
    'nzok: the Ministry of Health transfer comes in and goes out',
  );
  c.near(
    z.transfersFromStateKhil,
    line('III', '1.3'),
    0.011,
    'nzok: transfers from the state vs law art. 1 III.1.3',
  );
  c.near(
    zr.transfersHealthMinistry,
    line('III', '1.3.1'),
    0.011,
    'nzok: Ministry of Health part vs law art. 1 III.1.3.1',
  );
  c.ok(z.contributionRatePct === 8, 'nzok: contribution rate is 8.0 per cent (ZBNZOK art. 2)');
  const emp = ctx.get('rates.json').scenarios.find((x: Doc) => x.id === 'employment');
  c.near(
    emp.split.employee.health + emp.split.employer.health,
    z.contributionRatePct,
    0.011,
    'nzok: rate = employee + employer health share in rates.json',
  );
  const m = b.municipalities,
    mt = m.transfers;
  c.ok(
    m.count === 265 &&
      munic.totals.count === 265 &&
      m.year === 2026 &&
      m.dataset === 'municipalities',
    'municipalities: count / year / dataset',
  );
  const gdp26 = dig(outlook, 'gdp', 'mlnPrecise', 2),
    kfpExp26 = dig(outlook, 'kfp', 'expenditure', 'mln', 2);
  c.ok(outlook.years[2] === 2026, 'outlook: index 2 is the year 2026');
  c.near(
    m.expMln,
    m.localExpMln + m.delegatedExpMln,
    tolSum(2),
    'municipalities: local + delegated = expenditure',
  );
  c.near(
    m.localExpPct,
    (100 * m.localExpMln) / m.expMln,
    0.051,
    'municipalities: local share of expenditure',
  );
  c.near(
    m.expPctGdp,
    (100 * m.expMln) / gdp26,
    0.051,
    'municipalities: expenditure as per cent of GDP 2026',
  );
  c.near(
    m.expPctKfp,
    (100 * m.expMln) / (kfpExp26 - s.euContributionKhil / 1000),
    0.051,
    'municipalities: expenditure as per cent of the programme without the EU contribution',
  );
  c.near(
    m.delegatedExpMln,
    mt.mainSplit2026.delegatedKhil / 1000,
    0.051,
    'municipalities: delegated expenditure = delegated part of the subsidy',
  );
  c.near(
    mt.mainSplit2026.localKhil + mt.mainSplit2026.delegatedKhil,
    mt.mainKhil[0],
    tolSum(2),
    'municipalities: main subsidy split adds up',
  );
  c.ok(
    equal(mt.years, [2026, 2027, 2028]) && mt.mainKhil.length === 3,
    'municipalities.transfers: years / mainKhil length',
  );
  c.ok(
    equal(
      mt.byKind.map((k: Doc) => k.id),
      ['delegated', 'equalizing', 'winterRoads', 'capital'],
    ) && mt.byKind.every((k: Doc) => k.khil?.length === 3 && allNumbers(k.khil)),
    'municipalities.transfers.byKind ids / lengths',
  );
  for (let i = 0; i < 3; i++)
    c.near(
      sum(mt.byKind.map((k: Doc) => k.khil[i])),
      mt.mainKhil[i],
      tolSum(4),
      `municipalities.transfers: kinds add up to the main subsidy in ${mt.years[i]}`,
    );
  const cs = munic.check.columnSums;
  c.near(
    mt.mainKhil[0],
    cs[0],
    0.011,
    'municipalities: main subsidy 2026 vs municipalities.json column sum',
  );
  mt.byKind.forEach((k: Doc, i: number) =>
    c.near(
      k.khil[0],
      cs[i + 1],
      0.011,
      `municipalities: ${k.id} 2026 vs municipalities.json column sum`,
    ),
  );
  c.near(
    mt.otherTargetedKhil,
    cs[5],
    0.011,
    'municipalities: other targeted transfers vs municipalities.json',
  );
  c.near(
    mt.allKhil,
    mt.mainKhil[0] + mt.otherTargetedKhil,
    tolSum(2),
    'municipalities: all = main + other targeted',
  );
  c.near(
    mt.allKhil,
    line('III', '1.1'),
    0.011,
    'municipalities: all transfers vs law art. 1 III.1.1',
  );
  c.near(
    mt.allKhil,
    munic.totals.allKhil,
    0.011,
    'municipalities: all transfers vs municipalities.json totals',
  );
  const e = b.euAccounts,
    fs = e.fromStateBudgetKhil;
  c.ok(e.year === 2026 && e.vintage === 'draft', 'euAccounts: year / vintage');
  c.near(
    e.balanceMln,
    e.revMln - e.expMln + e.transferFromStateMln,
    tolSum(3),
    'euAccounts: balance = revenue - expenditure + transfer',
  );
  ordered(c, fs, ['nf', 'dfz', 'sum'], 'euAccounts.fromStateBudgetKhil keys');
  c.near(fs.sum, fs.nf + fs.dfz, tolSum(2), 'euAccounts: the two accounts add up');
  c.near(fs.nf, line('III', '1.4'), 0.011, 'euAccounts: National Fund vs law art. 1 III.1.4');
  c.near(
    fs.dfz,
    line('III', '1.5'),
    0.011,
    'euAccounts: State Fund Agriculture vs law art. 1 III.1.5',
  );
  c.ok(
    fs.sum / 1000 <= e.transferFromStateMln,
    'euAccounts: the transfers named in the law do not exceed the table II-4 total',
  );
  const ot = b.other;
  c.ok(equal(ot.years, [2026, 2027, 2028]), 'other: years');
  c.ok(
    equal(
      ot.items.map((x: Doc) => x.id),
      ['bnt', 'bnr', 'bta', 'banMon', 'universities', 'banMoew', 'militaryUniversities'],
    ) && ot.items.every((x: Doc) => text(x.label) && x.khil?.length === 3 && allNumbers(x.khil)),
    'other: item ids / labels / three values each',
  );
  for (let i = 0; i < 3; i++)
    c.near(
      sum(ot.items.map((x: Doc) => x.khil[i])),
      ot.sumKhil[i],
      tolSum(7),
      `other: items add up in ${ot.years[i]}`,
    );
  c.ok(ot.sumKhil.length === 3, 'other: sumKhil length');
  c.ok(
    ot.items.every((x: Doc) => x.khil.every((v: number) => v >= 0)),
    'other: no negative amounts',
  );
  const t = d.transfers;
  ordered(
    c,
    t,
    [
      'unit',
      'toMunicipalitiesKhil',
      'toDooKhil',
      'toNzokKhil',
      'toEuNfKhil',
      'toEuDfzKhil',
      'itemisedKhil',
      'otherKhil',
      'providedKhil',
      'receivedKhil',
      'netKhil',
      'toNzokFromHealthMinistryKhil',
      'source',
      'sourceNote',
    ],
    `transfers keys ${pyRepr(keys(t))}`,
  );
  c.ok(t.unit === 'хил. €' && equal(t.source, ['zdb']), 'transfers: unit / source');
  const five = [t.toMunicipalitiesKhil, t.toDooKhil, t.toNzokKhil, t.toEuNfKhil, t.toEuDfzKhil];
  c.ok(
    allNumbers([...five, t.itemisedKhil, t.otherKhil, t.providedKhil, t.receivedKhil, t.netKhil]),
    'transfers: every figure is a number',
  );
  c.near(sum(five), t.itemisedKhil, tolSum(5), 'transfers: the five named recipients add up');
  c.near(t.providedKhil - t.itemisedKhil, t.otherKhil, 0.06, 'transfers: other = provided - named');
  c.near(t.providedKhil - t.receivedKhil, t.netKhil, 0.06, 'transfers: net = provided - received');
  c.ok(t.otherKhil > 0, 'transfers: the unnamed remainder is positive');
  for (const [key, ref] of [
    ['toMunicipalitiesKhil', '1.1'],
    ['toDooKhil', '1.2'],
    ['toNzokKhil', '1.3'],
    ['toEuNfKhil', '1.4'],
    ['toEuDfzKhil', '1.5'],
    ['toNzokFromHealthMinistryKhil', '1.3.1'],
    ['providedKhil', '1'],
    ['receivedKhil', '2'],
  ] as const)
    c.near(t[key], line('III', ref), 0.011, `transfers.${key} vs law art. 1 III.${ref}`);
  c.near(t.netKhil, line('III', 'III'), 0.011, 'transfers.netKhil vs law art. 1 III');
  for (const [key, sk] of [
    ['providedKhil', 'providedKhil'],
    ['receivedKhil', 'receivedKhil'],
    ['netKhil', 'transfersNetKhil'],
  ] as const)
    c.near(t[key], s[sk], 0.011, `transfers.${key} vs the state block`);
  c.near(
    t.toMunicipalitiesKhil,
    mt.allKhil,
    0.011,
    'transfers: municipalities vs the municipalities block',
  );
  c.near(t.toDooKhil, o.transfersFromCentralKhil, 0.011, 'transfers: DOO vs the DOO block');
  c.near(t.toNzokKhil, z.transfersFromStateKhil, 0.011, 'transfers: NZOK vs the NZOK block');
  c.near(t.toEuNfKhil + t.toEuDfzKhil, fs.sum, 0.11, 'transfers: EU accounts vs the EU block');
  const sk = d.sankey;
  c.ok(equal(keys(sk), ['unit', 'nodes', 'links']) && sk.unit === 'млн. €', 'sankey keys / unit');
  c.ok(
    equal(
      sk.nodes.map((n: Doc) => n.id),
      ['state', ...targets],
    ) && sk.nodes.every((n: Doc) => text(n.name)),
    'sankey nodes',
  );
  c.ok(
    equal(
      sk.links.map((l: Doc) => l.target),
      targets,
    ) && sk.links.every((l: Doc) => l.source === 'state'),
    'sankey links: one from the state to each recipient',
  );
  const ref = Object.fromEntries(targets.map((k, i) => [k, [...five, t.otherKhil][i]]));
  for (const lk of sk.links) {
    const w = `sankey link state -> ${lk.target}`;
    c.ok(allNumbers([lk.value, lk.khil]) && lk.value > 0, `${w}: value / khil`);
    c.near(lk.khil, ref[lk.target], 0.011, `${w}: khil vs the transfers block`);
    c.near(lk.value, (lk.khil || 0) / 1000, 0.051, `${w}: value = khil / 1000`);
  }
  c.near(
    sum(sk.links.map((l: Doc) => l.khil)),
    t.providedKhil,
    tolSum(6),
    'sankey: the links add up to the provided transfers',
  );
  const n = d.nationalVsEu;
  ordered(
    c,
    n,
    [
      'unit',
      'years',
      'vintage',
      'national',
      'eu',
      'kfp',
      'exec',
      'textSplit',
      'source',
      'sourceNote',
    ],
    `nationalVsEu keys ${pyRepr(keys(n))}`,
  );
  c.ok(n.unit === 'млн. €' && equal(n.source, ['asbp']), 'nationalVsEu: unit / source');
  c.ok(
    equal(n.years, outlook.years) && equal(n.vintage, outlook.vintage),
    'nationalVsEu: years / vintage equal outlook.json',
  );
  const ny = n.years.length,
    nat = n.national,
    eu = n.eu,
    kfp = n.kfp;
  ordered(
    c,
    nat,
    ['revMln', 'expMln', 'spendingMln', 'euContributionMln', 'transferToEuMln', 'balanceMln'],
    'national keys',
  );
  ordered(c, eu, ['revMln', 'expMln', 'transferFromStateMln', 'balanceMln'], 'eu keys');
  ordered(c, kfp, ['revMln', 'expMln', 'balanceMln'], 'kfp keys');
  for (const [grp, blk] of [
    ['national', nat],
    ['eu', eu],
    ['kfp', kfp],
  ] as const)
    for (const [key, v] of Object.entries(blk) as [string, any][])
      c.ok(Array.isArray(v) && v.length === ny && allNumbers(v), `${grp}.${key}: ${ny} numbers`);
  if (
    [nat, eu, kfp].every((blk) => values(blk).every((v) => Array.isArray(v) && v.length === ny))
  ) {
    n.years.forEach((y: number, i: number) => {
      c.near(
        nat.balanceMln[i],
        nat.revMln[i] - nat.expMln[i] + nat.transferToEuMln[i],
        tolSum(3),
        `national balance ${y} = revenue - expenditure + transfer`,
      );
      c.near(
        eu.balanceMln[i],
        eu.revMln[i] - eu.expMln[i] + eu.transferFromStateMln[i],
        tolSum(3),
        `EU balance ${y} = revenue - expenditure + transfer`,
      );
      c.near(
        nat.transferToEuMln[i] + eu.transferFromStateMln[i],
        0,
        0.011,
        `${y}: the transfer leaves the national budget and enters the EU accounts`,
      );
      c.near(
        nat.spendingMln[i] + nat.euContributionMln[i],
        nat.expMln[i],
        tolSum(2),
        `national expenditure ${y} = spending + EU contribution`,
      );
      for (const key of ['revMln', 'expMln', 'balanceMln'])
        c.near(
          nat[key][i] + eu[key][i],
          kfp[key][i],
          tolSum(2),
          `national + EU = programme (${key}, ${y})`,
        );
      for (const [key, okey] of [
        ['revMln', 'revenue'],
        ['expMln', 'expenditure'],
        ['balanceMln', 'balance'],
      ] as const)
        c.near(kfp[key][i], outlook.kfp[okey].mln[i], 0.011, `kfp ${okey} ${y} vs outlook.json`);
    });
    c.near(
      nat.euContributionMln[2],
      s.euContributionKhil / 1000,
      0.051,
      'national: 2026 EU contribution vs the state block',
    );
    for (const [key, label] of [
      ['transferFromStateMln', 'transfer'],
      ['revMln', 'revenue'],
      ['expMln', 'expenditure'],
      ['balanceMln', 'balance'],
    ] as const)
      c.near(eu[key][2], e[key], 0.011, `EU: 2026 ${label} vs the euAccounts block`);
  }
  const ts = n.textSplit;
  c.ok(
    equal(ts.years, [2024, 2025]) && equal(ts.pages, [171, 175]) && ts.unit === 'млн. €',
    'textSplit: years / pages / unit',
  );
  ts.years.forEach((y: number, i: number) => {
    const j = n.years.indexOf(y);
    c.near(
      ts.diffNationalMln[i],
      ts.nationalMln[i] - nat.balanceMln[j],
      0.011,
      `textSplit ${y}: national difference = text - table`,
    );
    c.near(
      ts.diffEuMln[i],
      ts.euMln[i] - eu.balanceMln[j],
      0.011,
      `textSplit ${y}: EU difference = text - table`,
    );
    c.near(
      ts.nationalMln[i] + ts.euMln[i],
      kfp.balanceMln[j],
      tolSum(2),
      `textSplit ${y}: the two parts add up to the programme balance`,
    );
    c.ok(
      ts.diffNationalMln[i] !== 0 && ts.diffEuMln[i] !== 0,
      `textSplit ${y}: the text and the table do differ (otherwise the note is wrong)`,
    );
  });
  const ex = n.exec,
    lat = execu.latest;
  c.ok(
    ex.asOf === lat.asOf &&
      ex.month === lat.month &&
      ex.ref === 'execution' &&
      ex.unit === 'млн. €',
    'exec: asOf / month / ref / unit equal execution.json latest',
  );
  for (const grp of ['national', 'eu'])
    for (const [key, src] of [
      ['rev', 'rev'],
      ['exp', 'exp.total'],
      ['balance', 'balance'],
    ] as const) {
      const got = dig(ex, grp, key),
        col = grp === 'national' ? 'nat' : 'eu';
      c.ok(equal(got, dig(lat, col, src)), `exec.${grp}.${key} equals execution.json latest`);
      c.ok(
        got &&
          typeof got === 'object' &&
          !Array.isArray(got) &&
          !('plan' in got) &&
          !('pctPlan' in got),
        `exec.${grp}.${key}: no unevidenced law denominator or percent`,
      );
      c.ok(execu.plan2026.coverage[col], 'execution split has an explicit law coverage reason');
    }
  const mb = d.monthlyByBudget;
  c.ok(
    mb.status === 'pending' &&
      mb.id === 'P02' &&
      equal(keys(mb), ['status', 'id', 'title', 'reason', 'expected', 'source', 'screens']),
    `monthlyByBudget: pending P02 keys ${pyRepr(keys(mb))}`,
  );
  c.ok(numbersIn(mb) === 0, 'monthlyByBudget: no numbers while pending');
  c.ok(
    ['title', 'reason', 'expected'].every((k) => text(mb[k])) &&
      equal(mb.source, ['minfin']) &&
      equal(mb.screens, ['S15']),
    'monthlyByBudget: texts / source / screens',
  );
  c.ok(
    Array.isArray(d.notes) && d.notes.length === 7 && d.notes.every(cleanText),
    'notes: seven non-empty strings',
  );
  c.fact(
    `COMPONENTS: ${d.notes.length} notes; transfers provided ${fmt(t.providedKhil)} thousand EUR, of which ${fmt(t.itemisedKhil)} to the five named recipients`,
  );
  return c;
}

const scenarioIds = ['employment', 'management-contract', 'self-employed', 'pensioner'];
const parts = ['doo', 'upf', 'health'];
const num = '(\\d+(?:[ \u00a0]\\d{3})*(?:,\\d+)?)';
const bg = (s: string) => Number(s.replace(/[ \u00a0]/g, '').replace(',', '.'));
const first = (rx: string, s: string): string[] | null => new RegExp(rx).exec(s)?.slice(1) ?? null;
const scalar = (s: string): number | null => (/^\d+(,\d+)?$/.test(s) ? bg(s) : null);

function scenarioChecks(c: Check, r: Doc, a: Doc): void {
  const sc = Object.fromEntries(r.scenarios.map((x: Doc) => [x.id, x])),
    y26 = (no: string): string => a[no]?.years?.['2026'] ?? '';
  const pension = first(
    '^' +
      num +
      ' за родените преди 1 януари 1960 г\\.; ' +
      num +
      ' за родените след 31 декември 1959 г\\.',
    y26('11.1'),
  );
  const sick = scalar(y26('11.3')),
    unemp = scalar(y26('11.5')),
    health = scalar(y26('12')),
    upf = scalar(y26('13')),
    gvrs = scalar(y26('16'));
  const split = first(
    '^' +
      num +
      ':' +
      num +
      ' за лицата родени преди 1 януари 1960 г\\. ' +
      num +
      ':' +
      num +
      ' за лицата, родени след 31 декември 1959 г\\.$',
    y26('20.2'),
  );
  c.ok(
    pension !== null &&
      split !== null &&
      sick !== null &&
      unemp !== null &&
      health !== null &&
      upf !== null &&
      gvrs !== null,
    'assumptions: the 2026 strings of rows 11.1, 11.3, 11.5, 12, 13, 16, 20.2 have the printed form',
  );
  if (
    !pension ||
    !split ||
    sick === null ||
    unemp === null ||
    health === null ||
    upf === null ||
    gvrs === null
  )
    return;
  const [pOld, pNew] = pension.map(bg) as [number, number],
    [empOld, eeOld, empNew, eeNew] = split.map(bg) as [number, number, number, number];
  c.near(empOld + eeOld, pOld, 0.011, 'ASBP row 20.2 (before 1960) adds up to row 11.1');
  c.near(empNew + eeNew, pNew, 0.011, 'ASBP row 20.2 (after 1959) adds up to row 11.1');
  c.ok(
    first('^60:40$', y26('20.1')) !== null && first('^60:40$', y26('20.3')) !== null,
    'ASBP rows 20.1 and 20.3: split 60:40',
  );
  const e = sc.employment;
  c.near(
    e.split.employee.doo,
    eeNew + 0.4 * sick + 0.4 * unemp,
    0.0051,
    'employment: employee DOO share from the ASBP rows',
  );
  c.near(
    e.split.employer.doo,
    empNew + 0.6 * sick + 0.6 * unemp,
    0.0051,
    'employment: employer DOO share from the ASBP rows',
  );
  c.near(
    e.split.employee.health,
    0.4 * health,
    0.0051,
    'employment: employee health share = 40 per cent of 8',
  );
  c.near(
    e.split.employer.health,
    0.6 * health,
    0.0051,
    'employment: employer health share = 60 per cent of 8',
  );
  c.near(
    e.split.employee.upf + e.split.employer.upf,
    upf,
    0.0051,
    'employment: UPF shares add up to row 13',
  );
  c.near(e.gvrsPct, gvrs, 0.0051, 'employment: GVRS rate = row 16');
  const variants = e.variants.filter((x: Doc) => x.id === 'born-before-1960');
  c.ok(
    variants.length === 1 && e.variants.length === 1,
    'employment: exactly one variant, born-before-1960',
  );
  if (variants.length) {
    const v = variants[0];
    c.near(
      v.split.employee.doo,
      eeOld + 0.4 * sick + 0.4 * unemp,
      0.0051,
      'born-before-1960: employee DOO share',
    );
    c.near(
      v.split.employer.doo,
      empOld + 0.6 * sick + 0.6 * unemp,
      0.0051,
      'born-before-1960: employer DOO share',
    );
    c.ok(
      v.split.employee.upf === 0 && v.split.employer.upf === 0,
      'born-before-1960: no UPF share',
    );
    for (const who of ['employee', 'employer'])
      c.near(
        v.split[who].health,
        e.split[who].health,
        0.0051,
        `born-before-1960: the same ${who} health share`,
      );
    c.near(
      v.employeePct,
      e.employeePct,
      0.0051,
      'born-before-1960: the same employee total (only the fund split differs)',
    );
    c.near(
      v.employerPctWithoutTzpb,
      e.employerPctWithoutTzpb,
      0.0051,
      'born-before-1960: the same employer total',
    );
  }
  const se = sc['self-employed'];
  c.near(
    se.split.employee.doo,
    pNew,
    0.0051,
    'self-employed: DOO share = row 11.1 (born after 1959)',
  );
  c.near(se.split.employee.upf, upf, 0.0051, 'self-employed: UPF share = row 13');
  c.near(se.split.employee.health, health, 0.0051, 'self-employed: health share = row 12');
  const sv = se.variants.filter((x: Doc) => x.id === 'with-sickness-maternity');
  c.ok(
    sv.length === 1 && se.variants.length === 1,
    'self-employed: exactly one variant, with-sickness-maternity',
  );
  if (sv.length) {
    c.near(
      sv[0].split.employee.doo,
      pNew + sick,
      0.0051,
      'with-sickness-maternity: DOO share = pension + sickness fund (row 11.3)',
    );
    c.near(sv[0].employeePct, pNew + sick + upf + health, 0.0051, 'with-sickness-maternity: total');
  }
}
function limitsChecks(c: Check, r: Doc, a: Doc, sc: Doc): void {
  const amounts = [...r.quotes.zbdoo_art9.matchAll(new RegExp(num + ' евро', 'g'))].map((m) =>
    bg(m[1]!),
  );
  c.ok(
    equal(amounts, [550.66, 2111.64, 620.2, 2300]),
    `ZBDOO art. 9 quote: amounts ${pyRepr(amounts)}`,
  );
  const rx = '^' + num + ', считано от 1 януари; ' + num + ', считано от 1 август$';
  const m18 = first(rx, a['18']?.years?.['2026'] ?? ''),
    m19 = first(rx, a['19']?.years?.['2026'] ?? '');
  c.ok(m18 !== null && m19 !== null, 'ASBP rows 18 and 19: the 2026 strings have the printed form');
  const mx = [
    { id: 'until', from: '2026-01-01', to: '2026-07-31', eur: 2111.64 },
    { id: 'from', from: '2026-08-01', to: '2026-12-31', eur: 2300 },
  ];
  const mn = [
    { id: 'until', from: '2026-01-01', to: '2026-07-31', eur: 550.66 },
    { id: 'from', from: '2026-08-01', to: '2026-12-31', eur: 620.2 },
  ];
  if (m18 && m19)
    c.ok(
      equal(m18.map(bg), [2111.64, 2300]) && equal(m19.map(bg), [550.66, 620.2]),
      'ASBP rows 18 / 19 equal the law amounts',
    );
  for (const sid of scenarioIds.slice(0, 3))
    c.ok(
      equal(sc[sid].maxInsurableIncomeEur, mx),
      `${sid}: maxInsurableIncomeEur equals the ZBDOO art. 9 amounts`,
    );
  c.ok(
    equal(sc['self-employed'].minInsurableIncomeEur, mn),
    'self-employed: minInsurableIncomeEur equals the ZBDOO art. 9 amounts',
  );
  c.ok(
    equal(r.minInsurableIncome.selfEmployedEur, mn),
    'minInsurableIncome.selfEmployedEur equals the same amounts',
  );
}

export function rates(ctx: Context, napReader?: NapRowsReader): Check {
  const c = new Check('RATES'),
    r = ctx.get('rates.json');
  ordered(
    c,
    r,
    [
      'meta',
      'scenarios',
      'rules',
      'incomeTax',
      'tzpb',
      'minInsurableIncome',
      'changes',
      'napCategories',
      'assumptions',
      'quotes',
      'notes',
      'checks',
    ],
    `rates keys ${pyRepr(keys(r))}`,
  );
  const me = r.meta;
  c.ok(
    me.id === 'D17' &&
      me.status === 'real' &&
      equal(me.source, ['nap', 'zbdoo', 'zbnzok', 'asbp']) &&
      me.unit === '%' &&
      equal(me.pending, []) &&
      me.mock === false,
    'meta id / status / source / unit / pending',
  );
  c.ok(me.asOf === '2026-08-12' && me.retrieved === ctx.buildDate, 'meta asOf / retrieved');
  c.ok(
    equal(r.rules, { validTo: '2026-07-31', from: '2026-08-01', year: 2026 }),
    'rules: the two periods of 2026',
  );
  const a = Object.fromEntries(r.assumptions.map((x: Doc) => [x.no, x]));
  c.ok(r.assumptions.length === 15 && keys(a).length === 15, 'assumptions: 15 distinct rows');
  c.ok(
    r.assumptions.every(
      (x: Doc) =>
        text(x.label) &&
        x.years &&
        typeof x.years === 'object' &&
        !Array.isArray(x.years) &&
        values(x.years).every(text),
    ),
    'assumptions: verbatim strings in every year cell',
  );
  const sc = Object.fromEntries(r.scenarios.map((x: Doc) => [x.id, x]));
  c.ok(
    equal(
      r.scenarios.map((x: Doc) => x.id),
      scenarioIds,
    ),
    `scenario ids ${pyRepr(r.scenarios.map((x: Doc) => x.id))}`,
  );
  if (!equal(keys(sc), scenarioIds)) return c;
  const srcKeys = new Set(keys(ctx.get('core.json').sources ?? {}));
  for (const s of r.scenarios) {
    const w = `scenario ${s.id}`;
    c.ok(
      ['real', 'pending'].includes(s.status) &&
        Array.isArray(s.source) &&
        s.source.length > 0 &&
        s.source.every((k: string) => srcKeys.has(k)),
      `${w}: status / source`,
    );
    c.ok(text(s.label), `${w}: label`);
  }
  const pen = sc.pensioner;
  c.ok(
    pen.status === 'pending' &&
      numbersIn(pen) === 0 &&
      ['reason', 'expected'].every((k) => text(pen[k])),
    'pensioner: pending, texts, no numbers',
  );
  c.ok(
    sameSet(keys(pen), ['id', 'label', 'status', 'source', 'reason', 'expected']),
    `pensioner: keys ${pyRepr(keys(pen).sort())}`,
  );
  for (const sid of scenarioIds.slice(0, 3)) {
    const s = sc[sid],
      w = `scenario ${sid}`,
      sp = s.split;
    c.ok(s.status === 'real', `${w}: status real`);
    for (const who of ['employee', 'employer'])
      c.ok(
        equal(keys(sp[who]), parts) &&
          allNumbers(values(sp[who])) &&
          values(sp[who]).every((v) => v >= 0),
        `${w}: ${who} split parts`,
      );
    c.near(
      s.employeePct,
      sum(values(sp.employee)),
      0.0051,
      `${w}: employee total = sum of the three funds`,
    );
    c.near(
      'employerPctWithoutTzpb' in s ? s.employerPctWithoutTzpb : s.employerPct,
      sum(values(sp.employer)),
      0.0051,
      `${w}: employer total = sum of the three funds`,
    );
    c.ok(text(s.appliesTo) && text(s.basis), `${w}: appliesTo / basis`);
    c.ok(
      (s.pending ?? []).every(
        (p: Doc) =>
          typeof p.field === 'string' &&
          text(p.reason) &&
          typeof p.expected === 'string' &&
          p.source,
      ),
      `${w}: pending entries carry field / reason / expected / source`,
    );
  }
  const tz = r.tzpb;
  for (const sid of ['employment', 'management-contract']) {
    const s = sc[sid];
    c.ok(
      equal(s.tzpbPct, { min: tz.min, max: tz.max, used: tz.used }),
      `${sid}: tzpbPct equals the tzpb block`,
    );
    c.near(
      s.employerPct,
      s.employerPctWithoutTzpb + tz.used,
      0.0051,
      `${sid}: employer total = funds + TZPB (the lowest rate)`,
    );
    c.near(s.gvrsPct, 0, 0.0001, `${sid}: no GVRS contribution in 2026 (ZBDOO art. 15)`);
  }
  c.ok(
    sc['management-contract'].sameRatesAs === 'employment',
    'management-contract: same rates as employment',
  );
  for (const k of [
    'employeePct',
    'employerPct',
    'employerPctWithoutTzpb',
    'split',
    'maxInsurableIncomeEur',
  ])
    c.ok(
      equal(sc['management-contract'][k], sc.employment[k]),
      `management-contract: ${k} equals employment`,
    );
  const se = sc['self-employed'];
  c.ok(
    se.employerPct === 0 && values(se.split.employer).every((v) => v === 0),
    'self-employed: nothing paid by an employer',
  );
  c.ok(
    equal(
      (sc['management-contract'].pending ?? []).map((p: Doc) => p.field),
      ['incomeTaxPct'],
    ) &&
      equal(
        (se.pending ?? []).map((p: Doc) => p.field),
        ['incomeTaxPct'],
      ),
    'pending income tax of the two scenarios',
  );
  c.ok(
    !('incomeTaxPct' in sc['management-contract']) && !('incomeTaxPct' in se),
    'no income-tax figure where it is pending',
  );
  c.ok(
    sc.employment.incomeTaxPct === r.incomeTax.ratePct && !('pending' in sc.employment),
    'employment: income tax equals the incomeTax block, nothing pending',
  );
  scenarioChecks(c, r, a);
  limitsChecks(c, r, a, sc);
  const it = r.incomeTax,
    years = ['2025', '2026', '2027', '2028'];
  c.ok(
    equal(it.source, ['asbp']) &&
      equal(keys(it.years), years) &&
      equal(keys(it.soleTraderBusinessPct), years),
    'incomeTax: years',
  );
  const row3 = a['3'] ?? {};
  for (const y of years) {
    const s = row3.years?.[y] ?? '',
      sub = row3.sub?.[0]?.years?.[y] ?? '';
    c.ok(
      /^\d+(,\d+)?$/.test(s) && bg(s) === it.years[y] && it.years[y] === it.ratePct,
      `incomeTax ${y}: the ASBP row 3 string equals the stored rate`,
    );
    c.ok(
      /^\d+(,\d+)?$/.test(sub) && bg(sub) === it.soleTraderBusinessPct[y],
      `incomeTax ${y}: the ASBP row 3 sole-trader string equals the stored rate`,
    );
  }
  const acts: Doc[] = tz.activities,
    codes = acts.map((x) => x.code);
  c.ok(
    acts.length === 87 &&
      new Set(codes).size === 87 &&
      codes.every((x) => typeof x === 'string' && /^\d{2}$/.test(x)),
    'tzpb: 87 distinct two-digit activity codes',
  );
  c.ok(equal(codes, [...codes].sort()), 'tzpb: activities in code order');
  c.ok(
    acts.every((x) => cleanText(x.name)),
    'tzpb: activity names',
  );
  const vals = acts.flatMap((x) => [x.until, x.from]);
  c.ok(allNumbers(vals), 'tzpb: every rate is a number');
  if (allNumbers(vals)) {
    c.near(Math.min(...vals), tz.min, 0.0001, 'tzpb: minimum rate');
    c.near(Math.max(...vals), tz.max, 0.0001, 'tzpb: maximum rate');
    const changed = acts.filter((x) => x.until !== x.from).map((x) => x.code),
      ch = r.changes.filter((x: Doc) => x.id === 'tzpb-by-activity');
    c.ok(
      tz.changed === changed.length && changed.length === 7,
      `tzpb: changed = ${changed.length}`,
    );
    c.ok(
      ch.length === 1 &&
        equal(ch[0].changedCodes, changed) &&
        ch[0].changed === changed.length &&
        ch[0].activities === acts.length,
      'changes: tzpb-by-activity matches the table',
    );
  }
  c.near(tz.used, tz.min, 0.0001, 'tzpb: the calculator uses the lowest rate');
  c.ok(tz.min === 0.4 && tz.max === 1.1, 'tzpb: range 0.4 to 1.1 per cent');
  const t114 = first('от ' + num + ' до ' + num + ' на сто', a['11.4']?.years?.['2026'] ?? '');
  c.ok(
    t114 !== null && equal(t114.map(bg), [tz.min, tz.max]),
    'tzpb: the range equals the ASBP row 11.4',
  );
  const mi = r.minInsurableIncome,
    rows: Doc[] = mi.rows,
    groups = mi.groups;
  c.ok(
    groups.length === 9 && groups.every(text) && new Set(groups).size === 9,
    'minInsurableIncome: nine occupation groups',
  );
  c.ok(
    rows.length === 86 &&
      equal(
        rows.map((x) => x.no),
        Array.from({ length: 86 }, (_, i) => i + 1),
      ),
    'minInsurableIncome: rows numbered 1 to 86',
  );
  c.ok(
    rows.every((x) => text(x.name) && typeof x.code === 'string'),
    'minInsurableIncome: names / codes are strings',
  );
  const noCode = rows.filter((x) => !x.code).map((x) => x.no);
  c.ok(
    equal(noCode, [82]) && rows[81]?.name === 'Централен кооперативен съюз',
    `minInsurableIncome: only row 82 (the Central Cooperative Union, listed without an activity code) has no code, got ${pyRepr(noCode)}`,
  );
  let cells = 0,
    filled = 0,
    empty = 0,
    changedC = 0,
    holesAgree = true,
    rises = true;
  const uVals: number[] = [],
    fVals: number[] = [];
  for (const x of rows) {
    const us = x.until,
      fs = x.from;
    if (!Array.isArray(us) || !Array.isArray(fs) || us.length !== 9 || fs.length !== 9) {
      c.fail(`minInsurableIncome row ${x.no}: until / from must have nine cells`);
      continue;
    }
    for (let i = 0; i < 9; i++) {
      const u = us[i],
        f = fs[i];
      cells++;
      if (u === null || f === null) {
        empty++;
        holesAgree = holesAgree && u === null && f === null;
        continue;
      }
      c.ok(
        isnum(u) && isnum(f) && u > 0 && f > 0,
        `minInsurableIncome row ${x.no}: cell values ${u} / ${f}`,
      );
      filled++;
      uVals.push(u);
      fVals.push(f);
      if (u !== f) changedC++;
      rises = rises && f > u;
    }
  }
  c.ok(holesAgree, 'minInsurableIncome: an empty cell is empty in both periods');
  c.ok(
    cells === 774 && mi.cells === 774 && empty === 30 && mi.emptyCells === 30 && filled === 744,
    `minInsurableIncome: ${cells} cells, ${empty} empty, ${filled} filled`,
  );
  c.ok(rises, 'minInsurableIncome: every filled cell rises on 1 August');
  const minChanges = r.changes.filter((x: Doc) => x.id === 'min-income-by-activity');
  c.ok(minChanges.length === 1, 'changes: min-income-by-activity');
  if (minChanges.length === 1 && uVals.length) {
    const ch = minChanges[0];
    c.ok(
      ch.cells === cells && ch.filled === filled && ch.changed === changedC,
      'changes: min-income-by-activity counts',
    );
    c.ok(
      equal(
        [ch.untilMin, ch.untilMax, ch.fromMin, ch.fromMax],
        [Math.min(...uVals), Math.max(...uVals), Math.min(...fVals), Math.max(...fVals)],
      ),
      'changes: min-income-by-activity ranges',
    );
    c.near(
      Math.min(...uVals),
      se.minInsurableIncomeEur[0].eur,
      0.0001,
      'the smallest minimum income of the annex equals the self-employed minimum (until)',
    );
    c.near(
      Math.min(...fVals),
      se.minInsurableIncomeEur[1].eur,
      0.0001,
      'the smallest minimum income of the annex equals the self-employed minimum (from)',
    );
  }
  c.ok(
    Array.isArray(mi.notes) && mi.notes.length === 5 && mi.notes.every(text),
    'minInsurableIncome: five legal notes',
  );
  const cd = Object.fromEntries(r.changes.map((x: Doc) => [x.id, x]));
  c.ok(
    equal(
      r.changes.map((x: Doc) => x.id),
      [
        'max-insurable',
        'min-self-employed',
        'min-income-by-activity',
        'tzpb-by-activity',
        'civil-servant-employee-share',
        'civil-servant-employer-share',
      ],
    ),
    `changes ids ${pyRepr(r.changes.map((x: Doc) => x.id))}`,
  );
  for (const [cid, key] of [
    ['max-insurable', 'maxInsurableIncomeEur'],
    ['min-self-employed', 'minInsurableIncomeEur'],
  ] as const) {
    const x = cd[cid] ?? {},
      arr = (cid === 'min-self-employed' ? se : sc.employment)[key];
    c.ok(
      x.until === arr[0].eur && x.from === arr[1].eur,
      `changes.${cid}: until / from equal the scenario amounts`,
    );
    if (isnum(x.until) && isnum(x.from)) {
      c.near(x.delta, x.from - x.until, 0.011, `changes.${cid}: delta`);
      c.near(x.deltaPct, (100 * (x.from - x.until)) / x.until, 0.0051, `changes.${cid}: deltaPct`);
    }
  }
  for (const cid of ['civil-servant-employee-share', 'civil-servant-employer-share']) {
    const x = cd[cid] ?? {};
    if (isnum(x.until) && isnum(x.from)) {
      c.near(x.delta, x.from - x.until, 0.011, `changes.${cid}: delta`);
      if ('deltaPct' in x)
        c.near(
          x.deltaPct,
          (100 * (x.from - x.until)) / x.until,
          0.0051,
          `changes.${cid}: deltaPct`,
        );
    }
  }
  const csE = cd['civil-servant-employee-share'] ?? {},
    csR = cd['civil-servant-employer-share'] ?? {};
  if (allNumbers([csE.until, csE.from, csR.until, csR.from]))
    c.near(
      csE.until + csR.until,
      csE.from + csR.from,
      0.0051,
      'civil servants: the two shares add up to the same total before and after 1 August',
    );
  else c.fail('civil servants: until / from of both shares must be numbers');
  for (const x of r.changes)
    c.ok(
      text(x.label) &&
        text(x.basis) &&
        Array.isArray(x.source) &&
        x.source.length &&
        x.source.every((k: string) => srcKeys.has(k)),
      `changes.${x.id}: label / basis / source`,
    );
  const nc: Doc[] = r.napCategories;
  c.ok(
    equal(
      nc.map((x) => x.no),
      Array.from({ length: 19 }, (_, i) => i + 1),
    ),
    'napCategories: numbered 1 to 19',
  );
  c.ok(
    nc.every((x) => text(x.label) && Number.isInteger(x.page) && x.page >= 1),
    'napCategories: label / page',
  );
  c.ok(
    equal(
      nc.map((x) => x.page),
      nc.map((x) => x.page).sort((x, y) => x - y),
    ),
    'napCategories: pages ascend',
  );
  c.ok(
    nc.every((x) => (x.modelledBy ?? []).every((id: string) => sc[id]?.status === 'real')),
    'napCategories: modelledBy names real scenarios',
  );
  const mb = Object.fromEntries(nc.map((x) => [x.no, x.modelledBy]));
  c.ok(
    equal(mb[1], ['employment', 'management-contract']) &&
      equal(mb[10], ['self-employed']) &&
      Object.entries(mb).every(
        ([k, v]) => ['1', '10'].includes(k) || (Array.isArray(v) && v.length === 0),
      ),
    'napCategories: categories 1 and 10 are modelled, the other 17 are not',
  );
  const q = r.quotes;
  c.ok(
    equal(keys(q), ['zbdoo_art9', 'zbdoo_art14', 'zbdoo_art15', 'zbnzok_art2']) &&
      values(q).every(text),
    'quotes: four law articles',
  );
  c.ok(
    q.zbnzok_art2.includes('8 на сто') &&
      q.zbdoo_art15.includes('не се внасят') &&
      q.zbdoo_art14.includes('приложение № 2А'),
    'quotes: ZBNZOK art. 2 = 8 per cent; ZBDOO art. 15 = no GVRS; art. 14 names annex 2A',
  );
  c.ok(
    Array.isArray(r.notes) && r.notes.length === 7 && r.notes.every(cleanText),
    'notes: seven non-empty strings',
  );
  const ck = r.checks;
  ordered(
    c,
    ck,
    [
      'napRowsAddUp',
      'napTotalsVsBill',
      'napSplitVsBill',
      'limitsVsLawAndBill',
      'tzpbRangeVsBill',
      'annexesAligned',
      'annexRows',
      'activities',
      'nameFixes',
    ],
    'checks keys',
  );
  c.ok(
    [
      'napRowsAddUp',
      'napTotalsVsBill',
      'napSplitVsBill',
      'limitsVsLawAndBill',
      'tzpbRangeVsBill',
      'annexesAligned',
    ].every((k) => ck[k] === true),
    'checks: every stored verdict is true',
  );
  c.ok(
    ck.annexRows === rows.length &&
      ck.activities === acts.length &&
      Number.isInteger(ck.nameFixes) &&
      ck.nameFixes >= 0,
    'checks: counts equal the tables',
  );
  c.fact(
    `RATES: employment ${sc.employment.employeePct} / ${sc.employment.employerPct} per cent (employee / employer incl. TZPB), self-employed ${se.employeePct} per cent, ${cells} annex cells (${empty} empty), ${acts.length} TZPB activities (${tz.changed} changed)`,
  );
  checkNapEvidence(ctx, c, r, napReader);
  return c;
}

export const componentsRatesGroups: Group<Context>[] = [
  {
    name: 'COMPONENTS',
    description: 'Constituent budgets, transfers, national vs EU, Sankey and cross-dataset ties',
    run: components,
  },
  {
    name: 'RATES',
    description:
      'Contribution scenarios, ASBP strings, limits, TZPB, minimum incomes and NAP coverage',
    run: rates,
  },
];

export interface NapRow {
  page: number;
  label: string;
  cells: string[];
}
export type NapRowsReader = (pdf: OriginalBytes) => Record<string, NapRow>;
export const NAP_ORIGINAL_PATH = 'data/originals/nap/nap_prilozhenie_1_VK-30-10237_12.08.2026.pdf';
function checkNapEvidence(ctx: Context, c: Check, r: Doc, reader?: NapRowsReader): void {
  const absolute = safePath(ctx.root, NAP_ORIGINAL_PATH);
  if (!existsSync(absolute)) {
    c.fact(
      'NAP original unavailable: scenario identities checked from ASBP strings; stored NAP verdicts are not an independent PDF re-read',
    );
    return;
  }
  try {
    const bytes = readFileSync(absolute),
      digest = sha256(bytes);
    if (!c.ok(digest === originalPins(ctx).get(NAP_ORIGINAL_PATH), 'NAP original pin')) return;
    if (!reader) {
      c.fail('NAP original is present but the independent NAP reader is not bound');
      return;
    }
    const nap = reader({ path: NAP_ORIGINAL_PATH, sha256: digest, bytes }),
      funds: Doc = {};
    const percent = (s: string): number => {
      if (!s.trim() || s.trim() === '-') return 0;
      const m = /^(\d+(?:,\d+)?)/.exec(s.trim());
      if (!m) throw new Error('unreadable NAP percentage: ' + s);
      return bg(m[1]!);
    };
    for (const rid of ['1.1.', '1.2.', '5.1.2.', '5.2.2.', '10.1.2.', '10.2.2.']) {
      const row = nap[rid];
      if (!row || row.cells.length !== 15 || !Number.isInteger(row.page) || row.page < 1)
        throw new Error('missing NAP source row ' + rid);
      const f: Doc = {};
      funds[rid] = f;
      for (const [who, base] of [
        ['total', 4],
        ['employee', 8],
        ['employer', 12],
      ] as const)
        f[who] = Object.fromEntries(parts.map((part, i) => [part, percent(row.cells[base + i]!)]));
      for (const part of parts)
        c.near(
          f.total[part],
          f.employee[part] + f.employer[part],
          0.0051,
          `NAP ${rid}: ${part} total = employee + employer`,
        );
    }
    const sc = Object.fromEntries(r.scenarios.map((s: Doc) => [s.id, s]));
    const scenarios: [string, Doc][] = [
      ['1.2.', sc.employment],
      ['1.1.', sc.employment.variants[0]],
      ['10.1.2.', sc['self-employed']],
      ['10.2.2.', sc['self-employed'].variants[0]],
    ];
    for (const [rid, s] of scenarios)
      for (const who of ['employee', 'employer'])
        for (const part of parts) {
          const expected = s.split[who]?.[part];
          c.near(expected, funds[rid][who][part], 0.0051, `NAP ${rid}: ${who} ${part} vs scenario`);
        }
    for (const who of ['employee', 'employer']) {
      const change = r.changes.find((x: Doc) => x.id === `civil-servant-${who}-share`);
      c.near(
        change?.until,
        sum(values(funds['5.1.2.'][who])),
        0.0051,
        `NAP civil-servant ${who}: until`,
      );
      c.near(
        change?.from,
        sum(values(funds['5.2.2.'][who])),
        0.0051,
        `NAP civil-servant ${who}: from`,
      );
    }
    const euroAmounts = (s: string): number[] =>
      [...s.matchAll(/(\d+(?:,\d+)?) евро/g)].map((m) => bg(m[1]!));
    const max = sc.employment.maxInsurableIncomeEur.map((x: Doc) => x.eur);
    const min = sc['self-employed'].minInsurableIncomeEur.map((x: Doc) => x.eur);
    c.ok(
      equal(euroAmounts(nap['1.2.']!.cells[2]!), max),
      'NAP 1.2.: printed maximum income limits',
    );
    for (const rid of ['10.1.2.', '10.2.2.'])
      c.ok(
        equal(euroAmounts(nap[rid]!.cells[2]!), [...min, ...max]),
        `NAP ${rid}: printed minimum and maximum income limits`,
      );
    for (let no = 1; no <= 19; no++) {
      const row = nap[`${no}.`],
        category = r.napCategories.find((x: Doc) => x.no === no);
      c.ok(
        row &&
          category?.page === row.page &&
          row.label.startsWith(category.label.replace(/…$/, '')),
        `NAP category ${no}: source page and category label`,
      );
    }
    c.fact(
      'independent NAP reader supplied six contribution rows; funds, scenarios and civil-servant effects recomputed',
    );
  } catch (error) {
    c.fail(
      'cannot verify independent NAP evidence: ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
export function ratesGroup(reader?: NapRowsReader): Group<Context> {
  return {
    name: 'RATES',
    description: componentsRatesGroups[1]!.description,
    run: (ctx) => rates(ctx, reader),
  };
}
