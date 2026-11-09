/** Independent validation of the legacy enacted-law data against its published cross-references. */
import { pythonNumberAt, type PythonNumber } from '../common/numbers.js';
import { Check, isnum, numbersIn, pyTruth } from './checks.js';
import { Context } from './context.js';
import {
  PythonError,
  pyGet,
  pyPrefixStringAt,
  pyHas,
  pyDict,
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
  pyTypedSum,
  pyDecimalInteger,
  pyLessEqual,
  sourceTypeAt,
  pyDictKeysAt,
  pyItem,
  pySet,
  pySubtract,
} from './python-error.js';
const TOL = 0.06,
  TOL_SUM = 0.15;
const HEAD = ['rev', 'exp', 'transfers', 'eucontrib', 'balance', 'financing'];
const HEAD_ROW: Record<string, string> = {
  rev: 'I',
  exp: 'II',
  transfers: 'III',
  eucontrib: 'IV',
  balance: 'V',
  financing: 'VI',
};
const REF: Record<string, Record<string, number>> = {
  bill: { rev: 2279189.7, exp: 13352084.8 },
  law: { rev: 2284302.7, exp: 13326470.3 },
};
const OWN: Record<string, number> = {
  '1600': -2202.9,
  '2200': -10225.8,
  '7400': 2014.4,
  '8400': 20451.6,
};
const same = (a: unknown, b: unknown) => pyEqual(a, b);
const repr = pyRepr;
const iso = (x: any) =>
  typeof x === 'string' &&
  /^\p{Decimal_Number}{4}-\p{Decimal_Number}{2}-\p{Decimal_Number}{2}$/u.test(x);
const nz = (x: any): number => (isnum(x) ? x : 0);
const sorted = (x: any[]) => [...x].sort();
const n = (o: any, k: string | number): PythonNumber => {
  const value = pyItem(o, k);
  return typeof value === 'boolean'
    ? { value: Number(value), kind: 'int' }
    : pythonNumberAt(o, String(k), value);
};
const sum = (xs: Iterable<PythonNumber>) => pySum(xs);
const pyfloat = floatRepr;
const display = pyReprAt;
const displaySum = (value: PythonNumber) =>
  value.kind === 'float' ? pyfloat(value.value) : String(value.value);
const stringField = (holder: any, key: string) => {
  const value = required(holder, key);
  return typeof value === 'string' ? value : display(holder, key);
};
function near(c: Check, a: any, b: any, tol: number, message: string, ar?: string, br?: string) {
  return c.ok(
    isnum(a) && isnum(b) && Math.abs(a - b) <= tol + 1e-9,
    `${message}: ${ar ?? repr(a)} vs ${br ?? repr(b)} (tolerance ${tol})`,
  );
}
function dd(c: Check, node: any, where: string, tol = TOL) {
  const b = node.bill,
    l = node.law,
    d = node.diff;
  if (isnum(b) && isnum(l))
    return near(c, d, l - b, tol, `${where} diff`, display(node, 'diff'), pyfloat(l - b));
  return c.ok(d == null, `${where}: a diff without both sides`);
}
function art1(c: Check, law: any): Map<string, any> {
  const a = required<any>(law, 'art1'),
    h = required<any>(a, 'headline');
  c.ok(same(Object.keys(h), HEAD), `art1.headline keys ${repr(Object.keys(h))}`);
  for (const k of HEAD) {
    for (const s of ['bill', 'law', 'diff'])
      c.ok(pyHas(h, k) && isnum(h[k][s]), `art1.headline.${k}.${s} is not a number`);
    if (pyHas(h, k)) dd(c, h[k], `art1.headline.${k}`);
  }
  if (HEAD.every((k) => pyHas(h, k) && ['bill', 'law', 'diff'].every((s) => isnum(h[k][s]))))
    for (const s of ['bill', 'law', 'diff']) {
      const v: any = Object.fromEntries(HEAD.map((k) => [k, h[k][s]]));
      near(
        c,
        required<any>(v, 'balance'),
        required<any>(v, 'rev') -
          required<any>(v, 'exp') -
          required<any>(v, 'transfers') -
          required<any>(v, 'eucontrib'),
        TOL_SUM,
        `art1 ${s} balance = rev - exp - transfers - eucontrib`,
        display(required<any>(h, 'balance'), s),
        pyfloat(
          required<any>(v, 'rev') -
            required<any>(v, 'exp') -
            required<any>(v, 'transfers') -
            required<any>(v, 'eucontrib'),
        ),
      );
      near(
        c,
        required<any>(v, 'financing'),
        -required<any>(v, 'balance'),
        TOL,
        `art1 ${s} financing = -balance`,
        display(required<any>(h, 'financing'), s),
        pyfloat(-required<any>(v, 'balance')),
      );
    }
  const lines = required<any>(a, 'lines');
  c.ok(lines.length === 50, `art1 has ${lines.length} lines (50 expected)`);
  c.ok(
    same(
      lines.map((r: any) => required(r, 'id')),
      lines.map((_: any, i: number) => `a1.${String(i + 1).padStart(2, '0')}`),
    ),
    'art1 line ids are a1.01.. consecutive',
  );
  const rows = pyDict<string, any>();
  const key = (sec: string, no: string) => JSON.stringify([sec, no]);
  for (const r of lines) {
    const w = `art1 line ${required<any>(r, 'id')}`;
    c.ok(
      typeof r.text === 'string' &&
        !!pyStrip(required<any>(r, 'text')) &&
        pyIntAt(r, 'level') &&
        Number(required<any>(r, 'level')) >= 0 &&
        Number(required<any>(r, 'level')) <= 3,
      `${w}: text/level`,
    );
    if (pyTruth(r.header)) {
      c.ok(
        !['bill', 'law', 'diff', 'changed'].some((k) => pyHas(r, k)),
        `${w}: a header row must not carry numbers`,
      );
      continue;
    }
    c.ok(
      typeof r.no === 'string' &&
        required<any>(r, 'no') !== '' &&
        [...required<any>(r, 'no')].every((ch) => ch.codePointAt(0)! < 128) &&
        typeof r.sec === 'string',
      `${w}: 'no' ${repr(r.no ?? null)} must be plain ASCII`,
    );
    if (
      !c.ok(
        ['bill', 'law', 'diff'].every((k) => isnum(r[k])),
        `${w}: bill/law/diff must be numbers`,
      )
    )
      continue;
    dd(c, r, w);
    c.ok(
      pyEqual(r.changed, Math.abs(required<any>(r, 'diff')) > 0.05),
      `${w}: changed flag ${display(r, 'changed')} vs diff ${display(r, 'diff')}`,
    );
    const rk = key(required<any>(r, 'sec'), required<any>(r, 'no'));
    c.ok(!rows.has(rk), `${w}: duplicate row (${pyReprAt(r, 'sec')}, ${pyReprAt(r, 'no')})`);
    rows.set(rk, r);
  }
  const get = (sec: string, no: string, s: string) => {
    const r = rows.get(key(sec, no));
    if (!r) throw [sec, no];
    return r[s] as number;
  };
  const sumRows = (sec: string, nos: string[], s: string) =>
    sum(
      pyMap(nos, (no) =>
        n(
          rows.get(key(sec, no)) ??
            (() => {
              throw [sec, no];
            })(),
          s,
        ),
      ),
    );
  try {
    for (const k of HEAD)
      for (const s of ['bill', 'law', 'diff'])
        near(
          c,
          get(HEAD_ROW[k]!, HEAD_ROW[k]!, s),
          required<any>(required<any>(h, k), s),
          TOL,
          `art1 headline ${k} ${s} = line ${HEAD_ROW[k]}`,
          display(rows.get(key(HEAD_ROW[k]!, HEAD_ROW[k]!)), s),
          display(h[k], s),
        );
    for (const s of ['bill', 'law', 'diff']) {
      near(
        c,
        get('I', 'I', s),
        sumRows('I', ['1', '2', '3'], s),
        TOL_SUM,
        `art1 ${s}: I = 1 + 2 + 3`,
      );
      near(
        c,
        get('I', '1', s),
        sumRows(
          'I',
          Array.from({ length: 8 }, (_, i) => `1.${i + 1}`),
          s,
        ),
        TOL_SUM,
        `art1 ${s}: taxes = 1.1..1.8`,
      );
      near(
        c,
        get('II', 'II', s),
        sumRows('II', ['1', '2', '3', '4', '5'], s),
        TOL_SUM,
        `art1 ${s}: II = 1..5`,
      );
      near(
        c,
        get('II', '2', s),
        get('II', '2.1', s) + get('II', '2.2', s),
        TOL_SUM,
        `art1 ${s}: capital = 2.1 + 2.2`,
      );
      near(
        c,
        get('II', '5', s),
        sumRows('II', ['5.1', '5.2', '5.3'], s),
        TOL_SUM,
        `art1 ${s}: reserve = 5.1..5.3`,
      );
      near(
        c,
        get('III', 'III', s),
        get('III', '1', s) - get('III', '2', s),
        TOL_SUM,
        `art1 ${s}: net transfers = given - received`,
      );
      near(
        c,
        get('V', 'V', s),
        get('I', 'I', s) - get('II', 'II', s) - get('III', 'III', s) - get('IV', 'IV', s),
        TOL_SUM,
        `art1 ${s}: V = I - II - III - IV`,
      );
      near(c, get('VI', 'VI', s), -get('V', 'V', s), TOL, `art1 ${s}: VI = -V`);
    }
  } catch (e) {
    if (e instanceof PythonError && e.name === 'KeyError')
      c.fail(`art1: row ${e.message} is missing`);
    else if (Array.isArray(e))
      c.fail(`art1: row (${pyReprAt(e, 0)}, ${pyReprAt(e, 1)}) is missing`);
    else throw e;
    return pyDict();
  }
  return rows;
}
function lawBudgets(c: Check, law: any) {
  const bs = required<any[]>(law, 'budgets');
  c.ok(bs.length === 46, `${bs.length} budgets (46 expected: art. 2-47)`);
  c.ok(
    same(
      bs.map((b: any) => required<any>(b, 'art')),
      bs.map((_: any, i: number) => i + 2),
    ),
    `budget arts are 2..${1 + bs.length} consecutive`,
  );
  const ids = bs.map((b: any) => required<any>(b, 'id'));
  c.ok(
    pySet(ids).size === ids.length &&
      ids.every((i: any) => typeof i === 'string' && /^\p{Decimal_Number}{4}$/u.test(i)),
    'budget ids unique 4-digit strings',
  );
  const changed: number[] = [],
    sums: any = { bill: { rev: 0, exp: 0 }, law: { rev: 0, exp: 0 } };
  for (const b of bs) {
    const w = `budget ${required<any>(b, 'id')} (art. ${required<any>(b, 'art')})`;
    for (const k of ['name', 'short', 'kind'])
      c.ok(typeof b[k] === 'string' && !!pyStrip(b[k]), `${w}: ${k}`);
    for (const k of ['rev', 'exp', 'transfers']) {
      const sides = ['bill', 'law', 'diff'].map((s) => required(required<any>(b, s), k));
      c.ok(
        sides.every((x) => x === null) || sides.every(isnum),
        `${w}.${k}: the three sides must be all numbers or all null: [${['bill', 'law', 'diff'].map((s) => display(required<any>(b, s), k)).join(', ')}]`,
      );
      if (isnum(sides[0]) && isnum(sides[1]))
        near(
          c,
          sides[2],
          sides[1] - sides[0],
          TOL,
          `${w}.${k} diff`,
          display(required<any>(b, 'diff'), k),
          pyfloat(sides[1] - sides[0]),
        );
    }
    for (const s of ['bill', 'law']) {
      c.ok(isnum(required<any>(required<any>(b, s), 'exp')), `${w}.${s}.exp must be a number`);
      sums[s].rev += nz(required<any>(required<any>(b, s), 'rev'));
      sums[s].exp += nz(required<any>(required<any>(b, s), 'exp'));
      if (
        isnum(required<any>(required<any>(b, s), 'exp')) &&
        isnum(required<any>(required<any>(b, s), 'transfers'))
      ) {
        const gap =
          required<any>(required<any>(b, s), 'transfers') -
          (required<any>(required<any>(b, s), 'exp') -
            nz(required<any>(required<any>(b, s), 'rev')));
        const want =
          required<any>(b, 'id') === '0600' && s === 'law'
            ? -7000
            : required<any>(b, 'id') === '1700'
              ? 1866.2
              : (OWN[required<any>(b, 'id')] ?? 0);
        near(
          c,
          gap,
          want,
          TOL_SUM,
          `${w} ${s}: transfers - (exp - rev) is the budget's own balance row`,
          pyfloat(gap),
          pyfloat(want),
        );
      }
    }
    const ln = required<any>(b, 'lines');
    c.ok(
      same(sorted(Object.keys(ln)), ['add', 'chg', 'del']) &&
        Object.keys(ln).every((k) => pyIntAt(ln, k) && Number(ln[k]) >= 0),
      `${w}: lines ${repr(ln)}`,
    );
    const moved =
      ['rev', 'exp', 'transfers'].some((k) => Math.abs(nz(required<any>(b, 'diff')[k])) > 0.05) ||
      Object.values(ln).some(pyTruth);
    c.ok(
      pyEqual(required(b, 'changed'), moved),
      `${w}: changed flag ${display(b, 'changed')} vs differences`,
    );
    if (moved) changed.push(required<any>(b, 'art'));
  }
  const t = required<any>(law, 'totals');
  c.ok(
    pyEqual(required(t, 'count'), bs.length) && bs.length === 46,
    `totals.count ${stringField(t, 'count')}`,
  );
  for (const s of ['bill', 'law'])
    for (const k of ['rev', 'exp']) {
      near(
        c,
        required<any>(required<any>(t, s), k),
        sums[s][k],
        TOL_SUM,
        `totals.${s}.${k} = sum of the budgets`,
        display(t[s], k),
        pyfloat(sums[s][k]),
      );
      near(
        c,
        required<any>(required<any>(t, s), k),
        REF[s]![k],
        TOL,
        `totals.${s}.${k} reference value`,
      );
    }
  for (const k of ['rev', 'exp']) {
    const actual = required(required<any>(t, 'diff'), k);
    const left = n(required(t, 'law'), k),
      right = n(required(t, 'bill'), k);
    const difference = pySubtract(left, right);
    near(
      c,
      actual,
      difference,
      TOL,
      `totals.diff.${k}`,
      display(required<any>(t, 'diff'), k),
      left.kind === 'float' || right.kind === 'float' ? pyfloat(difference) : String(difference),
    );
  }
  c.ok(
    same(changed, [2, 3, 16, 17]),
    `budgets that differ: ${repr(changed)} (arts 2, 3, 16, 17 expected)`,
  );
  c.ok(
    required<any>(law, 'note').includes('46') &&
      required<any>(law, 'note').includes('чл. 2, 3, 16 и 17'),
    'law.note must name the 46 budgets and the four that differ',
  );
}
function changes(c: Check, law: any, artRows: Map<string, any>) {
  const bs = pyDict<number, any>(
      required<any>(law, 'budgets').map((b: any) => [required<any>(b, 'art'), b]),
    ),
    ch = required<any>(law, 'changes');
  c.ok(
    same(
      ch.map((x: any) => required<any>(x, 'art')),
      [1, 2, 3, 16, 17],
    ),
    `changes arts ${repr(ch.map((x: any) => required<any>(x, 'art')))}`,
  );
  for (const x of ch) {
    const w = `changes art. ${required<any>(x, 'art')}`,
      b = bs.get(required<any>(x, 'art'));
    const id = required(x, 'id');
    const expectedId =
      required<any>(x, 'art') === 1
        ? 'state'
        : (() => {
            if (b === undefined) throw new PythonError('KeyError', stringField(x, 'art'));
            return required(b, 'id');
          })();
    c.ok(pyEqual(id, expectedId), `${w}: id ${required<any>(x, 'id')}`);
    c.ok(
      Array.isArray(required<any>(x, 'notes')) &&
        required<any>(x, 'notes').length > 0 &&
        required<any>(x, 'notes').every((v: any) => typeof v === 'string' && !!pyStrip(v)),
      `${w}: notes`,
    );
    for (const [k, node] of Object.entries(required<Record<string, any>>(x, 'headline')))
      dd(c, node, `${w} headline ${k}`);
    for (const key of ['areas', 'bodies', 'commitments'])
      for (const [i, node] of pyIterGet(x, key).entries()) {
        c.ok(
          isnum(pyGet(node, 'bill')) && isnum(pyGet(node, 'law')),
          `${w} ${key}[${i}]: both sides must be numbers`,
        );
        dd(c, node, `${w} ${key}[${i}]`);
      }
    const ops: Record<string, number> = { chg: 0, add: 0, del: 0 };
    for (const [i, r] of required<any>(x, 'lines').entries()) {
      const ww = `${w} line ${i} (${r.sec ?? 'None'} ${r.no ?? 'None'})`;
      c.ok(
        pyHas(ops, required<any>(r, 'op')) &&
          typeof required<any>(r, 'text') === 'string' &&
          !!pyStrip(required<any>(r, 'text')),
        `${ww}: op/text`,
      );
      c.ok(
        [...(required<any>(r, 'no') as string)].every((ch) => ch.codePointAt(0)! < 128),
        `${ww}: 'no' must be plain ASCII`,
      );
      if (pyHas(ops, required<any>(r, 'op'))) ops[required<any>(r, 'op')]!++;
      c.ok(
        (required<any>(r, 'op') !== 'add' || required<any>(r, 'bill') === null) &&
          (required<any>(r, 'op') !== 'del' || required<any>(r, 'law') === null) &&
          (required<any>(r, 'op') !== 'chg' ||
            (isnum(required<any>(r, 'bill')) && isnum(required<any>(r, 'law')))),
        `${ww}: op ${required<any>(r, 'op')} vs the two sides`,
      );
      dd(c, r, ww);
    }
    if (b) {
      c.ok(
        same(ops, required<any>(b, 'lines')),
        `${w}: op counts ${repr(ops)} vs the budget's lines ${pyReprAt(b, 'lines')}`,
      );
      for (const k of ['rev', 'exp', 'transfers'])
        if (pyHas(required<any>(x, 'headline'), k))
          for (const s of ['bill', 'law'])
            near(
              c,
              required<any>(required<any>(required<any>(x, 'headline'), k), s),
              required<any>(required<any>(b, s), k),
              TOL,
              `${w} headline ${k} ${s} = the budget`,
              display(required<any>(required<any>(x, 'headline'), k), s),
              display(required<any>(b, s), k),
            );
      if ('areas' in x)
        for (const s of ['bill', 'law'])
          near(
            c,
            sum(pyMap(required<any>(x, 'areas'), (a: any) => n(a, s))),
            required<any>(required<any>(b, s), 'exp'),
            TOL_SUM,
            `${w} areas ${s} sum to the expenditure`,
          );
    } else {
      const marked = pyDict<string, any>(
        required<any>(x, 'lines').map((r: any) => [
          JSON.stringify([required<any>(r, 'sec'), required<any>(r, 'no')]),
          r,
        ]),
      );
      const changed = pyDict([...artRows].filter(([, r]) => pyTruth(r.changed)));
      const diff = [...pySet([...marked.keys(), ...changed.keys()])]
        .filter((k) => marked.has(k) !== changed.has(k))
        .sort()
        .map((k) => JSON.parse(k));
      c.ok(
        diff.length === 0,
        `art. 1: changed rows differ: [${diff.map((k) => `(${pyReprAt(k, 0)}, ${pyReprAt(k, 1)})`).join(', ')}]`,
      );
      for (const [k, r] of marked)
        if (changed.has(k)) {
          const pair = JSON.parse(k),
            q = changed.get(k);
          c.ok(
            required<any>(r, 'bill') === required<any>(q, 'bill') &&
              required<any>(r, 'law') === required<any>(q, 'law'),
            `art. 1 row (${pyReprAt(pair, 0)}, ${pyReprAt(pair, 1)}) differs from art1.lines`,
          );
        }
      c.ok(ops.add === 0 && ops.del === 0, 'art. 1 has only changed rows');
    }
  }
  c.ok(
    same(sorted(Object.keys(required<any>(ch[0], 'headline'))), [
      'balance',
      'exp',
      'financing',
      'rev',
    ]),
    'art. 1 change headline keys',
  );
}
function reconciliation(c: Check, law: any) {
  const rec = required<any>(law, 'reconciliation'),
    h = required<any>(required<any>(law, 'art1'), 'headline');
  const rows = required<any>(law, 'budgets')
    .filter(
      (b: any) =>
        Math.abs(nz(required<any>(required<any>(b, 'diff'), 'rev'))) > 0.05 ||
        Math.abs(nz(required<any>(required<any>(b, 'diff'), 'exp'))) > 0.05,
    )
    .map((b: any) => ({
      art: required<any>(b, 'art'),
      name: required(b, 'name'),
      rev: nz(required<any>(required<any>(b, 'diff'), 'rev')),
      exp: nz(required<any>(required<any>(b, 'diff'), 'exp')),
      source: required<any>(b, 'diff'),
    }));
  c.ok(
    same(
      required<any>(rec, 'rows').map((r: any) => [
        required<any>(r, 'art'),
        required<any>(r, 'name'),
      ]),
      rows.map((r: any) => [required<any>(r, 'art'), required<any>(r, 'name')]),
    ),
    `reconciliation rows ${repr(required<any>(rec, 'rows').map((r: any) => required<any>(r, 'art')))} vs the budgets with a money difference ${repr(rows.map((r: any) => required<any>(r, 'art')))}`,
  );
  for (let i = 0; i < Math.min(rows.length, required<any>(rec, 'rows').length); i++)
    for (const k of ['rev', 'exp'])
      near(
        c,
        required<any>(pyItem(required<any>(rec, 'rows'), i), k),
        rows[i][k],
        TOL,
        `reconciliation art. ${required<any>(rows[i], 'art')} ${k}`,
        display(required<any>(rec, 'rows')[i], k),
        display(required<any>(rows[i], 'source'), k),
      );
  const values = (k: string) =>
    sum(
      pyMap(rows, (r: any) =>
        isnum(required<any>(r, 'source')[k])
          ? n(required<any>(r, 'source'), k)
          : { value: 0, kind: 'float' },
      ),
    );
  const s: any = { rev: values('rev'), exp: values('exp') };
  s.balance = required<any>(s, 'rev') - required<any>(s, 'exp');
  for (const k of ['rev', 'exp', 'balance']) {
    near(
      c,
      required<any>(required<any>(rec, 'sum'), k),
      s[k],
      TOL_SUM,
      `reconciliation sum.${k}`,
      display(required<any>(rec, 'sum'), k),
      pyfloat(s[k]),
    );
    near(
      c,
      required<any>(required<any>(rec, 'art1'), k),
      required<any>(required<any>(h, k), 'diff'),
      TOL,
      `reconciliation art1.${k} = art. 1 headline diff`,
      display(required<any>(rec, 'art1'), k),
      display(h[k], 'diff'),
    );
    near(
      c,
      required<any>(required<any>(rec, 'sum'), k),
      required<any>(required<any>(rec, 'art1'), k),
      TOL_SUM,
      `arts. 2 + 3 + 17 = art. 1 on ${k}`,
    );
  }
  c.ok(required<any>(rec, 'ok') === true, 'reconciliation.ok must be true');
  c.ok(
    required<any>(rec, 'unit') === required<any>(required<any>(law, 'meta'), 'unit') &&
      required<any>(rec, 'unit') === 'хил. €',
    'reconciliation unit',
  );
  return s;
}
function bills(c: Check, law: any, src: any, buildDate: string) {
  const gz = pySet(
      required<any>(law, 'gazette').map((g: any) =>
        JSON.stringify([required<any>(g, 'issue'), required<any>(g, 'date')]),
      ),
    ),
    bs = required<any>(law, 'bills');
  c.ok(
    same(
      bs.map((b: any) => required<any>(b, 'id')),
      ['zdb', 'zbdoo', 'zbnzok'],
    ),
    `bills ${repr(bs.map((b: any) => required<any>(b, 'id')))}`,
  );
  c.ok(
    same(
      bs.map((b: any) => required<any>(b, 'sign')),
      ['52-602-01-19', '52-602-01-18', '52-602-01-17'],
    ),
    'bill signs',
  );
  for (const b of bs) {
    const w = `bill ${required<any>(b, 'id')}`,
      days = [
        required<any>(b, 'submitted'),
        required<any>(b, 'firstReading'),
        ...required<any>(b, 'secondReading'),
      ];
    c.ok(
      [
        ...days,
        required<any>(b, 'adopted'),
        required<any>(required<any>(b, 'decree'), 'issued'),
        required<any>(required<any>(b, 'gazette'), 'date'),
      ].every(iso),
      `${w}: dates must be ISO`,
    );
    c.ok(
      same(days, sorted(days)),
      `${w}: submitted <= first reading <= second reading: ${repr(days)}`,
    );
    c.ok(
      required<any>(b, 'adopted') === required<any>(b, 'secondReading').at(-1),
      `${w}: adopted = last second reading`,
    );
    c.ok(
      required<any>(b, 'adopted') <= required<any>(required<any>(b, 'decree'), 'issued') &&
        required<any>(required<any>(b, 'decree'), 'issued') <=
          required<any>(required<any>(b, 'gazette'), 'date') &&
        required<any>(required<any>(b, 'gazette'), 'date') <= buildDate,
      `${w}: adopted <= decree <= gazette <= build date`,
    );
    c.ok(
      gz.has(
        JSON.stringify([
          required<any>(required<any>(b, 'gazette'), 'issue'),
          required<any>(required<any>(b, 'gazette'), 'date'),
        ]),
      ),
      `${w}: gazette issue ${required<any>(required<any>(b, 'gazette'), 'issue')} of ${required<any>(required<any>(b, 'gazette'), 'date')} is not in law.gazette`,
    );
    required(required<any>(b, 'decree'), 'no');
    c.ok(
      pyIntAt(required<any>(b, 'decree'), 'no') && pyIntAt(required<any>(b, 'gazette'), 'issue'),
      `${w}: decree / issue numbers`,
    );
    c.ok(iso(required<any>(required<any>(b, 'inForce'), 'from')), `${w}: inForce.from`);
    for (const e of required<any>(required<any>(b, 'inForce'), 'exceptions')) {
      c.ok(
        (required<any>(e, 'from') === null || iso(required<any>(e, 'from'))) &&
          pyTruth(pyStrip(required<any>(e, 'when'))) &&
          pyTruth(pyStrip(required<any>(e, 'scope'))),
        `${w}: exception ${repr(e)}`,
      );
      c.ok(
        required<any>(e, 'from') === null ||
          required<any>(e, 'from') >= required<any>(required<any>(b, 'gazette'), 'date'),
        `${w}: an exception starts before the gazette date: ${required<any>(e, 'from')}`,
      );
    }
    c.ok(
      ['committeeReports', 'opinions', 'proposals'].every((k) => {
        required(required<any>(b, 'counts'), k);
        return pyIntAt(required<any>(b, 'counts'), k) && Number(required<any>(b, 'counts')[k]) >= 0;
      }),
      `${w}: counts`,
    );
    c.ok(
      required<any>(b, 'page').startsWith('https://www.parliament.bg/') &&
        required<any>(b, 'law').startsWith('https://dv.parliament.bg/'),
      `${w}: urls`,
    );
    c.ok(
      required<any[]>(b, 'source').every((k: string) => pyHas(src, k)),
      `${w}: source keys`,
    );
  }
  const z = required<any>(bs[0], 'counts'),
    cn = required<any>(law, 'counts');
  for (const k of ['committeeReports', 'opinions', 'proposals'])
    c.ok(
      pyEqual(required(cn, k), required(z, k)),
      `counts.${k} ${display(cn, k)} vs the bill ${display(z, k)}`,
    );
  for (const [k, d] of [
    ['committeeReports', 'reportDates'],
    ['opinions', 'opinionDates'],
    ['proposals', 'proposalDates'],
  ] as const) {
    const value = pyTypedSum(pyMap(pyDictKeysAt(cn, d), (x) => n(cn[d], x)));
    c.ok(value.value === cn[k], `counts.${d} sums to ${displaySum(value)}, not ${display(cn, k)}`);
    c.ok(
      pyDictKeysAt(cn, d).every((x) => iso(x) && x <= buildDate),
      `counts.${d} dates`,
    );
  }
  c.ok(
    pyEqual(
      required(required<any>(cn, 'committees'), 'reported'),
      required(cn, 'committeeReports'),
    ) &&
      pyLessEqual(
        required<any>(cn, 'committeeReports'),
        required(required<any>(cn, 'committees'), 'total'),
        sourceTypeAt(cn, 'committeeReports'),
        sourceTypeAt(required<any>(cn, 'committees'), 'total'),
      ) &&
      pyEqual(required<any>(required<any>(cn, 'committees'), 'total'), 24),
    `counts.committees ${display(cn, 'committees')}`,
  );
  c.ok(
    same(
      required<any>(cn, 'proposalDates'),
      required<any>(required<any>(law, 'proposals'), 'byDate'),
    ),
    'counts.proposalDates = proposals.byDate',
  );
  const g = required<any>(law, 'gazette'),
    dates = g.map((x: any) => required<any>(x, 'date'));
  c.ok(same(dates, sorted(dates)) && g.length === 4, 'gazette: 4 issues in date order');
  for (const x of g)
    c.ok(
      iso(required<any>(x, 'date')) &&
        Number(required<any>(x, 'date').slice(0, 4)) === required<any>(x, 'year') &&
        pyIntAt(x, 'issue') &&
        pyTruth(required<any>(x, 'laws')),
      `gazette ${repr(x)}`,
    );
  const docs = required<any>(law, 'documents');
  c.ok(
    docs.length === 7 &&
      docs.every(
        (d: any) =>
          pyTruth(required<any>(d, 'kind')) &&
          pyTruth(required<any>(d, 'title')) &&
          required<any>(d, 'url').startsWith('https://'),
      ),
    'documents: 7 https links',
  );
  c.ok(
    required<any>(docs[0], 'url') ===
      required<any>(required<any>(required<any>(law, 'versions'), 'bill'), 'url'),
    'documents[0] is the bill file of versions.bill',
  );
}
function timeline(c: Check, law: any, ctx: Context) {
  const tl = required<any>(law, 'timeline');
  c.ok(tl.length === 21, `timeline has ${tl.length} entries (21 expected)`);
  const days: string[] = [];
  for (const [i, t] of tl.entries()) {
    const w = `timeline[${i}] ${pyPrefixStringAt(t, 'title', 30)}`;
    c.ok(
      pyHas(required<any>(law, 'kinds'), required<any>(t, 'kind')) &&
        ['prehistory', 'parliament', 'execution'].includes(required<any>(t, 'phase')),
      `${w}: kind/phase`,
    );
    c.ok(
      typeof required<any>(t, 'title') === 'string' &&
        !!pyStrip(required<any>(t, 'title')) &&
        typeof required<any>(t, 'dateText') === 'string' &&
        !!pyStrip(required<any>(t, 'dateText')),
      `${w}: title/dateText`,
    );
    c.ok(pyTruth(required(t, 'source')), `${w}: source`);
    const d = pyTruth(t.date)
      ? required<any>(t, 'date')
      : pyTruth(t.month)
        ? `${required<any>(t, 'month')}-01`
        : null;
    c.ok((d === null) === pyTruth(t.ongoing), `${w}: only an ongoing entry may have no date`);
    if (d !== null) {
      c.ok(iso(d) && d <= ctx.buildDate, `${w}: date ${d}`);
      days.push(d);
    }
    if (pyTruth(t.href))
      c.ok(
        (required<any>(t, 'href').startsWith('#/') &&
          ctx.routes().match(required<any>(t, 'href')) !== null) ||
          required<any>(t, 'href').startsWith('https://'),
        `${w}: href ${required<any>(t, 'href')} does not resolve`,
      );
  }
  c.ok(same(days, sorted(days)), 'timeline is not in date order');
  c.ok(
    tl.filter((t: any) => required<any>(t, 'phase') === 'execution').length === 1 &&
      required<any>(tl.at(-1), 'phase') === 'execution',
    'one execution entry, last',
  );
  const used = pySet<string>(tl.map((t: any) => required<any>(t, 'kind'))),
    missing = [...used].filter((x) => !pyHas(required<any>(law, 'kinds'), x)).sort();
  c.ok(!missing.length, `timeline kinds ${repr(missing)}`);
}
function proposals(c: Check, law: any) {
  const p = required<any>(law, 'proposals'),
    items = required<any>(p, 'items');
  c.ok(
    same(sorted(Object.keys(p)), ['byDate', 'count', 'items', 'note', 'urlPattern']),
    `proposals keys ${repr(sorted(Object.keys(p)))}`,
  );
  const count = pyTypedSum(
    pyMap(pyDictKeysAt(p, 'byDate'), (k) => n(required<any>(p, 'byDate'), k)),
  );
  c.ok(
    required<any>(p, 'count') === items.length && items.length === 69 && count.value === 69,
    `proposals: count ${display(p, 'count')}, items ${items.length}, byDate ${displaySum(count)}`,
  );
  const seen: Record<string, number> = {},
    nos = pySet<string>();
  for (const [i, r] of items.entries()) {
    const w = `proposals.items[${i}]`;
    c.ok(
      same(sorted(Object.keys(r)), ['date', 'file', 'no']),
      `${w}: keys ${repr(sorted(Object.keys(r)))} (only no, date, file: no author, no text)`,
    );
    required(r, 'no');
    c.ok(
      /^52-\p{Decimal_Number}{3}-\p{Decimal_Number}{2}-\p{Decimal_Number}+$/u.test(
        required<any>(r, 'no'),
      ) && required(r, 'file') === required<any>(r, 'no') + '.pdf',
      `${w}: no/file ${stringField(r, 'no')} ${stringField(r, 'file')}`,
    );
    c.ok(
      iso(required<any>(r, 'date')) && pyHas(required<any>(p, 'byDate'), required<any>(r, 'date')),
      `${w}: date ${required<any>(r, 'date')}`,
    );
    c.ok(!nos.has(required<any>(r, 'no')), `${w}: duplicate number`);
    nos.add(required<any>(r, 'no'));
    seen[required<any>(r, 'date')] = (seen[required<any>(r, 'date')] ?? 0) + 1;
  }
  c.ok(
    same(seen, required<any>(p, 'byDate')),
    `proposals.byDate ${display(p, 'byDate')} vs items ${repr(seen)}`,
  );
  c.ok(
    required<any>(p, 'urlPattern') === 'https://www.parliament.bg/bills/52/{file}',
    'proposals.urlPattern',
  );
  const nx = required<any>(law, 'next');
  c.ok(
    required<any>(nx, 'status') === 'pending' &&
      numbersIn(nx) === 0 &&
      pyTruth(required(nx, 'expected')) &&
      pyTruth(required(nx, 'note')),
    'next: a pending block without numbers',
  );
}
export function law(ctx: Context): Check {
  const c = new Check('LAW'),
    data = ctx.get('law.json'),
    core = ctx.get('core.json'),
    m = required<any>(data, 'meta');
  const keys = [
    'meta',
    'note',
    'versions',
    'art1',
    'budgets',
    'totals',
    'changes',
    'reconciliation',
    'bills',
    'timeline',
    'kinds',
    'counts',
    'gazette',
    'documents',
    'proposals',
    'next',
    'pending',
  ];
  c.ok(
    same(sorted(Object.keys(data)), sorted(keys)),
    `law.json keys ${repr(sorted(Object.keys(data)))}`,
  );
  c.ok(
    required(m, 'id') === 'D10+D11' &&
      required<any>(m, 'status') === 'real' &&
      required(m, 'unit') === 'хил. €' &&
      same(required<any>(m, 'pending'), ['P07']) &&
      same(required<any>(data, 'pending'), ['P07']),
    'meta id/status/unit/pending',
  );
  c.ok(
    iso(required<any>(m, 'asOf')) && required<any>(m, 'asOf') <= ctx.buildDate,
    `meta.asOf ${required<any>(m, 'asOf')}`,
  );
  const v = required<any>(data, 'versions');
  c.ok(
    required(required<any>(v, 'bill'), 'date') === '2026-07-01' &&
      required<any>(required<any>(v, 'law'), 'date') === '2026-07-24' &&
      required<any>(required<any>(v, 'bill'), 'ref') === '52-602-01-19',
    'versions dates/ref',
  );
  c.ok(
    Object.values(v).every(
      (x: any) =>
        required<string>(x, 'url').startsWith('https://') && pyTruth(required(x, 'label')),
    ),
    'versions urls',
  );
  const rows = art1(c, data);
  lawBudgets(c, data);
  changes(c, data, rows);
  const s = reconciliation(c, data);
  bills(c, data, required<any>(core, 'sources'), ctx.buildDate);
  timeline(c, data, ctx);
  proposals(c, data);
  const t = required<any>(data, 'totals');
  c.fact(
    `46 budgets: revenue ${fmt(required<any>(required<any>(t, 'bill'), 'rev'))} -> ${fmt(required<any>(required<any>(t, 'law'), 'rev'))}, expenditure ${fmt(required<any>(required<any>(t, 'bill'), 'exp'))} -> ${fmt(required<any>(required<any>(t, 'law'), 'exp'))} хил. €; 4 differ (arts 2, 3, 16, 17); arts 2 + 3 + 17 = art. 1: revenue ${fmt(required<any>(s, 'rev'))}, expenditure ${fmt(required<any>(s, 'exp'))}, balance ${fmt(required<any>(s, 'balance'))}; ${required<any>(data, 'timeline').length} timeline entries, ${pyDecimalInteger(required(required<any>(data, 'counts'), 'committeeReports'))} committee reports, ${pyDecimalInteger(required(required<any>(data, 'counts'), 'opinions'))} opinions, ${pyDecimalInteger(required(required<any>(data, 'counts'), 'proposals'))} proposals`,
  );
  return c;
}
