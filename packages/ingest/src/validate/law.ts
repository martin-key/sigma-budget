/** Independent validation of the legacy enacted-law data against its published cross-references. */
import { pythonNumberAt, type PythonNumber } from '../common/numbers.js';
import { Check, fmt, isnum, numbersIn, pyRepr, pyTruth } from './checks.js';
import { Context } from './context.js';
import {
  PythonError,
  required,
  floatRepr,
  pyStrip,
  pyEqual,
  pyIntAt,
  pySum,
  pyMap,
  pyTypedSum,
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
  const value = o[k];
  if (value === undefined)
    throw new PythonError(
      Array.isArray(o) ? 'IndexError' : 'KeyError',
      Array.isArray(o) ? 'list index out of range' : pyRepr(String(k)),
    );
  return typeof value === 'boolean'
    ? { value: Number(value), kind: 'int' }
    : pythonNumberAt(o, String(k), value);
};
const sum = (xs: Iterable<PythonNumber>) => pySum(xs);
const pyfloat = floatRepr;
const display = (o: any, k: string | number): string => {
  const value = o[k];
  if (isnum(value) && n(o, k).kind === 'float') return pyfloat(value);
  if (Array.isArray(value)) return `[${value.map((_, i) => display(value, i)).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .map((key) => `${repr(key)}: ${display(value, key)}`)
      .join(', ')}}`;
  return repr(value);
};
const displaySum = (value: PythonNumber) =>
  value.kind === 'float' ? pyfloat(value.value) : String(value.value);
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
  const a = law.art1,
    h = a.headline;
  c.ok(same(Object.keys(h), HEAD), `art1.headline keys ${repr(Object.keys(h))}`);
  for (const k of HEAD) {
    for (const s of ['bill', 'law', 'diff'])
      c.ok(Object.hasOwn(h, k) && isnum(h[k][s]), `art1.headline.${k}.${s} is not a number`);
    if (Object.hasOwn(h, k)) dd(c, h[k], `art1.headline.${k}`);
  }
  if (
    HEAD.every((k) => Object.hasOwn(h, k) && ['bill', 'law', 'diff'].every((s) => isnum(h[k][s])))
  )
    for (const s of ['bill', 'law', 'diff']) {
      const v: any = Object.fromEntries(HEAD.map((k) => [k, h[k][s]]));
      near(
        c,
        v.balance,
        v.rev - v.exp - v.transfers - v.eucontrib,
        TOL_SUM,
        `art1 ${s} balance = rev - exp - transfers - eucontrib`,
        display(h.balance, s),
        pyfloat(v.rev - v.exp - v.transfers - v.eucontrib),
      );
      near(
        c,
        v.financing,
        -v.balance,
        TOL,
        `art1 ${s} financing = -balance`,
        display(h.financing, s),
        pyfloat(-v.balance),
      );
    }
  const lines = a.lines;
  c.ok(lines.length === 50, `art1 has ${lines.length} lines (50 expected)`);
  c.ok(
    same(
      lines.map((r: any) => required(r, 'id')),
      lines.map((_: any, i: number) => `a1.${String(i + 1).padStart(2, '0')}`),
    ),
    'art1 line ids are a1.01.. consecutive',
  );
  const rows = new Map<string, any>();
  const key = (sec: string, no: string) => JSON.stringify([sec, no]);
  for (const r of lines) {
    const w = `art1 line ${r.id}`;
    c.ok(
      typeof r.text === 'string' &&
        !!pyStrip(r.text) &&
        pyIntAt(r, 'level') &&
        Number(r.level) >= 0 &&
        Number(r.level) <= 3,
      `${w}: text/level`,
    );
    if (pyTruth(r.header)) {
      c.ok(
        !['bill', 'law', 'diff', 'changed'].some((k) => Object.hasOwn(r, k)),
        `${w}: a header row must not carry numbers`,
      );
      continue;
    }
    c.ok(
      typeof r.no === 'string' &&
        r.no !== '' &&
        [...r.no].every((ch) => ch.codePointAt(0)! < 128) &&
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
      pyEqual(r.changed, Math.abs(r.diff) > 0.05),
      `${w}: changed flag ${display(r, 'changed')} vs diff ${display(r, 'diff')}`,
    );
    const rk = key(r.sec, r.no);
    c.ok(!rows.has(rk), `${w}: duplicate row (${repr(r.sec)}, ${repr(r.no)})`);
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
          required<any>(h, k)[s],
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
    if (!Array.isArray(e)) throw e;
    c.fail(`art1: row (${repr(e[0])}, ${repr(e[1])}) is missing`);
    return new Map();
  }
  return rows;
}
function lawBudgets(c: Check, law: any) {
  const bs = required<any[]>(law, 'budgets');
  c.ok(bs.length === 46, `${bs.length} budgets (46 expected: art. 2-47)`);
  c.ok(
    same(
      bs.map((b: any) => b.art),
      bs.map((_: any, i: number) => i + 2),
    ),
    `budget arts are 2..${1 + bs.length} consecutive`,
  );
  const ids = bs.map((b: any) => b.id);
  c.ok(
    new Set(ids).size === ids.length &&
      ids.every((i: any) => typeof i === 'string' && /^\p{Decimal_Number}{4}$/u.test(i)),
    'budget ids unique 4-digit strings',
  );
  const changed: number[] = [],
    sums: any = { bill: { rev: 0, exp: 0 }, law: { rev: 0, exp: 0 } };
  for (const b of bs) {
    const w = `budget ${b.id} (art. ${b.art})`;
    for (const k of ['name', 'short', 'kind'])
      c.ok(typeof b[k] === 'string' && !!pyStrip(b[k]), `${w}: ${k}`);
    for (const k of ['rev', 'exp', 'transfers']) {
      const sides = ['bill', 'law', 'diff'].map((s) => b[s][k]);
      c.ok(
        sides.every((x) => x === null) || sides.every(isnum),
        `${w}.${k}: the three sides must be all numbers or all null: [${['bill', 'law', 'diff'].map((s) => display(b[s], k)).join(', ')}]`,
      );
      if (isnum(sides[0]) && isnum(sides[1]))
        near(
          c,
          sides[2],
          sides[1] - sides[0],
          TOL,
          `${w}.${k} diff`,
          display(b.diff, k),
          pyfloat(sides[1] - sides[0]),
        );
    }
    for (const s of ['bill', 'law']) {
      c.ok(isnum(b[s].exp), `${w}.${s}.exp must be a number`);
      sums[s].rev += nz(b[s].rev);
      sums[s].exp += nz(b[s].exp);
      if (isnum(b[s].exp) && isnum(b[s].transfers)) {
        const gap = b[s].transfers - (b[s].exp - nz(b[s].rev));
        const want =
          b.id === '0600' && s === 'law' ? -7000 : b.id === '1700' ? 1866.2 : (OWN[b.id] ?? 0);
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
    const ln = b.lines;
    c.ok(
      same(sorted(Object.keys(ln)), ['add', 'chg', 'del']) &&
        Object.keys(ln).every((k) => pyIntAt(ln, k) && Number(ln[k]) >= 0),
      `${w}: lines ${repr(ln)}`,
    );
    const moved =
      ['rev', 'exp', 'transfers'].some((k) => Math.abs(nz(b.diff[k])) > 0.05) ||
      Object.values(ln).some(pyTruth);
    c.ok(
      pyEqual(required(b, 'changed'), moved),
      `${w}: changed flag ${display(b, 'changed')} vs differences`,
    );
    if (moved) changed.push(b.art);
  }
  const t = law.totals;
  c.ok(t.count === bs.length && bs.length === 46, `totals.count ${t.count}`);
  for (const s of ['bill', 'law'])
    for (const k of ['rev', 'exp']) {
      near(
        c,
        t[s][k],
        sums[s][k],
        TOL_SUM,
        `totals.${s}.${k} = sum of the budgets`,
        display(t[s], k),
        pyfloat(sums[s][k]),
      );
      near(c, t[s][k], REF[s]![k], TOL, `totals.${s}.${k} reference value`);
    }
  for (const k of ['rev', 'exp'])
    near(
      c,
      t.diff[k],
      t.law[k] - t.bill[k],
      TOL,
      `totals.diff.${k}`,
      display(t.diff, k),
      pyfloat(t.law[k] - t.bill[k]),
    );
  c.ok(
    same(changed, [2, 3, 16, 17]),
    `budgets that differ: ${repr(changed)} (arts 2, 3, 16, 17 expected)`,
  );
  c.ok(
    law.note.includes('46') && law.note.includes('чл. 2, 3, 16 и 17'),
    'law.note must name the 46 budgets and the four that differ',
  );
}
function changes(c: Check, law: any, artRows: Map<string, any>) {
  const bs = new Map<number, any>(law.budgets.map((b: any) => [b.art, b])),
    ch = law.changes;
  c.ok(
    same(
      ch.map((x: any) => x.art),
      [1, 2, 3, 16, 17],
    ),
    `changes arts ${repr(ch.map((x: any) => x.art))}`,
  );
  for (const x of ch) {
    const w = `changes art. ${x.art}`,
      b = bs.get(x.art);
    c.ok(x.art === 1 ? x.id === 'state' : x.id === b.id, `${w}: id ${x.id}`);
    c.ok(
      Array.isArray(x.notes) &&
        x.notes.length > 0 &&
        x.notes.every((v: any) => typeof v === 'string' && !!pyStrip(v)),
      `${w}: notes`,
    );
    for (const [k, node] of Object.entries(x.headline)) dd(c, node, `${w} headline ${k}`);
    for (const key of ['areas', 'bodies', 'commitments'])
      for (const [i, node] of (x[key] ?? []).entries()) {
        c.ok(isnum(node.bill) && isnum(node.law), `${w} ${key}[${i}]: both sides must be numbers`);
        dd(c, node, `${w} ${key}[${i}]`);
      }
    const ops: Record<string, number> = { chg: 0, add: 0, del: 0 };
    for (const [i, r] of x.lines.entries()) {
      const ww = `${w} line ${i} (${r.sec ?? 'None'} ${r.no ?? 'None'})`;
      c.ok(
        Object.hasOwn(ops, r.op) && typeof r.text === 'string' && !!pyStrip(r.text),
        `${ww}: op/text`,
      );
      c.ok(
        [...(r.no as string)].every((ch) => ch.codePointAt(0)! < 128),
        `${ww}: 'no' must be plain ASCII`,
      );
      if (Object.hasOwn(ops, r.op)) ops[r.op]!++;
      c.ok(
        (r.op !== 'add' || r.bill === null) &&
          (r.op !== 'del' || r.law === null) &&
          (r.op !== 'chg' || (isnum(r.bill) && isnum(r.law))),
        `${ww}: op ${r.op} vs the two sides`,
      );
      dd(c, r, ww);
    }
    if (b) {
      c.ok(
        same(ops, b.lines),
        `${w}: op counts ${repr(ops)} vs the budget's lines ${repr(b.lines)}`,
      );
      for (const k of ['rev', 'exp', 'transfers'])
        if (Object.hasOwn(x.headline, k))
          for (const s of ['bill', 'law'])
            near(
              c,
              x.headline[k][s],
              b[s][k],
              TOL,
              `${w} headline ${k} ${s} = the budget`,
              display(x.headline[k], s),
              display(b[s], k),
            );
      if ('areas' in x)
        for (const s of ['bill', 'law'])
          near(
            c,
            sum(pyMap(x.areas, (a: any) => n(a, s))),
            b[s].exp,
            TOL_SUM,
            `${w} areas ${s} sum to the expenditure`,
          );
    } else {
      const marked = new Map<string, any>(
        x.lines.map((r: any) => [JSON.stringify([r.sec, r.no]), r]),
      );
      const changed = new Map([...artRows].filter(([, r]) => pyTruth(r.changed)));
      const diff = [...new Set([...marked.keys(), ...changed.keys()])]
        .filter((k) => marked.has(k) !== changed.has(k))
        .sort()
        .map((k) => JSON.parse(k));
      c.ok(
        diff.length === 0,
        `art. 1: changed rows differ: [${diff.map((k) => `(${repr(k[0])}, ${repr(k[1])})`).join(', ')}]`,
      );
      for (const [k, r] of marked)
        if (changed.has(k)) {
          const pair = JSON.parse(k),
            q = changed.get(k);
          c.ok(
            r.bill === q.bill && r.law === q.law,
            `art. 1 row (${repr(pair[0])}, ${repr(pair[1])}) differs from art1.lines`,
          );
        }
      c.ok(ops.add === 0 && ops.del === 0, 'art. 1 has only changed rows');
    }
  }
  c.ok(
    same(sorted(Object.keys(ch[0].headline)), ['balance', 'exp', 'financing', 'rev']),
    'art. 1 change headline keys',
  );
}
function reconciliation(c: Check, law: any) {
  const rec = law.reconciliation,
    h = law.art1.headline;
  for (const k of ['rev', 'exp', 'balance']) required(h, k);
  const rows = law.budgets
    .filter((b: any) => Math.abs(nz(b.diff.rev)) > 0.05 || Math.abs(nz(b.diff.exp)) > 0.05)
    .map((b: any) => ({
      art: b.art,
      name: b.name,
      rev: nz(b.diff.rev),
      exp: nz(b.diff.exp),
      source: b.diff,
    }));
  c.ok(
    same(
      rec.rows.map((r: any) => [r.art, r.name]),
      rows.map((r: any) => [r.art, r.name]),
    ),
    `reconciliation rows ${repr(rec.rows.map((r: any) => r.art))} vs the budgets with a money difference ${repr(rows.map((r: any) => r.art))}`,
  );
  for (let i = 0; i < Math.min(rows.length, rec.rows.length); i++)
    for (const k of ['rev', 'exp'])
      near(
        c,
        rec.rows[i][k],
        rows[i][k],
        TOL,
        `reconciliation art. ${rows[i].art} ${k}`,
        display(rec.rows[i], k),
        display(rows[i].source, k),
      );
  const values = (k: string) =>
    sum(
      pyMap(rows, (r: any) => (isnum(r.source[k]) ? n(r.source, k) : { value: 0, kind: 'float' })),
    );
  const s: any = { rev: values('rev'), exp: values('exp') };
  s.balance = s.rev - s.exp;
  for (const k of ['rev', 'exp', 'balance']) {
    near(
      c,
      rec.sum[k],
      s[k],
      TOL_SUM,
      `reconciliation sum.${k}`,
      display(rec.sum, k),
      pyfloat(s[k]),
    );
    near(
      c,
      rec.art1[k],
      h[k].diff,
      TOL,
      `reconciliation art1.${k} = art. 1 headline diff`,
      display(rec.art1, k),
      display(h[k], 'diff'),
    );
    near(c, rec.sum[k], rec.art1[k], TOL_SUM, `arts. 2 + 3 + 17 = art. 1 on ${k}`);
  }
  c.ok(rec.ok === true, 'reconciliation.ok must be true');
  c.ok(rec.unit === law.meta.unit && rec.unit === 'хил. €', 'reconciliation unit');
  return s;
}
function bills(c: Check, law: any, src: any, buildDate: string) {
  const gz = new Set(law.gazette.map((g: any) => JSON.stringify([g.issue, g.date]))),
    bs = law.bills;
  c.ok(
    same(
      bs.map((b: any) => b.id),
      ['zdb', 'zbdoo', 'zbnzok'],
    ),
    `bills ${repr(bs.map((b: any) => b.id))}`,
  );
  c.ok(
    same(
      bs.map((b: any) => b.sign),
      ['52-602-01-19', '52-602-01-18', '52-602-01-17'],
    ),
    'bill signs',
  );
  for (const b of bs) {
    const w = `bill ${b.id}`,
      days = [b.submitted, b.firstReading, ...b.secondReading];
    c.ok(
      [...days, b.adopted, b.decree.issued, b.gazette.date].every(iso),
      `${w}: dates must be ISO`,
    );
    c.ok(
      same(days, sorted(days)),
      `${w}: submitted <= first reading <= second reading: ${repr(days)}`,
    );
    c.ok(b.adopted === b.secondReading.at(-1), `${w}: adopted = last second reading`);
    c.ok(
      b.adopted <= b.decree.issued &&
        b.decree.issued <= b.gazette.date &&
        b.gazette.date <= buildDate,
      `${w}: adopted <= decree <= gazette <= build date`,
    );
    c.ok(
      gz.has(JSON.stringify([b.gazette.issue, b.gazette.date])),
      `${w}: gazette issue ${b.gazette.issue} of ${b.gazette.date} is not in law.gazette`,
    );
    c.ok(pyIntAt(b.decree, 'no') && pyIntAt(b.gazette, 'issue'), `${w}: decree / issue numbers`);
    c.ok(iso(b.inForce.from), `${w}: inForce.from`);
    for (const e of b.inForce.exceptions) {
      c.ok(
        (e.from === null || iso(e.from)) && pyTruth(pyStrip(e.when)) && pyTruth(pyStrip(e.scope)),
        `${w}: exception ${repr(e)}`,
      );
      c.ok(
        e.from === null || e.from >= b.gazette.date,
        `${w}: an exception starts before the gazette date: ${e.from}`,
      );
    }
    c.ok(
      ['committeeReports', 'opinions', 'proposals'].every(
        (k) => pyIntAt(b.counts, k) && Number(b.counts[k]) >= 0,
      ),
      `${w}: counts`,
    );
    c.ok(
      b.page.startsWith('https://www.parliament.bg/') &&
        b.law.startsWith('https://dv.parliament.bg/'),
      `${w}: urls`,
    );
    c.ok(
      required<any[]>(b, 'source').every((k: string) => Object.hasOwn(src, k)),
      `${w}: source keys`,
    );
  }
  const z = bs[0].counts,
    cn = law.counts;
  for (const k of ['committeeReports', 'opinions', 'proposals'])
    c.ok(cn[k] === z[k], `counts.${k} ${display(cn, k)} vs the bill ${display(z, k)}`);
  for (const [k, d] of [
    ['committeeReports', 'reportDates'],
    ['opinions', 'opinionDates'],
    ['proposals', 'proposalDates'],
  ] as const) {
    const value = pyTypedSum(pyMap(Object.keys(cn[d]), (x) => n(cn[d], x)));
    c.ok(value.value === cn[k], `counts.${d} sums to ${displaySum(value)}, not ${display(cn, k)}`);
    c.ok(
      Object.keys(cn[d]).every((x) => iso(x) && x <= buildDate),
      `counts.${d} dates`,
    );
  }
  c.ok(
    cn.committees.reported === cn.committeeReports &&
      cn.committeeReports <= cn.committees.total &&
      cn.committees.total === 24,
    `counts.committees ${repr(cn.committees)}`,
  );
  c.ok(same(cn.proposalDates, law.proposals.byDate), 'counts.proposalDates = proposals.byDate');
  const g = law.gazette,
    dates = g.map((x: any) => x.date);
  c.ok(same(dates, sorted(dates)) && g.length === 4, 'gazette: 4 issues in date order');
  for (const x of g)
    c.ok(
      iso(x.date) &&
        Number(x.date.slice(0, 4)) === x.year &&
        pyIntAt(x, 'issue') &&
        pyTruth(x.laws),
      `gazette ${repr(x)}`,
    );
  const docs = law.documents;
  c.ok(
    docs.length === 7 &&
      docs.every((d: any) => pyTruth(d.kind) && pyTruth(d.title) && d.url.startsWith('https://')),
    'documents: 7 https links',
  );
  c.ok(docs[0].url === law.versions.bill.url, 'documents[0] is the bill file of versions.bill');
}
function timeline(c: Check, law: any, ctx: Context) {
  const tl = law.timeline;
  c.ok(tl.length === 21, `timeline has ${tl.length} entries (21 expected)`);
  const days: string[] = [];
  for (const [i, t] of tl.entries()) {
    const w = `timeline[${i}] ${(t.title ?? '').slice(0, 30)}`;
    c.ok(
      Object.hasOwn(law.kinds, t.kind) &&
        ['prehistory', 'parliament', 'execution'].includes(t.phase),
      `${w}: kind/phase`,
    );
    c.ok(
      typeof t.title === 'string' &&
        !!pyStrip(t.title) &&
        typeof t.dateText === 'string' &&
        !!pyStrip(t.dateText),
      `${w}: title/dateText`,
    );
    c.ok(t.source, `${w}: source`);
    const d = pyTruth(t.date) ? t.date : pyTruth(t.month) ? `${t.month}-01` : null;
    c.ok((d === null) === pyTruth(t.ongoing), `${w}: only an ongoing entry may have no date`);
    if (d !== null) {
      c.ok(iso(d) && d <= ctx.buildDate, `${w}: date ${d}`);
      days.push(d);
    }
    if (pyTruth(t.href))
      c.ok(
        (t.href.startsWith('#/') && ctx.routes().match(t.href) !== null) ||
          t.href.startsWith('https://'),
        `${w}: href ${t.href} does not resolve`,
      );
  }
  c.ok(same(days, sorted(days)), 'timeline is not in date order');
  c.ok(
    tl.filter((t: any) => t.phase === 'execution').length === 1 && tl.at(-1).phase === 'execution',
    'one execution entry, last',
  );
  const used = new Set<string>(tl.map((t: any) => t.kind)),
    missing = [...used].filter((x) => !Object.hasOwn(law.kinds, x)).sort();
  c.ok(!missing.length, `timeline kinds ${repr(missing)}`);
}
function proposals(c: Check, law: any) {
  const p = law.proposals,
    items = p.items;
  c.ok(
    same(sorted(Object.keys(p)), ['byDate', 'count', 'items', 'note', 'urlPattern']),
    `proposals keys ${repr(sorted(Object.keys(p)))}`,
  );
  const count = pyTypedSum(pyMap(Object.keys(p.byDate), (k) => n(p.byDate, k)));
  c.ok(
    p.count === items.length && items.length === 69 && count.value === 69,
    `proposals: count ${display(p, 'count')}, items ${items.length}, byDate ${displaySum(count)}`,
  );
  const seen: Record<string, number> = {},
    nos = new Set<string>();
  for (const [i, r] of items.entries()) {
    const w = `proposals.items[${i}]`;
    c.ok(
      same(sorted(Object.keys(r)), ['date', 'file', 'no']),
      `${w}: keys ${repr(sorted(Object.keys(r)))} (only no, date, file: no author, no text)`,
    );
    required(r, 'no');
    c.ok(
      /^52-\p{Decimal_Number}{3}-\p{Decimal_Number}{2}-\p{Decimal_Number}+$/u.test(r.no) &&
        r.file === r.no + '.pdf',
      `${w}: no/file ${r.no} ${r.file}`,
    );
    c.ok(iso(r.date) && Object.hasOwn(p.byDate, r.date), `${w}: date ${r.date}`);
    c.ok(!nos.has(r.no), `${w}: duplicate number`);
    nos.add(r.no);
    seen[r.date] = (seen[r.date] ?? 0) + 1;
  }
  c.ok(same(seen, p.byDate), `proposals.byDate ${display(p, 'byDate')} vs items ${repr(seen)}`);
  c.ok(p.urlPattern === 'https://www.parliament.bg/bills/52/{file}', 'proposals.urlPattern');
  const nx = law.next;
  c.ok(
    nx.status === 'pending' && numbersIn(nx) === 0 && pyTruth(nx.expected) && pyTruth(nx.note),
    'next: a pending block without numbers',
  );
}
export function law(ctx: Context): Check {
  const c = new Check('LAW'),
    data = ctx.get('law.json'),
    core = ctx.get('core.json'),
    m = data.meta;
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
    m.id === 'D10+D11' &&
      m.status === 'real' &&
      m.unit === 'хил. €' &&
      same(m.pending, ['P07']) &&
      same(data.pending, ['P07']),
    'meta id/status/unit/pending',
  );
  c.ok(iso(m.asOf) && m.asOf <= ctx.buildDate, `meta.asOf ${m.asOf}`);
  const v = data.versions;
  c.ok(
    v.bill.date === '2026-07-01' && v.law.date === '2026-07-24' && v.bill.ref === '52-602-01-19',
    'versions dates/ref',
  );
  c.ok(
    Object.values(v).every((x: any) => x.url.startsWith('https://') && pyTruth(x.label)),
    'versions urls',
  );
  const rows = art1(c, data);
  lawBudgets(c, data);
  changes(c, data, rows);
  const s = reconciliation(c, data);
  bills(c, data, core.sources, ctx.buildDate);
  timeline(c, data, ctx);
  proposals(c, data);
  const t = data.totals;
  c.fact(
    `46 budgets: revenue ${fmt(t.bill.rev)} -> ${fmt(t.law.rev)}, expenditure ${fmt(t.bill.exp)} -> ${fmt(t.law.exp)} хил. €; 4 differ (arts 2, 3, 16, 17); arts 2 + 3 + 17 = art. 1: revenue ${fmt(s.rev)}, expenditure ${fmt(s.exp)}, balance ${fmt(s.balance)}; ${data.timeline.length} timeline entries, ${data.counts.committeeReports} committee reports, ${data.counts.opinions} opinions, ${data.counts.proposals} proposals`,
  );
  return c;
}
