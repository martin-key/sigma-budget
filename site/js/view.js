// Small pure helpers for pages (no DOM). Everything honours the viewer's preferences (store) and never returns NaN/undefined:
// a value that cannot be computed is null (numbers) or an em dash (strings).  See mock/DEV_GUIDE.md §5.22.
//   yIndex(years, ctx)                  index of the selected year in a `years` array (or {list:[…]}), -1 when absent
//   at(arr, years, ctx)                 arr[yIndex] ?? null
//   change(a, b)                        percent change from b to a, null when not computable
//   amount(ctx, {mln, pctGdp, d, scale})   text: „26,35 млрд. €“ | „36,9% от БВП“ | „8 645 € на човек“ (+ „(≈ … лв.)“)
//   amountParts(ctx, o)                 same as {v, u, lev} for big numbers (kpi uses it)
//   perCapita(ctx, mln)                 euro per person as text, from core.population.persons
//   periodStatus(ctx)                   'forecast' for 2027/2028, else 'real'
import { store } from './store.js';
import { data } from './data.js';
import { num, pct, money, moneyParts, perPerson, DASH, NBSP, EUR_RATE } from './format.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const listOf = years => (Array.isArray(years) ? years : Array.isArray(years?.list) ? years.list : null);
const coreOf = ctx => ctx?.core ?? data.get('core') ?? null;
const personsOf = ctx => { const p = coreOf(ctx)?.population?.persons; return ok(p) && p > 0 ? p : null; };

export function yIndex(years, ctx) {
  const list = listOf(years);
  const y = ctx?.period?.year ?? store.period.year;
  if (!list) return -1;
  return list.findIndex(v => Number(v) === y);
}
export function at(arr, years, ctx) {
  const i = yIndex(years, ctx);
  if (i < 0 || !Array.isArray(arr)) return null;
  const v = arr[i];
  return v === undefined ? null : v;
}
/** percent change from b to a (null when either is missing or b is zero) */
export function change(a, b) {
  if (!ok(a) || !ok(b) || b === 0) return null;
  const r = ((a - b) / Math.abs(b)) * 100;
  return Number.isFinite(r) ? r : null;
}
export function perCapita(ctx, mln) { return perPerson(mln, personsOf(ctx)); }
export const periodStatus = ctx => ((ctx?.period ?? store.period).vintage === 'forecast' ? 'forecast' : 'real');

/** the amount split into a number part and a unit part, honouring „Показвай в: % от БВП“, „на човек“ and „и в лева“ */
export function amountParts(ctx, o = {}) {
  const { mln, pctGdp, d, scale } = o;
  const unit = store.get('unit'), per = store.get('perPerson'), lv = store.get('leva');
  if (unit === 'pct' && ok(pctGdp)) return { v: pct(pctGdp, d ?? 1), u: 'от БВП', lev: '' };
  if (!ok(mln)) return { v: DASH, u: '', lev: '' };
  if (per) {
    const p = personsOf(ctx);
    if (p) {
      const e = (mln * 1e6) / p;
      return { v: num(e, d ?? 0), u: '€ на човек', lev: lv ? `≈${NBSP}${num(e * EUR_RATE, 0)}${NBSP}лв.` : '' };
    }
  }
  const { v, u } = moneyParts(mln, { scale, d });
  const m = lv ? /\((≈.*)\)$/.exec(money(mln, { scale, d, leva: true })) : null;
  return { v, u, lev: m ? m[1] : '' };
}
export function amount(ctx, o = {}) {
  const p = amountParts(ctx, o);
  if (p.v === DASH) return DASH;
  return `${p.v}${p.u ? NBSP + p.u : ''}${p.lev ? ` (${p.lev})` : ''}`;
}

/* ── added by G1 ── */
/** numbers for charts, honouring „Показвай в: % от БВП“ and „на човек“ (leva stays a text addendum, see amount(); charts ignore it).
 *  chartUnit(ctx, {pct: the caller can supply % of GDP values, max: largest |млн. €| that will be drawn, d: decimals override})
 *    → {kind: 'pct'|'person'|'mlrd'|'mln', unit, d, conv(mln, pctGdp) → number|null, fmt(v), axis(v), option(horizontal)}
 *  Use: const u = chartUnit(ctx, {pct: true, max}); chart({unit: u.unit, d: u.d, fmt: u.fmt, option: u.option(), series: [{data: mln.map((m, i) => u.conv(m, pg[i]))}]}) */
export function chartUnit(ctx, { pct: canPct = false, max = null, d = null, person = true } = {}) {
  const unit = store.get('unit'), per = person && store.get('perPerson');   // person:false = a series whose early years have no population (S07 COFOG history)
  let u;
  // conv() rounds away binary float noise (9,479299999999999 млрд. €) that the CSV export of a chart's table twin would otherwise print
  const tidy = (x, k) => Math.round(x * 10 ** k) / 10 ** k;
  if (unit === 'pct' && canPct) u = { kind: 'pct', unit: '% от БВП', d: 1, conv: (mln, pg) => (ok(pg) ? tidy(pg, 4) : null) };
  else {
    const p = per ? personsOf(ctx) : null;
    if (p) u = { kind: 'person', unit: '€ на човек', d: 0, conv: mln => (ok(mln) ? tidy((mln * 1e6) / p, 2) : null) };
    else if (ok(max) && Math.abs(max) >= 1000) u = { kind: 'mlrd', unit: 'млрд. €', d: 2, conv: mln => (ok(mln) ? tidy(mln / 1000, 5) : null) };
    else u = { kind: 'mln', unit: 'млн. €', d: ok(max) && Math.abs(max) < 100 ? 1 : 0, conv: mln => (ok(mln) ? tidy(mln, 3) : null) };
  }
  if (d != null) u.d = d;
  u.fmt = v => (ok(v) ? num(v, u.d) : DASH);
  // axis ticks: as few decimals as the tick needs (2,5 not 2,50), never more than two
  u.axis = v => { if (!ok(v)) return DASH; for (let k = 0; k < 3; k++) if (Math.abs(v - Number(v.toFixed(k))) < 1e-9) return num(v, k); return num(v, 2); };
  u.option = (horizontal = false) => ({ [horizontal ? 'xAxis' : 'yAxis']: { axisLabel: { formatter: u.axis } } });
  return u;
}

/** a money column of a table whose data is in млн. €: the bare number under a header unit, honouring „на човек“ and „и в лева“ like amount() does.
 *  moneyCol(ctx, {d = 1}) → {unit: 'млн. €' | '€ на човек', d, raw(mln) → number|null, text(mln) → '12 803,8' | '—', lev(mln) → '≈ 25 040,2 млн. лв.' | ''}
 *  Use: const m = moneyCol(ctx); column {key:'v', label:'Приходи', unit:m.unit, d:m.d, fmt:(v, row) => html`${m.text(row.mln)}…`}; row {mln, v:m.raw(mln)}.
 *  The raw value is the displayed value, so sorting and the CSV export agree with the screen. */
export function moneyCol(ctx, { d = 1, person = true } = {}) {
  const p = person && store.get('perPerson') ? personsOf(ctx) : null, lv = store.get('leva');
  const dd = p ? 0 : d;
  const raw = mln => (ok(mln) ? (p ? (mln * 1e6) / p : mln) : null);
  return {
    unit: p ? '€ на човек' : 'млн. €', d: dd, raw,
    text: mln => { const v = raw(mln); return v == null ? DASH : num(v, dd); },
    lev: mln => { const v = raw(mln); return lv && v != null ? `≈${NBSP}${num(v * EUR_RATE, dd)}${NBSP}${p ? 'лв.' : 'млн. лв.'}` : ''; }
  };
}
