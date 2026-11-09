/** Fiscal validation against the legacy 2024–28 Annex 3 contract. */
import { Check, byId, fmt, isnum, pyRepr } from './checks.js';
import { Context } from './context.js';
import {
  PythonError,
  required,
  divide,
  floatRepr,
  pyStrip,
  pyEqual,
  pyIntAt,
  pySum,
  pyMap,
  pyDecimalInteger,
  pySubtract,
  pythonType,
} from './python-error.js';

const KFP_KEYS = ['revenue', 'expenditure', 'balance', 'interest', 'primaryBalance', 'financing'];
const same = (a: unknown, b: unknown): boolean => pyEqual(a, b);
const pyFloat = floatRepr;
const fixed = (n: number, places: number) => fmt(n, places).replaceAll(' ', '').replace(',', '.');
const tuple = (values: number[]): string => `(${values.map(pyFloat).join(', ')})`;
// CPython round(x) uses ties-to-even, unlike Math.round.
function roundInteger(x: number): number {
  if (x === null)
    throw new PythonError('TypeError', "type NoneType doesn't define __round__ method");
  const lo = Math.floor(x),
    fraction = x - lo;
  return fraction === 0.5 ? (lo % 2 === 0 ? lo : lo + 1) : Math.round(x);
}
function ptol(series: any[]): number {
  const decimals = series.map((v) => {
    if (v === null)
      throw new PythonError(
        'TypeError',
        "float() argument must be a string or a real number, not 'NoneType'",
      );
    let x: number;
    if (typeof v === 'string') {
      const normalized = pythonNumericText(v);
      const valid =
        /^[+-]?(?:(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?|inf(?:inity)?|nan)$/i.test(
          normalized,
        );
      if (!valid)
        throw new PythonError('ValueError', `could not convert string to float: ${pyRepr(v)}`);
      x = /^[-+]?inf/i.test(normalized)
        ? normalized.startsWith('-')
          ? -Infinity
          : Infinity
        : Number(normalized.replaceAll('_', ''));
    } else x = Number(v);
    const repr = pyFloat(x);
    return repr.includes('.') ? repr.split('.')[1]!.length : 0;
  });
  return 0.5 * 10 ** -Math.max(0, ...decimals) + 0.001;
}

export function annex3(ctx: Context): Check {
  const c = new Check('ANNEX3'),
    o = ctx.get('outlook.json');
  c.ok(same(required(o, 'years'), [2024, 2025, 2026, 2027, 2028]), `years ${pyRepr(o.years)}`);
  c.ok(
    same(o.vintage, ['actual', 'prelim', 'plan', 'forecast', 'forecast']),
    `vintage ${pyRepr(o.vintage)}`,
  );
  const g = o.gdp;
  required(g, 'mln');
  c.ok(g.mln.length === 5 && g.mlnPrecise.length === 5, 'gdp lengths');
  for (let i = 0; i < 5; i++) {
    const rounded = roundInteger(g.mlnPrecise[i]);
    c.ok(
      isnum(g.mln[i]) && Math.abs(g.mln[i] - rounded) <= 1e-9,
      `gdp.mln[${i}] is the rounded precise value: ${displayAt(g.mln, i)} vs ${rounded} (tolerance 0.0)`,
    );
  }
  const gdp = g.mlnPrecise,
    k = o.kfp;
  c.ok(
    same(Object.keys(k).sort(), [...KFP_KEYS].sort()),
    `kfp keys ${pyRepr(Object.keys(k).sort())}`,
  );
  for (const name of KFP_KEYS) {
    const b = k[name];
    required(b, 'mln');
    c.ok(
      b.mln.length === 5 && b.pctGdp.length === 5 && [...b.mln, ...b.pctGdp].every(isnum),
      `${name}: five numbers each`,
    );
    const tol = ptol(b.pctGdp);
    for (let i = 0; i < 5; i++)
      c.near(b.pctGdp[i], divide(100 * b.mln[i], gdp[i]), tol, `${name} pctGdp ${2024 + i}`);
  }
  const [rev, exp, bal, itr, pb, fin] = KFP_KEYS.map((name) => k[name].mln);
  for (let i = 0; i < 5; i++) {
    const y = 2024 + i;
    c.near(rev[i] - exp[i], bal[i], 0.3, `${y}: revenue - expenditure vs balance`);
    c.near(fin[i], -bal[i], 0.3, `${y}: financing vs -balance`);
    c.near(pb[i], bal[i] + itr[i], 0.3, `${y}: primary balance vs balance + interest`);
  }
  c.ok(
    k.primaryBalance.computed === true && k.primaryBalance.note,
    'primaryBalance must be flagged computed with a note',
  );
  const head = [rev[2], exp[2], bal[2], itr[2], gdp[2]];
  c.ok(same(head, [49615.3, 56807.2, -7191.9, 1059.2, 125246.7]), `2026 headline ${tuple(head)}`);
  for (const [name, arr] of Object.entries(o.macro) as [string, any[]][])
    c.ok(arr.length === 5 && arr.every(isnum), `macro.${name}: five numbers`);
  c.ok(o.macroVintage.length === 5, 'macroVintage length');
  const rows = o.macroRows,
    ids = rows.map((r: any) => r.id);
  c.ok(
    ids.length === new Set(ids).size && rows.length === 16,
    `macroRows: 16 unique ids, got ${rows.length}`,
  );
  const inGroups = o.macroGroups.flatMap((gr: any) => gr.rows);
  c.ok(same(inGroups.sort(), [...ids].sort()), 'macroGroups must list every macroRow exactly once');
  for (const r of rows)
    c.ok(r.values.length === 5 && r.values.every(isnum), `macroRow ${r.id}: five numbers`);
  const mr = byId(rows) as Record<string, any>;
  c.ok(same(required<any>(mr, 'gdp').values, g.mln), 'macroRows gdp must equal gdp.mln');
  const vs = o.versions;
  c.ok(vs.length === 9, `versions: ${vs.length} rows, expected 9`);
  const other: Record<string, any> = Object.assign(
    Object.create(null),
    byId(ctx.get('revenue.json').rows),
    byId(ctx.get('expenditure.json').economic.rows),
  );
  let mx = 0;
  for (const v of vs) {
    c.ok(
      v.pdf.length === 5 && v.docx.length === 5 && v.diff.length === 5,
      `versions ${v.id}: five values`,
    );
    c.ok(
      same(v.pdf.slice(0, 2), v.docx.slice(0, 2)) && same(v.diff.slice(0, 2), [0, 0]),
      `versions ${v.id}: 2024-2025 must be equal`,
    );
    for (let i = 0; i < 5; i++) {
      c.near(v.diff[i], v.docx[i] - v.pdf[i], 0.0501, `versions ${v.id} diff ${i}`);
      mx = Math.max(mx, Math.abs(v.diff[i]));
    }
    const row = other[v.id];
    if (c.ok(row !== undefined, `versions ${v.id}: no such row in revenue/economic`)) {
      const start = rowOffset(row);
      requireOffsetIndex(row, true);
      c.ok(
        same(row.mln, v.pdf.slice(start, start + row.mln.length)),
        `versions ${v.id}: the published row must be the PDF version`,
      );
    }
  }
  c.ok(Math.abs(mx - 4.3) < 0.001, `versions: largest difference ${fixed(mx, 1)}, documented 4.3`);
  c.ok(
    o.notes[0].id === 'twoVersions' && o.notes[0].text.includes('9 реда'),
    'notes[0] must be twoVersions and name the 9 rows',
  );
  c.fact(
    `2026: revenue ${fmt(rev[2])}, expenditure ${fmt(exp[2])}, balance ${fmt(bal[2])}, interest ${fmt(itr[2])} млн. €; GDP ${fmt(gdp[2])}; ${vs.length} rows differ between the two Annex 3 versions (max ${fixed(mx, 1)})`,
  );
  return c;
}

import { pythonNumberAt, pythonNumericText, type PythonNumber } from '../common/numbers.js';
const numeric = (holder: any, key: string | number): PythonNumber => {
  const v = holder[key];
  if (v === undefined)
    throw new PythonError(
      Array.isArray(holder) ? 'IndexError' : 'KeyError',
      Array.isArray(holder) ? 'list index out of range' : pyRepr(String(key)),
    );
  if (typeof v === 'boolean') return { value: Number(v), kind: 'int' };
  return pythonNumberAt(holder, String(key), v);
};
const floatZero: PythonNumber = { value: 0, kind: 'float' };
const roundedOne = (x: number): number => Number(fmt(x, 1).replaceAll(' ', '').replace(',', '.'));
function rowOffset(row: any, operation: '+' | '-' = '+'): number {
  if (!Object.hasOwn(row, 'y0')) return 0;
  const value = row.y0;
  if (typeof value === 'number' || typeof value === 'boolean') return Number(value);
  const type = pythonType(value);
  if (operation === '-')
    throw new PythonError(
      'TypeError',
      "unsupported operand type(s) for -: 'int' and '" + type + "'",
    );
  const message =
    type === 'str' || type === 'list'
      ? 'can only concatenate ' + type + ' (not "int") to ' + type
      : "unsupported operand type(s) for +: '" + type + "' and 'int'";
  throw new PythonError('TypeError', message);
}
function requireOffsetIndex(row: any, slice = false): void {
  if (Object.hasOwn(row, 'y0') && !pyIntAt(row, 'y0'))
    throw new PythonError(
      'TypeError',
      slice
        ? 'slice indices must be integers or None or have an __index__ method'
        : 'list indices must be integers or slices, not float',
    );
}
function listValue<T>(values: T[], index: number): T {
  const position = index < 0 ? values.length + index : index;
  if (position < 0 || position >= values.length)
    throw new PythonError('IndexError', 'list index out of range');
  return values[position]!;
}
function at(row: any, i: number): PythonNumber | null {
  const j = i - rowOffset(row, '-');
  if (j < 0 || j >= row.mln.length) return null;
  requireOffsetIndex(row);
  if (row.mln[j] === null) return null;
  return numeric(row.mln, j);
}
function tree(c: Check, rows: any[], what: string, gdp: number[], tolCap = 0.3): number {
  const by = byId(rows) as Record<string, any>,
    kids: Record<string, any[]> = {};
  for (const q of rows) {
    required(q, 'id');
    required(q, 'mln');
    required(q, 'level');
    c.ok(isnum(q.level), `${what} ${q.id}: level`);
    const p = q.parent;
    if (pyTruth(p)) {
      if (c.ok(Object.hasOwn(by, p), `${what} ${q.id}: parent ${p} not in the table`)) {
        c.ok(
          pyEqual(by[p].level, q.level - 1),
          `${what} ${q.id}: level ${pyRepr(q.level)} under parent level ${pyRepr(by[p].level)}`,
        );
        (kids[p] ??= []).push(q);
      }
    } else c.ok(pyEqual(q.level, 0), `${what} ${q.id}: a row without parent must be level 0`);
    const fits = q.mln.length === q.pctGdp.length && rowOffset(q) + q.mln.length <= 5;
    const rawOffset = Object.hasOwn(q, 'y0') ? q.y0 : 0;
    c.ok(
      fits,
      `${what} ${q.id}: mln/pctGdp lengths ${q.mln.length}/${q.pctGdp.length} (y0 ${pyDecimalInteger(rawOffset)})`,
    );
    const y0 = rowOffset(q);
    const tol = ptol(q.pctGdp);
    for (let j = 0; j < Math.min(q.mln.length, q.pctGdp.length); j++) {
      const m = q.mln[j],
        p = q.pctGdp[j];
      c.ok(isnum(m) && isnum(p), `${what} ${q.id}: non-number at ${j}`);
      if (isnum(m) && isnum(p)) {
        requireOffsetIndex(q);
        nearComputed(
          c,
          q.pctGdp,
          j,
          divide(100 * m, listValue(gdp, j + y0)),
          tol,
          `${what} ${q.id} pctGdp ${j + y0}`,
        );
      }
    }
  }
  let worst = 0;
  for (const [pid, ks] of Object.entries(kids)) {
    const real = ks.filter((k) => !pyTruth(k.memo)),
      tol = Math.min(tolCap, 0.05 * (real.length + 1) + 0.01);
    for (let i = 0; i < 5; i++) {
      const parent = at(by[pid], i);
      if (parent === null) continue;
      const values = pyMap(real, (k) => {
        const n = at(k, i);
        return n && n.value ? n : floatZero;
      });
      const d = Math.abs(parent.value - pySum(values));
      worst = Math.max(worst, d);
      c.ok(
        d <= tol,
        `${what} ${pid} year ${i}: ${fmt(parent.value)} differs from the sum of its ${real.length} parts by ${fixed(d, 2)}`,
      );
    }
  }
  return worst;
}
function displayAt(holder: any, key: string | number): string {
  const v = holder[key];
  return isnum(v) && numeric(holder, key).kind === 'float'
    ? pyFloat(v)
    : typeof v === 'string'
      ? v
      : pyRepr(v);
}
function nearWithText(
  c: Check,
  a: unknown,
  b: unknown,
  tolerance: number,
  message: string,
  ar: string,
  br: string,
): void {
  c.ok(
    isnum(a) && isnum(b) && Math.abs(a - b) <= tolerance + 1e-9,
    `${message}: ${ar} vs ${br} (tolerance ${tolerance})`,
  );
}
function nearComputed(
  c: Check,
  holder: any,
  key: string | number,
  b: number,
  tolerance: number,
  message: string,
): void {
  const a = holder[key];
  const rendered = displayAt(holder, key);
  c.ok(
    isnum(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance + 1e-9,
    `${message}: ${rendered} vs ${pyFloat(b)} (tolerance ${tolerance})`,
  );
}
export function revenue(ctx: Context): Check {
  const c = new Check('REVENUE'),
    r = ctx.get('revenue.json'),
    o = ctx.get('outlook.json'),
    gdp = o.gdp.mlnPrecise;
  c.ok(same(r.years, o.years) && same(r.vintage, o.vintage), 'years/vintage must equal outlook');
  const t = r.total;
  c.ok(
    same(t.mln, o.kfp.revenue.mln) && same(t.pctGdp, o.kfp.revenue.pctGdp),
    'total must equal outlook.kfp.revenue',
  );
  const rows = required<any[]>(r, 'rows'),
    by = byId(rows) as Record<string, any>;
  c.ok(
    rows.length === 31 && Object.keys(by).length === 31,
    `rows: ${rows.length} (unique ${Object.keys(by).length}), expected 31`,
  );
  c.ok(same(by['r.total'].mln, t.mln), 'r.total must equal total');
  const worst = tree(c, rows, 'revenue', gdp),
    groups = r.groups;
  c.ok(
    groups.length === 8 && new Set(groups.map((gr: any) => gr.id)).size === 8,
    'groups: 8 unique ids',
  );
  const used = groups.flatMap((gr: any) => gr.rowIds);
  c.ok(
    used.length === new Set(used).size && used.every((id: string) => Object.hasOwn(by, id)),
    'groups: rowIds unique and existing',
  );
  const gsum = [];
  for (let i = 0; i < 5; i++) {
    const s = pySum(pyMap(groups, (gr: any) => numeric(gr.mln, i)));
    gsum.push(roundedOne(s));
    c.near(s, t.mln[i], 0.15, `groups sum vs total, year ${2024 + i}`);
    c.near(r.groupSums[i], roundedOne(s), 0.0501, `groupSums[${i}]`);
  }
  for (const gr of groups) {
    if (!gr.rowIds.every((x: string) => Object.hasOwn(by, x))) continue;
    c.ok(
      same(
        gr.annex3Rows,
        gr.rowIds.map((i: string) => by[i].label),
      ),
      `group ${gr.id}: annex3Rows differ from the row labels`,
    );
    for (let i = 0; i < 5; i++) {
      const s = pySum(
        pyMap(gr.rowIds, (x: string) => {
          const n = at(by[x], i);
          return n && n.value ? n : floatZero;
        }),
      );
      c.near(gr.mln[i], s, 0.0501, `group ${gr.id} mln ${2024 + i}`);
    }
    const tol = ptol(gr.pctGdp);
    for (let i = 0; i < 5; i++)
      nearComputed(
        c,
        gr.pctGdp,
        i,
        divide(100 * gr.mln[i], gdp[i]),
        tol,
        `group ${gr.id} pctGdp ${2024 + i}`,
      );
    nearComputed(
      c,
      gr,
      'share2026',
      divide(100 * gr.mln[2], t.mln[2]),
      0.0051,
      `group ${gr.id} share2026`,
    );
    nearComputed(
      c,
      gr,
      'yoy2026Pct',
      100 * (divide(gr.mln[2], gr.mln[1]) - 1),
      0.0501,
      `group ${gr.id} yoy2026Pct`,
    );
  }
  const shares = pySum(pyMap(groups, (gr: any) => numeric(gr, 'share2026')));
  nearWithText(c, shares, 100, 0.05, 'shares add up to 100', pyFloat(shares), '100.0');
  const ex = ctx.get('execution.json');
  c.ok(
    r.execution.ref === 'execution' &&
      (Array.isArray(r.execution.rows) ? r.execution.rows : Object.keys(r.execution.rows)).every(
        (k: string) => ex.rows.some((x: any) => x.id === k),
      ),
    'execution.rows must be ids of execution.json',
  );
  const notes = r.notes.map((n: any) => n.id);
  c.ok(same(notes, ['groups', 'rounding', 'byTax']), `notes ids ${pyRepr(notes)}`);
  const max = Math.max(...gsum.map((a, i) => Math.abs(a - t.mln[i])));
  c.fact(
    `2026 revenue ${fmt(t.mln[2])} млн. €, ${groups.length} groups (sum differs from the total by at most ${fmt(max, 1)}), tree identities within ${fixed(worst, 1)}`,
  );
  return c;
}

import { createHash } from 'node:crypto';
import { pyTruth } from './checks.js';
export function measures(ctx: Context): Check {
  const c = new Check('MEASURES'),
    m = ctx.get('measures.json'),
    o = ctx.get('outlook.json'),
    t = m.totals;
  const tt = t.discretionary2026;
  c.ok(
    same([tt['II-8'], tt['II-9']], [482, 604.4]),
    `discretionary 2026: II-8 / II-9 = ${pyFloat(tt['II-8'])} / ${pyFloat(tt['II-9'])}`,
  );
  c.ok(
    same(
      [t.revenueMln, t.expenditureMln, t.expenditureMlnWithoutIndicative],
      [745, -1710.5, -1060.8],
    ),
    'short-term totals',
  );
  c.ok(same([m.check['II-8'], m.check['II-9']], [482, 604.4]), 'check.II-8 / II-9');
  const items = m.items,
    ids = items.map((i: any) => i.id),
    by = byId(items) as Record<string, any>,
    cnt = required<any>(m, 'counts');
  c.ok(
    items.length === 52 && new Set(ids).size === 52,
    `items: ${items.length} (unique ${new Set(ids).size}), expected 52`,
  );
  const short = items.filter((i: any) => i.tab === 'short'),
    disc = items.filter((i: any) => i.tab === 'discretionary'),
    laws = items.filter((i: any) => i.tab === 'laws');
  c.ok(
    same(
      [short.length, disc.length, laws.length],
      [cnt.short.all, cnt.discretionary.revenue + cnt.discretionary.expenditure, cnt.laws],
    ),
    `counts by tab: ${short.length} / ${disc.length} / ${laws.length}`,
  );
  c.ok(cnt.all === items.length && items.length === 52, 'counts.all');
  const count = (xs: any[], f: (x: any) => boolean) => xs.filter(f).length;
  c.ok(
    count(short, (i) => i.kind === 'revenue' && pyTruth(required(i, 'hasEstimate'))) ===
      cnt.short.revenue && cnt.short.revenue === 8,
    'counts: short revenue with estimate',
  );
  c.ok(
    count(short, (i) => i.kind === 'expenditure' && pyTruth(required(i, 'hasEstimate'))) ===
      cnt.short.expenditure && cnt.short.expenditure === 9,
    'counts: short expenditure with estimate',
  );
  c.ok(
    count(short, (i) => !pyTruth(required(i, 'hasEstimate'))) === cnt.short.noEstimate &&
      cnt.short.noEstimate === 7,
    'counts: short without estimate',
  );
  c.ok(
    count(disc, (i) => i.kind === 'revenue') === cnt.discretionary.revenue &&
      cnt.discretionary.revenue === 14,
    'counts: discretionary revenue',
  );
  c.ok(
    count(disc, (i) => i.kind === 'expenditure') === cnt.discretionary.expenditure &&
      cnt.discretionary.expenditure === 6,
    'counts: discretionary expenditure',
  );
  for (const i of items) {
    required(i, 'page');
    c.ok(
      (Array.isArray(m.tabs) ? m.tabs.includes(i.tab) : Object.hasOwn(m.tabs, i.tab)) &&
        Object.hasOwn(m.stageLabels, i.stage),
      `${i.id}: tab/stage`,
    );
    c.ok(
      ['name', 'text', 'quote'].every((k) => typeof i[k] === 'string' && pyStrip(i[k])),
      `${i.id}: name/text/quote must be text`,
    );
    c.ok(
      i.page !== null &&
        typeof i.page === 'object' &&
        !Array.isArray(i.page) &&
        pyIntAt(i.page, 'docx'),
      `${i.id}: page.docx`,
    );
    if (pyTruth(required(i, 'hasEstimate'))) {
      required(i, 'effectMln');
      c.ok(
        Object.keys(i.effectMln).every((y) => ['2026', '2027', '2028'].includes(y)) &&
          pyTruth(i.effectMln) &&
          Object.values(i.effectMln).every(isnum),
        `${i.id}: effectMln`,
      );
      if (i.tab === 'short')
        c.ok(Object.hasOwn(m.estimateKinds, i.estimateKind), `${i.id}: estimateKind`);
    } else
      c.ok(
        !('effectMln' in i) && !('balanceEffectMln' in i),
        `${i.id}: no estimate, so no numbers`,
      );
    if ('balanceEffectMln' in i) {
      const sign = i.kind === 'revenue' ? 1 : -1;
      c.ok(
        same(Object.keys(i.balanceEffectMln).sort(), Object.keys(i.effectMln).sort()) &&
          Object.keys(i.effectMln).every(
            (y) => Math.abs(i.balanceEffectMln[y] - sign * i.effectMln[y]) < 1e-9,
          ),
        `${i.id}: balanceEffectMln must be +effect (revenue) or -effect (expenditure)`,
      );
    }
    for (const rid of i.related ?? [])
      c.ok(Object.hasOwn(by, rid), `${i.id}: related ${rid} does not exist`);
    if ('from' in i)
      c.ok(
        typeof i.from === 'string' &&
          /^\p{Decimal_Number}{4}-\p{Decimal_Number}{2}-\p{Decimal_Number}{2}$/u.test(i.from),
        `${i.id}: from ${pyRepr(i.from)}`,
      );
  }
  const grp = byId(m.groups) as Record<string, any>,
    seen: string[] = [];
  for (const gr of m.groups) {
    seen.push(...gr.items);
    c.ok(
      gr.items.every(
        (x: string) => Object.hasOwn(by, x) && by[x].tab === 'short' && by[x].kind === gr.kind,
      ),
      `group ${gr.id}: items must be short-term ${gr.kind} measures`,
    );
    if ('totalMln' in gr) {
      const s = pySum(pyMap(gr.items, (x: string) => numeric(by[x].effectMln, '2026')));
      nearWithText(
        c,
        s,
        gr.totalMln,
        0.05 * (gr.items.length + 1),
        `group ${gr.id}: items sum vs totalMln`,
        pyFloat(s),
        displayAt(gr, 'totalMln'),
      );
    }
  }
  c.ok(
    same(seen.sort(), short.map((i: any) => i.id).sort()),
    'groups must cover every short-term measure exactly once',
  );
  c.near(
    grp['short-revenue'].totalMln,
    t.revenueMln,
    0.0001,
    'group short-revenue vs totals.revenueMln',
  );
  c.near(
    grp['short-expenditure'].totalMln,
    t.expenditureMln,
    0.0001,
    'group short-expenditure vs totals.expenditureMln',
  );
  const kk = grp['short-expenditure'].items
    .map((x: string) => by[x])
    .filter((x: any) => x.estimateKind === 'stated');
  c.near(
    pySum(pyMap(kk, (x: any) => numeric(x.effectMln, '2026'))),
    t.expenditureMlnWithoutIndicative,
    0.05 * (kk.length + 1),
    'stated expenditure measures vs totals.expenditureMlnWithoutIndicative',
  );
  const gdp = o.gdp.mlnPrecise[2];
  for (const [tab, kind] of [
    ['II-8', 'revenue'],
    ['II-9', 'expenditure'],
  ] as const) {
    const its = disc.filter((i: any) => i.table === tab);
    c.ok(
      its.every((i: any) => i.kind === kind) && its.length === cnt.discretionary[kind],
      `${tab}: items`,
    );
    const sums = [];
    for (const y of ['2026', '2027', '2028']) {
      const s = pySum(
        pyMap(its, (i: any) =>
          Object.hasOwn(i.effectMln, y) ? numeric(i.effectMln, y) : floatZero,
        ),
      );
      sums.push(roundedOne(s));
      nearWithText(
        c,
        s,
        t.discretionary[tab][y],
        0.15,
        `${tab} ${y}: items sum vs printed total`,
        pyFloat(s),
        displayAt(t.discretionary[tab], y),
      );
    }
    c.ok(
      same(m.check.rowSums[tab], sums),
      `check.rowSums[${tab}] [${m.check.rowSums[tab].map((_: any, i: number) => displayAt(m.check.rowSums[tab], i)).join(', ')}] vs recomputed [${sums.map(pyFloat).join(', ')}]`,
    );
    c.near(
      t.discretionaryPeriod[tab],
      pySum(pyMap(Object.keys(t.discretionary[tab]), (y) => numeric(t.discretionary[tab], y))),
      0.15,
      `${tab}: period total`,
    );
  }
  nearComputed(
    c,
    t.gdpShare2026,
    'revenue',
    divide(100 * tt['II-8'], gdp),
    0.0051,
    'gdpShare2026 revenue',
  );
  nearComputed(
    c,
    t.gdpShare2026,
    'expenditure',
    divide(100 * tt['II-9'], gdp),
    0.0051,
    'gdpShare2026 expenditure',
  );
  const d = m.document;
  required(d, 'sha256');
  c.ok(
    d.url.startsWith('https://www.parliament.bg/') && d.sha256.length === 64,
    'document: url/sha256',
  );
  const path = 'parliament/52-602-01-19.docx';
  if (ctx.sourceExists(path))
    c.ok(
      createHash('sha256').update(ctx.sourceBytes(path)).digest('hex') === d.sha256,
      'document.sha256 differs from the local copy of the bill',
    );
  else c.warn('local copy of the bill not found: document.sha256 not re-checked');
  c.fact(
    `short-term: revenue ${fmt(t.revenueMln)}, expenditure ${fmt(t.expenditureMln)} (${fmt(t.expenditureMlnWithoutIndicative)} without indicative) млн. €; discretionary 2026: II-8 ${fmt(tt['II-8'])}, II-9 ${fmt(tt['II-9'])}; ${items.length} items (24 + 20 + 8)`,
  );
  return c;
}

export function expenditure(ctx: Context): Check {
  const c = new Check('EXPENDITURE'),
    e = ctx.get('expenditure.json'),
    o = ctx.get('outlook.json'),
    core = ctx.get('core.json'),
    gdp = o.gdp.mlnPrecise,
    f = required<any>(e, 'functions');
  c.ok(
    same(f.years, [2025, 2026, 2027, 2028]) && f.vintage.length === 4 && f.yearLabels.length === 4,
    'functions: years/vintage/yearLabels',
  );
  const items = f.items,
    tot = f.totalMln;
  c.ok(
    items.length === 9 && new Set(items.map((i: any) => i.id)).size === 9,
    'functions: 9 unique items',
  );
  for (let k = 0; k < 4; k++) {
    const s = pySum(pyMap(items, (i: any) => numeric(i.mln, k)));
    nearWithText(
      c,
      s,
      tot[k],
      0.0011,
      `functions: items sum vs totalMln, ${2025 + k}`,
      pyFloat(s),
      displayAt(tot, k),
    );
    nearComputed(
      c,
      f.totalPctGdp,
      k,
      divide(100 * tot[k], gdp[k + 1]),
      0.0051,
      `functions: totalPctGdp ${2025 + k}`,
    );
  }
  c.ok(tot[1] === 55525, `functions: 2026 total ${displayAt(tot, 1)}, expected 55 525,0`);
  const gaps = [0, 0, 0, 0];
  for (const it of items) {
    c.ok(
      ['mln', 'pctGdp', 'share'].every((x) => it[x].length === 4 && it[x].every(isnum)),
      `functions ${it.id}: four numbers each`,
    );
    for (let k = 0; k < 4; k++) {
      gaps[k] = Math.max(gaps[k]!, Math.abs(it.pctGdp[k] - divide(100 * it.mln[k], gdp[k + 1])));
      nearComputed(
        c,
        it.share,
        k,
        divide(100 * it.mln[k], tot[k]),
        0.0061,
        `functions ${it.id} share ${2025 + k}`,
      );
    }
    nearComputed(
      c,
      it,
      'yoy2026Pct',
      100 * (divide(it.mln[1], it.mln[0]) - 1),
      0.0501,
      `functions ${it.id} yoy2026Pct`,
    );
    if (pyTruth(it.parts))
      for (let k = 0; k < 4; k++)
        c.near(
          pySum(pyMap(it.parts, (p: any) => numeric(p.mln, k))),
          it.mln[k],
          0.15,
          `functions ${it.id}: parts vs item, ${2025 + k}`,
        );
  }
  const rc = f.reconcile;
  for (let k = 0; k < 4; k++)
    c.ok(
      gaps[k]! <= rc.printedPctGdpMaxGap[k] + 0.006,
      `functions: printed % of GDP gap ${fixed(gaps[k]!, 3)} in ${2025 + k} exceeds the declared ${rc.printedPctGdpMaxGap[k]}`,
    );
  const ec = byId(required<any>(e, 'economic').rows) as Record<string, any>;
  for (let k = 0; k < 4; k++) {
    const value = at(ec['x.exp'], k + 1);
    nearWithText(
      c,
      rc.annex3ExpenditureMln[k],
      value?.value,
      0.0001,
      `reconcile: annex3ExpenditureMln ${2025 + k} vs economic x.exp`,
      displayAt(rc.annex3ExpenditureMln, k),
      value === null
        ? 'None'
        : typeof value.value === 'number' && value.kind === 'float'
          ? pyFloat(value.value)
          : typeof value.value === 'string'
            ? value.value
            : pyRepr(value.value),
    );
    nearComputed(
      c,
      rc.diffMln,
      k,
      roundedOne(tot[k] - rc.annex3ExpenditureMln[k]),
      0.0501,
      `reconcile: diffMln ${2025 + k}`,
    );
  }
  c.ok(
    Math.abs(rc.diffMln[0]) > 1000 && rc.diffMln.slice(1).every((d: number) => Math.abs(d) <= 0.15),
    "reconcile: only the 2025 'Програма' column may differ from Annex 3",
  );
  const vers = f.versions,
    by = byId(items) as Record<string, any>,
    pdfTotal = [...tot];
  c.ok(vers.length === 7, `functions.versions: ${vers.length} rows, expected 7`);
  for (const v of vers) {
    const it = by[v.id],
      pub = 'part' in v ? it.parts.filter((p: any) => p.name === v.part)[0].mln : it.mln;
    c.ok(
      same(v.docx, pub),
      `functions.versions ${v.id} ${v.part ?? ''}: the published numbers must be the .docx ones`,
    );
    c.ok(v.pdf[0] === v.docx[0], `functions.versions ${v.id}: 2025 must be equal`);
    if (!('part' in v)) for (let k = 0; k < 4; k++) pdfTotal[k] += v.pdf[k] - v.docx[k];
  }
  for (let k = 0; k < 4; k++)
    c.near(rc.pdfTotalMln[k], pdfTotal[k], 0.0501, `reconcile: pdfTotalMln ${2025 + k}`);
  const note = f.notes[0].text.replaceAll('\u202f', ' ').replaceAll('\u00a0', ' ');
  c.ok(
    f.notes[0].id === 'base' && note.includes('55 525,0') && note.includes('56 807,2'),
    'functions.notes[0] must quote 55 525,0 and 56 807,2',
  );
  const mins = new Set(ctx.get('ministries.json').items.map((m: any) => m.id));
  for (const it of items)
    c.ok(
      (it.ministries ?? []).every((m: string) => mins.has(m)),
      `functions ${it.id}: unknown ministry code in ${pyRepr(it.ministries)}`,
    );
  const z = e.economic,
    rows = z.rows;
  c.ok(
    same(z.years, o.years) && same(z.vintage, o.vintage),
    'economic: years/vintage must equal outlook',
  );
  c.ok(
    rows.length === 30 && Object.keys(ec).length === 30,
    `economic: ${rows.length} rows, expected 30`,
  );
  const worst = tree(c, rows, 'economic', gdp);
  c.ok(
    same(ec['x.total'].mln, o.kfp.expenditure.mln),
    'economic x.total must equal outlook expenditure',
  );
  c.ok(
    same(ec['x.interest'].mln, o.kfp.interest.mln),
    'economic x.interest must equal outlook interest',
  );
  for (let i = 0; i < 5; i++)
    c.near(
      ec['x.nonint'].mln[i],
      pySubtract(numeric(ec['x.exp'].mln, i), numeric(ec['x.interest'].mln, i)),
      0.15,
      `economic: memo x.nonint ${2024 + i}`,
    );
  c.ok(ec['x.nonint'].memo === true, 'economic: x.nonint must be a memo row');
  nearWithText(
    c,
    ec['x.exp'].mln[2],
    tot[1],
    0.0011,
    'economic x.exp 2026 vs functions total',
    displayAt(ec['x.exp'].mln, 2),
    displayAt(tot, 1),
  );
  c.ok(
    same([ec['x.total'].mln[2], ec['x.eucontrib'].mln[2]], [56807.2, 1282.2]),
    'economic 2026: x.total/x.eucontrib',
  );
  c.near(
    ec['x.exp'].mln[2] + ec['x.eucontrib'].mln[2],
    ec['x.total'].mln[2],
    0.15,
    '55 525,0 + 1 282,2 vs 56 807,2',
  );
  const cf = e.cofog,
    cit = cf.items,
    top = cit.filter((x: any) => !pyTruth(x.memoOf));
  c.ok(
    cf.years.length === 10 && cf.years.at(-1) === 2024 && same(cf.source, ['eurostat']),
    'cofog: ten years ending 2024, source eurostat',
  );
  for (let k = 0; k < 10; k++)
    c.ok(
      Math.abs(pySum(pyMap(top, (x: any) => numeric(x.mln, k))) - cf.total.mln[k]) <= 0.3,
      `cofog ${cf.years[k]}: functions differ from the total`,
    );
  for (const m of cit.filter((x: any) => pyTruth(x.memoOf))) {
    const p = required<any>(byId(cit, 'code') as Record<string, any>, m.memoOf);
    c.ok(
      m.mln.slice(0, p.mln.length).every((a: number, k: number) => a <= p.mln[k] + 0.05),
      `cofog memo ${m.code} exceeds its parent`,
    );
  }
  c.ok(
    cit.every((x: any) => (x.kfpFunctions ?? []).every((id: string) => Object.hasOwn(by, id))),
    'cofog: kfpFunctions must be function ids',
  );
  const implied = divide(100 * cf.total.mln.at(-1), cf.total.pctGdp.at(-1));
  c.ok(
    Math.abs(divide(implied, gdp[0]) - 1) < 0.003,
    `cofog: the GDP implied by the 2024 percentages (${fmt(implied, 0)}) differs from Annex 3's 2024 GDP`,
  );
  const pc = e.perCapita;
  c.ok(
    pc.population === core.population.persons && pc.year === core.population.year,
    'perCapita: population must equal core.population',
  );
  c.fact(
    `functions 2026 ${fmt(tot[1])} млн. € (+ EU contribution ${fmt(ec['x.eucontrib'].mln[2])} = ${fmt(ec['x.total'].mln[2])}); economic tree within ${fixed(worst, 1)}; Annex 3 2025 column differs from the printed 'Програма' by ${fmt(rc.diffMln[0])} млн. €`,
  );
  return c;
}
