/** Budget and programme validation, including all ministry files and their index. */
import { pythonNumberAt, type PythonNumber } from '../common/numbers.js';
import { Check, fmt, isnum, numbersIn, pyTruth } from './checks.js';
import { Context } from './context.js';
import {
  PythonError,
  pythonRepr as pyRepr,
  pyReprAt,
  required,
  floatRepr,
  pyStrip,
  pyEqual,
  pyIntAt,
  pySum,
  pyMap,
  pyTypedSum,
  pyAddAssign,
  pyGreaterThan,
  pyItem,
  sourceTypeAt,
  pyDivide,
  pyMultiply,
  pySubtract,
} from './python-error.js';
const TOL = 0.06,
  TOL_SUM = 0.15,
  TOL_COL = 0.12;
const KINDS = [
  'ministry',
  'agency',
  'commission',
  'judiciary',
  'constitutional',
  'legislature',
  'fund',
  'other',
];
const TIERS = ['validated', 'program-budget-differs', 'pending'];
const COLS = [
  'consTotal',
  'consPrb',
  'consOther',
  'deptTotal',
  'deptPrb',
  'deptOther',
  'admTotal',
  'admPrb',
  'admOther',
];
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028];
const LABELS = [
  'Отчет 2023',
  'Отчет 2024',
  'Закон 2025',
  'Проект 2026',
  'Прогноза 2027',
  'Прогноза 2028',
];
const VINTAGE = ['actual', 'actual', 'plan', 'plan', 'forecast', 'forecast'];
const FIELDS = [
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
];
const ARCHIVE = 'https://www.parliament.bg/bills/52/52-602-01-19.zip';
const INTERNAL = [
  'gdoc',
  'lovable',
  'artifact-files',
  'sources/',
  '/lov',
  'state/',
  'scripts/',
  'playbook',
];
const SENTINELS = { noData: -1, noGrowth: -101 };
const same = (a: unknown, b: unknown) => pyEqual(a, b);
const sorted = (x: any[]) => [...x].sort();
const n = (o: any, k: string | number): PythonNumber => {
  const v = pyItem(o, k);
  if (typeof v === 'boolean') return { value: Number(v), kind: 'int' };
  return pythonNumberAt(o, String(k), v);
};
const sum = (xs: Iterable<PythonNumber>) => pySum(xs);
const pyfloat = floatRepr;
const fixed = (v: number, n: number) => fmt(v, n).replaceAll(' ', '').replace(',', '.');
const disp = (o: any, k: string | number) =>
  isnum(o[k]) && n(o, k).kind === 'float'
    ? pyfloat(o[k])
    : typeof o[k] === 'string'
      ? o[k]
      : pyReprAt(o, k);
const iso = (x: any) =>
  typeof x === 'string' &&
  /^\p{Decimal_Number}{4}-\p{Decimal_Number}{2}-\p{Decimal_Number}{2}$/u.test(x);
const byid = (rows: any[]) =>
  Object.assign(Object.create(null), Object.fromEntries(rows.map((x) => [x.id, x])));
function near(c: Check, a: any, b: any, tol: number, msg: string, ar?: string, br?: string) {
  return c.ok(
    isnum(a) && isnum(b) && Math.abs(a - b) <= tol + 1e-9,
    `${msg}: ${ar ?? pyRepr(a)} vs ${br ?? pyRepr(b)} (tolerance ${tol})`,
  );
}
function nearSum(
  c: Check,
  values: Iterable<PythonNumber>,
  b: () => any,
  tolerance: number,
  message: string,
  renderedTarget: () => string,
) {
  const result = pyTypedSum(values);
  return near(
    c,
    result.value,
    b(),
    tolerance,
    message,
    result.kind === 'float' ? pyfloat(result.value) : String(result.value),
    renderedTarget(),
  );
}
function optional(c: Check, a: any, b: any, msg: string, ar?: string, br?: string) {
  if (a == null || b == null)
    return c.ok(
      a == null && b == null,
      `${msg}: ${a == null ? 'None' : (ar ?? pyRepr(a))} vs ${b == null ? 'None' : (br ?? pyRepr(b))}`,
    );
  return near(c, a, b, TOL, msg, ar, br);
}
function cleanName(s: any): boolean {
  return (
    typeof s === 'string' &&
    s === pyStrip(s) &&
    [...s].length >= 4 &&
    s !== 'Код' &&
    !s.includes('  ') &&
    !s.includes('"') &&
    (s.match(/„/g)?.length ?? 0) === (s.match(/“/g)?.length ?? 0) &&
    (s.match(/[А-Яа-я]/g)?.length ?? 0) >= 3 &&
    !/^[\p{Decimal_Number}.\s]+$/u.test(s)
  );
}
type Row = [string, string, any];
function progRows(d: any): Row[] {
  const out: Row[] = [];
  for (const pol of d.policies)
    if (pyTruth(pol.programs)) {
      out.push(['policy', '', pol]);
      for (const pr of pol.programs) out.push(['program', required(pol, 'code'), pr]);
    } else out.push(['program', '', pol]);
  return out;
}
export function budgets(ctx: Context): Check {
  const c = new Check('BUDGETS'),
    m = ctx.get('ministries.json'),
    law = ctx.get('law.json'),
    core = ctx.get('core.json'),
    mm = m.meta;
  c.ok(
    same(Object.keys(m), [
      'meta',
      'totals',
      'kinds',
      'tiers',
      'programTotals',
      'scopeNote',
      'items',
    ]),
    `ministries.json keys ${pyRepr(Object.keys(m))}`,
  );
  c.ok(
    mm.id === 'D08+D09' &&
      mm.status === 'real' &&
      mm.unit === 'хил. €' &&
      same(mm.pending, ['P03']) &&
      mm.mock === false,
    'meta id/status/unit/pending',
  );
  c.ok(
    iso(mm.asOf) &&
      mm.asOf <= ctx.buildDate &&
      mm.source.every((s: string) => Object.hasOwn(core.sources, s)),
    'meta asOf/source',
  );
  c.ok(
    (Array.isArray(core.pending) ? core.pending : Object.values(core.pending)).some(
      (p: any) => p.id === 'P03',
    ),
    'core.pending has P03',
  );
  c.ok(
    same(Object.keys(m.kinds), KINDS) || same(sorted(Object.keys(m.kinds)), sorted(KINDS)),
    `kinds ${pyRepr(Object.keys(m.kinds))}`,
  );
  c.ok(
    same(sorted(Object.keys(m.tiers)), sorted(TIERS)) &&
      Object.values(m.tiers).every((v) => typeof v === 'string' && pyTruth(v)),
    `tiers ${pyRepr(Object.keys(m.tiers))}`,
  );
  c.ok(typeof m.scopeNote === 'string' && pyStrip(m.scopeNote) !== '', 'scopeNote');
  const items = required<any[]>(m, 'items'),
    ids = items.map((x: any) => x.id),
    lb = byid(law.budgets);
  c.ok(
    items.length === 46 && m.totals.count === 46,
    `${items.length} items, totals.count ${m.totals.count} (46 expected)`,
  );
  c.ok(
    same(ids, sorted(ids)) && new Set(ids).size === ids.length,
    'items are unique and sorted by id',
  );
  const diff = [...new Set([...ids, ...Object.keys(lb)])]
    .filter((x) => ids.includes(x) !== Object.hasOwn(lb, x))
    .sort();
  c.ok(!diff.length, `ministries.json and law.json list different budgets: ${pyRepr(diff)}`);
  let rev = 0,
    exp = 0,
    polTotal = 0,
    progTotal = 0;
  const tiers: Record<string, number> = Object.create(null),
    kinds: Record<string, number> = Object.create(null);
  for (const x of items) {
    const i = x.id,
      w = `budget ${i}`,
      b = lb[i];
    if (!c.ok(b !== undefined, `${w}: not in law.json`)) continue;
    c.ok(
      pyEqual(required(x, 'art'), required(b, 'art')) &&
        pyEqual(required(x, 'name'), required(b, 'name')) &&
        pyEqual(required(x, 'short'), required(b, 'short')) &&
        pyEqual(required(x, 'kind'), required(b, 'kind')),
      `${w}: art/name/short/kind differ from law.json`,
    );
    c.ok(Object.hasOwn(m.kinds, x.kind), `${w}: kind ${x.kind}`);
    kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;
    c.ok(
      typeof required(x, 'lawName') === 'string' && cleanName(x.lawName),
      `${w}: lawName ${pyReprAt(x, 'lawName')}`,
    );
    for (const [key, k] of [
      ['revKhil', 'rev'],
      ['expKhil', 'exp'],
      ['transfersKhil', 'transfers'],
    ] as const)
      optional(c, x[key], b.law[k], `${w} ${key} = law.json`, disp(x, key), disp(b.law, k));
    rev = pyAddAssign(
      { value: rev, kind: 'float' },
      pyTruth(x.revKhil) ? n(x, 'revKhil') : { value: 0, kind: 'float' },
    );
    exp = pyAddAssign({ value: exp, kind: 'float' }, n(x, 'expKhil'));
    const pols = required<any[]>(x, 'policies');
    c.ok(
      ['policies', 'areas'].includes(x.policiesKind) && pyTruth(pols),
      `${w}: policiesKind / policies`,
    );
    c.ok(
      same(
        pols.map((q: any) => q.n),
        pols.map((_: any, j: number) => j + 1),
      ),
      `${w}: policy numbers ${pyRepr(pols.map((q: any) => q.n))}`,
    );
    c.ok(
      pols.every((q: any) => cleanName(q.name) && isnum(q.khil)),
      `${w}: policy names / amounts`,
    );
    nearSum(
      c,
      pyMap(pols, (q: any) => n(q, 'khil')),
      () => required(x, 'policyTotalKhil'),
      TOL_SUM,
      `${w}: policies sum to policyTotalKhil`,
      () => disp(x, 'policyTotalKhil'),
    );
    near(
      c,
      x.policyTotalKhil,
      x.expKhil,
      TOL,
      `${w}: policyTotalKhil = expKhil`,
      disp(x, 'policyTotalKhil'),
      disp(x, 'expKhil'),
    );
    for (const q of pols)
      if (pyTruth(q.parts)) {
        nearSum(
          c,
          pyMap(q.parts, (p: any) => n(p, 'khil')),
          () => required(q, 'khil'),
          TOL_SUM,
          `${w} policy ${q.n}: parts sum`,
          () => disp(q, 'khil'),
        );
        c.ok(
          q.parts.every((p: any) => cleanName(p.name)),
          `${w} policy ${q.n}: part names`,
        );
      }
    if ('bodies' in x)
      nearSum(
        c,
        pyMap(x.bodies, (q: any) => n(q, 'khil')),
        () => required(x, 'expKhil'),
        TOL_SUM,
        `${w}: bodies sum to the expenditure`,
        () => disp(x, 'expKhil'),
      );
    const pb = x.programBudgetVsLaw,
      ch = x.change;
    c.ok(
      (ch == null) === (x.exp2025Khil == null),
      `${w}: change and exp2025Khil must come together`,
    );
    if (ch != null) {
      c.ok(
        ['law', 'program-budget'].includes(required(ch, 'basis')) &&
          (required(ch, 'basis') === 'program-budget') === (pb != null),
        `${w}: change.basis ${disp(ch, 'basis')}`,
      );
      const baseHolder = pyTruth(pb) && required(ch, 'basis') === 'program-budget' ? pb : x;
      const baseKey = baseHolder === pb ? 'prbKhil' : 'expKhil';
      const base = n(baseHolder, baseKey);
      if (pyGreaterThan(required(x, 'exp2025Khil'), 0, sourceTypeAt(x, 'exp2025Khil')))
        near(
          c,
          required(ch, 'pct'),
          pyMultiply(
            { value: 100, kind: 'float' },
            {
              value: pySubtract(
                { value: pyDivide(base, n(x, 'exp2025Khil')), kind: 'float' },
                { value: 1, kind: 'float' },
              ),
              kind: 'float',
            },
          ),
          0.051,
          `${w}: change.pct`,
          disp(ch, 'pct'),
          pyfloat(100 * (Number(base.value) / x.exp2025Khil - 1)),
        );
    }
    const bl = x.billVsLaw;
    c.ok(
      (bl != null) === pyTruth(b.changed),
      `${w}: billVsLaw must exist exactly for the changed budgets`,
    );
    if (bl != null) {
      for (const [key, k] of [
        ['revKhil', 'rev'],
        ['expKhil', 'exp'],
        ['transfersKhil', 'transfers'],
      ] as const) {
        const moved = Math.abs(pyTruth(b.diff[k]) ? b.diff[k] : 0) > 0.05;
        c.ok(
          Object.hasOwn(bl, key) === moved,
          `${w} billVsLaw.${key} present only when the amount moved`,
        );
        if (Object.hasOwn(bl, key))
          for (const s of ['bill', 'law', 'diff'])
            near(
              c,
              bl[key][s],
              b[s][k],
              TOL,
              `${w} billVsLaw.${key}.${s}`,
              disp(bl[key], s),
              disp(b[s], k),
            );
      }
      c.ok(same(required(bl, 'lines'), b.lines), `${w}: billVsLaw.lines`);
    }
    const p = required<any>(x, 'programs');
    tiers[p.tier ?? 'pending'] = (tiers[p.tier ?? 'pending'] ?? 0) + 1;
    if (p.status === 'real') {
      const tier = required<string>(p, 'tier');
      c.ok(
        ['validated', 'program-budget-differs'].includes(tier) &&
          p.file === `ministries/${i}.json` &&
          ctx.exists(p.file),
        `${w}: programs block ${pyRepr(p)}`,
      );
      c.ok(
        pyIntAt(p, 'count') &&
          pyIntAt(p, 'policyCount') &&
          p.count >= p.policyCount &&
          p.policyCount >= 1,
        `${w}: programs counts`,
      );
      polTotal += p.policyCount;
      progTotal += p.count;
      c.ok(
        (p.tier === 'program-budget-differs') === (pb != null),
        `${w}: tier vs programBudgetVsLaw`,
      );
      if (pb != null) {
        near(
          c,
          pb.lawKhil,
          x.expKhil,
          TOL,
          `${w}: programBudgetVsLaw.lawKhil`,
          disp(pb, 'lawKhil'),
          disp(x, 'expKhil'),
        );
        near(
          c,
          pb.diffKhil,
          pySubtract(n(pb, 'lawKhil'), n(pb, 'prbKhil')),
          TOL,
          `${w}: programBudgetVsLaw.diffKhil = law - program budget`,
          disp(pb, 'diffKhil'),
          pyfloat(pySubtract(n(pb, 'lawKhil'), n(pb, 'prbKhil'))),
        );
        near(
          c,
          pb.billKhil,
          b.bill.exp,
          TOL,
          `${w}: programBudgetVsLaw.billKhil = the bill`,
          disp(pb, 'billKhil'),
          disp(b.bill, 'exp'),
        );
        c.ok(
          pyEqual(
            pb.matchesBill,
            Math.abs(pySubtract(n(pb, 'prbKhil'), n(pb, 'billKhil'))) <= 0.05,
          ),
          `${w}: programBudgetVsLaw.matchesBill`,
        );
        c.ok(Math.abs(pb.diffKhil) > 0.05, `${w}: a 'differs' tier needs a difference`);
      }
    } else {
      c.ok(
        p.status === 'pending' &&
          p.id === 'P03' &&
          ['format', 'source-sums'].includes(p.reasonKind) &&
          pyTruth(pyStrip(p.reason)) &&
          !('file' in p) &&
          numbersIn(p) === 0 &&
          !ctx.exists(`ministries/${i}.json`),
        `${w}: pending programs block ${pyRepr(p)}`,
      );
      c.ok(pb == null, `${w}: a pending budget has no programBudgetVsLaw`);
    }
  }
  near(
    c,
    m.totals.revKhil,
    rev,
    TOL_SUM,
    'totals.revKhil = sum of the items',
    disp(m.totals, 'revKhil'),
    pyfloat(rev),
  );
  near(
    c,
    m.totals.expKhil,
    exp,
    TOL_SUM,
    'totals.expKhil = sum of the items',
    disp(m.totals, 'expKhil'),
    pyfloat(exp),
  );
  near(
    c,
    m.totals.revKhil,
    law.totals.law.rev,
    TOL,
    'totals.revKhil = law totals',
    disp(m.totals, 'revKhil'),
    disp(law.totals.law, 'rev'),
  );
  near(
    c,
    m.totals.expKhil,
    law.totals.law.exp,
    TOL,
    'totals.expKhil = law totals (13 326 470,3)',
    disp(m.totals, 'expKhil'),
    disp(law.totals.law, 'exp'),
  );
  const pt = m.programTotals,
    validated = tiers.validated ?? 0,
    differ = tiers['program-budget-differs'] ?? 0,
    pending = tiers.pending ?? 0;
  c.ok(
    pt.budgets === validated + differ &&
      pt.budgets === 42 &&
      pt.pending === pending &&
      pending === 4 &&
      pt.differ === differ &&
      differ === 3,
    `programTotals ${pyRepr(pt)} vs tiers ${pyRepr(tiers)}`,
  );
  c.ok(
    required(pt, 'policies') === polTotal &&
      polTotal === 82 &&
      pt.programs === progTotal &&
      progTotal === 190,
    `programTotals policies/programs ${pyReprAt(pt, 'policies')}/${pyReprAt(pt, 'programs')} vs ${polTotal}/${progTotal}`,
  );
  c.ok(
    same(sorted(Object.keys(kinds)), sorted(KINDS)) &&
      Object.values(kinds).reduce((a, b) => a + b, 0) === 46,
    `kinds used ${pyRepr(kinds)}`,
  );
  const noChange = items.filter((x: any) => x.change == null).map((x: any) => x.id);
  c.ok(
    same(sorted(noChange), ['0100', '0500', '1800', '2300', '3200', '4700']),
    `budgets without a 2025 total: ${pyRepr(noChange)}`,
  );
  c.fact(
    `46 budgets: revenue ${fmt(m.totals.revKhil)}, expenditure ${fmt(m.totals.expKhil)} хил. €; program budgets: ${validated} validated / ${differ} differ from the law / ${pending} pending (P03); ${Number(pt.policies)} policies, ${Number(pt.programs)} programs`,
  );
  return c;
}
function checkFile(c: Check, ctx: Context, item: any, d: any): Row[] {
  const i = item.id,
    w = `ministries/${i}.json`;
  c.ok(
    same(Object.keys(d), [
      'meta',
      'id',
      'art',
      'name',
      'short',
      'tier',
      'years',
      'yearLabels',
      'vintage',
      'cols',
      'policiesKind',
      'total',
      'policies',
      'yearsComplete',
      'check',
      'skipped',
      'skippedTotal',
      'doc',
    ]),
    `${w}: keys ${pyRepr(Object.keys(d))}`,
  );
  const mt = d.meta;
  c.ok(
    mt.id === 'D09' &&
      mt.status === 'real' &&
      same(mt.source, ['prb']) &&
      required(mt, 'unit') === 'хил. €' &&
      mt.mock === false &&
      iso(mt.asOf) &&
      mt.asOf <= ctx.buildDate,
    `${w}: meta`,
  );
  c.ok(
    d.id === i &&
      d.art === item.art &&
      d.name === item.name &&
      d.short === item.short &&
      d.tier === item.programs.tier &&
      d.policiesKind === item.policiesKind,
    `${w}: id/art/name/short/tier/policiesKind differ from ministries.json`,
  );
  c.ok(
    same(d.years, YEARS) &&
      same(d.yearLabels, LABELS) &&
      same(d.vintage, VINTAGE) &&
      same(d.cols, COLS),
    `${w}: years/labels/vintage/cols`,
  );
  const yc = d.yearsComplete;
  c.ok(
    same(
      yc,
      [...new Set(yc)].sort((a: any, b: any) => a - b),
    ) &&
      yc.every((y: number) => YEARS.includes(y)) &&
      yc.includes(2026),
    `${w}: yearsComplete ${pyRepr(yc)}`,
  );
  c.ok(
    d.skipped.length === d.skippedTotal &&
      d.skipped.every((s: any) => typeof s === 'string' && !!pyStrip(s)),
    `${w}: skipped list vs skippedTotal`,
  );
  const rows = progRows(d),
    codes = rows.map(([, , r]) => r.code);
  c.ok(new Set(codes).size === codes.length, `${w}: duplicate codes`);
  for (const [lvl, parent, r] of rows) {
    const ww = `${w} ${r.code}`;
    c.ok(cleanName(required(r, 'name')), `${ww}: name ${pyReprAt(r, 'name')}`);
    if (lvl === 'policy' || (lvl === 'program' && !parent))
      c.ok(
        new RegExp(`^${i}\\.\\p{Decimal_Number}{2}\\.00$`, 'u').test(r.code) &&
          required(r, 'kind') === (lvl === 'policy' ? 'policy' : 'program'),
        `${ww}: policy code/kind`,
      );
    else
      c.ok(
        new RegExp(`^${i}\\.\\p{Decimal_Number}{2}\\.(?!00)\\p{Decimal_Number}{2}$`, 'u').test(
          r.code,
        ) && r.code.slice(0, 7) === parent.slice(0, 7),
        `${ww}: program code under policy ${parent}`,
      );
    required(r, 'values');
    c.ok(
      Object.keys(r.values).every((y) => YEARS.map(String).includes(y)),
      `${ww}: value years ${pyRepr(sorted(Object.keys(r.values)))}`,
    );
    for (const [y, v] of Object.entries(r.values) as [string, any[]][]) {
      if (!c.ok(v.length === 9 && v.every(isnum), `${ww} ${y}: nine numbers`)) continue;
      for (const k of [0, 3, 6])
        near(
          c,
          v[k],
          v[k + 1] + v[k + 2],
          TOL_COL,
          `${ww} ${y}: ${COLS[k]} = budget + other`,
          disp(v, k),
          pyfloat(v[k + 1] + v[k + 2]),
        );
      near(
        c,
        v[0],
        v[3] + v[6],
        TOL_COL,
        `${ww} ${y}: consolidated = department + administration`,
        disp(v, 0),
        pyfloat(v[3] + v[6]),
      );
    }
  }
  let polOk = true,
    progOk = true;
  for (const y of yc) {
    const ys = String(y),
      total = d.total[ys];
    if (
      !c.ok(
        Object.hasOwn(d.total, ys) && total.length === 9 && total.every(isnum),
        `${w}: total ${y}`,
      )
    )
      continue;
    const pols = d.policies,
      tol = Math.min(0.3, 0.05 * (pols.length + 1) + 0.01);
    for (let k = 0; k < 9; k++) {
      const s = sum(
        pyMap(pols, (p: any) =>
          Object.hasOwn(p.values, ys) ? n(p.values[ys], k) : { value: 0, kind: 'float' },
        ),
      );
      if (Math.abs(s - total[k]) > tol + 1e-9) {
        polOk = false;
        c.fail(`${w} ${y} ${COLS[k]}: policies sum to ${fixed(s, 1)}, total ${fixed(total[k], 1)}`);
      }
    }
    for (const pol of pols) {
      const progs = pol.programs;
      if (!pyTruth(progs)) continue;
      const tolerance = Math.min(0.3, 0.05 * (progs.length + 1) + 0.01);
      for (let k = 0; k < 9; k++) {
        const s = sum(
            pyMap(progs, (r: any) =>
              Object.hasOwn(r.values, ys) ? n(r.values[ys], k) : { value: 0, kind: 'float' },
            ),
          ),
          pv = Object.hasOwn(pol.values, ys) ? pol.values[ys][k] : 0;
        if (Math.abs(s - pv) > tolerance + 1e-9) {
          progOk = false;
          c.fail(
            `${w} ${y} ${COLS[k]}: programs of ${pol.code} sum to ${fixed(s, 1)}, policy ${fixed(Number(pv), 1)}`,
          );
        }
      }
    }
  }
  const ck = d.check;
  c.ok(
    required(ck, 'policiesSumToTotal') === polOk &&
      required(ck, 'programsSumToPolicies') === progOk &&
      polOk &&
      progOk,
    `${w}: check flags vs recomputed sums`,
  );
  const t26 = d.total['2026'];
  if (pyTruth(t26)) {
    near(
      c,
      required(ck, 'prbTotal2026'),
      t26[1],
      TOL,
      `${w}: check.prbTotal2026 = total 2026 (budget column)`,
      disp(ck, 'prbTotal2026'),
      disp(t26, 1),
    );
    near(
      c,
      ck.zdbExp,
      item.expKhil,
      TOL,
      `${w}: check.zdbExp = the law`,
      disp(ck, 'zdbExp'),
      disp(item, 'expKhil'),
    );
    const sameLaw = Math.abs(pySubtract(n(ck, 'prbTotal2026'), n(ck, 'zdbExp'))) <= 0.05;
    c.ok(
      required(ck, 'matchesLaw') === sameLaw && sameLaw === (d.tier === 'validated'),
      `${w}: matchesLaw ${disp(ck, 'matchesLaw')} tier ${d.tier}`,
    );
    c.ok(
      'diffKhil' in ck === !sameLaw,
      `${w}: diffKhil exists exactly when the program budget differs`,
    );
    if ('diffKhil' in ck)
      near(
        c,
        ck.diffKhil,
        pySubtract(n(ck, 'zdbExp'), n(ck, 'prbTotal2026')),
        TOL,
        `${w}: diffKhil = law - program budget`,
        disp(ck, 'diffKhil'),
        pyfloat(pySubtract(n(ck, 'zdbExp'), n(ck, 'prbTotal2026'))),
      );
  }
  const p = item.programs,
    pc = rows.filter(([lvl]) => lvl === 'policy').length,
    pr = rows.filter(([lvl]) => lvl === 'program').length;
  c.ok(
    p.policyCount === pc && p.count === pr,
    `${w}: counts (${p.policyCount}, ${p.count}) vs ${pc} policies / ${pr} programs`,
  );
  const doc = d.doc;
  c.ok(
    same(sorted(Object.keys(doc)), ['archive', 'archiveUrl', 'file', 'pages', 'pagesByYear']) &&
      doc.file.toLowerCase().endsWith('.pdf') &&
      !doc.file.includes('/') &&
      doc.archiveUrl === ARCHIVE &&
      typeof doc.archive === 'string' &&
      pyTruth(doc.archive),
    `${w}: doc ${pyRepr(sorted(Object.keys(doc)))}`,
  );
  required(doc, 'pages');
  c.ok(
    same(
      doc.pages,
      [...new Set(doc.pages)].sort((a: any, b: any) => a - b),
    ) && doc.pages.every((n: any, i: number) => pyIntAt(doc.pages, i) && n > 0),
    `${w}: doc.pages`,
  );
  c.ok(
    Object.keys(required(doc, 'pagesByYear')).every((y) => YEARS.map(String).includes(y)) &&
      Object.values(doc.pagesByYear).every((v: any) => v.every((x: any) => doc.pages.includes(x))),
    `${w}: doc.pagesByYear`,
  );
  const text = Object.entries(doc)
    .filter(([k]) => k !== 'pages' && k !== 'pagesByYear')
    .map(([, v]) => String(v))
    .join(' ')
    .toLowerCase();
  c.ok(
    !INTERNAL.filter((t) => t !== '/lov' && t !== 'state/').some((t) => text.includes(t)),
    `${w}: internal wording in doc`,
  );
  return rows;
}
export function programs(ctx: Context): Check {
  const c = new Check('PROGRAMS'),
    m = ctx.get('ministries.json'),
    pj = ctx.get('programs.json');
  const files = ctx
      .dataDirectory('ministries')
      .filter((f) => f.endsWith('.json'))
      .sort(),
    real = m.items
      .filter((x: any) => x.programs.status === 'real')
      .map((x: any) => x.id)
      .sort();
  const actual = files.map((f) => f.slice(0, -5)),
    diff = [...new Set([...actual, ...real])]
      .filter((x) => actual.includes(x) !== real.includes(x))
      .sort();
  c.ok(
    same(actual, real) && real.length === 42,
    `ministries/ holds ${files.length} files, ministries.json announces ${real.length}: ${pyRepr(diff)}`,
  );
  const by = byid(m.items),
    expect: Record<string, [string, string, string, any]> = Object.create(null);
  for (const i of real) {
    const rel = `ministries/${i}.json`;
    if (!ctx.exists(rel))
      throw new PythonError(
        'FileNotFoundError',
        `[Errno 2] No such file or directory: '${ctx.root}/${ctx.dataDir}/${rel}'`,
      );
    for (const [lvl, parent, r] of checkFile(c, ctx, by[i], ctx.get(rel)))
      expect[r.code] = [i, lvl, parent, r];
  }
  const pm = pj.meta;
  c.ok(
    pm.id === 'D09' &&
      pm.status === 'real' &&
      same(sorted(pm.source), ['prb', 'zdb']) &&
      required(pm, 'unit') === 'хил. €' &&
      iso(pm.asOf),
    'programs.json meta',
  );
  c.ok(
    same(Object.keys(pj), ['meta', 'fields', 'sentinels', 'note', 'items']) &&
      same(pj.fields, FIELDS) &&
      same(pj.sentinels, SENTINELS) &&
      typeof pj.note === 'string' &&
      pyTruth(pj.note),
    'programs.json keys / fields / sentinels',
  );
  const rows = required<any[]>(pj, 'items');
  c.ok(
    rows.length === Object.keys(expect).length && rows.length === 272,
    `programs.json has ${rows.length} rows, the files ${Object.keys(expect).length} (272 expected)`,
  );
  const seen = new Set<string>(),
    levels: Record<string, number> = Object.create(null);
  for (const row of rows) {
    c.ok(row.length === FIELDS.length, `programs.json row length ${row.length}`);
    const r: any = Object.fromEntries(FIELDS.slice(0, row.length).map((f, i) => [f, row[i]])),
      code = required<string>(r, 'code'),
      w = `programs.json ${code}`;
    c.ok(!seen.has(code), `${w}: duplicate row`);
    seen.add(code);
    if (!c.ok(Object.hasOwn(expect, code), `${w}: no such row in ministries/<code>.json`)) continue;
    const [i, lvl, parent, src] = expect[code]!;
    levels[r.level] = (levels[r.level] ?? 0) + 1;
    c.ok(
      r.ministry === i && r.level === lvl && r.policy === parent && r.name === src.name,
      `${w}: ministry/level/policy/name differ from the file`,
    );
    const v = src.values,
      y26 = '2026' in v ? v['2026'][0] : -1,
      p26 = '2026' in v ? v['2026'][1] : -1,
      y25 = '2025' in v ? v['2025'][0] : -1,
      p25 = '2025' in v ? v['2025'][1] : -1;
    for (const [field, value, year, index] of [
      ['y2026', y26, '2026', 0],
      ['prb2026', p26, '2026', 1],
      ['y2025', y25, '2025', 0],
      ['prb2025', p25, '2025', 1],
    ] as const)
      near(
        c,
        r[field],
        value,
        TOL,
        `${w} ${field}`,
        disp(row, FIELDS.indexOf(field)),
        Object.hasOwn(v, year) ? disp(v[year], index) : '-1',
      );
    if (y25 > 0 && y26 >= 0)
      near(
        c,
        r.growthPct,
        100 * (y26 / y25 - 1),
        0.051,
        `${w} growthPct`,
        disp(row, 7),
        pyfloat(100 * (y26 / y25 - 1)),
      );
    else
      c.ok(
        r.growthPct === SENTINELS.noGrowth,
        `${w}: growthPct must be the no-growth sentinel, got ${r.growthPct}`,
      );
    c.ok(
      pyEqual(r.isNew, 0 <= y25 && y25 <= 0.05 && y26 > 0 ? 1 : 0),
      `${w}: isNew ${disp(row, 8)}`,
    );
  }
  const missing = Object.keys(expect)
    .filter((x) => !seen.has(x))
    .sort();
  c.ok(
    same(sorted(Object.keys(expect)), sorted([...seen])),
    `rows missing from programs.json: ${pyRepr(missing.slice(0, 5))}`,
  );
  c.ok(
    same(levels, { policy: 82, program: 190 }),
    `programs.json levels ${pyRepr(levels)} (82 policies, 190 programs expected)`,
  );
  c.fact(
    `${files.length} program files; ${rows.length} rows in programs.json (${levels.policy ?? 0} policies, ${levels.program ?? 0} programs); every policy sums to its programs and the total, every name clean`,
  );
  return c;
}
