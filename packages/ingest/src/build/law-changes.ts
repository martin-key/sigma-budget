import { isNumber, roundNumber } from '../io/data.js';
import { formatThousands as fmt } from '../common/format.js';
type Data = Record<string, any>;
const tol = 0.051;
const diff = (b: unknown, l: unknown) =>
  isNumber(b) && isNumber(l) ? roundNumber(l - b, 1) : null;
const pair = (bill: unknown, law: unknown) => ({ bill, law, diff: diff(bill, law) });
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const dash = (s: string) => s.replace(/(^|\s)-\s/g, '$1– ');
const rn = (s: string) =>
  /^[IVXІХ]+\.?$/.test(s.trim()) ? s.replaceAll('І', 'I').replaceAll('Х', 'X') : s;
const cleanArea = (s: string) => s.replace(/[,\s]*(?:в\s*)?т\.\s*ч\.:?\s*$/, '').trim();
const labels: Data = {
  entered: 'Максимален размер на ангажиментите за разходи, които могат да бъдат поети през 2026 г.',
  new: 'Максимален размер на новите задължения за разходи, които могат да бъдат натрупани през 2026 г.',
};
function change(L: Data, art: number, name: string, id: string, headline?: Data): Data {
  const d = L.diff[String(art)],
    b = L.bill[String(art)],
    l = L.law[String(art)];
  const h: Data = headline ?? {};
  if (!headline)
    for (const k of ['rev', 'exp', 'transfers', 'balance', 'financing'])
      if (b.headline[k] != null || l.headline[k] != null)
        h[k] = pair(b.headline[k] ?? null, l.headline[k] ?? null);
  const out: Data = {
    art,
    id,
    name,
    headline: h,
    lines: d.lines.map((x: Data) => ({
      op: x.op,
      sec: x.sec,
      no: rn(x.no),
      text: dash(x.text).trim(),
      bill: x.bill ?? null,
      law: x.law ?? null,
      diff: diff(x.bill, x.law),
    })),
  };
  if ('policies' in d) {
    const bm = new Map(b.policies.map((p: Data) => [p.n, p])),
      lm = new Map(l.policies.map((p: Data) => [p.n, p]));
    if (JSON.stringify([...bm.keys()]) !== JSON.stringify([...lm.keys()]))
      throw new Error('Policy numbers differ');
    out.areas = [...lm.entries()].map(([n, p]: [any, any]) => {
      const name = cleanArea(p.name),
        prior: any = bm.get(n);
      if (fold(cleanArea(prior.name)) !== fold(name)) throw new Error('Policy names differ');
      return { n, name, ...pair(prior.khil, p.khil) };
    });
    if (
      b.policies.some((p: Data) => p.parts?.length) &&
      !l.policies.some((p: Data) => p.parts?.length)
    )
      out.areasNote =
        'В законопроекта разпределението е по бюджетни програми във всяка област; в закона са посочени само функционалните области.';
  }
  if ('bodies' in d) {
    const bm = new Map(b.bodies.map((x: Data) => [x.name, x.khil])),
      lm = new Map(l.bodies.map((x: Data) => [x.name, x.khil]));
    if (JSON.stringify([...bm.keys()]) !== JSON.stringify([...lm.keys()]))
      throw new Error('Bodies differ');
    out.bodies = [...lm.entries()].map(([name, v]) => ({ name, ...pair(bm.get(name), v) }));
  }
  if ('commitments' in d)
    out.commitments = ['entered', 'new'].map((k) => ({
      key: k,
      label: labels[k],
      ...pair(b.commitments[k], l.commitments[k]),
    }));
  return out;
}
export function lawChanges(
  L: Data,
  rows: Data[],
  art1: Data,
): { changes: Data[]; reconciliation: Data } {
  const byArt = new Map(rows.map((r) => [r.art, r]));
  const changes: Data[] = [],
    rec: Data[] = [];
  for (const art of [2, 3, 16, 17]) {
    const row = byArt.get(art)!;
    const ch = change(L, art, row.name, row.id);
    changes.push(ch);
    rec.push({
      art,
      name: row.name,
      rev: ch.headline.rev?.diff || 0,
      exp: ch.headline.exp?.diff || 0,
    });
  }
  const h1: Data = Object.fromEntries(
    ['rev', 'exp', 'balance', 'financing'].map((k) => [
      k,
      pair(L.bill['1'].headline[k], L.law['1'].headline[k]),
    ]),
  );
  const sum: Data = Object.fromEntries(
    ['rev', 'exp'].map((k) => [
      k,
      roundNumber(
        rec.reduce((s, r) => s + r[k], 0),
        1,
      ),
    ]),
  );
  sum.balance = roundNumber(sum.rev - sum.exp, 1);
  const a1: Data = Object.fromEntries(['rev', 'exp', 'balance'].map((k) => [k, h1[k].diff]));
  if (Object.keys(sum).some((k) => !isNumber(a1[k]) || Math.abs(sum[k] - a1[k]) > tol))
    throw new Error('Changes do not reconcile with article 1');
  changes.unshift(change(L, 1, 'Държавен бюджет', 'state', h1));
  const reconciliation = {
    unit: 'хил. €',
    rows: rec.filter((r) => r.rev || r.exp),
    sum,
    art1: a1,
    ok: true,
  };
  notes(changes, reconciliation, art1);
  return { changes, reconciliation };
}
function notes(changes: Data[], rec: Data, art1: Data) {
  const by = new Map(changes.map((c) => [c.art, c])),
    rd = new Map(rec.rows.map((r: Data) => [r.art, r]));
  const line = (ch: Data, sec: string, no: string) => {
    const x = ch.lines.find((v: Data) => v.sec === sec && v.no === no);
    if (!x) throw new Error('Missing diff line');
    return x;
  };
  const a = (no: string) => {
    const x = art1.lines.find((v: Data) => !v.header && v.sec === 'II' && v.no === no);
    if (!x) throw new Error('Missing article 1 line');
    return x;
  };
  const h1 = by.get(1)!.headline,
    r = h1.rev.diff,
    e = h1.exp.diff,
    bal = h1.balance.diff;
  const r2: any = rd.get(2),
    r3: any = rd.get(3),
    r17: any = rd.get(17);
  const numericDiff = (no: string): number => {
    const value: unknown = a(no).diff;
    if (!isNumber(value)) throw new Error(`Article 1 II ${no} difference is not numeric`);
    return value;
  };
  const kids = ['1.1', '1.2', '1.3', '1.4'].reduce((s, n) => s + numericDiff(n), 0),
    rest = roundNumber(numericDiff('1') - kids, 1)!;
  const inst = line(by.get(16)!, 'II', '1.2.2.4');
  if (
    r3.exp !== -r17.exp ||
    a('1.2.2').diff !== inst.law ||
    by.get(16)!.headline.exp.diff !== 0 ||
    rest >= 0 ||
    r2.rev <= 0 ||
    r2.exp >= 0
  )
    throw new Error('Notes no longer match the data');
  const more = (v: number) => (v > 0 ? 'повече' : 'по-малко'),
    sgn = (v: number) => (v > 0 ? '+' : '') + fmt(v);
  by.get(1)!.notes = [
    `Спрямо внесения законопроект приходите по закона са с ${fmt(Math.abs(r))} ${more(r)}, разходите са с ${fmt(Math.abs(e))} ${more(e)}, а бюджетното салдо е с ${fmt(Math.abs(bal))} по-добро. Разликите идват от чл. 2 (съдебна власт), чл. 3 (Народно събрание) и чл. 17 (Министерство на културата); чл. 16 не променя общата си сума.`,
    `Промените по чл. 3 (${sgn(r3.exp)}) и чл. 17 (${sgn(r17.exp)}) са равни по размер и с противоположен знак и в чл. 1 се компенсират.`,
    `Редовете след „в т.ч.“ в закона не са изчерпателни: промяната на текущите разходи (${fmt(a('1').diff)}) е по-голяма от сбора на посочените под нея редове (${fmt(kids)}); остатъкът (${fmt(rest)}) е в компоненти, които законът не показва поотделно.`,
  ];
  const c2 = by.get(2)!,
    t2 = c2.headline.transfers,
    fin2 = c2.headline.financing.law;
  const cur = line(c2, 'II', '1').diff,
    cap = line(c2, 'II', '2').diff,
    nw = c2.commitments.find((x: Data) => x.key === 'new'),
    ent = c2.commitments.find((x: Data) => x.key === 'entered');
  if (
    Math.abs(t2.diff - (r2.exp - r2.rev - fin2)) > tol ||
    c2.headline.balance.bill !== null ||
    fin2 <= 0
  )
    throw new Error('Article 2 transfers do not reconcile');
  c2.notes = [
    `Приходите на съдебната власт са с ${fmt(Math.abs(r2.rev))} ${more(r2.rev)}, а разходите — с ${fmt(Math.abs(r2.exp))} ${more(r2.exp)} (текущи: ${fmt(cur)}, капиталови: ${fmt(cap)}).`,
    `В закона има два нови реда: бюджетно салдо −${fmt(fin2)} и операции по финансирането +${fmt(fin2)} (депозити и средства по сметки). В законопроекта такива редове няма. Затова бюджетното взаимоотношение с централния бюджет намалява с ${fmt(Math.abs(t2.diff))}: ${fmt(Math.abs(r2.exp - r2.rev))} от по-ниските разходи и по-високите приходи и ${fmt(fin2)} от новото финансиране.`,
    `Максималният размер на новите задължения за разходи е намален от ${fmt(nw.bill)} на ${fmt(nw.law)}; максималният размер на ангажиментите (${fmt(ent.law)}) не се променя.`,
  ];
  const k3 = line(by.get(3)!, 'II', '2');
  by.get(3)!.notes = [
    `Капиталовите разходи на Народното събрание са намалени от ${fmt(k3.bill)} на ${fmt(k3.law)} (${sgn(k3.diff)}).`,
  ];
  const k17 = line(by.get(17)!, 'II', '2'),
    a17 = by.get(17)!.areas[0];
  by.get(17)!.notes = [
    `Капиталовите разходи на Министерството на културата са увеличени от ${fmt(k17.bill)} на ${fmt(k17.law)} (${sgn(k17.diff)}). Увеличението е в „${a17.name}“ (от ${fmt(a17.bill)} на ${fmt(a17.law)}).`,
  ];
  if (a17.diff !== k17.diff) throw new Error('Area change differs from capital change');
  by.get(16)!.notes = [
    `В закона към научните институти (Македонски, Добруджански, Тракийски) е добавен четвърти ред „Научен институт „Западни покрайнини“ (${fmt(inst.law)}). Общата сума на разходите не се променя; в приетата таблица не личи от кой ред са прехвърлени средствата.`,
  ];
}
