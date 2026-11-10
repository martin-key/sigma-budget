/** Independent search reference for the SEARCH validator, translated from search_feed.py. */
import {
  asciiDigits,
  codepointCompare,
  digitClass,
  fold,
  isLetterNumber,
  spaceClass,
  trim,
} from './search-unicode.js';
import { pyRepr } from './checks.js';

const pyString = (v: unknown): string => {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return typeof v === 'object' ? pyRepr(v) : String(v);
};
export const GROUPS = [
  'indicators',
  'institutions',
  'municipalities',
  'measures',
  'terms',
  'datasets',
];
export const FIELDS = ['g', 'title', 'sub', 'value', 'period', 'status', 'href', 'kw'];
const weights: Record<string, number> = {
  indicators: 2.5,
  institutions: 2.5,
  municipalities: 1,
  measures: 1.2,
  terms: 1.5,
  screens: 1.8,
  datasets: 0.6,
};
const labels: Record<string, string> = {
  indicators: 'Показатели',
  institutions: 'Институции',
  municipalities: 'Общини',
  measures: 'Мерки',
  terms: 'Понятия',
  datasets: 'Данни',
  screens: 'Екрани',
};
const transliteration = Object.fromEntries(
  [...'абвгдежзийклмнопрстуфхцчшщъьюя'].map((c, i) => [
    c,
    [
      'a',
      'b',
      'v',
      'g',
      'd',
      'e',
      'zh',
      'z',
      'i',
      'y',
      'k',
      'l',
      'm',
      'n',
      'o',
      'p',
      'r',
      's',
      't',
      'u',
      'f',
      'h',
      'ts',
      'ch',
      'sh',
      'sht',
      'a',
      'y',
      'yu',
      'ya',
    ][i]!,
  ]),
);
const quotes = `„“”"«»'’\``;
export function norm(value: unknown): string {
  const source = fold(String(value ?? ''));
  let result = '',
    gap = false;
  for (const ch of source) {
    if ((ch >= '\u0300' && ch <= '\u036f') || quotes.includes(ch)) continue;
    if (ch === '%' || isLetterNumber(ch)) {
      result += ch;
      gap = false;
    } else if (!gap) {
      result += ' ';
      gap = true;
    }
  }
  return trim(result);
}
export function lat(value: string): string {
  return Array.from(value, (ch) => transliteration[ch] ?? ch).join('');
}
const synonymRaw = [
  ['ддс', 'данък добавена стойност', 'данък върху добавената стойност'],
  ['дълг', 'задлъжнялост', 'задлъжняване'],
  ['мвр', 'вътрешните работи', 'полиция', 'вътрешен ред'],
  ['мвнр', 'външните работи'],
  ['мон', 'образованието и науката'],
  ['мз', 'здравеопазването'],
  ['мф', 'финансите'],
  ['мо', 'отбраната', 'армия'],
  ['мтсп', 'труда и социалната политика'],
  ['мррб', 'регионалното развитие'],
  ['мзх', 'земеделието и храните'],
  ['мтс', 'транспорта и съобщенията'],
  ['мосв', 'околната среда и водите'],
  ['нои', 'доо', 'обществено осигуряване', 'общественото осигуряване'],
  ['нзок', 'здравна каса', 'здравноосигурителна каса'],
  ['бвп', 'брутен вътрешен продукт'],
  ['кфп', 'консолидирана фискална програма', 'консолидираната фискална програма'],
  ['дфл', 'данък общ доход', 'данък върху доходите'],
  ['пенсии', 'пенсия', 'пенсионно'],
  ['заплати', 'заплата', 'възнаграждения', 'персонал'],
  ['еврофондове', 'европейски средства', 'средства от ес'],
  ['болници', 'здравеопазване'],
  ['училища', 'образование'],
  ['дефицит', 'салдо'],
  ['мерки', 'мярка'],
  ['данък', 'данъци', 'данъчни'],
  ['осигуровки', 'осигуровка', 'вноски'],
  ['ес', 'европейски съюз', 'евросъюз'],
];
const syn = synonymRaw.map((g) => g.map(norm)),
  synLat = syn.map((g) => g.map(lat));
const stop = new Set(
  'и в във на за от по с със към до при да се е са ли как колко кой коя кое кои какво къде'.split(
    ' ',
  ),
);
const length = (s: string) => Array.from(s).length;
export function stem(t: string): string {
  if (length(t) < 5 || /[a-z]/.test(t)) return t;
  const s = t.replace(/(ите|ата|ята|ото|ето|ът|ят|та|то|те)$/, '');
  return length(s) >= 5 ? s.replace(/[аяиеоуъ]$/, '') : s;
}
export interface Token {
  t: string;
  lat: boolean;
  alts: string[];
}
export interface Tokens {
  words: Token[];
  phrase: string | null;
}
export function parse(raw: unknown): Tokens {
  let q = ` ${norm(
    Array.from(String(raw ?? ''))
      .slice(0, 120)
      .join(''),
  )} `;
  for (const g of syn)
    for (const m of g)
      if (m.includes(' ') && q.includes(` ${m} `)) q = q.replace(` ${m} `, ` ${g[0]} `);
  let toks = q.trim().split(' ').filter(Boolean);
  if (toks.some((t) => !stop.has(t))) toks = toks.filter((t) => !stop.has(t));
  if (toks.every((t) => length(t) < 2)) return { words: [], phrase: null };
  const words = toks.slice(0, 8).map((t) => {
    const isLat = /[a-z]/.test(t),
      st = stem(t),
      alts = new Set([t, st]);
    for (const g of isLat ? synLat : syn)
      if (
        g.some((m) =>
          [t, st].some((x) => m === x || (length(x) >= 4 && !m.includes(' ') && m.startsWith(x))),
        )
      )
        for (const m of g) alts.add(m);
    return { t, lat: isLat, alts: [...alts].sort(codepointCompare) };
  });
  return { words, phrase: words.length > 1 ? words.map((k) => k.t).join(' ') : null };
}
export interface Entry {
  group: string;
  title: string;
  status: string;
  href: string;
  w: number;
  nn: string;
  t: string;
  nl: string;
  tl: string;
  mag: number;
}
export function mag(value: unknown): number {
  const m = new RegExp(
    `(${digitClass}(?:${digitClass}|${spaceClass})*(?:,${digitClass}+)?)${spaceClass}*(млрд|млн|хил)`,
    'u',
  ).exec(String(value ?? ''));
  return m
    ? Number(asciiDigits(m[1]!.replace(new RegExp(spaceClass, 'gu'), '')).replace(',', '.')) *
        ({ млрд: 1000, млн: 1, хил: 0.001 } as Record<string, number>)[m[2]!]!
    : 0;
}
export function entry(
  group: string,
  title: string,
  sub = '',
  kw = '',
  period = '',
  value = '',
  status = 'real',
  href = '',
): Entry {
  title = pyString(title);
  const nn = norm(title),
    t = norm(`${title} ${sub || ''} ${kw || ''} ${period || ''} ${labels[group] ?? 'Друго'}`);
  return {
    group,
    title,
    status: ['real', 'mock', 'pending'].includes(status) ? status : 'real',
    href,
    w: weights[group] ?? 1,
    nn,
    t,
    nl: lat(nn),
    tl: lat(t),
    mag: mag(value),
  };
}
export function tokScore(e: Entry, k: Token): number {
  const nn = k.lat ? e.nl : e.nn,
    t = k.lat ? e.tl : e.t;
  let best = 0;
  for (const a of k.alts) {
    const short = length(a) <= 3;
    let s =
      nn === a
        ? 10
        : ` ${nn} `.includes(` ${a} `)
          ? 7
          : ` ${nn}`.includes(` ${a}`)
            ? 6
            : !short && nn.includes(a)
              ? 3
              : ` ${t}`.includes(` ${a}`)
                ? 2
                : !short && t.includes(a)
                  ? 1
                  : 0;
    if (s && a !== k.t) s -= 0.5;
    best = Math.max(best, s);
  }
  return best;
}
export function osa(a: string, b: string, mx: number): number {
  const aa = Array.from(a),
    bb = Array.from(b),
    la = aa.length,
    lb = bb.length;
  if (Math.abs(la - lb) > mx) return mx + 1;
  let prev2: number[] = [],
    prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= lb; j++) {
      let v = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (aa[i - 1] === bb[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && aa[i - 1] === bb[j - 2] && aa[i - 2] === bb[j - 1])
        v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      low = Math.min(low, v);
    }
    if (low > mx) return mx + 1;
    prev2 = prev;
    prev = cur;
  }
  return Math.min(prev[lb]!, mx + 1);
}
export function near(e: Entry, k: Token): number {
  const t = k.t,
    len = length(t),
    mx = len >= 8 ? 2 : len >= 4 ? 1 : 0;
  if (!mx) return 0;
  const dist = (s: string) =>
    s
      .split(' ')
      .reduce(
        (d, w) =>
          length(w) < 3
            ? d
            : Math.min(
                d,
                osa(t, w, mx),
                length(w) > len ? osa(t, Array.from(w).slice(0, len).join(''), mx) : mx + 1,
              ),
        mx + 1,
      );
  const name = dist(k.lat ? e.nl : e.nn),
    text = dist(k.lat ? e.tl : e.t);
  return name <= mx ? 4.5 - name * 0.5 : text <= mx ? 2 - (text - 1) * 0.5 : 0;
}
export function score(e: Entry, toks: Tokens, fuzzy: boolean): number {
  let total = 0,
    inName = true;
  for (const k of toks.words) {
    const best = tokScore(e, k) || (fuzzy ? near(e, k) : 0);
    if (!best) return 0;
    if (best < 3) inName = false;
    total += best;
  }
  if (toks.phrase) {
    const p = ` ${toks.phrase} `,
      has = (s: string) => ` ${s} `.includes(p);
    total += has(e.nn) || has(e.nl) ? 2 : has(e.t) || has(e.tl) ? 1 : 0;
  }
  return (
    Math.floor((total + e.w - (inName ? Math.min(1.5, length(e.title) / 80) : 0)) * 100 + 0.5) / 100
  );
}
export function run(
  entries: Entry[],
  toks: Tokens,
  onlyReal = false,
): { hits: Entry[]; hidden: number; fuzzy: boolean } {
  const pass = (fuzzy: boolean) => {
    const out: { e: Entry; s: number }[] = [];
    let hidden = 0;
    for (const e of entries) {
      const s = score(e, toks, fuzzy);
      if (s <= 0) continue;
      if (onlyReal && e.status === 'mock') {
        hidden++;
        continue;
      }
      out.push({ e, s });
    }
    out.sort(
      (a, b) =>
        b.s - a.s || b.e.w - a.e.w || b.e.mag - a.e.mag || length(a.e.title) - length(b.e.title),
    );
    return { hits: out.map((x) => x.e), hidden };
  };
  if (!toks.words.length) return { hits: [], hidden: 0, fuzzy: false };
  let result = pass(false),
    fuzzy = false;
  if (!result.hits.length && !result.hidden) {
    result = pass(true);
    fuzzy = !!result.hits.length || result.hidden > 0;
  }
  return { ...result, fuzzy };
}
