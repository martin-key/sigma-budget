/** Fiscal validation against the legacy 2024–28 Annex 3 contract. */
import { Check, isnum } from './checks.js';
import { Context } from './context.js';
import {
  PythonError,
  pyById as byId,
  pyDict,
  pyGet,
  pyIterGet,
  pythonFormat as fmt,
  pythonRepr as pyRepr,
  pyReprAt,
  required,
  floatRepr,
  pyStrip,
  pyEqual,
  pyIntAt,
  pySum,
  pyMap,
  pyDecimalInteger,
  pySubtract,
  pythonType,
  pyItem,
  pySet,
  pyIter,
  pyHas,
  sourceTypeAt,
  pyLenAt,
  pyItemAt,
  pyIterAt,
  pyDivide,
  pyMultiply,
  pyAddAssign,
  pyAdd,
  pyLessEqual,
  pyTypedSum,
  pyAbs,
} from './python-error.js';
const KFP_KEYS = ['revenue', 'expenditure', 'balance', 'interest', 'primaryBalance', 'financing'];
const same = (a: unknown, b: unknown): boolean => pyEqual(a, b);
const pyFloat = floatRepr;
const fixed = (n: number, places: number) => fmt(n, places).replaceAll(' ', '').replace(',', '.');
const floating = (value: number): PythonNumber => ({ value, kind: 'float' });
function percentage(a: () => PythonNumber, b: () => PythonNumber): number {
  const product = pyMultiply(floating(100), a());
  return pyDivide(floating(product), b());
}
function growth(a: () => PythonNumber, b: () => PythonNumber): number {
  const ratio = pyDivide(a(), b());
  return pyMultiply(floating(100), floating(pySubtract(floating(ratio), floating(1))));
}
const tuple = (values: number[]): string => `(${values.map(pyFloat).join(', ')})`;
// CPython round(x) uses ties-to-even, unlike Math.round.
function roundInteger(x: number): number {
  if (typeof x !== 'number' && typeof x !== 'boolean')
    throw new PythonError('TypeError', `type ${pythonType(x)} doesn't define __round__ method`);
  if (Number.isNaN(x)) throw new PythonError('ValueError', 'cannot convert float NaN to integer');
  if (!Number.isFinite(Number(x)))
    throw new PythonError('OverflowError', 'cannot convert float infinity to integer');
  x = Number(x);
  const lo = Math.floor(x),
    fraction = x - lo;
  return fraction === 0.5 ? (lo % 2 === 0 ? lo : lo + 1) : Math.round(x);
}
function ptol(series: any): number {
  const decimals = pyIter(series).map((v) => {
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
    } else if (typeof v === 'number' || typeof v === 'boolean') x = Number(v);
    else
      throw new PythonError(
        'TypeError',
        `float() argument must be a string or a real number, not '${pythonType(v)}'`,
      );
    const repr = pyFloat(x);
    return repr.includes('.') ? repr.split('.')[1]!.length : 0;
  });
  return 0.5 * 10 ** -Math.max(0, ...decimals) + 0.001;
}
export function annex3(ctx: Context): Check {
  const c = new Check('ANNEX3'),
    o = ctx.get('outlook.json');
  c.ok(same(required(o, 'years'), [2024, 2025, 2026, 2027, 2028]), `years ${pyReprAt(o, 'years')}`);
  c.ok(
    same(required(o, 'vintage'), ['actual', 'prelim', 'plan', 'forecast', 'forecast']),
    `vintage ${pyReprAt(o, 'vintage')}`,
  );
  const g = required<any>(o, 'gdp');
  c.ok(pyLenAt(g, 'mln') === 5 && pyLenAt(g, 'mlnPrecise') === 5, 'gdp lengths');
  for (let i = 0; i < 5; i++) {
    const cell = pyItemAt(g, 'mln', i);
    const rounded = roundInteger(pyItemAt(g, 'mlnPrecise', i));
    c.ok(
      isnum(cell) && Math.abs(cell - rounded) <= 1e-9,
      `gdp.mln[${i}] is the rounded precise value: ${displayAt(required<any>(g, 'mln'), i)} vs ${rounded} (tolerance 0.0)`,
    );
  }
  const gdp = required<any>(g, 'mlnPrecise'),
    k = required<any>(o, 'kfp');
  c.ok(
    same(Object.keys(k).sort(), [...KFP_KEYS].sort()),
    `kfp keys ${pyRepr(Object.keys(k).sort())}`,
  );
  for (const name of KFP_KEYS) {
    const b = required<any>(k, name);
    required(b, 'mln');
    c.ok(
      pyLenAt(b, 'mln') === 5 &&
        pyLenAt(b, 'pctGdp') === 5 &&
        [...required<any>(b, 'mln'), ...required<any>(b, 'pctGdp')].every(isnum),
      `${name}: five numbers each`,
    );
    const tol = ptol(pyIterAt(b, 'pctGdp'));
    for (let i = 0; i < 5; i++)
      c.near(
        pyItemAt(b, 'pctGdp', i),
        pyDivide(
          {
            value: pyMultiply({ value: 100, kind: 'float' }, numeric(required(b, 'mln'), i)),
            kind: 'float',
          },
          numeric(gdp, i),
        ),
        tol,
        `${name} pctGdp ${2024 + i}`,
      );
  }
  const [rev, exp, bal, itr, pb, fin] = KFP_KEYS.map((name) => required<any>(k[name], 'mln'));
  for (let i = 0; i < 5; i++) {
    const y = 2024 + i;
    c.near(rev[i] - exp[i], bal[i], 0.3, `${y}: revenue - expenditure vs balance`);
    c.near(fin[i], -bal[i], 0.3, `${y}: financing vs -balance`);
    c.near(pb[i], bal[i] + itr[i], 0.3, `${y}: primary balance vs balance + interest`);
  }
  c.ok(
    required<any>(k, 'primaryBalance').computed === true && required<any>(k, 'primaryBalance').note,
    'primaryBalance must be flagged computed with a note',
  );
  const head = [rev[2], exp[2], bal[2], itr[2], gdp[2]];
  c.ok(same(head, [49615.3, 56807.2, -7191.9, 1059.2, 125246.7]), `2026 headline ${tuple(head)}`);
  for (const [name, arr] of Object.entries(required(o, 'macro')) as [string, any[]][])
    c.ok(arr.length === 5 && arr.every(isnum), `macro.${name}: five numbers`);
  c.ok(pyLenAt(o, 'macroVintage') === 5, 'macroVintage length');
  const rows = required<any[]>(o, 'macroRows'),
    ids = rows.map((r: any) => required(r, 'id'));
  c.ok(
    ids.length === pySet(ids).size && rows.length === 16,
    `macroRows: 16 unique ids, got ${rows.length}`,
  );
  const inGroups = required<any[]>(o, 'macroGroups').flatMap((gr: any) => pyIterAt(gr, 'rows'));
  c.ok(same(inGroups.sort(), [...ids].sort()), 'macroGroups must list every macroRow exactly once');
  for (const r of rows)
    c.ok(
      pyLenAt(r, 'values') === 5 && pyIterAt(r, 'values').every(isnum),
      `macroRow ${required(r, 'id')}: five numbers`,
    );
  const mr = byId(rows) as Record<string, any>;
  c.ok(
    same(required(required<any>(mr, 'gdp'), 'values'), required(g, 'mln')),
    'macroRows gdp must equal gdp.mln',
  );
  const vs = required<any[]>(o, 'versions');
  c.ok(vs.length === 9, `versions: ${vs.length} rows, expected 9`);
  const other = pyDict<any, any>([
    ...byId(required(ctx.get('revenue.json'), 'rows')),
    ...byId(required(required<any>(ctx.get('expenditure.json'), 'economic'), 'rows')),
  ]);
  let mx = 0;
  for (const v of vs) {
    c.ok(
      pyLenAt(v, 'pdf') === 5 && pyLenAt(v, 'docx') === 5 && pyLenAt(v, 'diff') === 5,
      `versions ${required<string>(v, 'id')}: five values`,
    );
    c.ok(
      same(required<any>(v, 'pdf').slice(0, 2), required<any>(v, 'docx').slice(0, 2)) &&
        same(required<any>(v, 'diff').slice(0, 2), [0, 0]),
      `versions ${required<string>(v, 'id')}: 2024-2025 must be equal`,
    );
    for (let i = 0; i < 5; i++) {
      const actual = pyItemAt(v, 'diff', i),
        left = numeric(required(v, 'docx'), i),
        right = numeric(required(v, 'pdf'), i),
        expected = pySubtract(left, right);
      nearWithText(
        c,
        actual,
        expected,
        0.0501,
        `versions ${required<string>(v, 'id')} diff ${i}`,
        displayAt(required(v, 'diff'), i),
        left.kind === 'float' || right.kind === 'float' ? pyFloat(expected) : String(expected),
      );
      mx = Math.max(mx, pyAbs(numeric(required<any>(v, 'diff'), i)));
    }
    const row = other.get(required<string>(v, 'id'));
    if (
      c.ok(
        row !== undefined,
        `versions ${required<string>(v, 'id')}: no such row in revenue/economic`,
      )
    ) {
      const start = rowOffset(row);
      requireOffsetIndex(row, true);
      c.ok(
        same(
          required<any>(row, 'mln'),
          required<any>(v, 'pdf').slice(start, start + required<any>(row, 'mln').length),
        ),
        `versions ${required<string>(v, 'id')}: the published row must be the PDF version`,
      );
    }
  }
  c.ok(Math.abs(mx - 4.3) < 0.001, `versions: largest difference ${fixed(mx, 1)}, documented 4.3`);
  c.ok(
    required(pyItemAt(o, 'notes', 0), 'id') === 'twoVersions' &&
      required<string>(pyItemAt(o, 'notes', 0), 'text').includes('9 реда'),
    'notes[0] must be twoVersions and name the 9 rows',
  );
  c.fact(
    `2026: revenue ${fmt(rev[2])}, expenditure ${fmt(exp[2])}, balance ${fmt(bal[2])}, interest ${fmt(itr[2])} млн. €; GDP ${fmt(gdp[2])}; ${vs.length} rows differ between the two Annex 3 versions (max ${fixed(mx, 1)})`,
  );
  return c;
}
import { pythonNumberAt, pythonNumericText, type PythonNumber } from '../common/numbers.js';
const numeric = (holder: any, key: string | number): PythonNumber => {
  const v = pyItem(holder, key);
  if (typeof v === 'boolean') return { value: Number(v), kind: 'int' };
  return pythonNumberAt(holder, String(key), v);
};
const floatZero: PythonNumber = { value: 0, kind: 'float' };
const roundedOne = (x: number): number => Number(fmt(x, 1).replaceAll(' ', '').replace(',', '.'));
function rowOffset(row: any, operation: '+' | '-' = '+'): number {
  if (!pyHas(row, 'y0')) return 0;
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
  if (pyHas(row, 'y0') && !pyIntAt(row, 'y0'))
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
type RowValue = PythonNumber & { raw: unknown };
function at(row: any, i: number): RowValue | null {
  const j = i - rowOffset(row, '-');
  if (!(j >= 0)) return null;
  const values = required<any>(row, 'mln');
  if (j >= pyLenAt(row, 'mln')) return null;
  requireOffsetIndex(row);
  const raw = pyItemAt(row, 'mln', j);
  if (raw === null) return null;
  return { ...numeric(values, j), raw };
}
function tree(c: Check, rows: any[], what: string, gdp: number[], tolCap = 0.3): number {
  const by = byId(rows) as Record<string, any>,
    kids = pyDict<any, any[]>();
  for (const q of rows) {
    c.ok(isnum(required<any>(q, 'level')), `${what} ${required<any>(q, 'id')}: level`);
    const p = q.parent;
    if (pyTruth(p)) {
      if (
        c.ok(
          pyHas(by, p),
          `${what} ${required<any>(q, 'id')}: parent ${typeof p === 'string' ? p : pyReprAt(q, 'parent')} not in the table`,
        )
      ) {
        c.ok(
          pyEqual(
            required(pyItem(by, p), 'level'),
            pySubtract(numeric(q, 'level'), { value: 1, kind: 'int' }),
          ),
          `${what} ${required<any>(q, 'id')}: level ${pyReprAt(q, 'level')} under parent level ${pyReprAt(pyItem(by, p), 'level')}`,
        );
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p)!.push(q);
      }
    } else
      c.ok(
        pyEqual(required<any>(q, 'level'), 0),
        `${what} ${required<any>(q, 'id')}: a row without parent must be level 0`,
      );
    const mlnLength = pyLenAt(q, 'mln');
    const pct = required<any>(q, 'pctGdp');
    const fits = mlnLength === pyLenAt(q, 'pctGdp') && rowOffset(q) + mlnLength <= 5;
    const rawOffset = pyHas(q, 'y0') ? q.y0 : 0;
    c.ok(
      fits,
      `${what} ${required<any>(q, 'id')}: mln/pctGdp lengths ${mlnLength}/${pyLenAt(q, 'pctGdp')} (y0 ${pyDecimalInteger(rawOffset)})`,
    );
    const y0 = rowOffset(q);
    const tol = ptol(pyIterAt(q, 'pctGdp'));
    const ms = pyIter(required<any>(q, 'mln')),
      ps = pyIter(pct);
    for (let j = 0; j < Math.min(ms.length, ps.length); j++) {
      const m = ms[j],
        p = ps[j];
      c.ok(isnum(m) && isnum(p), `${what} ${required<any>(q, 'id')}: non-number at ${j}`);
      if (isnum(m) && isnum(p)) {
        requireOffsetIndex(q);
        nearComputed(
          c,
          required<any>(q, 'pctGdp'),
          j,
          () =>
            percentage(
              () => numeric(required<any>(q, 'mln'), j),
              () => numeric(gdp, j + y0),
            ),
          tol,
          `${what} ${required<any>(q, 'id')} pctGdp ${j + y0}`,
          sourceTypeAt(q, 'pctGdp'),
        );
      }
    }
  }
  let worst = 0;
  for (const [pid, ks] of kids) {
    const real = ks.filter((k) => !pyTruth(k.memo)),
      tol = Math.min(tolCap, 0.05 * (real.length + 1) + 0.01);
    for (let i = 0; i < 5; i++) {
      const parent = at(pyItem(by, pid), i);
      if (parent === null) continue;
      const values = pyMap(real, (k) => {
        const n = at(k, i);
        return n && pyTruth(n.raw) ? n : floatZero;
      });
      const d = Math.abs(pySubtract(parent, pyTypedSum(values)));
      worst = Math.max(worst, d);
      c.ok(
        d <= tol,
        `${what} ${pid} year ${i}: ${fmt(parent.raw)} differs from the sum of its ${real.length} parts by ${fixed(d, 2)}`,
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
  b: () => number,
  tolerance: number,
  message: string,
  containerType?: string,
): void {
  const a = pyItem(holder, key, containerType);
  const computed = b();
  const rendered = displayAt(holder, key);
  c.ok(
    isnum(a) && Number.isFinite(computed) && Math.abs(a - computed) <= tolerance + 1e-9,
    `${message}: ${rendered} vs ${pyFloat(computed)} (tolerance ${tolerance})`,
  );
}
export function revenue(ctx: Context): Check {
  const c = new Check('REVENUE'),
    r = ctx.get('revenue.json'),
    o = ctx.get('outlook.json'),
    gdp = required<any>(required<any>(o, 'gdp'), 'mlnPrecise');
  c.ok(
    same(required(r, 'years'), required(o, 'years')) &&
      same(required(r, 'vintage'), required(o, 'vintage')),
    'years/vintage must equal outlook',
  );
  const t = required<any>(r, 'total');
  c.ok(
    same(required(t, 'mln'), required(required<any>(required<any>(o, 'kfp'), 'revenue'), 'mln')) &&
      same(
        required(t, 'pctGdp'),
        required(required<any>(required<any>(o, 'kfp'), 'revenue'), 'pctGdp'),
      ),
    'total must equal outlook.kfp.revenue',
  );
  const rows = required<any[]>(r, 'rows'),
    by = byId(rows) as Record<string, any>;
  c.ok(
    rows.length === 31 && by.size === 31,
    `rows: ${rows.length} (unique ${by.size}), expected 31`,
  );
  c.ok(
    same(required(required<any>(by, 'r.total'), 'mln'), required(t, 'mln')),
    'r.total must equal total',
  );
  const worst = tree(c, rows, 'revenue', gdp),
    groups = required<any[]>(r, 'groups');
  c.ok(
    groups.length === 8 && pySet(groups.map((gr: any) => required(gr, 'id'))).size === 8,
    'groups: 8 unique ids',
  );
  const used = groups.flatMap((gr: any) => pyIterAt(gr, 'rowIds'));
  c.ok(
    used.length === pySet(used).size && used.every((id: any) => pyHas(by, id)),
    'groups: rowIds unique and existing',
  );
  const gsum = [];
  for (let i = 0; i < 5; i++) {
    const s = pySum(pyMap(groups, (gr: any) => numeric(required(gr, 'mln'), i)));
    gsum.push(roundedOne(s));
    c.near(s, required<any>(t, 'mln')[i], 0.15, `groups sum vs total, year ${2024 + i}`);
    c.near(pyItemAt(r, 'groupSums', i), roundedOne(s), 0.0501, `groupSums[${i}]`);
  }
  for (const gr of groups) {
    if (!required<any>(gr, 'rowIds').every((x: string) => pyHas(by, x))) continue;
    c.ok(
      same(
        required(gr, 'annex3Rows'),
        required<any>(gr, 'rowIds').map((i: string) => required(pyItem(by, i), 'label')),
      ),
      `group ${required<any>(gr, 'id')}: annex3Rows differ from the row labels`,
    );
    for (let i = 0; i < 5; i++) {
      const actual = pyItemAt(gr, 'mln', i);
      const s = pyTypedSum(
        pyMap(required<any>(gr, 'rowIds'), (x: string) => {
          const n = at(pyItem(by, x), i);
          return n && pyTruth(n.raw) ? n : floatZero;
        }),
      );
      nearWithText(
        c,
        actual,
        s.value,
        0.0501,
        `group ${required<any>(gr, 'id')} mln ${2024 + i}`,
        displayAt(required<any>(gr, 'mln'), i),
        s.kind === 'float' ? pyFloat(s.value) : String(s.value),
      );
    }
    const tol = ptol(pyIterAt(gr, 'pctGdp'));
    for (let i = 0; i < 5; i++)
      nearComputed(
        c,
        required<any>(gr, 'pctGdp'),
        i,
        () =>
          percentage(
            () => numeric(required(gr, 'mln'), i),
            () => numeric(gdp, i),
          ),
        tol,
        `group ${required<any>(gr, 'id')} pctGdp ${2024 + i}`,
        sourceTypeAt(gr, 'pctGdp'),
      );
    nearComputed(
      c,
      gr,
      'share2026',
      () =>
        percentage(
          () => numeric(required(gr, 'mln'), 2),
          () => numeric(required(t, 'mln'), 2),
        ),
      0.0051,
      `group ${required<any>(gr, 'id')} share2026`,
    );
    nearComputed(
      c,
      gr,
      'yoy2026Pct',
      () =>
        growth(
          () => numeric(required(gr, 'mln'), 2),
          () => numeric(required<any>(gr, 'mln'), 1),
        ),
      0.0501,
      `group ${required<any>(gr, 'id')} yoy2026Pct`,
    );
  }
  const shares = pySum(pyMap(groups, (gr: any) => numeric(gr, 'share2026')));
  nearWithText(c, shares, 100, 0.05, 'shares add up to 100', pyFloat(shares), '100.0');
  const ex = ctx.get('execution.json');
  c.ok(
    required(required<any>(r, 'execution'), 'ref') === 'execution' &&
      pyIterAt(required<any>(r, 'execution'), 'rows').every((k: any) =>
        pySet(pyIterAt(ex, 'rows').map((x: any) => required(x, 'id'))).has(k),
      ),
    'execution.rows must be ids of execution.json',
  );
  const notes = pyIterAt(r, 'notes').map((n: any) => required(n, 'id'));
  c.ok(same(notes, ['groups', 'rounding', 'byTax']), `notes ids ${pyRepr(notes)}`);
  const max = Math.max(...gsum.map((a, i) => Math.abs(a - required<any>(t, 'mln')[i])));
  c.fact(
    `2026 revenue ${fmt(required<any>(t, 'mln')[2])} млн. €, ${groups.length} groups (sum differs from the total by at most ${fmt(max, 1)}), tree identities within ${fixed(worst, 1)}`,
  );
  return c;
}
import { createHash } from 'node:crypto';
import { pyTruth } from './checks.js';
export function measures(ctx: Context): Check {
  const c = new Check('MEASURES'),
    m = ctx.get('measures.json'),
    o = ctx.get('outlook.json'),
    t = required<any>(m, 'totals');
  const tt = required<any>(t, 'discretionary2026');
  c.ok(
    same([required<any>(tt, 'II-8'), required<any>(tt, 'II-9')], [482, 604.4]),
    `discretionary 2026: II-8 / II-9 = ${displayAt(tt, 'II-8')} / ${displayAt(tt, 'II-9')}`,
  );
  c.ok(
    same(
      [
        required(t, 'revenueMln'),
        required(t, 'expenditureMln'),
        required(t, 'expenditureMlnWithoutIndicative'),
      ],
      [745, -1710.5, -1060.8],
    ),
    'short-term totals',
  );
  c.ok(
    same(
      [
        required<any>(required<any>(m, 'check'), 'II-8'),
        required<any>(required<any>(m, 'check'), 'II-9'),
      ],
      [482, 604.4],
    ),
    'check.II-8 / II-9',
  );
  const items = required<any[]>(m, 'items'),
    ids = items.map((i: any) => required(i, 'id')),
    by = byId(items) as Record<string, any>,
    cnt = required<any>(m, 'counts');
  c.ok(
    items.length === 52 && pySet(ids).size === 52,
    `items: ${items.length} (unique ${pySet(ids).size}), expected 52`,
  );
  const short = items.filter((i: any) => required(i, 'tab') === 'short'),
    disc = items.filter((i: any) => required(i, 'tab') === 'discretionary'),
    laws = items.filter((i: any) => required(i, 'tab') === 'laws');
  c.ok(
    same(
      [short.length, disc.length, laws.length],
      [
        required<any>(required<any>(cnt, 'short'), 'all'),
        pyAdd(
          numeric(required<any>(cnt, 'discretionary'), 'revenue'),
          numeric(required<any>(cnt, 'discretionary'), 'expenditure'),
        ),
        required(cnt, 'laws'),
      ],
    ),
    `counts by tab: ${short.length} / ${disc.length} / ${laws.length}`,
  );
  c.ok(required(cnt, 'all') === items.length && items.length === 52, 'counts.all');
  const count = (xs: any[], f: (x: any) => boolean) => xs.filter(f).length;
  c.ok(
    count(
      short,
      (i) => required(i, 'kind') === 'revenue' && pyTruth(required(i, 'hasEstimate')),
    ) === required<any>(required<any>(cnt, 'short'), 'revenue') &&
      required<any>(required<any>(cnt, 'short'), 'revenue') === 8,
    'counts: short revenue with estimate',
  );
  c.ok(
    count(
      short,
      (i) => required(i, 'kind') === 'expenditure' && pyTruth(required(i, 'hasEstimate')),
    ) === required<any>(required<any>(cnt, 'short'), 'expenditure') &&
      required<any>(required<any>(cnt, 'short'), 'expenditure') === 9,
    'counts: short expenditure with estimate',
  );
  c.ok(
    count(short, (i) => !pyTruth(required(i, 'hasEstimate'))) ===
      required<any>(required<any>(cnt, 'short'), 'noEstimate') &&
      required<any>(required<any>(cnt, 'short'), 'noEstimate') === 7,
    'counts: short without estimate',
  );
  c.ok(
    count(disc, (i) => required(i, 'kind') === 'revenue') ===
      required<any>(required<any>(cnt, 'discretionary'), 'revenue') &&
      required<any>(required<any>(cnt, 'discretionary'), 'revenue') === 14,
    'counts: discretionary revenue',
  );
  c.ok(
    count(disc, (i) => required(i, 'kind') === 'expenditure') ===
      required<any>(required<any>(cnt, 'discretionary'), 'expenditure') &&
      required<any>(required<any>(cnt, 'discretionary'), 'expenditure') === 6,
    'counts: discretionary expenditure',
  );
  for (const i of items) {
    c.ok(
      (Array.isArray(required<any>(m, 'tabs'))
        ? required<any>(m, 'tabs').includes(required(i, 'tab'))
        : pyHas(required<any>(m, 'tabs'), required(i, 'tab'))) &&
        pyHas(required<any>(m, 'stageLabels'), required(i, 'stage')),
      `${required(i, 'id')}: tab/stage`,
    );
    c.ok(
      ['name', 'text', 'quote'].every((k) => typeof i[k] === 'string' && pyStrip(i[k])),
      `${required(i, 'id')}: name/text/quote must be text`,
    );
    c.ok(
      required(i, 'page') !== null &&
        typeof required<any>(i, 'page') === 'object' &&
        !Array.isArray(required<any>(i, 'page')) &&
        pyIntAt(required<any>(i, 'page'), 'docx'),
      `${required(i, 'id')}: page.docx`,
    );
    if (pyTruth(required(i, 'hasEstimate'))) {
      required(i, 'effectMln');
      c.ok(
        Object.keys(required<any>(i, 'effectMln')).every((y) =>
          ['2026', '2027', '2028'].includes(y),
        ) &&
          pyTruth(required<any>(i, 'effectMln')) &&
          Object.values(required<any>(i, 'effectMln')).every(isnum),
        `${required(i, 'id')}: effectMln`,
      );
      if (required<any>(i, 'tab') === 'short')
        c.ok(
          pyHas(required<any>(m, 'estimateKinds'), i.estimateKind),
          `${required(i, 'id')}: estimateKind`,
        );
    } else
      c.ok(
        !('effectMln' in i) && !('balanceEffectMln' in i),
        `${required(i, 'id')}: no estimate, so no numbers`,
      );
    if ('balanceEffectMln' in i) {
      const sign = required(i, 'kind') === 'revenue' ? 1 : -1;
      c.ok(
        same(
          Object.keys(required<any>(i, 'balanceEffectMln')).sort(),
          Object.keys(required<any>(i, 'effectMln')).sort(),
        ) &&
          Object.keys(required<any>(i, 'effectMln')).every(
            (y) =>
              Math.abs(
                pySubtract(numeric(required<any>(i, 'balanceEffectMln'), y), {
                  value: pyMultiply(
                    { value: sign, kind: 'float' },
                    numeric(required<any>(i, 'effectMln'), y),
                  ),
                  kind: 'float',
                }),
              ) < 1e-9,
          ),
        `${required(i, 'id')}: balanceEffectMln must be +effect (revenue) or -effect (expenditure)`,
      );
    }
    for (const rid of pyIterGet(i, 'related'))
      c.ok(
        pyHas(by, rid),
        `${required(i, 'id')}: related ${typeof rid === 'string' ? rid : pyRepr(rid)} does not exist`,
      );
    if ('from' in i)
      c.ok(
        typeof required<any>(i, 'from') === 'string' &&
          /^\p{Decimal_Number}{4}-\p{Decimal_Number}{2}-\p{Decimal_Number}{2}$/u.test(
            required<any>(i, 'from'),
          ),
        `${required(i, 'id')}: from ${pyReprAt(i, 'from')}`,
      );
  }
  const grp = byId(required<any>(m, 'groups')) as Record<string, any>,
    seen: string[] = [];
  for (const gr of required<any>(m, 'groups')) {
    seen.push(...required<any>(gr, 'items'));
    c.ok(
      required<any>(gr, 'items').every(
        (x: string) =>
          pyHas(by, x) &&
          required<any>(pyItem(by, x), 'tab') === 'short' &&
          required<any>(pyItem(by, x), 'kind') === required<any>(gr, 'kind'),
      ),
      `group ${required<any>(gr, 'id')}: items must be short-term ${required<any>(gr, 'kind')} measures`,
    );
    if ('totalMln' in gr) {
      const s = pySum(
        pyMap(required<any>(gr, 'items'), (x: string) =>
          numeric(required<any>(pyItem(by, x), 'effectMln'), '2026'),
        ),
      );
      nearWithText(
        c,
        s,
        required<any>(gr, 'totalMln'),
        0.05 * (required<any>(gr, 'items').length + 1),
        `group ${required<any>(gr, 'id')}: items sum vs totalMln`,
        pyFloat(s),
        displayAt(gr, 'totalMln'),
      );
    }
  }
  c.ok(
    same(seen.sort(), short.map((i: any) => required(i, 'id')).sort()),
    'groups must cover every short-term measure exactly once',
  );
  nearWithText(
    c,
    required<any>(pyItem(grp, 'short-revenue'), 'totalMln'),
    required<any>(t, 'revenueMln'),
    0.0001,
    'group short-revenue vs totals.revenueMln',
    displayAt(pyItem(grp, 'short-revenue'), 'totalMln'),
    displayAt(t, 'revenueMln'),
  );
  nearWithText(
    c,
    required<any>(pyItem(grp, 'short-expenditure'), 'totalMln'),
    required<any>(t, 'expenditureMln'),
    0.0001,
    'group short-expenditure vs totals.expenditureMln',
    displayAt(pyItem(grp, 'short-expenditure'), 'totalMln'),
    displayAt(t, 'expenditureMln'),
  );
  const kk = required<any>(pyItem(grp, 'short-expenditure'), 'items')
    .map((x: string) => pyItem(by, x))
    .filter((x: any) => required<any>(x, 'estimateKind') === 'stated');
  const stated = pyTypedSum(pyMap(kk, (x: any) => numeric(required<any>(x, 'effectMln'), '2026')));
  nearWithText(
    c,
    stated.value,
    required<any>(t, 'expenditureMlnWithoutIndicative'),
    0.05 * (kk.length + 1),
    'stated expenditure measures vs totals.expenditureMlnWithoutIndicative',
    stated.kind === 'float' ? pyFloat(stated.value) : String(stated.value),
    displayAt(t, 'expenditureMlnWithoutIndicative'),
  );
  const gdp = required<any>(required<any>(o, 'gdp'), 'mlnPrecise')[2];
  for (const [tab, kind] of [
    ['II-8', 'revenue'],
    ['II-9', 'expenditure'],
  ] as const) {
    const its = disc.filter((i: any) => i.table === tab);
    c.ok(
      its.every((i: any) => required(i, 'kind') === kind) &&
        its.length === required<any>(required<any>(cnt, 'discretionary'), kind),
      `${tab}: items`,
    );
    const sums = [];
    for (const y of ['2026', '2027', '2028']) {
      const s = pySum(
        pyMap(its, (i: any) =>
          pyHas(required<any>(i, 'effectMln'), y)
            ? numeric(required<any>(i, 'effectMln'), y)
            : floatZero,
        ),
      );
      sums.push(roundedOne(s));
      nearWithText(
        c,
        s,
        required<any>(required<any>(required<any>(t, 'discretionary'), tab), y),
        0.15,
        `${tab} ${y}: items sum vs printed total`,
        pyFloat(s),
        displayAt(required<any>(required<any>(t, 'discretionary'), tab), y),
      );
    }
    c.ok(
      same(required<any>(required<any>(required<any>(m, 'check'), 'rowSums'), tab), sums),
      `check.rowSums[${tab}] [${required<any>(required<any>(m, 'check'), 'rowSums')
        [tab].map((_: any, i: number) =>
          displayAt(required<any>(required<any>(required<any>(m, 'check'), 'rowSums'), tab), i),
        )
        .join(', ')}] vs recomputed [${sums.map(pyFloat).join(', ')}]`,
    );
    c.near(
      required<any>(required<any>(t, 'discretionaryPeriod'), tab),
      pySum(
        pyMap(Object.keys(required<any>(required<any>(t, 'discretionary'), tab)), (y) =>
          numeric(required<any>(required<any>(t, 'discretionary'), tab), y),
        ),
      ),
      0.15,
      `${tab}: period total`,
    );
  }
  nearComputed(
    c,
    required<any>(t, 'gdpShare2026'),
    'revenue',
    () =>
      percentage(
        () => numeric(tt, 'II-8'),
        () => numeric(required<any>(required<any>(o, 'gdp'), 'mlnPrecise'), 2),
      ),
    0.0051,
    'gdpShare2026 revenue',
    sourceTypeAt(t, 'gdpShare2026'),
  );
  nearComputed(
    c,
    required<any>(t, 'gdpShare2026'),
    'expenditure',
    () =>
      percentage(
        () => numeric(tt, 'II-9'),
        () => numeric(required<any>(required<any>(o, 'gdp'), 'mlnPrecise'), 2),
      ),
    0.0051,
    'gdpShare2026 expenditure',
    sourceTypeAt(t, 'gdpShare2026'),
  );
  const d = required<any>(m, 'document');
  required(d, 'sha256');
  c.ok(
    required<string>(d, 'url').startsWith('https://www.parliament.bg/') &&
      pyLenAt(d, 'sha256') === 64,
    'document: url/sha256',
  );
  const path = 'parliament/52-602-01-19.docx';
  if (ctx.sourceExists(path))
    c.ok(
      createHash('sha256').update(ctx.sourceBytes(path)).digest('hex') ===
        required<any>(d, 'sha256'),
      'document.sha256 differs from the local copy of the bill',
    );
  else c.warn('local copy of the bill not found: document.sha256 not re-checked');
  c.fact(
    `short-term: revenue ${fmt(required<any>(t, 'revenueMln'))}, expenditure ${fmt(required<any>(t, 'expenditureMln'))} (${fmt(required<any>(t, 'expenditureMlnWithoutIndicative'))} without indicative) млн. €; discretionary 2026: II-8 ${fmt(required<any>(tt, 'II-8'))}, II-9 ${fmt(required<any>(tt, 'II-9'))}; ${items.length} items (24 + 20 + 8)`,
  );
  return c;
}
export function expenditure(ctx: Context): Check {
  const c = new Check('EXPENDITURE'),
    e = ctx.get('expenditure.json'),
    o = ctx.get('outlook.json'),
    core = ctx.get('core.json'),
    gdp = required<any>(required<any>(o, 'gdp'), 'mlnPrecise'),
    f = required<any>(e, 'functions');
  c.ok(
    same(required(f, 'years'), [2025, 2026, 2027, 2028]) &&
      pyLenAt(f, 'vintage') === 4 &&
      pyLenAt(f, 'yearLabels') === 4,
    'functions: years/vintage/yearLabels',
  );
  const items = required<any[]>(f, 'items');
  c.ok(
    items.length === 9 && pySet(items.map((i: any) => required(i, 'id'))).size === 9,
    'functions: 9 unique items',
  );
  const tot = required<any>(f, 'totalMln');
  for (let k = 0; k < 4; k++) {
    const s = pySum(pyMap(items, (i: any) => numeric(required(i, 'mln'), k)));
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
      required<any>(f, 'totalPctGdp'),
      k,
      () =>
        percentage(
          () => numeric(tot, k),
          () => numeric(gdp, k + 1),
        ),
      0.0051,
      `functions: totalPctGdp ${2025 + k}`,
      sourceTypeAt(f, 'totalPctGdp'),
    );
  }
  c.ok(tot[1] === 55525, `functions: 2026 total ${displayAt(tot, 1)}, expected 55 525,0`);
  const gaps = [0, 0, 0, 0];
  for (const it of items) {
    c.ok(
      ['mln', 'pctGdp', 'share'].every((x) => pyLenAt(it, x) === 4) &&
        ['mln', 'pctGdp', 'share'].every((x) => pyIter(required(it, x)).every(isnum)),
      `functions ${required<any>(it, 'id')}: four numbers each`,
    );
    for (let k = 0; k < 4; k++) {
      gaps[k] = Math.max(
        gaps[k]!,
        Math.abs(
          pySubtract(numeric(required(it, 'pctGdp'), k), {
            value: pyDivide(
              {
                value: pyMultiply({ value: 100, kind: 'float' }, numeric(required(it, 'mln'), k)),
                kind: 'float',
              },
              numeric(gdp, k + 1),
            ),
            kind: 'float',
          }),
        ),
      );
      nearComputed(
        c,
        required<any>(it, 'share'),
        k,
        () =>
          percentage(
            () => numeric(required(it, 'mln'), k),
            () => numeric(tot, k),
          ),
        0.0061,
        `functions ${required<any>(it, 'id')} share ${2025 + k}`,
        sourceTypeAt(it, 'share'),
      );
    }
    nearComputed(
      c,
      it,
      'yoy2026Pct',
      () =>
        growth(
          () => numeric(required(it, 'mln'), 1),
          () => numeric(required<any>(it, 'mln'), 0),
        ),
      0.0501,
      `functions ${required<any>(it, 'id')} yoy2026Pct`,
    );
    if (pyTruth(it.parts))
      for (let k = 0; k < 4; k++)
        c.near(
          pySum(pyMap(required<any>(it, 'parts'), (p: any) => numeric(required<any>(p, 'mln'), k))),
          required<any>(it, 'mln')[k],
          0.15,
          `functions ${required<any>(it, 'id')}: parts vs item, ${2025 + k}`,
        );
  }
  const rc = required<any>(f, 'reconcile');
  for (let k = 0; k < 4; k++)
    c.ok(
      pyLessEqual(
        gaps[k]!,
        pyAdd(numeric(required(rc, 'printedPctGdpMaxGap'), k), floating(0.006)),
        'float',
        'float',
      ),
      `functions: printed % of GDP gap ${fixed(gaps[k]!, 3)} in ${2025 + k} exceeds the declared ${displayAt(required<any>(rc, 'printedPctGdpMaxGap'), k)}`,
    );
  const ec = byId(required<any>(required<any>(e, 'economic'), 'rows')) as Record<string, any>;
  for (let k = 0; k < 4; k++) {
    const value = at(pyItem(ec, 'x.exp'), k + 1);
    nearWithText(
      c,
      required<any>(rc, 'annex3ExpenditureMln')[k],
      value?.raw,
      0.0001,
      `reconcile: annex3ExpenditureMln ${2025 + k} vs economic x.exp`,
      displayAt(required<any>(rc, 'annex3ExpenditureMln'), k),
      value === null
        ? 'None'
        : typeof value.raw === 'number' && value.kind === 'float'
          ? pyFloat(value.raw)
          : typeof value.raw === 'string'
            ? value.raw
            : pyReprAt(value, 'raw'),
    );
    nearComputed(
      c,
      required<any>(rc, 'diffMln'),
      k,
      () =>
        roundedOne(pySubtract(numeric(tot, k), numeric(required(rc, 'annex3ExpenditureMln'), k))),
      0.0501,
      `reconcile: diffMln ${2025 + k}`,
      sourceTypeAt(rc, 'diffMln'),
    );
  }
  c.ok(
    pyAbs(numeric(required(rc, 'diffMln'), 0)) > 1000 &&
      required<any>(rc, 'diffMln')
        .slice(1)
        .every(
          (_d: number, i: number) => pyAbs(numeric(required<any>(rc, 'diffMln'), i + 1)) <= 0.15,
        ),
    "reconcile: only the 2025 'Програма' column may differ from Annex 3",
  );
  const vers = required<any>(f, 'versions'),
    by = byId(items) as Record<string, any>,
    pdfTotal = [...tot];
  c.ok(vers.length === 7, `functions.versions: ${vers.length} rows, expected 7`);
  for (const v of vers) {
    const it = pyItem(by, required<string>(v, 'id')),
      pub =
        'part' in v
          ? required<any>(
              required<any>(it, 'parts').filter(
                (p: any) => required<any>(p, 'name') === required<any>(v, 'part'),
              )[0],
              'mln',
            )
          : required<any>(it, 'mln');
    c.ok(
      same(required<any>(v, 'docx'), pub),
      `functions.versions ${required<string>(v, 'id')} ${v.part ?? ''}: the published numbers must be the .docx ones`,
    );
    c.ok(
      required<any>(v, 'pdf')[0] === required<any>(v, 'docx')[0],
      `functions.versions ${required<string>(v, 'id')}: 2025 must be equal`,
    );
    if (!('part' in v))
      for (let k = 0; k < 4; k++)
        pdfTotal[k] = pyAddAssign(numeric(pdfTotal, k), {
          value: pySubtract(numeric(required(v, 'pdf'), k), numeric(required(v, 'docx'), k)),
          kind: 'float',
        });
  }
  for (let k = 0; k < 4; k++)
    c.near(
      required<any>(rc, 'pdfTotalMln')[k],
      pdfTotal[k],
      0.0501,
      `reconcile: pdfTotalMln ${2025 + k}`,
    );
  const note = required<any>(required<any>(f, 'notes')[0], 'text')
    .replaceAll('\u202f', ' ')
    .replaceAll('\u00a0', ' ');
  c.ok(
    required<any>(required<any>(f, 'notes')[0], 'id') === 'base' &&
      note.includes('55 525,0') &&
      note.includes('56 807,2'),
    'functions.notes[0] must quote 55 525,0 and 56 807,2',
  );
  const mins = pySet(
    required<any>(ctx.get('ministries.json'), 'items').map((m: any) => required<any>(m, 'id')),
  );
  for (const it of items)
    c.ok(
      pyIterGet(it, 'ministries').every((m) => mins.has(m)),
      `functions ${required<any>(it, 'id')}: unknown ministry code in ${pyReprAt(it, 'ministries')}`,
    );
  const z = required<any>(e, 'economic'),
    rows = required<any>(z, 'rows');
  c.ok(
    same(required(z, 'years'), required(o, 'years')) &&
      same(required(z, 'vintage'), required(o, 'vintage')),
    'economic: years/vintage must equal outlook',
  );
  c.ok(rows.length === 30 && ec.size === 30, `economic: ${rows.length} rows, expected 30`);
  const worst = tree(c, rows, 'economic', gdp);
  c.ok(
    same(
      required<any>(pyItem(ec, 'x.total'), 'mln'),
      required<any>(required<any>(required<any>(o, 'kfp'), 'expenditure'), 'mln'),
    ),
    'economic x.total must equal outlook expenditure',
  );
  c.ok(
    same(
      required<any>(pyItem(ec, 'x.interest'), 'mln'),
      required<any>(required<any>(required<any>(o, 'kfp'), 'interest'), 'mln'),
    ),
    'economic x.interest must equal outlook interest',
  );
  for (let i = 0; i < 5; i++)
    c.near(
      required<any>(pyItem(ec, 'x.nonint'), 'mln')[i],
      pySubtract(
        numeric(required<any>(pyItem(ec, 'x.exp'), 'mln'), i),
        numeric(required<any>(pyItem(ec, 'x.interest'), 'mln'), i),
      ),
      0.15,
      `economic: memo x.nonint ${2024 + i}`,
    );
  c.ok(pyItem(ec, 'x.nonint').memo === true, 'economic: x.nonint must be a memo row');
  nearWithText(
    c,
    required<any>(pyItem(ec, 'x.exp'), 'mln')[2],
    tot[1],
    0.0011,
    'economic x.exp 2026 vs functions total',
    displayAt(required<any>(pyItem(ec, 'x.exp'), 'mln'), 2),
    displayAt(tot, 1),
  );
  c.ok(
    same(
      [
        required<any>(pyItem(ec, 'x.total'), 'mln')[2],
        required<any>(pyItem(ec, 'x.eucontrib'), 'mln')[2],
      ],
      [56807.2, 1282.2],
    ),
    'economic 2026: x.total/x.eucontrib',
  );
  c.near(
    required<any>(pyItem(ec, 'x.exp'), 'mln')[2] +
      required<any>(pyItem(ec, 'x.eucontrib'), 'mln')[2],
    required<any>(pyItem(ec, 'x.total'), 'mln')[2],
    0.15,
    '55 525,0 + 1 282,2 vs 56 807,2',
  );
  const cf = required<any>(e, 'cofog'),
    cit = required<any[]>(cf, 'items'),
    top = cit.filter((x: any) => !pyTruth(x.memoOf));
  c.ok(
    pyLenAt(cf, 'years') === 10 &&
      pyItemAt(cf, 'years', -1) === 2024 &&
      same(required(cf, 'source'), ['eurostat']),
    'cofog: ten years ending 2024, source eurostat',
  );
  for (let k = 0; k < 10; k++)
    c.ok(
      Math.abs(
        pySubtract(
          pyTypedSum(pyMap(top, (x: any) => numeric(required(x, 'mln'), k))),
          numeric(required(required<any>(cf, 'total'), 'mln'), k),
        ),
      ) <= 0.3,
      `cofog ${required<any>(cf, 'years')[k]}: functions differ from the total`,
    );
  for (const m of cit.filter((x: any) => pyTruth(x.memoOf))) {
    const p = required<any>(byId(cit, 'code') as Record<string, any>, m.memoOf);
    const memoMln = required<any>(m, 'mln'),
      parentMln = required<any>(p, 'mln');
    const left = pyIter(memoMln, sourceTypeAt(m, 'mln'));
    const right = pyIter(parentMln, sourceTypeAt(p, 'mln'));
    c.ok(
      left
        .slice(0, right.length)
        .every((a, k) =>
          pyLessEqual(a, pyAdd(numeric(right, k), floating(0.05)), sourceTypeAt(left, k), 'float'),
        ),
      `cofog memo ${required<any>(m, 'code')} exceeds its parent`,
    );
  }
  c.ok(
    cit.every((x: any) => pyIterGet(x, 'kfpFunctions').every((id) => pyHas(by, id))),
    'cofog: kfpFunctions must be function ids',
  );
  const implied = percentage(
    () =>
      numeric(
        required<any>(required<any>(cf, 'total'), 'mln'),
        required<any>(required<any>(cf, 'total'), 'mln').length - 1,
      ),
    () =>
      numeric(
        required<any>(required<any>(cf, 'total'), 'pctGdp'),
        required<any>(required<any>(cf, 'total'), 'pctGdp').length - 1,
      ),
  );
  c.ok(
    Math.abs(pyDivide(floating(implied), numeric(gdp, 0)) - 1) < 0.003,
    `cofog: the GDP implied by the 2024 percentages (${fmt(implied, 0)}) differs from Annex 3's 2024 GDP`,
  );
  const pc = required<any>(e, 'perCapita');
  c.ok(
    required(pc, 'population') === required<any>(required<any>(core, 'population'), 'persons') &&
      required(pc, 'year') === required<any>(required<any>(core, 'population'), 'year'),
    'perCapita: population must equal core.population',
  );
  c.fact(
    `functions 2026 ${fmt(tot[1])} млн. € (+ EU contribution ${fmt(required<any>(pyItem(ec, 'x.eucontrib'), 'mln')[2])} = ${fmt(required<any>(pyItem(ec, 'x.total'), 'mln')[2])}); economic tree within ${fixed(worst, 1)}; Annex 3 2025 column differs from the printed 'Програма' by ${fmt(required<any>(rc, 'diffMln')[0])} млн. €`,
  );
  return c;
}
