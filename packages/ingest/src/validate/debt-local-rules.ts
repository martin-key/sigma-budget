import { isPublishedDataset } from '@sigma-budget/dataset-schema';
/** Independent ports of validate/{debt,local_finance}.py at 3424bc998c726d6d511d4284295c54c50c42d099.
 * These rules inspect published datasets, not the corresponding production builders.
 * Original-source and additional safety checks are separate APIs; see debt-local/README.md.
 */
import { isDeepStrictEqual as eq } from 'node:util';
import { Check, fmt, isnum, pyRepr, pyTruth } from './checks.js';
import type { Context } from './context.js';
import type { Group } from './runner.js';
import { pythonFloatSum as sum } from '../common/numbers.js';

const sameSet = (a: unknown[], b: unknown[]) => eq([...new Set(a)].sort(), [...new Set(b)].sort());
const keys = (o: object, expected: string[]) => sameSet(Object.keys(o), expected);
const text = (s: unknown): s is string => typeof s === 'string' && !!s.trim();
const tolSum = (n: number) => 0.05 * (n + 1) + 0.01;
const words: Record<string, string> = { actual: 'Отчет', plan: 'Проект', forecast: 'Прогноза' };
const groupIds = ['maturity', 'instrument', 'rate', 'currency', 'creditor'];
const limitIds = ['debtCap', 'newDebt', 'newGuarantees', 'guaranteesAll', 'fiscalReserve'];
const columns = ['total', 'delegated', 'equalizing', 'winterRoads', 'capital', 'otherTargeted'];
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const iso = /^\d{4}-\d{2}-\d{2}$/;

function quarters(first: string, n: number): string[] {
  let year = Number(first.slice(0, 4)),
    quarter = Number(first.at(-1));
  return Array.from({ length: n }, () => {
    const out = `${year}-Q${quarter++}`;
    if (quarter === 5) {
      year++;
      quarter = 1;
    }
    return out;
  });
}
function printedMln(s: string): number | null {
  const m = /^([\d\s\u00a0\u202f]+(?:,\d+)?)\s*(млрд|млн)\.?\s+евро$/.exec(s || '');
  return m
    ? Number(
        (Number(m[1]!.replace(/\s/g, '').replace(',', '.')) * (m[2] === 'млрд' ? 1000 : 1)).toFixed(
          6,
        ),
      )
    : null;
}
function printedMonths(s: string): number | null {
  const m = /^(\d+) г\.(?: и (\d+) м\.)?$/.exec(s || '');
  return m ? Number(m[1]) * 12 + Number(m[2] || 0) : null;
}
function sameLen(c: Check, arrs: unknown[], n: number, where: string): void {
  c.ok(
    arrs.every((a) => Array.isArray(a) && a.length === n),
    `${where}: every array must have ${n} entries`,
  );
}

export function debt(ctx: Context): Check {
  const c = new Check('DEBT'),
    d = ctx.get('debt.json'),
    o = ctx.get('outlook.json'),
    ex = ctx.get('execution.json');
  c.ok(
    keys(d, [
      'meta',
      'defaultScope',
      'scopes',
      'latest',
      'zdd',
      'maastricht',
      'quarterly',
      'compare',
      'structure',
      'interest',
      'guaranteed',
      'newDebt',
      'limits',
      'financing',
      'notes',
      'check',
    ]),
    `debt keys ${pyRepr(Object.keys(d).sort())}`,
  );
  const m = d.meta;
  c.ok(
    m.id === 'D13+D14' &&
      m.status === 'real' &&
      eq(m.source, ['asbp', 'eurostat', 'bnb']) &&
      eq(
        m.pending,
        ctx.exists('debt-issues.json') &&
          isPublishedDataset('debt-issues.json', ctx.get('debt-issues.json'))
          ? []
          : ['P06'],
      ) &&
      m.mock === false,
    'meta id/status/source/pending/mock',
  );
  const z = d.zdd,
    yrs: number[] = z.years,
    n = yrs.length;
  c.ok(
    eq(yrs, o.years),
    `zdd.years ${pyRepr(yrs)} must equal the outlook years ${pyRepr(o.years)}`,
  );
  c.ok(
    eq(z.vintage, ['actual', 'actual', 'plan', 'forecast', 'forecast']) &&
      z.vintage.every((v: string) => v in words),
    `zdd.vintage ${pyRepr(z.vintage)}`,
  );
  c.ok(
    eq(
      z.columns,
      yrs.slice(0, z.vintage.length).map((y, i) => `${y} ${words[z.vintage[i]]}`),
    ),
    `zdd.columns ${pyRepr(z.columns)}`,
  );
  const ks = [
    'totalMln',
    'externalMln',
    'domesticMln',
    'pctGdp',
    'externalPctGdp',
    'domesticPctGdp',
    'gdpMln',
  ];
  sameLen(
    c,
    ks.map((k) => z[k]),
    n,
    'zdd',
  );
  c.ok(
    ks.every((k) => z[k].every(isnum)),
    'zdd: a non-numeric value',
  );
  c.ok(
    eq(z.gdpMln, o.gdp.mlnPrecise),
    `zdd.gdpMln ${pyRepr(z.gdpMln)} must equal outlook.gdp.mlnPrecise ${pyRepr(o.gdp.mlnPrecise)}`,
  );
  c.ok(
    z.table === 'VI-1' && eq(z.source, ['asbp']) && z.asOf === '2026-07-01',
    'zdd table / source / asOf',
  );
  let devPct = 0;
  yrs.forEach((y, i) => {
    c.near(
      z.totalMln[i],
      z.externalMln[i] + z.domesticMln[i],
      tolSum(2),
      `zdd ${y}: total = external + domestic`,
    );
    c.near(
      z.externalPctGdp[i] + z.domesticPctGdp[i],
      z.pctGdp[i],
      tolSum(2),
      `zdd ${y}: external + domestic percent`,
    );
    for (const [mln, pct, what] of [
      ['totalMln', 'pctGdp', 'total'],
      ['externalMln', 'externalPctGdp', 'external'],
      ['domesticMln', 'domesticPctGdp', 'domestic'],
    ] as const) {
      const calc = (100 * z[mln][i]) / z.gdpMln[i];
      c.near(
        z[pct][i],
        calc,
        0.051,
        `zdd ${y}: printed ${what} percent of GDP against value / GDP`,
      );
      devPct = Math.max(devPct, Math.abs(z[pct][i] - calc));
    }
  });
  c.ok(
    yrs.slice(0, -1).every((_, i) => z.totalMln[i] < z.totalMln[i + 1]),
    'zdd.totalMln should grow in this projection',
  );
  const sc: Record<string, any> = Object.fromEntries(d.scopes.map((s: any) => [s.id, s]));
  c.ok(
    eq(Object.keys(sc), ['zdd', 'maastricht']) && d.defaultScope in sc,
    `scopes ${pyRepr(Object.keys(sc))}, default ${pyRepr(d.defaultScope)}`,
  );
  c.ok(
    eq(sc.zdd.years, [yrs[0], yrs.at(-1)]) &&
      sc.zdd.latestActual === 2025 &&
      eq(sc.zdd.source, ['asbp']),
    'scopes.zdd',
  );
  const mx = d.maastricht;
  c.ok(
    eq(sc.maastricht.years, [mx.years[0], mx.years.at(-1)]) &&
      sc.maastricht.latestActual === mx.years.at(-1),
    'scopes.maastricht',
  );
  c.ok(eq(sc.maastricht.source, ['eurostat', 'bnb']), 'scopes.maastricht.source');
  for (const s of Object.values(sc))
    c.ok(
      ['label', 'short', 'note'].every((k) => text(s[k])),
      `scope ${s.id}: texts`,
    );
  const lz = d.latest.zdd,
    lm = d.latest.maastricht,
    i25 = yrs.indexOf(2025);
  c.ok(
    lz.year === 2025 &&
      lz.vintage === z.vintage[i25] &&
      lz.vintage === 'actual' &&
      lz.asOf === z.asOf,
    'latest.zdd year / vintage / asOf',
  );
  c.ok(
    lz.mln === z.totalMln[i25] && lz.pctGdp === z.pctGdp[i25],
    'latest.zdd must equal the 2025 column of table VI-1',
  );
  const nx = lz.next;
  c.ok(
    nx.year === 2026 &&
      nx.vintage === z.vintage[i25 + 1] &&
      nx.vintage === 'plan' &&
      nx.mln === z.totalMln[i25 + 1] &&
      nx.pctGdp === z.pctGdp[i25 + 1],
    'latest.zdd.next must equal the 2026 column of table VI-1',
  );
  const my: number[] = mx.years;
  c.ok(
    eq(
      my,
      Array.from({ length: my.length }, (_, i) => my[0]! + i),
    ) &&
      my[0] === 2015 &&
      my.at(-1) === 2025,
    `maastricht.years ${my[0]}..${my.at(-1)}`,
  );
  sameLen(c, [mx.bg.mln, mx.bg.pctGdp, mx.eu27.mln, mx.eu27.pctGdp], my.length, 'maastricht');
  c.ok(
    ['bg', 'eu27'].every((k) => ['mln', 'pctGdp'].every((kk) => mx[k][kk].every(isnum))),
    'maastricht: a non-numeric value',
  );
  c.ok(
    mx.thresholdPctGdp === 60 && mx.dataset === 'gov_10dd_edpt1' && eq(mx.source, ['eurostat']),
    'maastricht threshold / dataset / source',
  );
  c.ok(
    Math.max(...mx.bg.pctGdp) < mx.thresholdPctGdp,
    'Bulgaria stays under the 60% reference value in the series',
  );
  c.ok(
    lm.year === my.at(-1) &&
      lm.mln === mx.bg.mln.at(-1) &&
      lm.pctGdp === mx.bg.pctGdp.at(-1) &&
      lm.asOf === mx.asOf,
    'latest.maastricht must equal the last year of the annual series',
  );
  for (const year of [2024, 2025]) {
    const i = my.indexOf(year),
      newer = mx.asOf === '2026-10-21';
    c.near(
      mx.bg.pctGdp[i],
      (100 * mx.bg.mln[i]) / z.gdpMln[yrs.indexOf(year)],
      newer ? 0.2 : 0.051,
      `maastricht ${year}: percent against the GDP${newer ? ` of Annex 3 (Eurostat GDP of ${mx.asOf} is newer)` : ''}`,
    );
  }
  const q = d.quarterly,
    eu = q.eurostat,
    gg = q.bnbGg,
    cg = q.bnbCg;
  for (const [name, first, last] of [
    ['eurostat', '2024-Q1', '2026-Q2'],
    ['bnbGg', '2015-Q4', '2026-Q2'],
    ['bnbCg', '2008-Q1', '2026-Q2'],
  ] as const) {
    const s = q[name],
      qs = s.quarters;
    c.ok(
      qs[0] === first && qs.at(-1) === last && eq(qs, quarters(first, qs.length)),
      `quarterly.${name}: quarters must run ${first}..${last} without a gap`,
    );
    c.ok(
      s.mln.length === qs.length && s.mln.every((v: unknown) => isnum(v) && v > 0),
      `quarterly.${name}: mln`,
    );
  }
  c.ok(
    eu.dataset === 'gov_10q_ggdebt' &&
      gg.indicator === 'GGALN_G01_XDC' &&
      cg.indicator === 'GCALN_G01_AC_XDC',
    'quarterly dataset / indicators',
  );
  c.ok(
    eu.pctGdp.length === eu.flags.length && eu.flags.length === eu.quarters.length,
    'quarterly.eurostat: pctGdp / flags length',
  );
  let np = 0;
  while (np < eu.flags.length && eu.flags.at(-1 - np) === 'p') np++;
  c.ok(
    np >= 1 &&
      eq(eu.flags, [...Array(eu.flags.length - np).fill(''), ...Array(np).fill('p')]) &&
      keys(eu.flagLabels, ['p']),
    'quarterly.eurostat.flags: only the newest quarters are provisional',
  );
  const lq = lm.quarter;
  c.ok(
    lq.id === eu.quarters.at(-1) &&
      lq.mln === eu.mln.at(-1) &&
      lq.pctGdp === eu.pctGdp.at(-1) &&
      lq.flag === eu.flags.at(-1) &&
      lq.asOf === eu.asOf,
    'latest.maastricht.quarter must equal the last Eurostat quarter',
  );
  const gmap: Record<string, number> = Object.fromEntries(
    gg.quarters.map((k: string, i: number) => [k, gg.mln[i]]),
  );
  const devQ = Math.max(
    ...eu.quarters.flatMap((k: string, i: number) =>
      k in gmap ? [Math.abs(eu.mln[i] - gmap[k]!)] : [],
    ),
  );
  c.ok(
    eu.quarters.every((k: string) => k in gmap),
    'every Eurostat quarter has a BNB general-government quarter',
  );
  c.ok(
    devQ <= 0.05,
    `Eurostat quarterly debt differs from the BNB general-government series by ${devQ.toFixed(3)} (> 0.05)`,
  );
  let devA = 0;
  my.forEach((y, i) => {
    if (`${y}-Q4` in gmap) devA = Math.max(devA, Math.abs(mx.bg.mln[i] - gmap[`${y}-Q4`]!));
  });
  c.ok(
    devA <= 0.06,
    `the BNB fourth quarter differs from the Eurostat annual debt by ${devA.toFixed(3)} (> 0.06)`,
  );
  c.ok(
    my.slice(1).every((y) => `${y}-Q4` in gmap),
    'every year after 2015 has a BNB fourth quarter',
  );
  const cp = d.compare,
    r: Record<string, any> = Object.fromEntries(cp.rows.map((x: any) => [x.id, x]));
  const cmap = Object.fromEntries(cg.quarters.map((k: string, i: number) => [k, cg.mln[i]]));
  c.ok(
    eq(cp.years, [2024, 2025]) && eq(Object.keys(r), ['zdd', 'cg', 'gg']),
    `compare years / rows ${pyRepr(Object.keys(r))}`,
  );
  c.ok(
    eq(
      r.zdd.mln,
      cp.years.map((y: number) => z.totalMln[yrs.indexOf(y)]),
    ) && eq(r.zdd.source, ['asbp']),
    'compare.zdd must equal table VI-1',
  );
  c.ok(
    eq(
      r.cg.mln,
      cp.years.map((y: number) => cmap[`${y}-Q4`]),
    ) && eq(r.cg.source, ['bnb']),
    'compare.cg must equal the BNB central-government fourth quarter',
  );
  c.ok(
    eq(
      r.gg.mln,
      cp.years.map((y: number) => mx.bg.mln[my.indexOf(y)]),
    ) && eq(r.gg.source, ['eurostat']),
    'compare.gg must equal the Maastricht series',
  );
  c.ok(
    text(cp.note) &&
      ['таблица VI-1', 'БНБ', 'Маастрихт', 'Държавно управление'].every((scope) =>
        cp.note.includes(scope),
      ),
    'compare.note must carry the generic verification wording',
  );
  for (const x of Object.values(r)) c.ok(text(x.label), `compare.${x.id}: label`);
  const st = d.structure,
    devG: Record<string, number> = {};
  c.ok(
    eq(
      st.groups.map((g: any) => g.id),
      groupIds,
    ),
    `structure.groups ${pyRepr(st.groups.map((g: any) => g.id))}`,
  );
  for (const g of st.groups) {
    const per = new Map<number, number[]>();
    for (const row of g.rows) {
      c.ok(
        row.years.length === row.values.length &&
          row.values.every((v: unknown) => isnum(v) && v >= 0 && v <= 100),
        `structure ${g.id}/${row.id}: years / values`,
      );
      c.ok(
        row.years.every((y: number) => yrs.includes(y)) &&
          eq(
            row.years,
            [...row.years].sort((a, b) => a - b),
          ),
        `structure ${g.id}/${row.id}: years ${pyRepr(row.years)}`,
      );
      row.years
        .slice(0, row.values.length)
        .forEach((y: number, i: number) => per.set(y, [...(per.get(y) ?? []), row.values[i]]));
    }
    c.ok(
      eq(
        [...per.keys()].sort((a, b) => a - b),
        yrs,
      ),
      `structure ${g.id}: every projection year needs at least one row`,
    );
    devG[g.id] = Math.max(0, ...[...per.values()].map((vs) => Math.abs(sum(vs) - 100)));
    c.ok(
      devG[g.id]! <= 0.101,
      `structure ${g.id}: shares sum to ${(100 + devG[g.id]!).toFixed(2)}% at worst (> 100 +/- 0.1)`,
    );
  }
  c.ok(
    st.table === 'VI-2' &&
      eq(st.source, ['asbp']) &&
      st.asOf === z.asOf &&
      st.unit === '% от държавния дълг',
    'structure table / source / asOf / unit',
  );
  const am = st.avgMaturity;
  c.ok(
    eq(am.years, yrs) && am.months.length === am.printed.length && am.printed.length === n,
    'avgMaturity: years / lengths',
  );
  c.ok(
    am.printed
      .slice(0, am.months.length)
      .every((p: string, i: number) => printedMonths(p) === am.months[i]),
    `avgMaturity.printed ${pyRepr(am.printed)} must equal the months ${pyRepr(am.months)}`,
  );
  c.ok(
    eq(
      am.months,
      [...am.months].sort((a, b) => a - b),
    ),
    'avgMaturity grows over the projection',
  );
  const it = d.interest;
  c.ok(eq(it.years, [2024, 2025]), 'interest.years');
  it.years.forEach((y: number, i: number) =>
    c.near(
      it.totalMln[i],
      it.externalMln[i] + it.domesticMln[i],
      tolSum(2),
      `interest ${y}: total = external + domestic`,
    ),
  );
  c.near(
    it.pctGdpPrinted['2024'],
    (100 * it.totalMln[0]) / z.gdpMln[0],
    0.051,
    'interest 2024: printed percent of GDP',
  );
  c.ok(
    it.pctGdpPrinted['2028'] === 1.2 && eq(it.source, ['asbp']),
    'interest: printed 2028 percent / source',
  );
  const gu = d.guaranteed;
  c.ok(eq(gu.years, [2024, 2025]), 'guaranteed.years');
  gu.years.forEach((y: number, i: number) => {
    c.near(
      gu.totalMln[i],
      gu.externalMln[i] + gu.domesticMln[i],
      tolSum(2),
      `guaranteed ${y}: total = external + domestic`,
    );
    c.near(
      gu.pctGdpPrinted[i],
      (100 * gu.totalMln[i]) / z.gdpMln[yrs.indexOf(y)],
      0.051,
      `guaranteed ${y}: printed percent of GDP`,
    );
    c.near(
      sum(gu.sectors.map((s: any) => s.values[i])),
      100,
      0.05 * 6 + 0.01,
      `guaranteed ${y}: the sector shares`,
    );
  });
  c.ok(
    gu.sectors.length === 6 && gu.sectors.every((s: any) => s.values.length === 2),
    'guaranteed.sectors',
  );
  c.ok(
    isnum(gu.newGuarantees2025Mln) && gu.newGuarantees2025Mln > 0 && eq(gu.source, ['asbp']),
    'guaranteed: new guarantees / source',
  );
  const nd = d.newDebt,
    y5 = nd.y2025;
  c.ok(nd.uses.length === 4 && nd.uses.every(text), 'newDebt.uses: four statements');
  c.near(
    y5.totalMln,
    sum(y5.parts.map((p: any) => p.mln)),
    tolSum(3),
    'newDebt.y2025: total = parts',
  );
  c.ok(
    eq(
      y5.parts.map((p: any) => p.id),
      ['eurobonds', 'domesticBonds', 'structuralLoans'],
    ),
    'newDebt.y2025.parts ids',
  );
  c.ok(isnum(y5.repaymentsBln) && y5.repaymentsBln > 0, 'newDebt.y2025.repaymentsBln');
  const iss = nd.issued2026;
  c.near(
    iss.totalMln,
    sum(iss.months.map((x: any) => x.mln)),
    tolSum(5),
    'newDebt.issued2026: total = months',
  );
  c.ok(
    eq(
      iss.months.map((x: any) => x.month),
      ['януари', 'февруари', 'март', 'април', 'май'],
    ),
    'newDebt.issued2026.months must be the consecutive months of the year',
  );
  const lim: Record<string, any> = Object.fromEntries(d.limits.items.map((x: any) => [x.id, x]));
  c.ok(
    eq(Object.keys(lim), limitIds) && d.limits.year === 2026 && eq(d.limits.source, ['zdb']),
    `limits.items ${pyRepr(Object.keys(lim))}`,
  );
  for (const [k, x] of Object.entries(lim)) {
    c.ok(
      isnum(x.mln) && printedMln(x.printed) === x.mln,
      `limits.${k}: printed ${pyRepr(x.printed)} must equal ${x.mln} million`,
    );
    c.ok(integer(x.art) && x.art >= 65 && pyTruth(x.label.trim()), `limits.${k}: article / label`);
  }
  c.ok(
    lim.newDebt.includesMln === 3261.7 && lim.newDebt.includesMln < lim.newDebt.mln,
    'limits.newDebt.includesMln (SAFE)',
  );
  c.ok(
    lim.guaranteesAll.mln >= lim.newGuarantees.mln && lim.fiscalReserve.kind === 'min',
    'limits: guarantees, reserve',
  );
  c.ok(
    z.totalMln[yrs.indexOf(2026)] <= lim.debtCap.mln,
    'the 2026 state debt of table VI-1 must stay under the legal cap',
  );
  c.ok(
    eq(
      nd.plan.map((p: any) => [p.year, p.kind]),
      [
        [2026, 'limit'],
        [2027, 'plan'],
        [2028, 'plan'],
      ],
    ),
    'newDebt.plan kinds',
  );
  c.near(
    nd.plan[0].bln * 1000,
    lim.newDebt.mln,
    0.01,
    'newDebt.plan 2026 must equal the legal limit of art. 67',
  );
  c.near(
    nd.limitEnd2026Bln * 1000,
    lim.debtCap.mln,
    0.01,
    'newDebt.limitEnd2026Bln must equal the cap of art. 66',
  );
  c.ok(
    nd.plan.every((p: any) => isnum(p.bln) && p.bln > 0 && (p.refinancedBln ?? 0) <= p.bln),
    'newDebt.plan values',
  );
  c.ok(
    keys(nd.kindLabels, ['limit', 'plan']) && eq(nd.source, ['asbp']),
    'newDebt.kindLabels / source',
  );
  const fi = d.financing,
    ids = new Set(ex.rows.map((r: any) => r.id));
  c.ok(
    fi.ref === 'execution' && fi.asOf === ex.latest.asOf,
    'financing.ref / asOf must equal the execution data',
  );
  c.ok(
    fi.rows.every((r: string) => ids.has(r)) && sameSet(Object.keys(fi.labels), fi.rows),
    'financing.rows must be rows of execution.json with a label each',
  );
  c.ok(
    eq(
      d.notes.map((x: any) => x.id),
      ['projection', 'quarterly', 'maturities'],
    ) && d.notes.every((x: any) => pyTruth(x.text.trim())),
    `notes ids ${pyRepr(d.notes.map((x: any) => x.id))}`,
  );
  const ck = d.check;
  c.near(ck.zddPrintedPctMaxDev, devPct, 0.0051, 'check.zddPrintedPctMaxDev');
  c.near(ck.eurostatQuarterlyVsBnbGgMaxDev, devQ, 0.0051, 'check.eurostatQuarterlyVsBnbGgMaxDev');
  c.near(ck.bnbGgQ4VsEurostatAnnualMaxDev, devA, 0.0051, 'check.bnbGgQ4VsEurostatAnnualMaxDev');
  for (const [g, v] of Object.entries(ck.structureGroupMaxDevFrom100))
    c.near(v, devG[g], 0.0051, `check.structureGroupMaxDevFrom100.${g}`);
  c.ok(
    keys(ck.structureGroupMaxDevFrom100, groupIds) && ck.limitsMatchMotives === true,
    'check block keys / limitsMatchMotives',
  );
  c.fact(
    `table VI-1 ${n} years (2026 plan ${fmt(z.totalMln[yrs.indexOf(2026)])} of the ${fmt(lim.debtCap.mln, 0)} cap), Maastricht ${my.length} years + ${eu.quarters.length} quarters, GG vs BNB max dev ${devQ.toFixed(3)}, structure 5 groups, 5 legal limits`,
  );
  return c;
}

export function municipalities(ctx: Context): Check {
  const c = new Check('MUNIC'),
    m = ctx.get('municipalities.json'),
    geo = ctx.get('geo/obshtini.json');
  c.ok(
    eq(Object.keys(m), [
      'meta',
      'year',
      'populationYear',
      'columns',
      'kinds',
      'note',
      'perCapitaNote',
      'nameNote',
      'popFix',
      'items',
      'regions',
      'totals',
      'unmatched',
      'check',
    ]),
    `municipalities keys ${pyRepr(Object.keys(m))}`,
  );
  const me = m.meta;
  c.ok(
    me.id === 'D19+D20+D21' &&
      me.status === 'real' &&
      eq(me.source, ['zdb', 'gisco', 'eurostat']) &&
      me.unit === 'хил. €' &&
      me.mock === false,
    'meta id / status / source / unit',
  );
  c.ok(
    m.year === 2026 && m.populationYear === 2024 && eq(m.columns, columns),
    'year / populationYear / columns',
  );
  const ks = Object.fromEntries(m.kinds.map((k: any) => [k.id, k]));
  c.ok(
    eq(Object.keys(ks), columns) &&
      eq(
        columns.map((k) => ks[k].partOfTotal ?? null),
        [null, true, true, true, true, false],
      ),
    'kinds ids / partOfTotal flags',
  );
  c.ok(
    m.kinds.every((k: any) => text(k.label) && text(k.short)),
    'kinds: labels',
  );
  c.ok(
    ['note', 'perCapitaNote', 'nameNote'].every((k) => text(m[k])),
    'note texts',
  );
  const pf = m.popFix;
  c.ok(
    eq(pf.ids, ['DOB15', 'DOB28']) && eq(pf.used, { DOB15: pf.gisco.DOB28, DOB28: pf.gisco.DOB15 }),
    'popFix: used = gisco, swapped',
  );
  c.ok(
    pf.areaKm2.DOB15 > pf.areaKm2.DOB28 && pf.used.DOB15 < pf.used.DOB28,
    'popFix: the rural municipality is the larger one with fewer people',
  );
  const items: any[] = m.items,
    ids = items.map((i) => i.id);
  c.ok(
    items.length === 265 &&
      new Set(ids).size === 265 &&
      ids.every((x) => /^([A-Z]{3})(\d{2})$/.test(x)),
    'items: 265 unique ids of the form XXX00',
  );
  let devRow = 0,
    popSum = 0,
    allSum = 0;
  const sums: Record<string, number> = Object.fromEntries(columns.map((k) => [k, 0])),
    manual: string[] = [];
  for (const it of items) {
    const w = `${it.id} ${it.name}`,
      base = ['id', 'name', 'region', 'regionId', 'population', 'transfers', 'perCapita', 'match'];
    c.ok(
      keys(it, [...base, ...(it.match === 'manual' ? ['lawName'] : [])]),
      `${w}: keys ${pyRepr(Object.keys(it).sort())}`,
    );
    c.ok(text(it.name) && text(it.region), `${w}: name / region`);
    c.ok(it.regionId === it.id.slice(0, 3), `${w}: regionId ${it.regionId}`);
    c.ok(
      ['exact', 'manual'].includes(it.match) && (it.match === 'manual') === 'lawName' in it,
      `${w}: match ${it.match} / lawName`,
    );
    if (it.match === 'manual') {
      manual.push(it.id);
      c.ok(text(it.lawName) && it.lawName !== it.name, `${w}: lawName`);
    }
    const pop = it.population;
    c.ok(integer(pop) && pop > 0, `${w}: population ${pop}`);
    popSum += integer(pop) ? pop : 0;
    if (it.id in pf.used)
      c.ok(pop === pf.used[it.id], `${w}: population ${pop} must equal popFix.used`);
    const t = it.transfers;
    c.ok(
      eq(Object.keys(t), [...columns, 'all']) && Object.values(t).every((v) => isnum(v) && v >= 0),
      `${w}: transfers keys / values`,
    );
    if (![...columns, 'all'].every((k) => isnum(t[k]))) continue;
    const row = Math.abs(t.total - sum(columns.slice(1, 5).map((k) => t[k])));
    devRow = Math.max(devRow, row);
    c.ok(row <= 0.26, `${w}: total ${t.total} differs from its four kinds by ${row.toFixed(2)}`);
    c.near(t.all, t.total + t.otherTargeted, 0.05 * 3, `${w}: all = total + otherTargeted`);
    const pc = it.perCapita;
    c.ok(eq(Object.keys(pc), columns), `${w}: perCapita keys`);
    for (const k of columns)
      if (integer(pop) && pop > 0 && isnum(pc[k]))
        c.near(pc[k], (t[k] * 1000) / pop, 0.0051, `${w}: perCapita.${k}`);
    for (const k of columns) sums[k]! += t[k];
    allSum += t.all;
  }
  c.ok(
    eq([...manual].sort(), ['DOB15', 'KNL04', 'SOF46']),
    `manual matches ${pyRepr([...manual].sort())}`,
  );
  const regs: any[] = m.regions,
    rid = regs.map((r) => r.id);
  c.ok(
    regs.length === 28 &&
      new Set(rid).size === 28 &&
      sameSet(
        rid,
        items.map((i) => i.regionId),
      ),
    'regions: 28 oblasts, each with municipalities',
  );
  for (const r of regs) {
    const w = `oblast ${r.id}`,
      mine = items.filter((i) => i.regionId === r.id);
    c.ok(
      r.municipalities === mine.length && mine.every((i) => i.region === r.name),
      `${w}: municipality count / name`,
    );
    c.near(
      r.transfersKhil,
      sum(mine.map((i) => i.transfers.total)),
      0.05,
      `${w}: transfers = Σ municipalities`,
    );
    c.near(
      r.otherTargetedKhil,
      sum(mine.map((i) => i.transfers.otherTargeted)),
      0.05,
      `${w}: other targeted = Σ municipalities`,
    );
    c.ok(
      integer(r.population2025) && r.population2025 > 0 && /^BG\d{3}$/.test(r.nuts3),
      `${w}: population2025 / nuts3`,
    );
    const popR = sum(mine.map((i) => i.population));
    c.ok(
      Math.abs(popR - r.population2025) < 0.05 * r.population2025,
      `${w}: municipality population ${popR} is far from the oblast figure ${r.population2025}`,
    );
  }
  const tt = m.totals;
  c.ok(
    tt.count === 265 && tt.populationSum === popSum && popSum === 6445481,
    `totals.populationSum ${tt.populationSum}, Σ items ${popSum} (expected 6445481)`,
  );
  c.ok(
    tt.population2025Sum === sum(regs.map((r) => r.population2025)) &&
      tt.population2025Sum === 6437360,
    'totals.population2025Sum',
  );
  c.near(tt.transfersKhil, sums.total, 0.5, 'totals.transfersKhil = Σ items');
  c.near(tt.otherTargetedKhil, sums.otherTargeted, 0.5, 'totals.otherTargetedKhil = Σ items');
  c.near(tt.allKhil, allSum, 0.5, 'totals.allKhil = Σ items');
  c.near(
    tt.allKhil,
    tt.transfersKhil + tt.otherTargetedKhil,
    0.05 * 3,
    'totals.allKhil = main + other targeted',
  );
  c.near(
    sum(regs.map((r) => r.transfersKhil)),
    tt.transfersKhil,
    0.5,
    'Σ oblast transfers = national',
  );
  const ck = m.check;
  c.ok(
    ck.populationSumEqualsNational2024 === true &&
      ck.oblastPopulation2024EqualsEurostat === true &&
      ck.populationFixApplied === true,
    'check flags',
  );
  c.ok(
    ck.columnSums.length === 6 &&
      ck.columnSums
        .slice(0, columns.length)
        .every((a: number, i: number) => Math.abs(a - sums[columns[i]!]!) <= 0.5),
    `check.columnSums ${pyRepr(ck.columnSums)} vs ${pyRepr(columns.map((k) => Number(sums[k]!.toFixed(1))))}`,
  );
  c.near(ck.rowSumMaxDev, devRow, 0.0051, 'check.rowSumMaxDev');
  c.ok(
    eq(
      ck.manualMatches.map((x: string) => x.split(' = ')[0]).sort(),
      ['Добричка', 'Бобовдол', 'СТОЛИЧНА ОБЩИНА'].sort(),
    ) && eq(m.unmatched, []),
    'check.manualMatches / unmatched',
  );
  const gm = geo.meta;
  c.ok(
    gm.id === 'D20' &&
      gm.status === 'real' &&
      eq(gm.source, ['gisco']) &&
      geo.type === 'FeatureCollection',
    'geo meta / type',
  );
  const feats: any[] = geo.features,
    gids = feats.map((f) => f.properties.id);
  c.ok(
    feats.length === 265 && new Set(gids).size === 265 && sameSet(gids, ids),
    'geo: 265 unique features with the ids of municipalities.json',
  );
  const names = Object.fromEntries(items.map((i) => [i.id, i.name]));
  let nPts = 0;
  for (const f of feats) {
    const p = f.properties,
      g = f.geometry;
    c.ok(keys(p, ['id', 'name']) && p.name === names[p.id], `geo ${p.id}: properties ${pyRepr(p)}`);
    c.ok(
      ['Polygon', 'MultiPolygon'].includes(g.type) && pyTruth(g.coordinates),
      `geo ${p.id}: geometry`,
    );
    const pts: any[] = (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()).flat();
    const bad = pts.filter(
      (pt) =>
        !(
          isnum(pt[0]) &&
          isnum(pt[1]) &&
          pt[0] >= 22 &&
          pt[0] <= 29 &&
          pt[1] >= 41 &&
          pt[1] <= 44.5
        ),
    );
    nPts += pts.length;
    c.ok(!bad.length, `geo ${p.id}: coordinates outside Bulgaria: ${pyRepr(bad.slice(0, 2))}`);
  }
  c.ok(geo.idProperty === 'id', 'geo.idProperty');
  c.fact(
    `${items.length} municipalities in 28 oblasts, transfers ${fmt(tt.transfersKhil)} thousand euro (+ ${fmt(tt.otherTargetedKhil)} other targeted), population ${fmt(popSum, 0)}, ${nPts} boundary points, ${manual.length} manual name matches`,
  );
  return c;
}

export function sebra(ctx: Context): Check {
  const c = new Check('SEBRA'),
    s = ctx.get('sebra.json');
  c.ok(
    eq(Object.keys(s), [
      'meta',
      'period',
      'ministry',
      'ministryPrinted',
      'ministryCode',
      'publisher',
      'total',
      'byCode',
      'byOrganisation',
      'days',
      'overall',
      'overallLabel',
      'publication',
      'notes',
      'check',
    ]),
    `sebra keys ${pyRepr(Object.keys(s))}`,
  );
  const me = s.meta,
    days: any[] = s.days;
  c.ok(
    me.id === 'D24' &&
      me.status === 'real' &&
      eq(me.source, ['sebra']) &&
      me.unit === '€' &&
      me.mock === false,
    'meta id / status / source / unit',
  );
  c.ok(
    days.length === 3 &&
      eq(
        days.map((d) => d.date),
        days.map((d) => d.date).sort(),
      ) &&
      days.every((d) => iso.test(d.date)),
    'days: three ISO dates in order',
  );
  const last = days.at(-1)!;
  c.ok(
    me.asOf === last.date &&
      me.asOf === s.period.to &&
      me.asOf === s.period.from &&
      me.asOf <= ctx.buildDate,
    'meta.asOf / period must be the latest published day',
  );
  const money = (a: unknown, b: unknown, msg: string) => c.near(a, b, 0.011, msg);
  for (const d of days) {
    const w = `day ${d.date}`,
      [y, mo, dd] = d.date.split('-').map(Number);
    c.ok(
      d.label === `${dd} ${mo === 8 ? 'август' : '?'} ${y} г.`,
      `${w}: label ${pyRepr(d.label)}`,
    );
    c.ok(
      d.count === sum(d.byCode.map((r: any) => r.count)) &&
        d.count === sum(d.byOrganisation.map((r: any) => r.count)),
      `${w}: counts add up`,
    );
    money(d.eur, sum(d.byCode.map((r: any) => r.eur)), w + ': eur = Σ categories');
    money(d.eur, sum(d.byOrganisation.map((r: any) => r.eur)), w + ': eur = Σ organisations');
    c.ok(
      new Set(d.byCode.map((r: any) => r.code)).size === d.byCode.length &&
        d.byCode.every((r: any) => /^\d{2} xxxx$/.test(r.code) && pyTruth(r.name.trim())),
      `${w}: category codes`,
    );
    for (const o of d.byOrganisation) {
      c.ok(
        o.count === sum(o.byCode.map((r: any) => r.count)),
        `${w} ${o.name}: counts by category`,
      );
      money(o.eur, sum(o.byCode.map((r: any) => r.eur)), `${w} ${o.name}: eur by category`);
    }
    for (const k of ['count', 'eur']) c.ok(isnum(d[k]) && d[k] > 0, `${w}: ${k}`);
  }
  c.ok(
    eq(s.total, { count: last.count, eur: last.eur }) &&
      eq(s.byCode, last.byCode) &&
      eq(s.byOrganisation, last.byOrganisation),
    'total / byCode / byOrganisation must equal the latest day',
  );
  const ov = s.overall;
  c.ok(ov.count === sum(days.map((d) => d.count)), `overall.count ${ov.count}`);
  money(ov.eur, sum(days.map((d) => d.eur)), 'overall.eur = Σ days');
  const acc: Record<string, [number, number]> = {};
  for (const d of days)
    for (const r of d.byCode) {
      const a = (acc[r.code] ??= [0, 0]);
      a[0] += r.count;
      a[1] += r.eur;
    }
  const got: Record<string, [number, number]> = Object.fromEntries(
    ov.byCode.map((r: any) => [r.code, [r.count, r.eur]]),
  );
  c.ok(
    sameSet(Object.keys(got), Object.keys(acc)) &&
      Object.keys(acc).every(
        (k) => got[k]![0] === acc[k]![0] && Math.abs(got[k]![1] - acc[k]![1]) <= 0.011,
      ),
    'overall.byCode must be the Σ of the days',
  );
  c.ok(ov.count === sum(Object.values(got).map((v) => v[0])), 'overall.byCode counts');
  c.ok(
    text(s.overallLabel) && s.overallLabel.includes('не на целия месец'),
    'overallLabel must say it is not the whole month',
  );
  const pub = s.publication,
    fs: any[] = pub.files;
  c.ok(
    eq(
      fs.map((f) => f.day),
      days.map((d) => d.date),
    ) && fs.every((f) => f.parsed === true),
    'publication.files: one parsed file per day',
  );
  for (const f of fs) {
    c.ok(
      integer(f.bytes) &&
        f.bytes > 0 &&
        Math.abs(f.sizeKb - f.bytes / 1024) <= 0.0051 &&
        f.format === 'xlsx',
      `file ${f.day}: size / format`,
    );
    c.ok(
      iso.test(f.listedOn) && f.day <= f.listedOn && f.listedOn <= ctx.buildDate,
      `file ${f.day}: listedOn ${f.listedOn}`,
    );
  }
  c.ok(
    pub.page.startsWith('https://') &&
      iso.test(pub.retrieved) &&
      pub.retrieved <= ctx.buildDate &&
      iso.test(pub.sectionPublished),
    'publication page / dates',
  );
  const ck = s.check;
  c.ok(
    eq(ck, {
      daysParsed: days.length,
      daysListed: fs.length,
      categoriesAddUp: true,
      organisationsAddUp: true,
      fileSizesMatchListing: true,
    }),
    `check block ${pyRepr(ck)}`,
  );
  c.ok(s.notes.length === 4 && s.notes.every(text), 'notes: four statements');
  c.ok(
    s.notes.some((n: string) => n.includes('не е пълният месец')),
    'the notes must say that three days are not the whole month',
  );
  c.ok(
    ['ministry', 'ministryPrinted', 'ministryCode', 'publisher'].every((k) => text(s[k])),
    'ministry / publisher texts',
  );
  c.fact(
    `${days.length} days (${days[0]!.date} .. ${last.date}), ${ov.count} payments / ${fmt(ov.eur, 2)} euro in all, latest day ${last.count} / ${fmt(last.eur, 2)} euro`,
  );
  return c;
}

/** Donor rules only. Registration in the aggregate command is intentionally parent-owned. */
export const debtLocalGroups: Group<Context>[] = [
  {
    name: 'DEBT',
    run: debt,
    description:
      'debt.json: table VI-1 identities, Maastricht and quarterly series against each other, structure shares, legal limits',
  },
  {
    name: 'MUNIC',
    run: municipalities,
    description:
      'municipalities.json + geo: 265 municipalities, transfers by kind, population (GISCO fix), 28 oblasts, boundaries',
  },
  {
    name: 'SEBRA',
    run: sebra,
    description:
      'sebra.json: daily payment summaries add up by category and by organisation, files and check block',
  },
];
