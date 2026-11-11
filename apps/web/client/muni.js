// Municipality helpers shared by S20 (Моята община) and S21 (Община). Pure: no DOM, no store, no fetch, no module state.
// Money in municipalities.json (D19) is in хил. € (thousand euro); perCapita is € per person; an unknown number is
// absent or null, never 0.
//
//   TYPES                    the five kinds of transfer in the order of the data: {key, label, short, text, inTotal} (text = one plain sentence;
//                            inTotal: the first four make up transfers.total, „other targeted“ is paid on top and is OUTSIDE it, see transfers.all)
//   KEYS                     ['total', ...TYPES keys]
//   popOf(m) · totalOf(m) · allOf(m) · pcOf(m) · pcType(m, key)   population · main transfers (хил. €) · main + other targeted (хил. €) · € per person · € per person for one kind (null when unknown)
//   aggregate(list)          {count, population, popCount, sum{key|'all'}, perCapita{key|'all'}}; per person = Σ money ÷ Σ population over the municipalities that have both
//   rankOf(list, m)          {rank, of} by € per person, 1 = the most; null when m has no figure
//   similarTo(list, m, n)    the n municipalities nearest in population (never m itself), smallest first
//   search(list, q)          {hits, via:'name'|'region'|null} (Cyrillic or Latin spelling, with or without „Община“; also the law's spelling lawName); null for an empty query
//   normQuery(q)             the folded form of a query
//   khilText(v, d, leva) · eurText(v, d, leva)   amounts with the visitor's „и в лева“ switch („… (≈ … лв.)“)
//   munName(m)               „Община Благоевград“ · „Столична община“
import { NBSP, DASH, num, khil, eur, EUR_RATE } from './format.js';
import { norm, lat } from './searchlib.js';

const ok = (v) => typeof v === 'number' && Number.isFinite(v);

/** the five kinds of transfer (ЗДБ чл. 51) in the order of the data; the sentences are simplified on purpose, the law has the exact rules.
 *  The first four are „основните“ (т. 1) and add up to transfers.total; „други целеви“ (т. 2) come on top and are not in the total. */
export const TYPES = [
  {
    key: 'delegated',
    label: 'Делегирани дейности',
    short: 'Делегирани',
    inTotal: true,
    text: 'Пари за дейности, които държавата е възложила на общината, например за училища, детски градини и социални услуги.',
  },
  {
    key: 'equalizing',
    label: 'Изравнителна субсидия',
    short: 'Изравнителна',
    inTotal: true,
    text: 'Помага на общините с по-малко собствени приходи да вършат местните си дейности.',
  },
  {
    key: 'winterRoads',
    label: 'Зимно поддържане и снегопочистване',
    short: 'Зимно поддържане',
    inTotal: true,
    text: 'Пари за снегопочистване и поддържане на общинските пътища през зимата.',
  },
  {
    key: 'capital',
    label: 'Капиталови разходи',
    short: 'Капиталови',
    inTotal: true,
    text: 'Пари за строеж и сериозен ремонт на неща, които траят дълго, например улици и сгради.',
  },
  {
    key: 'otherTargeted',
    label: 'Други целеви трансфери',
    short: 'Други целеви',
    inTotal: false,
    text: 'Целеви суми за конкретни местни дейности. Дават се отгоре и не са част от основните трансфери.',
  },
];
export const KEYS = ['total', ...TYPES.map((t) => t.key)];

/** inhabitants, or null when unknown (a zero is treated as unknown: no per-person figure from it) */
export const popOf = (m) => (ok(m?.population) && m.population > 0 ? m.population : null);
/** the main transfers of the municipality (the first four kinds), хил. € */
export const totalOf = (m) => (ok(m?.transfers?.total) ? m.transfers.total : null);
/** the main transfers plus the other targeted ones, хил. € (null when the file does not carry it) */
export const allOf = (m) => (ok(m?.transfers?.all) ? m.transfers.all : null);
/** € per person: the value the data carries, else the total over the population */
export function pcOf(m) {
  const given = m?.perCapita?.total;
  if (ok(given)) return given;
  const p = popOf(m),
    t = totalOf(m);
  return p && t !== null ? (t * 1000) / p : null;
}
/** € per person for one kind of transfer (the value the data carries, else computed; 'all' has no given value) */
export function pcType(m, key) {
  const given = m?.perCapita?.[key];
  if (ok(given)) return given;
  const p = popOf(m),
    v = m?.transfers?.[key];
  return p && ok(v) ? (v * 1000) / p : null;
}

/** sums and per-person values of a group of municipalities */
export function aggregate(list) {
  const a = { count: list.length, population: 0, popCount: 0, sum: {}, perCapita: {} };
  const pc = {},
    ks = [...KEYS, 'all'];
  for (const k of ks) {
    a.sum[k] = null;
    pc[k] = { money: 0, pop: 0 };
  }
  for (const m of list) {
    const p = popOf(m);
    if (p) {
      a.population += p;
      a.popCount += 1;
    }
    for (const k of ks) {
      const v = m?.transfers?.[k];
      if (!ok(v)) continue;
      a.sum[k] = (a.sum[k] ?? 0) + v;
      if (p) {
        pc[k].money += v;
        pc[k].pop += p;
      }
    }
  }
  for (const k of ks) a.perCapita[k] = pc[k].pop > 0 ? (pc[k].money * 1000) / pc[k].pop : null;
  if (!a.popCount) a.population = null;
  return a;
}

/** place of m among the list by € per person (1 = the most) */
export function rankOf(list, m) {
  const v = pcOf(m);
  if (v === null) return null;
  let above = 0,
    of = 0;
  for (const x of list) {
    const w = pcOf(x);
    if (w === null) continue;
    of += 1;
    if (w > v) above += 1;
  }
  return { rank: above + 1, of };
}

/** the n municipalities whose population is nearest to m's (by ratio, so 10 000 vs 12 000 counts like 100 000 vs 120 000); smallest first */
export function similarTo(list, m, n = 10) {
  const p = popOf(m);
  if (!p) return [];
  return list
    .filter((x) => x !== m && x?.id !== m?.id && popOf(x))
    .map((x) => [Math.abs(Math.log(popOf(x) / p)), x])
    .sort((a, b) => a[0] - b[0] || String(a[1].id).localeCompare(String(b[1].id)))
    .slice(0, n)
    .map((x) => x[1])
    .sort((a, b) => popOf(a) - popOf(b) || String(a.id).localeCompare(String(b.id)));
}

/* ------------------------------------------------------------------ search */
/** a query folded the way names are: lower case, no quotes or signs, no leading „община“ */
export const normQuery = (q) =>
  norm(String(q ?? '').slice(0, 80))
    .replace(/^(община|obshtina) /, '')
    .trim();

/** municipalities whose name matches (best first), else those of an oblast with that name; null for an empty query */
export function search(list, q) {
  const qn = normQuery(q);
  if (!qn) return null;
  const latin = /[a-z]/.test(qn);
  const key = (s) => (latin ? lat(norm(s)) : norm(s));
  const place = (s) => {
    const n = key(s);
    if (n === qn) return 0;
    if (n.startsWith(qn)) return 1;
    if (` ${n}`.includes(` ${qn}`)) return 2;
    return qn.length >= 3 && n.includes(qn) ? 3 : -1; // one or two letters match only at the start of a word
  };
  const bg = (a, b) => String(a).localeCompare(String(b), 'bg');
  // the name, and the spelling of the law when it differs („Добричка“, „Столична община“, „Бобовдол“)
  const rank = (m) =>
    [m?.name, m?.lawName].reduce((best, s) => {
      const r = s ? place(s) : -1;
      return r >= 0 && (best < 0 || r < best) ? r : best;
    }, -1);
  const byName = [];
  for (const m of list) {
    const r = rank(m);
    if (r >= 0) byName.push([r, m]);
  }
  if (byName.length) {
    byName.sort((a, b) => a[0] - b[0] || bg(a[1].name, b[1].name) || bg(a[1].id, b[1].id));
    return { hits: byName.map((x) => x[1]), via: 'name' };
  }
  const byRegion = list
    .filter((m) => place(m?.region) >= 0)
    .sort((a, b) => bg(a.name, b.name) || bg(a.id, b.id));
  return byRegion.length ? { hits: byRegion, via: 'region' } : { hits: [], via: null };
}

/* ------------------------------------------------------------------ text */
/** thousand euro, and with the „и в лева“ switch on the same amount in leva after it */
export function khilText(v, d = 1, leva = false) {
  if (!ok(v)) return DASH;
  return leva ? `${khil(v, d)} (≈${NBSP}${num(v * EUR_RATE, d)}${NBSP}хил.${NBSP}лв.)` : khil(v, d);
}
/** euro (per person), and with the switch on the same amount in leva */
export function eurText(v, d = 0, leva = false) {
  if (!ok(v)) return DASH;
  return leva ? `${eur(v, d)} (≈${NBSP}${num(v * EUR_RATE, d)}${NBSP}лв.)` : eur(v, d);
}
/** „Община Благоевград“; the capital is „Столична община“ */
export const munName = (m) => {
  const n = String(m?.name ?? '').trim();
  if (!n) return 'Община';
  return norm(n) === 'столична' ? 'Столична община' : `Община ${n}`;
};
