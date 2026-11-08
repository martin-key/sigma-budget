import { isNumber, roundNumber } from '../io/data.js';
import { artEbk, budgetInfo, nomFirst } from './law-definitions.js';

type Data = Record<string, any>;
const tolerance = 0.051;
const keys = ['rev', 'exp', 'transfers'];
const diff = (b: unknown, l: unknown) =>
  isNumber(b) && isNumber(l) ? roundNumber(l - b, 1) : null;
const pair = (bill: unknown, law: unknown) => ({ bill, law, diff: diff(bill, law) });
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const dash = (s: string) => s.replace(/(^|\s)-\s/g, '$1– ');
const rn = (s: string) =>
  /^[IVXІХ]+\.?$/.test(s.trim()) ? s.replaceAll('І', 'I').replaceAll('Х', 'X') : s;
function nominative(name: string) {
  const i = name.indexOf(' '),
    first = i < 0 ? name : name.slice(0, i),
    rest = i < 0 ? '' : name.slice(i);
  return ((nomFirst[first] ?? first) + rest).trim();
}

export function articleOne(L: Data): Data {
  const bl = L.bill['1'].lines,
    ll = L.law['1'].lines;
  if (bl.length !== ll.length) throw new Error('Article 1 line counts differ');
  let prev = 0;
  const changed: string[] = [];
  const lines = bl.map((b: any[], i: number) => {
    const l = ll[i];
    if (!Array.isArray(b) || !Array.isArray(l) || b.length < 4 || l.length < 4)
      throw new Error('Incomplete article 1 line');
    if (b[0] !== l[0] || b[1] !== l[1] || fold(b[2]) !== fold(l[2]))
      throw new Error(`Article 1 line ${i + 1} differs`);
    const level = !b[1] ? prev + 1 : fold(b[1]) === fold(b[0]) ? 0 : b[1].split('.').length;
    prev = level;
    const d = diff(b[3], l[3]);
    const row: Data = {
      id: `a1.${String(i + 1).padStart(2, '0')}`,
      sec: b[0],
      no: rn(b[1]),
      level,
      text: dash(b[2]).trim(),
    };
    if (b[3] === null && l[3] === null) row.header = true;
    else
      Object.assign(row, {
        bill: b[3],
        law: l[3],
        diff: d,
        changed: d !== null && Math.abs(d) > tolerance,
      });
    if (row.changed) changed.push(JSON.stringify([b[0], b[1]]));
    return row;
  });
  const wanted = L.diff['1'].lines.map((x: Data) => JSON.stringify([x.sec, x.no])).sort();
  if (JSON.stringify(changed.sort()) !== JSON.stringify(wanted))
    throw new Error('Article 1 changed rows differ from diff');
  const headline: Data = {};
  for (const k of ['rev', 'exp', 'transfers', 'eucontrib', 'balance', 'financing'])
    headline[k] = pair(L.bill['1'].headline[k], L.law['1'].headline[k]);
  for (const version of ['bill', 'law']) {
    const h: Data = Object.fromEntries(
      Object.entries(headline).map(([k, v]) => [k, (v as Data)[version]]),
    );
    if (
      ['rev', 'exp', 'transfers', 'eucontrib', 'balance', 'financing'].some((k) => !isNumber(h[k]))
    )
      throw new Error(`Article 1 ${version} headline is not numeric`);
    if (
      Math.abs(h.rev - h.exp - h.transfers - h.eucontrib - h.balance) > tolerance ||
      Math.abs(h.financing + h.balance) > tolerance
    )
      throw new Error(`Article 1 ${version} does not reconcile`);
  }
  return { unit: 'хил. €', title: 'Чл. 1: държавният бюджет', headline, lines };
}

export function budgetRows(L: Data, ministries: Data | null): Data[] {
  const mins = new Map<number, Data>((ministries?.items ?? []).map((m: Data) => [m.art, m]));
  const rows = [];
  for (let art = 2; art <= 47; art++) {
    const eid = artEbk[String(art)]!,
      b = L.bill[String(art)],
      l = L.law[String(art)];
    const [short, kind] = budgetInfo[eid]!,
      m = mins.get(art);
    const name = m ? m.name : nominative(l.name);
    const ops: Data = { chg: 0, add: 0, del: 0 };
    for (const line of L.diff[String(art)]?.lines ?? []) ops[line.op] = (ops[line.op] ?? 0) + 1;
    const pairs: Data = Object.fromEntries(
      keys.map((k) => [k, pair(b.headline[k] ?? null, l.headline[k] ?? null)]),
    );
    const section = (key: string) => Object.fromEntries(keys.map((k) => [k, pairs[k][key]]));
    const row = {
      art,
      id: eid,
      name,
      short,
      kind,
      bill: section('bill'),
      law: section('law'),
      diff: section('diff'),
      changed: Object.hasOwn(L.diff, String(art)),
      lines: { chg: ops.chg, add: ops.add, del: ops.del },
    };
    if (m) {
      const bvl = m.billVsLaw || {};
      for (const [k, key] of [
        ['rev', 'revKhil'],
        ['exp', 'expKhil'],
        ['transfers', 'transfersKhil'],
      ]) {
        const got = bvl[key!];
        if (got && (got.bill !== pairs[k!].bill || got.law !== pairs[k!].law))
          throw new Error(`Article ${art} ${k} differs from ministries`);
        if (!got && pairs[k!].diff) throw new Error(`Article ${art} ${k} differs from ministries`);
        if (m[key!] != null && m[key!] !== pairs[k!].law)
          throw new Error(`Article ${art} ${k} law differs from ministries`);
      }
    }
    rows.push(row);
  }
  return rows;
}
export function budgetTotals(rows: Data[], L: Data): Data {
  const out: Data = { count: rows.length };
  for (const version of ['bill', 'law'])
    out[version] = Object.fromEntries(
      ['rev', 'exp'].map((k) => [
        k,
        roundNumber(
          rows.reduce((s, r) => s + (isNumber(r[version][k]) ? r[version][k] : 0), 0),
          1,
        ),
      ]),
    );
  out.diff = Object.fromEntries(
    ['rev', 'exp'].map((k) => [k, roundNumber(out.law[k] - out.bill[k], 1)]),
  );
  const sums = L.sums;
  if (
    !isNumber(sums.expKhil) ||
    !isNumber(sums.revKhil) ||
    rows.length !== sums.budgets ||
    Math.abs(out.law.exp - sums.expKhil) > tolerance ||
    Math.abs(out.law.rev - sums.revKhil) > tolerance
  )
    throw new Error('Budget totals do not reconcile');
  return out;
}
