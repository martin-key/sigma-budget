// S15 Изпълнява ли се планът? (G3). Monthly budget execution (KFP, national budget, EU funds) against the plan and the pace of the previous year.
// Every number is computed from execution.json (D06/D16/D26) and components.json (D07); nothing is typed from memory.
// Tabs are real routes: #/izpalnenie (Общо), /pera (По пера), /byudzheti (Бюджети), /sravnenie (Сравнение на години).
// Controls live in the query: ?mesec= ?obhvat= ?ed= ?prag=, and on /sravnenie ?g1= ?g2= (the two years) ?pok= ?rez= (the monthly block).
import { html } from '../html.js';
import { num, pct, pp, delta, date, monthName, EUR_RATE, NBSP, DASH } from '../format.js';
import { block } from '../ui/block.js';
import { seg } from '../ui/seg.js';
import { field, selectInput } from '../ui/forms.js';
import { chips } from '../ui/chips.js';
import { dataTable } from '../ui/table.js';
import { chart } from '../ui/chart.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { sankey } from '../ui/sankey.js';
import { emptyState, pendingState } from '../ui/states.js';
import { callout } from '../ui/cards.js';
import { gl } from '../ui/gl.js';
import { disclosure } from '../ui/disclosure.js';
import { amount, moneyCol, chartUnit } from '../view.js';

const SCOPES = [['kfp', 'КФП'], ['nat', 'Национален бюджет'], ['eu', 'Средства от ЕС']];
const SCOPE_IN = { kfp: 'в КФП', nat: 'в националния бюджет', eu: 'по средствата от ЕС' };
const THRESHOLDS = [10, 15];
const QUERY_KEYS = ['mesec', 'obhvat', 'ed', 'prag', 'g1', 'g2', 'pok', 'rez'];
const REV_ROWS = ['rev.tax', 'rev.nontax', 'rev.grants'];
const EXP_ROWS = ['exp.personnel', 'exp.maint', 'exp.interest', 'exp.social', 'exp.subsidies', 'exp.capex', 'exp.abroad', 'exp.reserve'];
const EARLIEST_REPORT = 2022;      // core.pending P05: the monthly reports from this year up to the first year in the file are still to come

/* ------------------------------------------------------------------ small helpers */
const fin = v => typeof v === 'number' && Number.isFinite(v);
const r1 = v => Math.round(v * 10 + 1e-9) / 10;
const ratio = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b) * 100 : null);
const mlrd = v => (fin(v) ? v / 1000 : null);
const isoLast = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const lastOf = arr => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);

/** the visitor's own keys of the query, for links that must keep the controls */
export function keepQuery(ctx, over = {}) {
  const out = {};
  for (const k of QUERY_KEYS) if (ctx.query && ctx.query[k]) out[k] = ctx.query[k];
  return { ...out, ...over };
}

/* ------------------------------------------------------------------ the model: everything the views print, derived once */
export function model(ctx) {
  const ex = ctx.data.execution;
  const q = ctx.query || {};
  // the report years in the file (2024, 2025, 2026 …); the period picks one, anything else shows the latest year
  const years = Object.keys(ex.data || {}).map(Number).filter(fin).sort((a, b) => a - b);
  const lastY = years[years.length - 1];
  const asked = ctx.period ? ctx.period.year : null;
  const Y = years.includes(asked) ? asked : lastY;
  const cur = ex.data[String(Y)];
  // the year before is the comparison when the file has it (2026 → 2025, 2025 → 2024; none for the first year)
  const PY = ex.data[String(Y - 1)] ? Y - 1 : null;
  const prevB = PY ? ex.data[String(PY)] : null;
  // only a year with a plan in the file (plan2026) gets the share of the plan, the pace and the flags
  const planB = ex['plan' + Y] && typeof ex['plan' + Y] === 'object' ? ex['plan' + Y] : null;
  const planned = !!planB;
  const last = cur.months;
  const scope = SCOPES.some(s => s[0] === q.obhvat) ? q.obhvat : 'kfp';
  const want = Math.floor(Number(q.mesec));
  const month = fin(want) && want >= 1 ? Math.min(want, 12) : last;
  const notYet = month > last;
  const m = notYet ? last : month;
  const unit = planned && q.ed === 'pct' ? 'pct' : 'eur';
  const thr = Number(q.prag) === 15 ? 15 : 10;
  const sub = ctx.params && ctx.params.sub;
  const tab = sub === 'pera' ? 'pera' : sub === 'byudzheti' ? 'byudzheti' : sub === 'sravnenie' ? 'sravnenie' : 'obsho';
  const cumArr = (yr, row, sc = scope) => (ex.data[String(yr)] && ex.data[String(yr)][sc] && ex.data[String(yr)][sc][row]) || null;
  const monArr = (yr, row, sc = scope) => (ex.monthly && ex.monthly[String(yr)] && ex.monthly[String(yr)][sc] && ex.monthly[String(yr)][sc][row]) || null;
  const planOf = (row, sc = scope) => { const v = planB && planB[sc] ? planB[sc][row] : null; return fin(v) ? v : null; };
  const at = (arr, i) => (Array.isArray(arr) && fin(arr[i]) ? arr[i] : null);
  // share of the previous year's result reached by each month: the file's own pace for the KFP rows (none for rows it does not list, so tiny lines are never flagged), computed for the other scopes
  const paceArr = (row, sc = scope) => {
    if (!PY) return null;
    const own = ex.pace && ex.pace[String(PY)] ? ex.pace[String(PY)][row] : null;
    if (sc === 'kfp') return Array.isArray(own) && own.length === 12 ? own : null;
    const a = cumArr(PY, row, sc);
    const full = lastOf(a);
    return a && a.length === 12 && fin(full) && full > 0 ? a.map(v => (v / full) * 100) : null;
  };
  const rowName = id => { const r = (ex.rows || []).find(x => x.id === id); return r ? r.short || r.label : id; };
  const asOfAt = i => (cur.asOf && cur.asOf[i]) || null;
  // one line of the picture for a row at the chosen month
  const item = row => {
    const c = at(cumArr(Y, row), m - 1);
    const p = planOf(row);
    const pc = ratio(c, p);
    const pv = prevB ? at(cumArr(PY, row), m - 1) : null;
    const pa = planned ? paceArr(row) : null;
    const pcs = pa ? at(pa, m - 1) : null;
    const diff = fin(pc) && fin(pcs) ? r1(r1(pc) - r1(pcs)) : null;
    const flag = scope === 'kfp' && diff != null ? (diff <= -thr + 1e-9 ? 'down' : diff >= thr - 1e-9 ? 'up' : 'none') : null;
    const fullY = !planned && last === 12 ? lastOf(cumArr(Y, row)) : null;
    // a change in % and a share of the year only on a positive base (a line that is negative for part of the year, like the state reserve, gets „—“)
    return { row, name: rowName(row), c, p, pc, pv, yoy: fin(pv) && pv > 0 && fin(c) && c >= 0 ? (c / pv - 1) * 100 : null, pace: pcs, diff, flag, shareOfYear: !planned && fin(fullY) && fullY > 0 && fin(c) && c >= 0 ? ratio(c, fullY) : null };
  };
  const M = { ctx, ex, years, lastY, Y, PY, planned, cur, last, scope, month, notYet, m, unit, thr, tab, cumArr, monArr, planOf, at, paceArr, rowName, item, asOf: asOfAt(m - 1) || ex.meta.asOf };
  M.k = { rev: item('rev'), exp: item('exp.total'), bal: item('balance') };
  return M;
}

/* ------------------------------------------------------------------ words */
const SCOPE_NAME = { kfp: 'КФП', nat: 'национален бюджет', eu: 'средства от ЕС' };

export function summaryText(M) {
  const { rev, exp, bal } = M.k;
  if (!fin(rev.c) || !fin(exp.c)) return '';
  const amt = v => amount(M.ctx, { mln: v });
  const s1 = `Към ${date(M.asOf)} г. ${SCOPE_IN[M.scope]} са събрани ${amt(rev.c)}${fin(rev.pc) ? ` (${pct(rev.pc)} от годишния план)` : ''}.`;
  const s2 = `Похарчени са ${amt(exp.c)}${fin(exp.pc) ? ` (${pct(exp.pc)})` : ''}.`;
  const s3 = !fin(bal.c) ? '' : bal.c < 0 ? `Дефицитът е ${amt(-bal.c)}.` : bal.c > 0 ? `Излишъкът е ${amt(bal.c)}.` : 'Салдото е нула.';
  return [s1, s2, s3].filter(Boolean).join(' ');
}

/** the note about the rhythm: a lower share of the plan is not the same as slower spending when the plan itself is bigger */
export function rhythmFacts(M) {
  if (!M.planned || !M.PY || M.scope !== 'kfp') return null;
  const e = M.k.exp;
  const fullPrev = lastOf(M.cumArr(M.PY, 'exp.total'));
  const planGrowth = fin(e.p) && fin(fullPrev) && fullPrev > 0 ? (e.p / fullPrev - 1) * 100 : null;
  const pace = e.pace;
  if (!fin(e.pc) || !fin(pace) || !fin(planGrowth) || !fin(e.yoy)) return null;
  return { py: M.PY, share: e.pc, pace, planGrowth, yoy: e.yoy, lower: r1(e.pc) < r1(pace), moreMoney: e.yoy > 0 && planGrowth > 0 };
}

function chartNames(M, which) {
  const inPct = M.unit === 'pct';
  return {
    cur: inPct ? `${M.Y}: дял от плана` : String(M.Y),
    prev: inPct ? `${M.PY}: дял от резултата за годината` : `${M.PY}${M.ex.data[String(M.PY)] && M.ex.data[String(M.PY)].converted ? ' (в евро)' : ''}`,
    plan: inPct ? 'План (100%)' : `Годишен план ${M.Y}`,
    verb: which === 'rev' ? 'събрани' : 'похарчени',
  };
}

/* ------------------------------------------------------------------ chart specs (also used by the embeds) */
const MONTH_CATS = Array.from({ length: 12 }, (_, i) => monthName(i + 1, true));

export function cumChartSpec(M, which) {
  const row = which === 'rev' ? 'rev' : 'exp.total';
  const label = which === 'rev' ? 'приходи' : 'разходи';
  const inPct = M.unit === 'pct';
  const cur = M.cumArr(M.Y, row);
  const plan = M.planOf(row);
  const prev = M.PY ? M.cumArr(M.PY, row) : null;
  const names = chartNames(M, which);
  const conv = v => (!fin(v) ? null : inPct ? ratio(v, plan) : v / 1000);
  const series = [{ name: names.cur, data: Array.from({ length: 12 }, (_, i) => (i < M.m ? conv(M.at(cur, i)) : null)), color: which === 'rev' ? '--rev' : '--exp' }];
  if (prev) {
    const pa = inPct ? M.paceArr(row) : null;
    series.push({ name: names.prev, dashed: true, color: 'other', data: Array.from({ length: 12 }, (_, i) => (inPct ? M.at(pa, i) : conv(M.at(prev, i)))) });
  }
  if (fin(plan)) series.push({ name: names.plan, color: '--series-other-2', data: Array.from({ length: 12 }, () => (inPct ? 100 : plan / 1000)) });
  const it = M.k[which];
  const desc = inPct
    ? `Към ${monthName(M.m)} са ${names.verb} ${pct(it.pc)} от годишния план; по същото време на ${M.PY} г. е бил достигнат ${pct(it.pace)} от резултата за годината.`
    : `Натрупаните ${label} към ${monthName(M.m)} са ${num(mlrd(it.c), 2)} млрд. €${fin(plan) ? `, при годишен план ${num(plan / 1000, 2)} млрд. €` : ''}.`;
  const spec = {
    id: `s15-cum-${which}`, type: 'line', title: `Натрупани ${label} през ${M.Y} г.`, categoryLabel: 'Месец', categories: MONTH_CATS, series, desc,
    sub: inPct ? `% от годишния план, ${SCOPE_NAME[M.scope]}` : `млрд. €, ${SCOPE_NAME[M.scope]}, от началото на ${M.Y} г.`,
    unit: inPct ? '%' : 'млрд. €', d: inPct ? 1 : 2, min: 0,
  };
  if (inPct) spec.fmt = v => pct(v, 1);
  return spec;
}

export function monthlyChartSpec(M) {
  const n = M.m;
  const cut = a => (a || []).slice(0, n).map(mlrd);
  const rev = M.monArr(M.Y, 'rev'), exp = M.monArr(M.Y, 'exp.total');
  const top = (exp || []).slice(0, n).reduce((b, v, i) => (fin(v) && (b < 0 || v > exp[b]) ? i : b), -1);
  return {
    id: 's15-monthly', type: 'bar', title: 'Приходи и разходи по месеци', categoryLabel: 'Месец', categories: MONTH_CATS.slice(0, n),
    sub: `млрд. €, ${SCOPE_NAME[M.scope]}, ${M.Y} г. (месечни стойности, не натрупани)`, unit: 'млрд. €', d: 2,
    series: [{ name: 'Приходи', data: cut(rev), color: '--rev' }, { name: 'Разходи (с вноската в ЕС)', data: cut(exp), color: '--exp' }],
    desc: top >= 0 ? `Най-големите месечни разходи са през ${monthName(top + 1)}: ${num(mlrd(exp[top]), 2)} млрд. €.` : 'Месечните приходи и разходи.',
  };
}

export function balanceChartSpec(M) {
  const n = M.m;
  const cut = a => (a || []).slice(0, n).map(mlrd);
  const bal = M.monArr(M.Y, 'balance');
  const prev = M.PY ? M.monArr(M.PY, 'balance') : null;
  const worst = (bal || []).slice(0, n).reduce((b, v, i) => (fin(v) && (b < 0 || v < bal[b]) ? i : b), -1);
  const series = [{ name: String(M.Y), data: cut(bal), color: 1 }];
  if (prev) series.push({ name: chartNames(M, 'rev').prev, data: cut(prev), color: 'other' });
  return {
    id: 's15-balance', type: 'bar', title: 'Салдо по месеци', categoryLabel: 'Месец', categories: MONTH_CATS.slice(0, n),
    sub: `млрд. €, ${SCOPE_NAME[M.scope]} (под нулата е дефицит)`, unit: 'млрд. €', d: 2, series,
    desc: worst >= 0 && bal[worst] < 0 ? `Най-големият месечен дефицит е през ${monthName(worst + 1)}: ${num(-mlrd(bal[worst]), 2)} млрд. €.` : 'Месечното салдо.',
  };
}

/* ------------------------------------------------------------------ controls, tabs, the frame for a month without a report */
const cap1 = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sourcesOf = M => (M.planned ? ['kfp', 'asbp'] : ['kfp']);

function monthOptions(M) {
  const out = [];
  for (let i = 1; i <= M.last; i++) out.push({ value: String(i), label: `${cap1(monthName(i))} ${M.Y}` });
  if (M.Y === M.lastY) {
    const later = new Set((M.ex.pendingMonths || []).map(p => p.month).filter(x => fin(x) && x > M.last));
    if (M.notYet) later.add(M.month);
    [...later].sort((a, b) => a - b).forEach(i => out.push({ value: String(i), label: `${cap1(monthName(i))} ${M.Y} (предстои)` }));
  }
  return out;
}

const ctl = (label, id, inner) => html`<div class="field s15-ctl"><span class="field-label" id="${id}">${label}</span>${inner}</div>`;

export function controls(M) {
  const parts = [field({ id: 's15-mesec', label: 'Месец', control: selectInput({ id: 's15-mesec', name: 'mesec', value: String(M.month), options: monthOptions(M), query: 'mesec' }) })];
  if (M.tab !== 'byudzheti') {
    parts.push(ctl('Обхват', 's15-obhvat-l', seg({ name: 's15-obhvat', label: 'Обхват', value: M.scope, query: 'obhvat', cls: 's15-seg', options: SCOPES.map(([value, label]) => ({ value, label })) })));
  }
  if (M.tab === 'obsho' && M.planned) {
    parts.push(ctl('Мерна единица', 's15-ed-l', seg({ name: 's15-ed', label: 'Мерна единица на графиките', value: M.unit, query: 'ed', cls: 's15-seg', options: [{ value: 'eur', label: 'млрд. €' }, { value: 'pct', label: '% от плана' }] })));
  }
  if (M.tab === 'pera' && M.planned && M.PY && M.scope === 'kfp') {
    parts.push(ctl('Праг за отбелязване', 's15-prag-l', seg({ name: 's15-prag', label: 'Праг за отбелязване в пункта', value: String(M.thr), query: 'prag', cls: 's15-seg', options: THRESHOLDS.map(v => ({ value: String(v), label: `${v}${NBSP}пр.п.` })) })));
  }
  return html`<div class="s15-controls" role="group" aria-label="Какво да покажем">${parts}</div>`;
}

export function tabNav(M) {
  const ctx = M.ctx;
  const q = keepQuery(ctx);
  const item = (sub, label) => ({ label, href: ctx.href('S15', sub ? { sub } : {}, q), pressed: M.tab === (sub || 'obsho') });
  return html`<nav class="s15-tabs" aria-label="Раздели на екрана">${chips({ items: [item(null, 'Общо'), item('pera', 'По пера'), item('byudzheti', 'Бюджети'), item('sravnenie', 'Сравнение на години')] })}</nav>`;
}

/** the month the visitor asked for has no report yet (the month after the last report) */
export function notYetFrame(M) {
  const ctx = M.ctx;
  const pend = (M.ex.pendingMonths || []).find(p => p.month === M.month);
  const when = pend && pend.asOf ? pend.asOf : isoLast(M.Y, M.month);
  const lastIso = (M.cur.asOf && M.cur.asOf[M.last - 1]) || M.ex.meta.asOf;
  const back = ctx.href('S15', M.tab === 'obsho' ? {} : { sub: M.tab }, keepQuery(ctx, { mesec: null }));
  return pendingState({
    id: 'P04', title: `Отчетът към ${date(when)} г. се очаква`,
    text: `Не показваме числа за месец, за който още няма отчет. Най-новите данни са към ${date(lastIso)} г.`,
    reason: 'Месечните отчети се добавят към портала, след като бъдат публикувани от Министерството на финансите.',
    action: { href: back, label: `Към ${monthName(M.last)} ${M.Y}` }
  });
}

/* ------------------------------------------------------------------ Общо: накратко, обяснение на ритъма, графиките */
export function kpisBlock(M) {
  const { rev, exp, bal } = M.k;
  const planned = M.planned;
  const vs = M.PY ? `спрямо същото време на ${M.PY} г.` : '';
  const dl = it => (M.PY && fin(it.yoy) ? { value: it.yoy, unit: '%', d: 1, label: vs } : undefined);
  const ofPlan = it => (planned && fin(it.pc) ? `${pct(it.pc, 1)} от годишния план` : undefined);
  const kind = !fin(bal.c) ? 'Салдо' : bal.c < 0 ? 'Дефицит' : bal.c > 0 ? 'Излишък' : 'Салдо';
  const same = (a, b) => fin(a) && fin(b) && a !== 0 && b !== 0 && Math.sign(a) === Math.sign(b);
  const balShare = planned && same(bal.c, bal.p) ? ratio(bal.c, bal.p) : null;
  const balDelta = M.PY && same(bal.c, bal.pv) ? (bal.c / bal.pv - 1) * 100 : null;
  const planWord = fin(bal.p) && bal.p > 0 ? 'планирания излишък' : 'планирания дефицит';
  const items = [
    kpi({ label: 'Събрани приходи', mln: rev.c, delta: dl(rev), sub: ofPlan(rev) }),
    kpi({ label: 'Похарчени разходи', mln: exp.c, delta: dl(exp), sub: ofPlan(exp) }),
    kpi({ label: kind, mln: fin(bal.c) ? Math.abs(bal.c) : null, delta: fin(balDelta) ? { value: balDelta, unit: '%', d: 1, label: vs } : undefined, sub: fin(balShare) ? `${pct(balShare, 1)} от ${planWord} за годината` : undefined }),
  ];
  return block({
    id: 's15-kpi', level: 2, title: `Накратко към ${date(M.asOf)} г.`, scope: M.scope, source: sourcesOf(M), asOf: M.asOf,
    sub: planned ? 'Числата са натрупани от началото на годината.' : `Числата са натрупани от началото на годината; за ${M.Y} г. няма годишен план за сравнение.`,
    share: { text: summaryText(M) },
    body: kpiGrid(items, { label: 'Основни числа' }),
  });
}

export function rhythmCallout(M) {
  const f = rhythmFacts(M);
  if (!f) return '';
  const body = html`
    <p>Към ${monthName(M.m)} са изразходвани ${pct(f.share, 1)} от годишния план. По същото време на ${f.py} г. вече са били изразходвани ${pct(f.pace, 1)} от разходите за цялата година.</p>
    <p>Приходите и разходите не се разпределят равномерно по месеци (${gl('sezonnost', 'сезонност')}). Затова сравняваме не с „една дванайсета на месец“, а с дела, достигнат по същото време на ${f.py} г.</p>
    <p>Планът за разходите през ${M.Y} г. е с ${num(f.planGrowth, 1)}% по-голям от реалните разходи през цялата ${f.py} г. Към ${monthName(M.m)} са похарчени с ${num(f.yoy, 1)}% ${f.yoy >= 0 ? 'повече' : 'по-малко'} пари, отколкото към ${monthName(M.m)} ${f.py} г.${f.lower && f.moreMoney ? ' Затова по-малкият дял от плана не е същото като по-малко похарчени пари.' : ''}</p>`;
  return callout({ kind: 'info', title: 'Как да четем дела от плана', body, id: 's15-rhythm' });
}

const EMPTY_CHART = () => emptyState({ title: 'Няма данни за графиката', text: 'За избрания обхват и година отчетът няма стойности за тази графика.' });

function chartBlock(M, spec, o) {
  const has = !!spec && Array.isArray(spec.series) && spec.series.some(s => (s.data || []).some(fin));
  return block({
    id: o.id, level: 2, title: o.title, sub: o.sub, scope: M.scope, source: sourcesOf(M), asOf: M.asOf,
    share: has ? { embed: spec.id, text: o.text } : false,
    body: has ? chart(spec) : EMPTY_CHART(),
  });
}

const cumTitle = (M, which) => (M.planned ? (which === 'rev' ? 'Приходи спрямо плана' : 'Разходи спрямо плана') : (which === 'rev' ? 'Приходи през годината' : 'Разходи през годината'));
const cumSub = M => (!M.planned ? (M.PY ? `Плътната линия е ${M.Y} г., прекъснатата е ${M.PY} г.` : 'Натрупани от началото на годината.')
  : !M.PY ? `Плътната линия е ${M.Y} г., а хоризонталната линия е годишният план.`
  : M.unit === 'pct' ? `Колко процента от годишния план са стигнати до всеки месец, сравнено с дела от резултата за ${M.PY} г.`
  : `Плътната линия е ${M.Y} г., прекъснатата е ${M.PY} г., а хоризонталната линия е годишният план.`);

export function cumBlock(M, which) {
  const it = M.k[which];
  const word = which === 'rev' ? 'събрани' : 'похарчени';
  const text = `Към ${date(M.asOf)} г. ${SCOPE_IN[M.scope]} са ${word} ${amount(M.ctx, { mln: it.c })}${fin(it.pc) ? ` (${pct(it.pc, 1)} от годишния план)` : ''}.`;
  return chartBlock(M, cumChartSpec(M, which), { id: `s15-b-cum-${which}`, title: cumTitle(M, which), sub: cumSub(M), text });
}

export function obshoView(M) {
  const out = [kpisBlock(M), rhythmCallout(M)];
  out.push(html`<div class="s15-pair">${cumBlock(M, 'rev')}${cumBlock(M, 'exp')}</div>`);
  out.push(chartBlock(M, monthlyChartSpec(M), { id: 's15-b-monthly', title: 'Месец по месец', sub: 'Всеки стълб е само един месец, не е натрупан от началото на годината.', text: `Приходи и разходи по месеци, ${M.Y} г., ${SCOPE_NAME[M.scope]}.` }));
  out.push(chartBlock(M, balanceChartSpec(M), { id: 's15-b-balance', title: 'Дефицит или излишък', sub: 'Под нулата означава, че през месеца са изразходвани повече пари, отколкото са събрани.', text: `Месечно салдо, ${M.Y} г., ${SCOPE_NAME[M.scope]}.` }));
  return out;
}

/* ------------------------------------------------------------------ По пера: таблици с план, дял и флаг ▼ ▲ */
const FLAG_WORD = { down: 'изостава', up: 'изпреварва' };
const FLAG_ICON = { down: '▼', up: '▲' };
const EXTRA_NAMES = { 'exp.contingency': 'Резерв за непредвидени разходи' };
const peraMode = M => (!M.planned ? 'year' : M.scope === 'kfp' ? 'plan' : 'yoy');

function peraRowObj(M, id, mc) {
  const it = M.item(id);
  const flagTxt = it.flag === 'down' || it.flag === 'up' ? `${FLAG_WORD[it.flag]}, ${pp(it.diff, 1)}` : fin(it.diff) ? pp(it.diff, 1) : '';
  return {
    name: EXTRA_NAMES[id] || it.name, plan: mc.raw(it.p), cum: mc.raw(it.c), prev: mc.raw(it.pv),
    share: it.pc, pace: it.pace, flag: flagTxt, diff: it.diff, kind: it.flag, yoy: it.yoy, part: it.shareOfYear,
    mp: it.p, mc: it.c, mv: it.pv,
  };
}

const moneyCell = (mc, mln) => {
  const lev = mc.lev(mln);
  return html`${mc.text(mln)}${lev ? html`<span class="s15-lev">${lev}</span>` : ''}`;
};
const pctCell = v => (fin(v) ? pct(v, 1) : DASH);

function flagCell(_v, r) {
  if (r.kind === 'down' || r.kind === 'up') {
    return html`<span class="s15-flag" data-flag="${r.kind}"><span aria-hidden="true">${FLAG_ICON[r.kind]}</span> ${FLAG_WORD[r.kind]}</span><span class="s15-diff">${pp(r.diff, 1)}</span>`;
  }
  return fin(r.diff) ? html`<span class="s15-diff">${pp(r.diff, 1)}</span>` : html`<span class="muted">${DASH}</span>`;
}

function peraColumns(M, mc, kind) {
  const mon = monthName(M.m);
  const got = kind === 'rev' ? 'Събрано' : 'Похарчено';
  const mode = peraMode(M);
  const money = (key, label, f) => ({ key, label, num: true, unit: mc.unit, d: mc.d, fmt: (_v, r) => moneyCell(mc, r[f]) });
  if (mode === 'plan') {
    // on a narrow screen the „Дял от плана“ column is folded into the executed cell (the CSS swaps them), so the key figure is never off-screen
    const cumCell = (_v, r) => html`${moneyCell(mc, r.mc)}${fin(r.share) ? html`<span class="s15-sub s15-narrow">${pct(r.share, 1)} от плана</span>` : ''}`;
    return [
      { key: 'name', label: 'Перо' },
      money('plan', `План за ${M.Y} г.`, 'mp'),
      { key: 'cum', label: `${got} към ${mon}`, num: true, unit: mc.unit, d: mc.d, fmt: cumCell },
      { key: 'share', label: 'Дял от плана', num: true, unit: '%', d: 1, fmt: pctCell },
      { key: 'pace', label: `Дял по същото време на ${M.PY} г.`, num: true, unit: '%', d: 1, fmt: pctCell },
      { key: 'flag', label: `Спрямо хода на ${M.PY} г.`, fmt: flagCell },
    ];
  }
  if (mode === 'yoy') {
    return [
      { key: 'name', label: 'Перо' },
      money('cum', `${got} към ${mon} ${M.Y}`, 'mc'),
      money('prev', `${got} към ${mon} ${M.PY}`, 'mv'),
      { key: 'yoy', label: 'Промяна', num: true, unit: '%', d: 1, fmt: v => (fin(v) ? delta(v, 1) : DASH) },
    ];
  }
  // a year without a plan: the amount, the same month of the year before (when the file has it) and the share of the year's result
  const cols = [{ key: 'name', label: 'Перо' }, money('cum', `${got} към ${mon} ${M.Y}`, 'mc')];
  if (M.PY) cols.push(money('prev', `${got} към ${mon} ${M.PY}`, 'mv'), { key: 'yoy', label: 'Промяна', num: true, unit: '%', d: 1, fmt: v => (fin(v) ? delta(v, 1) : DASH) });
  cols.push({ key: 'part', label: `Дял от резултата за ${M.Y} г.`, num: true, unit: '%', d: 1, fmt: pctCell });
  return cols;
}

function peraBlock(M, kind) {
  const mc = moneyCol(M.ctx, { d: 1 });
  const mode = peraMode(M);
  const ids = kind === 'rev' ? REV_ROWS : [...EXP_ROWS, ...(mode === 'plan' ? ['exp.contingency'] : []), 'eucontrib'];
  const rows = ids.map(id => peraRowObj(M, id, mc)).filter(r => mode === 'plan' || fin(r.mc) || fin(r.mv));
  const totalId = kind === 'rev' ? 'rev' : 'exp.total';
  const total = { label: kind === 'rev' ? 'Общо приходи' : 'Общо разходи (с вноската в ЕС)', values: peraRowObj(M, totalId, mc) };
  const over = rows.some(r => fin(r.share) && r.share > 100);
  const noteParts = [];
  if (mode === 'plan' && kind === 'exp') noteParts.push('За резерва за непредвидени разходи има само план: в месечния отчет той няма отделен ред.');
  if (over) noteParts.push('Дял над 100% означава, че за реда вече е похарчено повече от годишния план.');
  const title = kind === 'rev' ? 'Приходи по видове' : 'Разходи по видове';
  const has = rows.length > 0 && fin(total.values.mc);
  const text = `${title}, ${SCOPE_NAME[M.scope]}, към ${date(M.asOf)} г.`;
  return block({
    id: `s15-b-${kind}-rows`, level: 2, title, scope: M.scope, source: sourcesOf(M), asOf: M.asOf, share: has ? { text } : false, cls: mode === 'plan' ? 's15-plan' : undefined,
    body: has
      ? dataTable({ id: `s15-t-${kind}`, caption: `${title}: ${mode === 'plan' ? 'план, изпълнение и дял от плана' : mode === 'yoy' ? `натрупано спрямо същото време на ${M.PY} г.` : M.PY ? `натрупано, спрямо същото време на ${M.PY} г. и дял от резултата за годината` : 'натрупано и дял от резултата за годината'}`, columns: peraColumns(M, mc, kind), rows, total, note: noteParts.join(' ') || undefined, dense: true, cls: 's15-tbl' })
      : EMPTY_CHART(),
  });
}

/** how many detail rows each threshold would flag (the totals are not counted) */
function flagCounts(rows) {
  const cnt = t => rows.filter(r => fin(r.diff) && Math.abs(r.diff) >= t - 1e-9).length;
  return { 10: cnt(10), 15: cnt(15) };
}

function peraIntro(M) {
  const mon = monthName(M.m);
  const ctx = M.ctx;
  const mode = peraMode(M);
  if (mode === 'plan') {
    const mc = moneyCol(ctx);
    const rows = [...REV_ROWS, ...EXP_ROWS, 'eucontrib'].map(id => peraRowObj(M, id, mc));
    const n = flagCounts(rows);
    const flagged = rows.filter(r => r.kind === 'down' || r.kind === 'up');
    const list = flagged.map(r => `${r.name} (${FLAG_WORD[r.kind]})`).join(', ');
    const word = c => (c === 1 ? 'ред' : 'реда');
    return html`<div class="s15-lead">
      <p>Сравняваме два дяла: колко процента от годишния план са изпълнени към ${mon} ${M.Y} г. и колко процента от резултата за цялата ${M.PY} г. са били достигнати към същия месец. Когато двата дяла се различават с поне ${M.thr}${NBSP}${gl('protsenten-punkt', 'процентни пункта')}, редът е отбелязан: ▼ „изостава“ или ▲ „изпреварва“.</p>
      <p>При праг 10${NBSP}пр.п. се отбелязват ${n[10]} ${word(n[10])}, а при праг 15${NBSP}пр.п. – ${n[15]} ${word(n[15])}. Прагът се сменя от избора по-горе.${flagged.length ? ` Сега са отбелязани: ${list}.` : ' Сега няма отбелязани редове.'}</p>
    </div>`;
  }
  if (mode === 'yoy') {
    return html`<div class="s15-lead"><p>Тук сравняваме натрупаното към ${mon} ${M.Y} г. с натрупаното към същия месец на ${M.PY} г. За ${M.scope === 'nat' ? 'националния бюджет' : 'средствата от ЕС'} няма годишен план по видове, затова няма дял от плана. Планът за общите суми и трансферите е в раздела <a href="${ctx.href('S15', { sub: 'byudzheti' }, keepQuery(ctx))}">„Бюджети“</a>.</p></div>`;
  }
  return html`<div class="s15-lead"><p>Показваме натрупаното към ${mon} ${M.Y} г. и дела му от резултата за цялата година.${M.PY ? ` Сравняваме го и със същия месец на ${M.PY} г.` : ''} За ${M.Y} г. няма годишен план, затова няма дял от плана и няма отбелязване на изоставане.</p></div>`;
}

function mappingDisclosure(M) {
  const map = (M.ex.plan2026 && M.ex.plan2026.mapping) || null;
  if (!map || !Object.keys(map).length) return '';
  const rows = Object.entries(map).map(([id, line]) => ({ report: M.rowName(id), annex: line }));
  return disclosure({
    id: 's15-mapping', title: 'Кои редове на отчета съответстват на кои редове на плана',
    body: dataTable({ id: 's15-t-mapping', caption: 'Съпоставка на редовете на месечния отчет с редовете на Приложение 3', columns: [{ key: 'report', label: 'Ред в месечния отчет' }, { key: 'annex', label: 'Ред в плана (Приложение 3)' }], rows, dense: true }),
  });
}

export function peraView(M) {
  const out = [peraIntro(M), peraBlock(M, 'rev'), peraBlock(M, 'exp')];
  if (peraMode(M) === 'plan') {
    const note = M.ex.plan2026 && M.ex.plan2026.note;
    if (note) out.push(callout({ kind: 'info', title: 'Как е съпоставен планът с отчета', body: html`<p>${note}</p>`, id: 's15-plan-note' }));
    out.push(mappingDisclosure(M));
  }
  out.push(block({ id: 's15-taxes', level: 2, title: 'Изпълнение по видове данъци', status: 'pending', pending: 'P01' }));
  return out;
}

/* ------------------------------------------------------------------ Бюджети: плана по съставни бюджети (D07), националният бюджет и средствата от ЕС (реални) */
const khilToMln = v => (fin(v) ? v / 1000 : null);

/** components.json (D07) is optional: its own shape is read as it is (budgets.state … other, sankey, notes); what is missing is skipped, never invented */
const componentsOf = M => {
  const c = M.ctx.data.components;
  return c && typeof c === 'object' && c.budgets && typeof c.budgets === 'object' ? c : null;
};
const srcOf = c => (c && c.meta && Array.isArray(c.meta.source) && c.meta.source.length ? c.meta.source : ['zdb', 'asbp']);

function componentSankey(c, mc) {
  const sk = c && c.sankey;
  if (!sk || !Array.isArray(sk.nodes) || !Array.isArray(sk.links)) return null;
  const names = new Map(sk.nodes.map(n => [n.id, n.name || n.id]));
  const nm = id => names.get(id) || String(id);
  const links = sk.links.filter(l => l && fin(l.value) && l.value > 0).map(l => ({ source: nm(l.source), target: nm(l.target), value: l.value, mln: l.value }));
  if (!links.length) return null;
  return { nodes: sk.nodes.map(n => nm(n.id)), links: links.map(l => ({ source: l.source, target: l.target, value: mc.raw(l.value) })), total: links.reduce((t, l) => t + l.mln, 0) };
}

function sankeyBlock(M) {
  const c = componentsOf(M);
  const mc = moneyCol(M.ctx, { d: 1 });
  const sp = componentSankey(c, mc);
  const title = 'От държавния бюджет към другите бюджети';
  if (!sp) {
    return block({
      id: 's15-b-sankey', level: 2, title, status: 'pending', scope: 'kfp',
      body: pendingState({ title: 'Планът по съставни бюджети предстои', text: 'Данните за разпределението между държавния бюджет, ДОО, здравната каса и общините още не са заредени.' }),
    });
  }
  const total = amount(M.ctx, { mln: sp.total });
  return block({
    id: 's15-b-sankey', level: 2, title, scope: 'kfp', source: srcOf(c), asOf: c.meta && c.meta.asOf,
    sub: 'Планираните трансфери от държавния бюджет към другите бюджети през 2026 г. Това е планът, не изпълнението: месечно изпълнение по съставни бюджети предстои.',
    share: { embed: 's15-sankey', text: `Планираните трансфери от държавния бюджет към другите бюджети през 2026 г.: ${total}.` },
    body: sankey({ id: 's15-sankey', title: 'Трансфери от държавния бюджет по плана за 2026 г.', sub: mc.unit, desc: `Планираните трансфери от държавния бюджет към другите бюджети през 2026 г. са общо ${total}.`, nodes: sp.nodes, links: sp.links, unit: mc.unit, d: mc.d }),
    foot: html`<p class="small muted">„Други получатели“ са трансферите, които законът не назовава поименно. Те са разликата между всички предоставени трансфери и изброените получатели.</p>`,
  });
}

/** the plan of each budget: the numbers are the file's, only converted to млн. €; the state budget's total outflow is the sum of its three outflow lines */
function budgetRows(M, c) {
  const ctx = M.ctx, b = c.budgets, k = khilToMln;
  const a = v => amount(ctx, { mln: v });
  const line = (list, id) => (Array.isArray(list) ? (list.find(x => x && x.id === id) || {}).khil : null);
  const rows = [];
  const s = b.state;
  if (s && fin(s.revKhil)) {
    const out = fin(s.expKhil) && fin(s.transfersNetKhil) && fin(s.euContributionKhil) ? s.expKhil + s.transfersNetKhil + s.euContributionKhil : null;
    const parts = fin(out) ? `Разходите са сбор от ${a(k(s.expKhil))} собствени разходи, ${a(k(s.transfersNetKhil))} нетни трансфери към другите бюджети и ${a(k(s.euContributionKhil))} вноска в бюджета на ЕС.` : '';
    const fin2 = fin(s.financingKhil) ? ` За покриване на дефицита е предвидено финансиране ${a(k(s.financingKhil))}.` : '';
    rows.push({ id: 'state', name: s.name || 'Държавен бюджет', what: `${parts}${fin2}`.trim(), rev: k(s.revKhil), exp: k(out), bal: k(s.balanceKhil) });
  }
  const d = b.doo;
  if (d && fin(d.revAndTransfersKhil)) {
    const pen = line(d.exp, 'pensions'), gap = line(d.rev, 'transfersShortage');
    const what = [
      fin(d.ownRevKhil) && fin(d.transfersFromCentralKhil) ? `Собствени приходи ${a(k(d.ownRevKhil))} и трансфери от държавния бюджет ${a(k(d.transfersFromCentralKhil))}.` : '',
      fin(pen) ? `Най-голям разход са пенсиите: ${a(k(pen))}.` : '',
      fin(gap) ? `Салдото е нула: недостигът се покрива с допълнителен трансфер от държавния бюджет (${a(k(gap))}).` : '',
    ].filter(Boolean).join(' ');
    rows.push({ id: 'doo', name: d.name || 'ДОО', what, rev: k(d.revAndTransfersKhil), exp: k(d.expAndTransfersKhil), bal: k(d.balanceKhil) });
  }
  const n = b.nzok;
  if (n && fin(n.revAndTransfersKhil)) {
    const pay = line(n.exp, 'payments');
    const what = [
      fin(n.ownRevKhil) && fin(n.transfersFromStateKhil) ? `Собствени приходи ${a(k(n.ownRevKhil))} и трансфери от държавния бюджет ${a(k(n.transfersFromStateKhil))}.` : '',
      fin(pay) ? `Най-голям разход са здравноосигурителните плащания: ${a(k(pay))}.` : '',
    ].filter(Boolean).join(' ');
    rows.push({ id: 'nzok', name: n.name || 'НЗОК', what, rev: k(n.revAndTransfersKhil), exp: k(n.expAndTransfersKhil), bal: k(n.balanceKhil) });
  }
  const m = b.municipalities;
  if (m && fin(m.expMln)) {
    const main = m.transfers && Array.isArray(m.transfers.mainKhil) ? m.transfers.mainKhil[0] : null;
    const what = [
      fin(m.count) ? `Разходите на ${m.count} общини.` : '',
      fin(main) ? `${a(k(main))} от тях идват като основни трансфери от държавния бюджет.` : '',
      'Собствените приходи на общините (местни данъци и такси) не са показани тук.',
    ].filter(Boolean).join(' ');
    rows.push({ id: 'municipalities', name: m.name || 'Общини', what, rev: null, exp: m.expMln, bal: null });
  }
  const e = b.euAccounts;
  if (e && fin(e.revMln)) {
    const what = fin(e.transferFromStateMln) ? `Нетният трансфер от държавния бюджет е ${a(e.transferFromStateMln)}. Числата са по мотивите към законопроекта.` : 'Числата са по мотивите към законопроекта.';
    rows.push({ id: 'eu', name: e.name || 'Сметки за средства от ЕС', what, rev: e.revMln, exp: e.expMln, bal: e.balanceMln });
  }
  return rows;
}

function budgetsBlock(M) {
  const c = componentsOf(M);
  if (!c) return '';
  const rows0 = budgetRows(M, c);
  if (!rows0.length) return '';
  const mc = moneyCol(M.ctx, { d: 1 });
  const rows = rows0.map(r => ({ ...r, mr: r.rev, me: r.exp, mb: r.bal, rev: mc.raw(r.rev), exp: mc.raw(r.exp), bal: mc.raw(r.bal) }));
  const col = (key, label, f) => ({ key, label, num: true, unit: mc.unit, d: mc.d, fmt: (_v, r) => moneyCell(mc, r[f]) });
  const withWhat = rows.filter(r => r.what);
  return block({
    id: 's15-b-budgets', level: 2, title: 'Планът за всеки от бюджетите', sub: 'Планът за 2026 г. Под таблицата е кратко обяснение какво влиза в числата на всеки бюджет.',
    scope: 'kfp', source: srcOf(c), asOf: c.meta && c.meta.asOf,
    share: { text: 'Планът за 2026 г. по бюджети: приходи, разходи и салдо.' },
    body: html`${dataTable({
      id: 's15-t-budgets', caption: 'План за 2026 г. по съставни бюджети: приходи, разходи и салдо',
      columns: [{ key: 'name', label: 'Бюджет' }, col('rev', 'Приходи и получени трансфери', 'mr'), col('exp', 'Разходи и дадени трансфери', 'me'), col('bal', 'Салдо', 'mb')], rows, dense: true,
      note: 'Не събирайте числата по редовете: бюджетите си предават пари един на друг (трансфери). Консолидираната програма (КФП) изважда тези трансфери, за да не се броят два пъти.',
    })}
    ${withWhat.length ? html`<h3 class="s15-minor">Какво влиза в числата</h3><dl class="s15-defs">${withWhat.map(r => html`<dt>${r.name}</dt><dd>${r.what}</dd>`)}</dl>` : ''}`,
  });
}

/** the other budgets that the law does not name (appendix 6 of the bill's motives) and the notes of the data file, folded away */
function otherDisclosure(M, c) {
  const o = c.budgets.other;
  if (!o || !Array.isArray(o.items) || !o.items.length) return '';
  const years = Array.isArray(o.years) ? o.years : [2026, 2027, 2028];
  const mc = moneyCol(M.ctx, { d: 1 });
  const yearLabel = (y, i) => `${y} г.${i === 0 ? ' (проект)' : ' (прогноза)'}`;
  const at = (arr, i) => (Array.isArray(arr) ? khilToMln(arr[i]) : null);
  const rows = o.items.map(it => ({ name: it.label, ...Object.fromEntries(years.map((_y, i) => [`y${i}`, mc.raw(at(it.khil, i))])), ...Object.fromEntries(years.map((_y, i) => [`m${i}`, at(it.khil, i)])) }));
  const totals = Object.fromEntries(years.flatMap((_y, i) => [[`y${i}`, mc.raw(at(o.sumKhil, i))], [`m${i}`, at(o.sumKhil, i)]]));
  const cols = years.map((y, i) => ({ key: `y${i}`, label: yearLabel(y, i), num: true, unit: mc.unit, d: mc.d, fmt: (_v, r) => mc.text(r[`m${i}`]) }));
  return disclosure({
    id: 's15-other', title: 'Бюджети на БНТ, БНР, БТА, БАН и държавните университети',
    body: html`<p class="s15-lead">Приложение № 6 към мотивите към законопроекта изброява трансфери към тези бюджети. Член 1 от закона не ги назовава, затова не твърдим, че те са цялата сума в „Други получатели“.</p>
      ${dataTable({ id: 's15-t-other', caption: 'Трансфери към други бюджети по приложение № 6 към мотивите', columns: [{ key: 'name', label: 'Бюджет' }, ...cols], rows, total: { label: 'Общо', values: totals }, dense: true, note: o.sourceNote ? `Източник на числата: ${o.sourceNote}.` : undefined })}`,
  });
}

function notesDisclosure(M, c) {
  const notes = Array.isArray(c.notes) ? c.notes.filter(x => typeof x === 'string' && x.trim()) : [];
  const b = c.budgets;
  const srcs = ['state', 'doo', 'nzok', 'municipalities', 'euAccounts', 'other'].map(k => b[k]).filter(x => x && x.sourceNote).map(x => `${x.name}: ${x.sourceNote}`);
  if (!notes.length && !srcs.length) return '';
  return disclosure({
    id: 's15-notes', title: 'Бележки към числата и откъде са те',
    body: html`${notes.length ? html`<ul class="s15-method">${notes.map(t => html`<li>${t}</li>`)}</ul>` : ''}
      ${srcs.length ? html`<h3 class="s15-minor">Откъде са числата за всеки бюджет</h3><ul class="s15-method">${srcs.map(t => html`<li>${t}</li>`)}</ul>` : ''}`,
  });
}

function natEuBlock(M) {
  const mc = moneyCol(M.ctx, { d: 1 });
  const lines = [['rev', 'Приходи'], ['exp.total', 'Разходи (с вноската в ЕС)'], ['transfers', 'Трансфери (нето)'], ['balance', 'Бюджетно салдо']];
  const rows = lines.map(([id, name]) => {
    const r = { name };
    for (const [sc] of SCOPES) {
      const c = M.at(M.cumArr(M.Y, id, sc), M.m - 1);
      const p = M.planned ? M.planOf(id, sc) : null;
      r[`m_${sc}`] = c;
      r[sc] = mc.raw(c);
      r[`s_${sc}`] = fin(c) && fin(p) && c !== 0 && p !== 0 && Math.sign(c) === Math.sign(p) ? ratio(c, p) : null;
    }
    return r;
  });
  const col = (sc, label) => ({
    key: sc, label, num: true, unit: mc.unit, d: mc.d,
    fmt: (_v, r) => html`${moneyCell(mc, r[`m_${sc}`])}${fin(r[`s_${sc}`]) ? html`<span class="s15-sub">${pct(r[`s_${sc}`], 1)} от плана</span>` : ''}`,
  });
  const has = rows.some(r => fin(r.m_nat) || fin(r.m_eu));
  return block({
    id: 's15-b-nateu', level: 2, title: 'Национален бюджет и средства от ЕС', source: sourcesOf(M), asOf: M.asOf,
    sub: `Натрупано към ${date(M.asOf)} г.${M.planned ? ' Под сумата е показан делът от годишния план.' : ''}`,
    share: has ? { text: `Национален бюджет и средства от ЕС към ${date(M.asOf)} г.` } : false,
    body: has
      ? dataTable({
        id: 's15-t-nateu', caption: `Национален бюджет, средства от ЕС и КФП към ${date(M.asOf)} г.`,
        columns: [{ key: 'name', label: 'Показател' }, col('nat', 'Национален бюджет'), col('eu', 'Средства от ЕС'), col('kfp', 'КФП (общо)')], rows, dense: true,
        note: 'Трансферите между националния бюджет и средствата от ЕС са равни по размер и с противоположен знак, затова в КФП се нулират. Приходите, разходите и салдото на КФП са сборът от двата обхвата.',
      })
      : EMPTY_CHART(),
  });
}

export function byudzhetiView(M) {
  const c = componentsOf(M);
  const intro = html`<div class="s15-lead"><p>В ${gl('kfp', 'консолидираната фискална програма (КФП)')} се събират няколко отделни бюджета: държавният бюджет, държавното обществено осигуряване (ДОО), здравната каса (НЗОК), общините и средствата от ЕС. Тук е планът за 2026 г. и изпълнението по националния бюджет и средствата от ЕС.</p></div>`;
  return [
    intro, sankeyBlock(M), budgetsBlock(M), c ? otherDisclosure(M, c) : '', natEuBlock(M),
    block({ id: 's15-b-monthly-components', level: 2, title: 'Изпълнение по съставни бюджети', status: 'pending', pending: 'P02' }),
    c ? notesDisclosure(M, c) : '',
  ];
}

/* ------------------------------------------------------------------ Сравнение на години: two report years side by side (#/izpalnenie/sravnenie?g1=&g2=) */
// „По пера“: the items the other tabs show, each group closed by its total, then the balance
const CMP_ROWS = [...REV_ROWS, 'rev', ...EXP_ROWS, 'eucontrib', 'exp.total', 'balance'];
const CMP_TOTALS = { rev: 'Общо приходи', 'exp.total': 'Общо разходи (с вноската в ЕС)', balance: 'Салдо (приходи минус разходи)' };
// „По месеци“: the three headline rows (the file has their month-by-month values) and the two ways to read them
const CMP_KINDS = [
  { value: 'prihodi', label: 'Приходи', the: 'приходите', verb: 'са', row: 'rev' },
  { value: 'razhodi', label: 'Разходи', the: 'разходите', verb: 'са', row: 'exp.total' },
  { value: 'saldo', label: 'Салдо', the: 'салдото', verb: 'е', row: 'balance' },
];
const CMP_MODES = [{ value: 'mesec', label: 'За месеца' }, { value: 'natrupano', label: 'Натрупано' }];
const joinBg = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}` : String(xs.length ? xs[0] : ''));
const yearWord = y => (typeof y === 'number' ? `${y} г.` : `„${y}“`);

/** change in % from a to b, only on a positive base: a deficit or a zero gives „—“ */
const pctChange = (a, b) => (fin(a) && fin(b) && a > 0 && b >= 0 ? (b / a - 1) * 100 : null);

/** the two years of the comparison and what to show; every number comes from execution.json through the same accessors as model() */
export function cmpModel(M) {
  const q = M.ctx.query || {};
  const ys = M.years;
  const last = ys[ys.length - 1];
  const prev = ys.length > 1 ? ys[ys.length - 2] : last;
  // a year from the address: a number when it looks like one, the raw text otherwise (then the screen says it has no data for it)
  const yearOf = (v, def) => { const s = v == null ? '' : String(v).trim(); return s === '' ? def : /^\d{4}$/.test(s) ? Number(s) : s; };
  const g1 = yearOf(q.g1, prev), g2 = yearOf(q.g2, last);
  const has = y => typeof y === 'number' && ys.includes(y);
  const nOf = y => (has(y) ? M.ex.data[String(y)].months : 0);
  const n1 = nOf(g1), n2 = nOf(g2);
  const maxM = Math.max(n1, n2) || 12;
  const minM = Math.min(n1, n2) || maxM;
  const want = Math.floor(Number(q.mesec));
  const month = fin(want) && want >= 1 ? Math.min(want, maxM) : minM;
  const kind = CMP_KINDS.find(k => k.value === q.pok) || CMP_KINDS[0];
  const mode = CMP_MODES.find(k => k.value === q.rez) || CMP_MODES[0];
  const cum = (y, row, i) => (has(y) ? M.at(M.cumArr(y, row), i) : null);
  const mon = (y, row, i) => (has(y) ? M.at(M.monArr(y, row), i) : null);
  const asOfOf = (y, i) => { const b = has(y) ? M.ex.data[String(y)] : null; return b && Array.isArray(b.asOf) && b.asOf.length ? b.asOf[Math.min(i, b.asOf.length - 1)] : null; };
  const bad = [...new Set([g1, g2].filter(y => !has(y)))];
  const problem = bad.length ? 'year' : g1 === g2 ? 'same' : null;
  return { M, ctx: M.ctx, ys, prev, last, g1, g2, n1, n2, maxM, minM, month, kind, mode, cum, mon, asOfOf, has, bad, problem, scope: M.scope };
}

const laterOf = (...ds) => ds.filter(Boolean).sort().pop() || null;

/** „с 11,9% повече, отколкото към края на август 2025 г.“ (or „при … “ when the change in % cannot be computed) */
function cmpWords(C, a, b, where) {
  const p = pctChange(a, b);
  if (!fin(p)) return `при ${amount(C.ctx, { mln: a })} ${where} ${C.g1} г.`;
  if (Math.abs(p) < 0.05) return `колкото ${where} ${C.g1} г.`;
  return `с ${pct(Math.abs(p), 1)} ${p > 0 ? 'повече' : 'по-малко'}, отколкото ${where} ${C.g1} г.`;
}

export function cmpSummary(C) {
  if (C.problem) return '';
  const i = C.month - 1, mon = monthName(C.month);
  const r1 = C.cum(C.g1, 'rev', i), r2 = C.cum(C.g2, 'rev', i), e1 = C.cum(C.g1, 'exp.total', i), e2 = C.cum(C.g2, 'exp.total', i);
  const miss = [[C.g1, r1], [C.g2, r2]].filter(x => !fin(x[1])).map(x => x[0]);
  if (miss.length) return `За ${joinBg(miss)} г. няма отчет към края на ${mon}. Избери по-ранен месец.`;
  const where = `към края на ${mon}`;
  // cmpWords() ends with „… г.“: the sentences need no second full stop
  const s1 = `Към края на ${mon} ${C.g2} г. ${SCOPE_IN[C.scope]} са събрани ${amount(C.ctx, { mln: r2 })}, ${cmpWords(C, r1, r2, where)}`;
  const s2 = fin(e1) && fin(e2) ? ` Похарчени са ${amount(C.ctx, { mln: e2 })}, ${cmpWords(C, e1, e2, where)}` : '';
  return s1 + s2;
}

export function cmpControls(C) {
  const yOpts = cur => [...C.ys.map(y => ({ value: String(y), label: String(y) })), ...(C.has(cur) ? [] : [{ value: String(cur), label: `${cur} (няма данни)` }])];
  const short = C.n1 && C.n2 && C.n1 !== C.n2 ? (C.n1 < C.n2 ? C.g1 : C.g2) : null;             // the year with fewer reports
  const mOpts = Array.from({ length: C.maxM }, (_, k) => ({ value: String(k + 1), label: `${cap1(monthName(k + 1))}${short != null && k + 1 > C.minM ? ` (няма отчет за ${short} г.)` : ''}` }));
  const parts = [
    field({ id: 's15-g1', label: 'Първа година', control: selectInput({ id: 's15-g1', name: 'g1', value: String(C.g1), options: yOpts(C.g1), query: 'g1' }) }),
    field({ id: 's15-g2', label: 'Втора година', control: selectInput({ id: 's15-g2', name: 'g2', value: String(C.g2), options: yOpts(C.g2), query: 'g2' }) }),
    field({ id: 's15-mesec', label: 'Натрупано до месец', control: selectInput({ id: 's15-mesec', name: 'mesec', value: String(C.month), options: mOpts, query: 'mesec' }) }),
    ctl('Обхват', 's15-obhvat-l', seg({ name: 's15-obhvat', label: 'Обхват', value: C.scope, query: 'obhvat', cls: 's15-seg', options: SCOPES.map(([value, label]) => ({ value, label })) })),
  ];
  return html`<div class="s15-controls s15-cmp-controls" role="group" aria-label="Кои години да сравним">${parts}</div>`;
}

/** g1 = g2, or a year the file does not have: say so and offer the default comparison */
function cmpProblem(C) {
  const ctx = C.ctx;
  const href = ctx.href('S15', { sub: 'sravnenie' }, keepQuery(ctx, { g1: null, g2: null, mesec: null }));
  const action = C.prev !== C.last ? { href, label: `Сравни ${C.prev} и ${C.last} г.` } : undefined;
  if (C.problem === 'same') {
    return emptyState({ title: 'Избрана е една и съща година', text: `И двете години са ${C.g1} г. Избери две различни години, за да видиш разликите.`, action });
  }
  const early = C.bad.every(y => typeof y === 'number' && y >= EARLIEST_REPORT && y < C.ys[0]);
  if (early) {
    return pendingState({ id: 'P05', title: `Месечните отчети за ${joinBg(C.bad)} г. предстоят`, text: `Още не са добавени. Сега има отчети за ${joinBg(C.ys)} г.`, action });
  }
  return emptyState({ title: `Няма данни за ${joinBg(C.bad.map(yearWord))}`, text: `Има месечни отчети за ${joinBg(C.ys)} г. Избери година от тях.`, action });
}

/** a signed difference with the leva line under it when „и в лева“ is on */
function diffCell(mc, mln) {
  const v = mc.raw(mln);
  if (v == null) return html`<span class="muted">${DASH}</span>`;
  const lev = mc.lev(mln);
  return html`${num(v, mc.d, { sign: true })}${lev ? html`<span class="s15-lev">${lev}</span>` : ''}`;
}

/** the five columns of both comparison tables; below 640px the change in % moves under the difference (the CSS hides column 5) */
function cmpColumns(mc, first, la, lb) {
  const money = (key, label, f) => ({ key, label, num: true, unit: mc.unit, d: mc.d, fmt: (_v, r) => (fin(r[f]) ? moneyCell(mc, r[f]) : html`<span class="muted">${DASH}</span>`) });
  return [
    { key: 'name', label: first, fmt: (_v, r) => (r.total ? html`<strong>${r.name}</strong>` : r.name) },
    money('a', la, 'ma'),
    money('b', lb, 'mb'),
    { key: 'd', label: 'Разлика', num: true, unit: mc.unit, d: mc.d, fmt: (_v, r) => html`${diffCell(mc, r.md)}${fin(r.p) ? html`<span class="s15-sub s15-narrow">${delta(r.p, 1)}</span>` : ''}` },
    { key: 'p', label: 'Промяна', num: true, unit: '%', d: 1, fmt: v => (fin(v) ? delta(v, 1) : DASH) },
  ];
}

// the plain values (sorting, CSV, PNG) are rounded like the screen shows them; the cells print from the unrounded млн. € (ma, mb, md)
const rnd = (v, d) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const cmpRow = (mc, name, a, b, total = false) => {
  const d = fin(a) && fin(b) ? b - a : null;
  return { name, total, ma: a, mb: b, md: d, a: rnd(mc.raw(a), mc.d), b: rnd(mc.raw(b), mc.d), d: rnd(mc.raw(d), mc.d), p: rnd(pctChange(a, b), 1) };
};

/** the short notes under a comparison table: which year has no report for some months, when the % is not computed, how the difference is made */
function cmpNote(C, rows, missing) {
  const out = [`Разликата е ${C.g2} г. минус ${C.g1} г.`];
  out.push(...missing);
  if (rows.some(r => fin(r.ma) && fin(r.mb) && !fin(r.p))) out.push(`Промяна в проценти не се смята, когато числото за ${C.g1} г. е нула или под нулата (например при дефицит).`);
  return out.join(' ');
}

export function cmpItemsBlock(C) {
  const mc = moneyCol(C.ctx, { d: 1 });
  const i = C.month - 1, mon = monthName(C.month);
  const rows = CMP_ROWS.map(id => cmpRow(mc, CMP_TOTALS[id] || C.M.rowName(id), C.cum(C.g1, id, i), C.cum(C.g2, id, i), id in CMP_TOTALS));
  const missing = [C.g1, C.g2].filter(y => C.month > (y === C.g1 ? C.n1 : C.n2)).map(y => `За ${y} г. последният отчет е към ${date(C.asOfOf(y, 11))} г., затова там има „${DASH}“.`);
  const asOf = laterOf(C.asOfOf(C.g1, i), C.asOfOf(C.g2, i));
  return block({
    id: 's15-b-cmp-items', level: 2, title: 'По пера', scope: C.scope, source: ['kfp'], asOf, cls: 's15-cmp',
    sub: `Натрупано от началото на годината до края на ${mon}, ${SCOPE_NAME[C.scope]}.`,
    share: { text: `По пера: ${C.g1} и ${C.g2} г., натрупано до края на ${mon}, ${SCOPE_NAME[C.scope]}. ${cmpSummary(C)}`.trim() },
    body: dataTable({
      id: 's15-t-cmp-items', caption: `Приходи и разходи по пера: ${C.g1} и ${C.g2} г., натрупано до края на ${mon}`, dense: true, cls: 's15-tbl',
      columns: cmpColumns(mc, 'Перо', `${C.g1} към ${mon}`, `${C.g2} към ${mon}`), rows, note: cmpNote(C, rows, missing),
    }),
  });
}

/** the 12 months of the chosen row for both years (null where a year has no report): cumulative or for the month alone */
function cmpMonthsData(C) {
  const row = C.kind.row, natr = C.mode.value === 'natrupano';
  const val = (y, i) => (natr ? C.cum(y, row, i) : C.mon(y, row, i));
  return { row, natr, A: MONTH_CATS.map((_, i) => val(C.g1, i)), B: MONTH_CATS.map((_, i) => val(C.g2, i)) };
}

export function cmpMonthsSpec(C, D = cmpMonthsData(C)) {
  const { row, natr, A, B } = D;
  const max = [...A, ...B].filter(fin).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const u = chartUnit(C.ctx, { pct: false, max });
  const both = MONTH_CATS.map((_, i) => i).filter(i => fin(A[i]) && fin(B[i]));
  const k = both.length ? both[both.length - 1] : null;
  const shown = v => `${u.fmt(u.conv(v))}${NBSP}${u.unit}`;
  const when = natr ? 'към края на' : 'през';
  const desc = k == null ? `${C.kind.label} по месеци за ${C.g1} и ${C.g2} г.`
    : `${cap1(when)} ${monthName(k + 1)} ${C.g2} г. ${C.kind.the} ${C.kind.verb} ${shown(B[k])}, при ${shown(A[k])} ${when} ${monthName(k + 1)} ${C.g1} г.`;
  const tcol = (key, label, unit, d) => ({ key, label, unit, d, num: true });
  return {
    id: 's15-cmp-chart', type: 'bar', title: `${C.kind.label} по месеци: ${C.g1} и ${C.g2} г.`, categoryLabel: 'Месец', categories: MONTH_CATS,
    sub: `${u.unit}, ${natr ? 'натрупано от началото на годината' : 'само за месеца'}, ${SCOPE_NAME[C.scope]}`,
    unit: u.unit, d: u.d, fmt: u.fmt, option: u.option(), desc,
    series: [
      { name: `${C.g1} г.`, data: A.map(v => u.conv(v)), color: 'other' },
      { name: `${C.g2} г.`, data: B.map(v => u.conv(v)), color: row === 'rev' ? '--rev' : row === 'exp.total' ? '--exp' : 1 },
    ],
    // the table twin (and the CSV) carries the difference and the change too
    table: {
      columns: [{ key: 'm', label: 'Месец' }, tcol('a', `${C.g1} г.`, u.unit, u.d), tcol('b', `${C.g2} г.`, u.unit, u.d), tcol('d', 'Разлика', u.unit, u.d), tcol('p', 'Промяна', '%', 1)],
      rows: MONTH_CATS.map((_, i) => { const p = pctChange(A[i], B[i]); return { m: cap1(monthName(i + 1)), a: u.conv(A[i]), b: u.conv(B[i]), d: fin(A[i]) && fin(B[i]) ? u.conv(B[i] - A[i]) : null, p: fin(p) ? Math.round(p * 100) / 100 : null }; }),
    },
  };
}

export function cmpMonthsBlock(C) {
  const D = cmpMonthsData(C);
  const { A, B, natr } = D;
  const spec = cmpMonthsSpec(C, D);
  const mc = moneyCol(C.ctx, { d: 1 });
  const rows = MONTH_CATS.map((_, i) => cmpRow(mc, cap1(monthName(i + 1)), A[i], B[i]));
  const missing = [[C.g1, C.n1], [C.g2, C.n2]].filter(x => x[1] < 12).map(([y, n]) => `За ${y} г. има отчети до ${monthName(n)}; за следващите месеци няма данни („${DASH}“).`);
  const has = spec.series.some(s => s.data.some(fin));
  const opts = html`<div class="s15-cmp-opts" role="group" aria-label="Какво да покажем по месеци">
    ${ctl('Показател', 's15-pok-l', seg({ name: 's15-pok', label: 'Показател', value: C.kind.value, query: 'pok', cls: 's15-seg', options: CMP_KINDS.map(x => ({ value: x.value, label: x.label })) }))}
    ${ctl('Стойности', 's15-rez-l', seg({ name: 's15-rez', label: 'Стойности', value: C.mode.value, query: 'rez', cls: 's15-seg', options: CMP_MODES }))}
  </div>`;
  return block({
    id: 's15-b-cmp-months', level: 2, title: 'По месеци', scope: C.scope, source: ['kfp'], asOf: laterOf(C.asOfOf(C.g1, 11), C.asOfOf(C.g2, 11)), cls: 's15-cmp',
    sub: `${C.kind.label}, ${natr ? 'натрупано от началото на годината до края на всеки месец' : 'сумата само за всеки месец'}. Във всяка двойка стълбове левият е ${C.g1} г., десният – ${C.g2} г.`,
    share: has ? { text: spec.desc } : false,
    body: html`${opts}${has ? chart(spec) : EMPTY_CHART()}${dataTable({
      id: 's15-t-cmp-months', caption: `${C.kind.label} по месеци: ${C.g1} и ${C.g2} г., ${natr ? 'натрупано' : 'за всеки месец'}`, dense: true, cls: 's15-tbl',
      columns: cmpColumns(mc, 'Месец', `${C.g1} г.`, `${C.g2} г.`), rows, note: cmpNote(C, rows, missing),
    })}`,
  });
}

export function sravnenieView(C) {
  if (C.problem) return [cmpProblem(C)];
  return [
    html`<div class="s15-lead"><p>Двете години една до друга: първо по пера, после месец по месец.</p></div>`,
    cmpItemsBlock(C),
    cmpMonthsBlock(C),
  ];
}

/* ------------------------------------------------------------------ how the numbers are made */
export function methodDisclosure(M, C = null) {
  const conv = M.years.filter(y => M.ex.data[String(y)] && M.ex.data[String(y)].converted);
  const joinYears = ys => (ys.length > 1 ? `${ys.slice(0, -1).join(', ')} и ${ys[ys.length - 1]}` : String(ys[0]));
  const first = M.years[0];
  const before = first - 1 > EARLIEST_REPORT ? `${EARLIEST_REPORT}–${first - 1}` : String(first - 1);
  return disclosure({
    id: 's15-method', title: 'Как се смятат числата',
    body: html`<ul class="s15-method">
      <li>Числата са натрупани от началото на годината до края на избрания месец.</li>
      <li>Източник са месечните отчети на Министерството на финансите за консолидираната фискална програма. Те са на ${gl('kasova-osnova', 'касова основа')}: отчита се кога парите са влезли или излезли.</li>
      <li>Планът за 2026 г. е „Проект“ към законопроекта за бюджета. Окончателните числа по приетия закон може да се различават.</li>
      <li>Разходите включват вноската в бюджета на ЕС. В таблицата „По пера“ тя е отделен ред.</li>
      ${conv.length ? html`<li>${conv.length > 1 ? `Отчетите за ${joinYears(conv)} г. са били в лева. Превърнали сме ги` : `Отчетът за ${conv[0]} г. е бил в лева. Превърнали сме го`} в евро по фиксирания курс ${num(EUR_RATE, 5)} лв. за 1 €.</li>` : ''}
      <li>Сравняваме със същия месец на предходната година. За ${first} г. сравнение няма: отчетите за ${before} г. предстоят.</li>
      ${C ? html`<li>В „Сравнение на години“ разликата е ${C.g2} г. минус ${C.g1} г., а промяната в проценти е спрямо ${C.g1} г. „За месеца“ е сумата само за този месец, „Натрупано“ е от началото на годината.</li>` : ''}
    </ul>`,
  });
}

/* ------------------------------------------------------------------ the page */
export const needs = ['core', 'execution', 'components?'];
export const styles = ['s15-izpalnenie'];

export function lede(ctx) {
  try {
    if (!ctx.data || !ctx.data.execution) return undefined;
    const M = model(ctx);
    if (M.tab === 'sravnenie') return cmpSummary(cmpModel(M)) || 'Сравни две години по месечните отчети: по пера и месец по месец.';
    if (M.notYet) return `Отчетът към ${date(isoLast(M.Y, M.month))} г. се очаква. Най-новите данни са към ${date(M.asOf)} г.`;
    return summaryText(M) || undefined;
  } catch (e) { return undefined; }
}

const embedOf = fn => ctx => {
  if (!ctx.data || !ctx.data.execution) return null;
  const M = model(ctx);
  if (M.notYet) return null;
  const spec = fn(M);
  return spec && spec.series.some(s => (s.data || []).some(fin)) ? { chart: spec, source: sourcesOf(M), asOf: M.asOf, status: 'real' } : null;
};

export const embeds = {
  's15-cum-rev': embedOf(M => cumChartSpec(M, 'rev')),
  's15-cum-exp': embedOf(M => cumChartSpec(M, 'exp')),
  's15-monthly': embedOf(monthlyChartSpec),
  's15-balance': embedOf(balanceChartSpec),
};

export function render(ctx) {
  const M = model(ctx);
  if (M.tab === 'sravnenie') {
    const C = cmpModel(M);
    return html`${tabNav(M)}${cmpControls(C)}${sravnenieView(C)}${methodDisclosure(M, C)}`;
  }
  const yearNote = !M.planned
    ? callout({
      kind: 'info', title: `Показана е ${M.Y} г.`, id: `s15-y${String(M.Y).slice(2)}`,
      body: html`<p>${M.PY ? `За ${M.Y} г. екранът показва отчета и сравнението с ${M.PY} г., без годишен план.` : `За ${M.Y} г. екранът показва само отчета: без годишен план и без сравнение с предходна година.`}</p>`,
    })
    : '';
  const body = M.notYet ? notYetFrame(M) : M.tab === 'pera' ? peraView(M) : M.tab === 'byudzheti' ? byudzhetiView(M) : obshoView(M);
  return html`${tabNav(M)}${controls(M)}${yearNote}${body}${methodDisclosure(M)}`;
}

export function mount(root, ctx) {
  if (ctx.kind === 'rerender' && ctx.data && ctx.data.execution) {
    const M = model(ctx);
    const t = M.tab === 'sravnenie' ? lede(ctx) : M.notYet ? lede(ctx) : summaryText(M);
    if (t) ctx.announce(t);
  }
}
