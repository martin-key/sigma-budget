import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { zipMember } from '../build/annual-lineage.js';
import { Check, isnum } from './checks.js';
import { Context, safePath } from './context.js';

const LAW_ROWS: Record<string, number> = {
  rev: 0,
  'rev.tax': 1,
  'rev.nontax': 6,
  'rev.grants': 7,
  'exp.total': 8,
  'exp.interest': 14,
  eucontrib: 15,
  'exp.capex': 11,
  'exp.abroad': 12,
  'exp.contingency': 13,
  balance: 17,
};
const reason = 'Приложение 1 не дава отделен законов знаменател за този ред.';
const split = 'Приложение 1 не дава национална/европейска разбивка на закона; колони 2/3 са отчет.';
const coverage = {
  kfp: Object.fromEntries(
    [
      'exp.personnel',
      'exp.maint',
      'exp.social',
      'exp.subsidies',
      'exp.reserve',
      'exp.interest.ext',
      'exp.interest.dom',
    ].map((r) => [r, reason]),
  ),
  nat: split,
  eu: split,
};
type Rat = [bigint, bigint];
function decimal(v: unknown): Rat {
  if (!isnum(v) && typeof v !== 'string') throw new TypeError('invalid decimal');
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(v));
  if (!m) throw new TypeError('invalid decimal');
  const power = Number(m[4] ?? 0) - (m[3]?.length ?? 0);
  if (!Number.isSafeInteger(power) || Math.abs(power) > 1000)
    throw new RangeError('invalid decimal exponent');
  const num = BigInt(m[2]! + (m[3] ?? '')) * (m[1] === '-' ? -1n : 1n);
  return power >= 0 ? [num * 10n ** BigInt(power), 1n] : [num, 10n ** BigInt(-power)];
}
const add = (a: Rat, b: Rat): Rat => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const neg = (a: Rat): Rat => [-a[0], a[1]];
const sub = (a: Rat, b: Rat) => add(a, neg(b));
const mul = (a: Rat, b: Rat): Rat => [a[0] * b[0], a[1] * b[1]];
const div = (a: Rat, b: Rat): Rat => {
  if (!b[0]) throw new RangeError('division by zero');
  return b[0] < 0n ? [-a[0] * b[1], -a[1] * b[0]] : [a[0] * b[1], a[1] * b[0]];
};
const cmp = (a: Rat, b: Rat) =>
  a[0] * b[1] < b[0] * a[1] ? -1 : a[0] * b[1] > b[0] * a[1] ? 1 : 0;
const asNumber = (a: Rat) => {
  const denominator = a[1].toString();
  if (!/^10*$/.test(denominator)) return Number(a[0]) / Number(a[1]);
  const places = denominator.length - 1,
    negative = a[0] < 0n;
  const digits = (negative ? -a[0] : a[0]).toString().padStart(places + 1, '0');
  return Number(
    `${negative ? '-' : ''}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`,
  );
};
const half = decimal('0.05'),
  hundred = decimal(100);
function quantize2(a: Rat): number {
  const negative = a[0] < 0n,
    num = (negative ? -a[0] : a[0]) * 100n;
  let q = num / a[1];
  if ((num % a[1]) * 2n >= a[1]) q++;
  return Number(negative ? -q : q) / 100;
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const own = (o: any, key: string) => Object.prototype.hasOwnProperty.call(o, key);
// Member digests are keyed by the freshly verified archive digest, never by a mutable path.
const memberDigests = new Map<string, string>();

/** Independent Annex 1 calculations; the builder's plan output is never an expectation. */
export function validateKfpLaw(c: Check, ex: any, outlook: any, ctx: Context): void {
  const forecast: any = ctx.proto('budget_forecast_2027.json'),
    bill: any = ctx.proto('budget_bill_2027.json');
  for (const doc of [forecast, bill]) {
    const src = doc.source,
      archive = readFileSync(safePath(ctx.root, src.archive));
    const archiveHash = own(src, 'archive_sha256') ? src.archive_sha256 : src.sha256;
    const memberHash = own(src, 'pdf_sha256') ? src.pdf_sha256 : src.memberSha256;
    const actualHash = sha(archive);
    if (actualHash !== archiveHash) throw new Error(`Archive checksum mismatch: ${src.archive}`);
    const key = `${actualHash}\0${src.member}`;
    let digest = memberDigests.get(key);
    if (digest === undefined) {
      digest = sha(zipMember(archive, src.member));
      if (memberDigests.size >= 256) memberDigests.clear();
      memberDigests.set(key, digest);
    }
    if (digest !== memberHash) throw new Error(`PDF member checksum mismatch: ${src.member}`);
  }
  const table = forecast.tables.annex1_execution2026,
    rows = table.rows;
  const column = table.columns[0];
  if (column.year !== 2026 || column.vintage !== 'програма')
    throw new Error('Wrong year or vintage in Annex 1');
  const values: Record<string, number> = {};
  for (const [rid, i] of Object.entries(LAW_ROWS)) {
    const value = rows[i].values[0];
    if (!isnum(value))
      throw new TypeError(
        `Non-numeric extraction cell: F/tables/annex1_execution2026/rows/${i}/values/0`,
      );
    values[rid] = value;
  }
  values.exp = asNumber(sub(decimal(values['exp.total']), decimal(values.eucontrib)));
  values.fin = -values.balance!;
  const expected: any = {
    periodKey: '2026.law',
    basis: 'adopted-law',
    source: ['budget2027'],
    asOf: '2026-11-06',
    unit: 'млн. €',
    coverage,
    kfp: values,
    nat: {},
    eu: {},
  };
  const plan = ex.plan2026;
  for (const key of ['periodKey', 'basis', 'source', 'asOf', 'unit', 'coverage'])
    c.ok(isDeepStrictEqual(plan[key] ?? null, expected[key]), 'law plan metadata/coverage: ' + key);
  for (const scope of ['kfp', 'nat', 'eu']) {
    c.ok(isDeepStrictEqual(plan[scope], expected[scope]), 'law map exact: ' + scope);
    for (const [rid, item] of Object.entries(ex.latest[scope]) as [string, any][]) {
      const pv = expected[scope][rid] ?? null;
      c.ok((item.plan ?? null) === pv, `latest law denominator: ${scope}/${rid}`);
      const hasPct = pv !== null && pv > 0 && !['balance', 'fin', 'transfers'].includes(rid);
      c.ok(own(item, 'pctPlan') === hasPct, `latest law percent availability: ${scope}/${rid}`);
      if (hasPct) {
        const cum = ex.data['2026'][scope][rid][ex.latest.month - 1];
        const want = quantize2(div(mul(decimal(cum), hundred), decimal(pv)));
        c.ok(item.pctPlan === want, 'latest canonical law percent: ' + rid);
      }
    }
  }
  for (const [name, rid] of [
    ['revenue', 'rev'],
    ['expenditure', 'exp.total'],
    ['balance', 'balance'],
    ['interest', 'exp.interest'],
  ])
    c.ok(outlook.byPeriod['2026.law'].series[name!].value === values[rid!], 'outlook law: ' + name);
  for (const [i, row] of rows.entries()) {
    const printed = i < 13 || i === 14 || i === 15,
      available = row.values[4] !== null;
    c.ok(available === printed, 'annex1 printed percent availability: row ' + i);
    if (available && printed) {
      const law = decimal(row.values[0]),
        sept = decimal(row.values[1]),
        pct = decimal(row.values[4]);
      const lower = div(mul(hundred, sub(sept, half)), add(law, half)),
        upper = div(mul(hundred, add(sept, half)), sub(law, half));
      c.ok(
        cmp(lower, add(pct, half)) < 0 && cmp(upper, sub(pct, half)) > 0,
        'annex1 printed percent interval: row ' + i,
      );
    }
  }
  for (const [rid, index] of Object.entries(LAW_ROWS)) {
    const row = rows[index];
    if (row.values[1] === null) {
      c.ok(rid === 'exp.contingency', 'only contingency has no September execution cell');
      continue;
    }
    decimal(row.values[0]);
    const sept = decimal(row.values[1]);
    let actual = own(ex.data['2026'].kfp, rid) ? decimal(ex.data['2026'].kfp[rid][8]) : null;
    if (rid === 'exp.capex') actual = add(actual!, decimal(ex.data['2026'].kfp['exp.reserve'][8]));
    if (actual !== null)
      c.ok(
        cmp(sub(sept, half), actual) <= 0 && cmp(actual, add(sept, half)) < 0,
        'annex1 September XLS: ' + rid,
      );
  }
  for (const [parent, children] of [
    [0, [1, 6, 7]],
    [8, [9, 14, 15]],
    [9, [10, 11, 12, 13]],
  ] as [number, number[]][]) {
    const value = decimal(rows[parent].values[0]),
      total = children.map((i) => decimal(rows[i].values[0])).reduce(add, decimal(0));
    const difference = sub(value, total),
      abs: Rat = [difference[0] < 0n ? -difference[0] : difference[0], difference[1]];
    c.ok(cmp(abs, mul(half, decimal(children.length + 1))) < 0, 'annex1 law subtotal: ' + parent);
  }
}
