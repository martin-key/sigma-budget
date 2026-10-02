// Bulgarian number/date formats. Never returns NaN/undefined: non-finite input prints an em dash.
// Money is stored in million euro (core.json build.eurRate = 1.95583 leva per euro).
export const EUR_RATE = 1.95583;
export const NNBSP = '\u202f', NBSP = '\u00a0', MINUS = '\u2212', DASH = '\u2014';
const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const MONTHS_S = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
export const monthName = (m, short = false) => (short ? MONTHS_S : MONTHS)[m - 1] || DASH;
const ok = v => typeof v === 'number' && Number.isFinite(v);

/** 12803.8 -> "12 803,8" (group separator is a narrow no-break space) */
/** toFixed that rounds half up on the decimal representation (55,525 -> 55,53; plain toFixed gives 55,52) */
const fixed = (abs, d) => {
  const s = String(abs);
  if (!s.includes('e')) { const n = Number(`${Math.round(Number(`${s}e${d}`))}e-${d}`); if (Number.isFinite(n)) return n.toFixed(d); }
  return abs.toFixed(d);
};
export function num(v, d = 0, o = {}) {
  if (!ok(v)) return DASH;
  const f = fixed(Math.abs(v), d);
  const neg = v < 0 && Number(f) !== 0;
  let [i, fr] = f.split('.');
  if (o.group !== false) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return (neg ? MINUS : o.sign && Number(f) !== 0 ? '+' : '') + i + (fr ? ',' + fr : '');
}
/** 53.14 -> "53,1%"; pass {sign:true} for deltas */
export const pct = (v, d = 1, o = {}) => (ok(v) ? num(v, d, o) + '%' : DASH);
/** percentage points: "+10 пр. п." */
export const pp = (v, d = 1) => (ok(v) ? num(v, d, { sign: true }) + NBSP + 'пр.п.' : DASH);
/** signed percent change with a typographic minus: "+11,2%" */
export const delta = (v, d = 1) => pct(v, d, { sign: true });

/**
 * Money from million euro. scale: 'auto' (>=1000 -> млрд.), 'mln', 'mlrd', 'eur'.
 * money(26347.377) -> "26,35 млрд. €"; money(738.4) -> "738,4 млн. €"; money(26347.4,{leva:true}) -> "... ≈ 51,53 млрд. лв."
 */
export function money(mln, o = {}) {
  if (!ok(mln)) return DASH;
  const scale = o.scale || 'auto';
  const abs = Math.abs(mln);
  const useB = scale === 'mlrd' || (scale === 'auto' && abs >= 1000);
  const one = (m, cur) => {
    if (scale === 'eur') return num(m * 1e6, 0) + NBSP + cur;
    if (useB) return num(m / 1000, o.d ?? 2) + NBSP + 'млрд.' + NBSP + cur;
    return num(m, o.d ?? (abs >= 100 ? 1 : 2)) + NBSP + 'млн.' + NBSP + cur;
  };
  const e = one(mln, '€');
  return o.leva ? `${e} (≈${NBSP}${one(mln * EUR_RATE, 'лв.')})` : e;
}
/** number part and unit part separately (for big KPI numbers): {v:"26,35", u:"млрд. €"} */
export function moneyParts(mln, o = {}) {
  const s = money(mln, { ...o, leva: false });
  const i = s.indexOf(NBSP);
  return i < 0 ? { v: s, u: '' } : { v: s.slice(0, i), u: s.slice(i + 1) };
}
/** thousand euro (хил. €) as used by the budget law: "4 927 964,0 хил. €" */
export const khil = (v, d = 1) => (ok(v) ? num(v, d) + NBSP + 'хил.' + NBSP + '€' : DASH);
/** whole euro per person */
export const eur = (v, d = 0) => (ok(v) ? num(v, d) + NBSP + '€' : DASH);
export const leva = (v, d = 0) => (ok(v) ? num(v, d) + NBSP + 'лв.' : DASH);
/** per person: million euro and a population -> euro per person */
export const perPerson = (mln, persons) => (ok(mln) && ok(persons) && persons > 0 ? eur((mln * 1e6) / persons) : DASH);

/** ISO date -> "31.07.2026" | long: "31 юли 2026" */
export function date(iso, long = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return DASH;
  return long ? `${+m[3]}${NBSP}${MONTHS[+m[2] - 1]}${NBSP}${m[1]}` : `${m[3]}.${m[2]}.${m[1]}`;
}
export const monthYear = (y, m) => `${monthName(m)} ${y}`;
/** "1 проект / 2 проекта" */
export const plural = (n, one, many) => `${num(n, 0)} ${n === 1 ? one : many}`;
/** text for screen readers: spells the unit out, "26,35 милиарда евро" */
export function moneyLabel(mln) {
  if (!ok(mln)) return 'няма данни';
  const abs = Math.abs(mln), sign = mln < 0 ? 'минус ' : '';
  return abs >= 1000 ? `${sign}${num(abs / 1000, 2)} милиарда евро` : `${sign}${num(abs, 1)} милиона евро`;
}
/** parse "#/path?x=1&y=2" style query strings */
export const parseQuery = s => Object.fromEntries(new URLSearchParams(s || ''));
export const buildQuery = o => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v != null && v !== '') u.set(k, v); const s = u.toString(); return s ? '?' + s : ''; };
/** comparison arrow helpers */
export const arrow = v => (!ok(v) || v === 0 ? '→' : v > 0 ? '▲' : '▼');
/** quote a CSV cell */
export const csvCell = v => { const s = v == null ? '' : String(v); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
