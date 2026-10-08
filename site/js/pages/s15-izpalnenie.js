// S15 Изпълнява ли се планът? (G3). Monthly budget execution (KFP, national budget, EU funds) against the plan and the pace of 2025.
// Every number is computed from execution.json (D06/D16/D26) and components.json (D07); nothing is typed from memory.
// Tabs are real routes: #/izpalnenie (Общо), /pera (По пера), /byudzheti (Бюджети). Controls live in the query: ?mesec= ?obhvat= ?ed= ?prag=.
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
import { amount, moneyCol } from '../view.js';

const SCOPES = [['kfp', 'КФП'], ['nat', 'Национален бюджет'], ['eu', 'Средства от ЕС']];
const SCOPE_IN = { kfp: 'в КФП', nat: 'в националния бюджет', eu: 'по средствата от ЕС' };
const THRESHOLDS = [10, 15];
const QUERY_KEYS = ['mesec', 'obhvat', 'ed', 'prag'];
const REV_ROWS = ['rev.tax', 'rev.nontax', 'rev.grants'];
const EXP_ROWS = ['exp.personnel', 'exp.maint', 'exp.interest', 'exp.social', 'exp.subsidies', 'exp.capex', 'exp.abroad', 'exp.reserve'];

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
  const Y = ctx.period && ctx.period.year === 2025 ? 2025 : 2026;
  const cur = ex.data[String(Y)];
  const prevB = Y === 2026 ? ex.data['2025'] : null;
  const planB = Y === 2026 ? ex.plan2026 : null;
  const last = cur.months;
  const scope = SCOPES.some(s => s[0] === q.obhvat) ? q.obhvat : 'kfp';
  const want = Math.floor(Number(q.mesec));
  const month = fin(want) && want >= 1 ? Math.min(want, 12) : last;
  const notYet = month > last;
  const m = notYet ? last : month;
  const unit = Y === 2026 && q.ed === 'pct' ? 'pct' : 'eur';
  const thr = Number(q.prag) === 15 ? 15 : 10;
  const sub = ctx.params && ctx.params.sub;
  const tab = sub === 'pera' ? 'pera' : sub === 'byudzheti' ? 'byudzheti' : 'obsho';
  const cumArr = (yr, row, sc = scope) => (ex.data[String(yr)] && ex.data[String(yr)][sc] && ex.data[String(yr)][sc][row]) || null;
  const monArr = (yr, row, sc = scope) => (ex.monthly && ex.monthly[String(yr)] && ex.monthly[String(yr)][sc] && ex.monthly[String(yr)][sc][row]) || null;
  const planOf = (row, sc = scope) => { const v = planB && planB[sc] ? planB[sc][row] : null; return fin(v) ? v : null; };
  const at = (arr, i) => (Array.isArray(arr) && fin(arr[i]) ? arr[i] : null);
  // share of the 2025 result reached by each month: the file's own pace for the KFP rows (none for rows it does not list, so tiny lines are never flagged), computed for the other scopes
  const paceArr = (row, sc = scope) => {
    const own = ex.pace && ex.pace['2025'] ? ex.pace['2025'][row] : null;
    if (sc === 'kfp') return Array.isArray(own) && own.length === 12 ? own : null;
    const a = cumArr(2025, row, sc);
    const full = lastOf(a);
    return a && fin(full) && full > 0 ? a.map(v => (v / full) * 100) : null;
  };
  const rowName = id => { const r = (ex.rows || []).find(x => x.id === id); return r ? r.short || r.label : id; };
  const asOfAt = i => (cur.asOf && cur.asOf[i]) || null;
  // one line of the picture for a row at the chosen month
  const item = row => {
    const c = at(cumArr(Y, row), m - 1);
    const p = planOf(row);
    const pc = ratio(c, p);
    const pv = prevB ? at(cumArr(2025, row), m - 1) : null;
    const pa = Y === 2026 ? paceArr(row) : null;
    const pcs = pa ? at(pa, m - 1) : null;
    const diff = fin(pc) && fin(pcs) ? r1(r1(pc) - r1(pcs)) : null;
    const flag = scope === 'kfp' && diff != null ? (diff <= -thr + 1e-9 ? 'down' : diff >= thr - 1e-9 ? 'up' : 'none') : null;
    const full25 = Y === 2025 ? lastOf(cumArr(2025, row)) : null;
    return { row, name: rowName(row), c, p, pc, pv, yoy: fin(pv) && pv !== 0 && fin(c) ? (c / pv - 1) * 100 : null, pace: pcs, diff, flag, shareOfYear: Y === 2025 ? ratio(c, full25) : null };
  };
  const M = { ctx, ex, Y, cur, last, scope, month, notYet, m, unit, thr, tab, cumArr, monArr, planOf, at, paceArr, rowName, item, asOf: asOfAt(m - 1) || ex.meta.asOf };
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
  if (M.Y !== 2026 || M.scope !== 'kfp') return null;
  const e = M.k.exp;
  const full25 = lastOf(M.cumArr(2025, 'exp.total'));
  const planGrowth = fin(e.p) && fin(full25) && full25 > 0 ? (e.p / full25 - 1) * 100 : null;
  const pace = e.pace;
  if (!fin(e.pc) || !fin(pace) || !fin(planGrowth) || !fin(e.yoy)) return null;
  return { share: e.pc, pace, planGrowth, yoy: e.yoy, lower: r1(e.pc) < r1(pace), moreMoney: e.yoy > 0 && planGrowth > 0 };
}

function chartNames(M, which) {
  const inPct = M.unit === 'pct';
  return {
    cur: inPct ? `${M.Y}: дял от плана` : String(M.Y),
    prev: inPct ? '2025: дял от резултата за годината' : '2025 (в евро)',
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
  const prev = M.Y === 2026 ? M.cumArr(2025, row) : null;
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
    ? `Към ${monthName(M.m)} са ${names.verb} ${pct(it.pc)} от годишния план; по същото време на 2025 г. е бил достигнат ${pct(it.pace)} от резултата за годината.`
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
  const prev = M.Y === 2026 ? M.monArr(2025, 'balance') : null;
  const worst = (bal || []).slice(0, n).reduce((b, v, i) => (fin(v) && (b < 0 || v < bal[b]) ? i : b), -1);
  const series = [{ name: String(M.Y), data: cut(bal), color: 1 }];
  if (prev) series.push({ name: '2025 (в евро)', data: cut(prev), color: 'other' });
  return {
    id: 's15-balance', type: 'bar', title: 'Салдо по месеци', categoryLabel: 'Месец', categories: MONTH_CATS.slice(0, n),
    sub: `млрд. €, ${SCOPE_NAME[M.scope]} (под нулата е дефицит)`, unit: 'млрд. €', d: 2, series,
    desc: worst >= 0 && bal[worst] < 0 ? `Най-големият месечен дефицит е през ${monthName(worst + 1)}: ${num(-mlrd(bal[worst]), 2)} млрд. €.` : 'Месечното салдо.',
  };
}

/* ------------------------------------------------------------------ controls, tabs, the frame for a month without a report */
const cap1 = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sourcesOf = M => (M.Y === 2026 ? ['kfp', 'asbp'] : ['kfp']);

function monthOptions(M) {
  const out = [];
  for (let i = 1; i <= M.last; i++) out.push({ value: String(i), label: `${cap1(monthName(i))} ${M.Y}` });
  if (M.Y === 2026) {
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
  if (M.tab === 'obsho' && M.Y === 2026) {
    parts.push(ctl('Мерна единица', 's15-ed-l', seg({ name: 's15-ed', label: 'Мерна единица на графиките', value: M.unit, query: 'ed', cls: 's15-seg', options: [{ value: 'eur', label: 'млрд. €' }, { value: 'pct', label: '% от плана' }] })));
  }
  if (M.tab === 'pera' && M.Y === 2026 && M.scope === 'kfp') {
    parts.push(ctl('Праг за отбелязване', 's15-prag-l', seg({ name: 's15-prag', label: 'Праг за отбелязване в пункта', value: String(M.thr), query: 'prag', cls: 's15-seg', options: THRESHOLDS.map(v => ({ value: String(v), label: `${v}${NBSP}пр.п.` })) })));
  }
  return html`<div class="s15-controls" role="group" aria-label="Какво да покажем">${parts}</div>`;
}

export function tabNav(M) {
  const ctx = M.ctx;
  const q = keepQuery(ctx);
  const item = (sub, label) => ({ label, href: ctx.href('S15', sub ? { sub } : {}, q), pressed: M.tab === (sub || 'obsho') });
  return html`<nav class="s15-tabs" aria-label="Раздели на екрана">${chips({ items: [item(null, 'Общо'), item('pera', 'По пера'), item('byudzheti', 'Бюджети')] })}</nav>`;
}

/** the month the visitor asked for has no report yet (August 2026 today) */
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
  const planned = M.Y === 2026;
  const vs = 'спрямо същото време на 2025 г.';
  const dl = it => (planned && fin(it.yoy) ? { value: it.yoy, unit: '%', d: 1, label: vs } : undefined);
  const ofPlan = it => (planned && fin(it.pc) ? `${pct(it.pc, 1)} от годишния план` : undefined);
  const kind = !fin(bal.c) ? 'Салдо' : bal.c < 0 ? 'Дефицит' : bal.c > 0 ? 'Излишък' : 'Салдо';
  const same = (a, b) => fin(a) && fin(b) && a !== 0 && b !== 0 && Math.sign(a) === Math.sign(b);
  const balShare = planned && same(bal.c, bal.p) ? ratio(bal.c, bal.p) : null;
  const balDelta = planned && same(bal.c, bal.pv) ? (bal.c / bal.pv - 1) * 100 : null;
  const planWord = fin(bal.p) && bal.p > 0 ? 'планирания излишък' : 'планирания дефицит';
  const items = [
    kpi({ label: 'Събрани приходи', mln: rev.c, delta: dl(rev), sub: ofPlan(rev) }),
    kpi({ label: 'Похарчени разходи', mln: exp.c, delta: dl(exp), sub: ofPlan(exp) }),
    kpi({ label: kind, mln: fin(bal.c) ? Math.abs(bal.c) : null, delta: fin(balDelta) ? { value: balDelta, unit: '%', d: 1, label: vs } : undefined, sub: fin(balShare) ? `${pct(balShare, 1)} от ${planWord} за годината` : undefined }),
  ];
  return block({
    id: 's15-kpi', level: 2, title: 'Накратко', scope: M.scope, source: sourcesOf(M), asOf: M.asOf,
    sub: M.Y === 2026 ? 'Числата са натрупани от началото на годината.' : 'Числата са натрупани от началото на годината; за 2025 г. няма годишен план за сравнение.',
    share: { text: summaryText(M) },
    body: kpiGrid(items, { label: 'Основни числа' }),
  });
}

export function rhythmCallout(M) {
  const f = rhythmFacts(M);
  if (!f) return '';
  const body = html`
    <p>Към ${monthName(M.m)} са изразходвани ${pct(f.share, 1)} от годишния план. По същото време на 2025 г. вече са били изразходвани ${pct(f.pace, 1)} от разходите за цялата година.</p>
    <p>Приходите и разходите не се разпределят равномерно по месеци (${gl('sezonnost', 'сезонност')}). Затова сравняваме не с „една дванайсета на месец“, а с дела, достигнат по същото време на 2025 г.</p>
    <p>Планът за разходите през 2026 г. е с ${num(f.planGrowth, 1)}% по-голям от отчетените разходи през цялата 2025 г. Към ${monthName(M.m)} са похарчени с ${num(f.yoy, 1)}% ${f.yoy >= 0 ? 'повече' : 'по-малко'} пари, отколкото към ${monthName(M.m)} 2025 г.${f.lower && f.moreMoney ? ' Затова по-малкият дял от плана не е същото като по-малко похарчени пари.' : ''}</p>`;
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

const cumTitle = (M, which) => (M.Y === 2026 ? (which === 'rev' ? 'Приходи спрямо плана' : 'Разходи спрямо плана') : (which === 'rev' ? 'Приходи през годината' : 'Разходи през годината'));
const cumSub = M => (M.Y !== 2026 ? 'Натрупани от началото на годината.'
  : M.unit === 'pct' ? 'Колко процента от годишния план са стигнати до всеки месец, сравнено с дела от резултата за 2025 г.'
  : 'Плътната линия е 2026 г., прекъснатата е 2025 г., а хоризонталната линия е годишният план.');

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
const peraMode = M => (M.Y === 2025 ? 'year' : M.scope === 'kfp' ? 'plan' : 'yoy');

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
      { key: 'pace', label: 'Дял по същото време на 2025 г.', num: true, unit: '%', d: 1, fmt: pctCell },
      { key: 'flag', label: 'Спрямо хода на 2025 г.', fmt: flagCell },
    ];
  }
  if (mode === 'yoy') {
    return [
      { key: 'name', label: 'Перо' },
      money('cum', `${got} към ${mon} ${M.Y}`, 'mc'),
      money('prev', `${got} към ${mon} 2025`, 'mv'),
      { key: 'yoy', label: 'Промяна', num: true, unit: '%', d: 1, fmt: v => (fin(v) ? delta(v, 1) : DASH) },
    ];
  }
  return [
    { key: 'name', label: 'Перо' },
    money('cum', `${got} към ${mon} ${M.Y}`, 'mc'),
    { key: 'part', label: `Дял от резултата за ${M.Y} г.`, num: true, unit: '%', d: 1, fmt: pctCell },
  ];
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
      ? dataTable({ id: `s15-t-${kind}`, caption: `${title}: ${mode === 'plan' ? 'план, изпълнение и дял от плана' : mode === 'yoy' ? 'натрупано спрямо същото време на 2025 г.' : 'натрупано и дял от резултата за годината'}`, columns: peraColumns(M, mc, kind), rows, total, note: noteParts.join(' ') || undefined, dense: true, cls: 's15-tbl' })
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
      <p>Сравняваме два дяла: колко процента от годишния план са изпълнени към ${mon} ${M.Y} г. и колко процента от резултата за цялата 2025 г. са били достигнати към същия месец. Когато двата дяла се различават с поне ${M.thr}${NBSP}${gl('protsenten-punkt', 'процентни пункта')}, редът е отбелязан: ▼ „изостава“ или ▲ „изпреварва“.</p>
      <p>При праг 10${NBSP}пр.п. се отбелязват ${n[10]} ${word(n[10])}, а при праг 15${NBSP}пр.п. – ${n[15]} ${word(n[15])}. Прагът се сменя от избора по-горе.${flagged.length ? ` Сега са отбелязани: ${list}.` : ' Сега няма отбелязани редове.'}</p>
    </div>`;
  }
  if (mode === 'yoy') {
    return html`<div class="s15-lead"><p>Тук сравняваме натрупаното към ${mon} ${M.Y} г. с натрупаното към същия месец на 2025 г. За ${M.scope === 'nat' ? 'националния бюджет' : 'средствата от ЕС'} няма годишен план по видове, затова няма дял от плана. Планът за общите суми и трансферите е в раздела <a href="${ctx.href('S15', { sub: 'byudzheti' }, keepQuery(ctx))}">„Бюджети“</a>.</p></div>`;
  }
  return html`<div class="s15-lead"><p>Показваме натрупаното към ${mon} 2025 г. и дела му от резултата за цялата година. За 2025 г. няма годишен план, затова няма дял от плана и няма отбелязване на изоставане.</p></div>`;
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

/* ------------------------------------------------------------------ Бюджети: плана по съставни бюджети (D07), националният бюджет и средствата от ЕС (официални данни) */
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
      const p = M.Y === 2026 ? M.planOf(id, sc) : null;
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
    sub: `Натрупано към ${date(M.asOf)} г.${M.Y === 2026 ? ' Под сумата е показан делът от годишния план.' : ''}`,
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

/* ------------------------------------------------------------------ how the numbers are made */
export function methodDisclosure(M) {
  const converted = !!(M.ex.data['2025'] && M.ex.data['2025'].converted);
  return disclosure({
    id: 's15-method', title: 'Как се смятат числата',
    body: html`<ul class="s15-method">
      <li>Числата са натрупани от началото на годината до края на избрания месец.</li>
      <li>Източник са месечните отчети на Министерството на финансите за консолидираната фискална програма. Те са на ${gl('kasova-osnova', 'касова основа')}: отчита се кога парите са влезли или излезли.</li>
      <li>Планът за 2026 г. е „Проект“ към законопроекта за бюджета. Окончателните числа по приетия закон може да се различават.</li>
      <li>Разходите включват вноската в бюджета на ЕС. В таблицата „По пера“ тя е отделен ред.</li>
      ${converted ? html`<li>Отчетът за 2025 г. е бил в лева. Превърнали сме го в евро по фиксирания курс ${num(EUR_RATE, 5)} лв. за 1 €.</li>` : ''}
      <li>Сравняваме само с 2025 г.: отчетите за 2022–2024 г. предстоят.</li>
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

/** one line that says what the numbers are: a report, against which plan, for which scope, in which unit */
export function contextLine(M) {
  const against = M.Y === 2026 ? `спрямо плана по Закона за ${M.Y}` : 'предварителен, без план за сравнение';
  const scope = M.tab === 'byudzheti' ? 'по съставни бюджети' : SCOPE_NAME[M.scope];
  const unit = M.tab === 'obsho' && M.unit === 'pct' ? 'млрд. € и % от плана' : 'млрд. €';
  return html`<span class="ctx-period"><strong>${M.notYet ? 'Последен отчет' : 'Отчет'} към ${date(M.asOf)}</strong> <span class="muted">· ${against} · ${scope} · ${unit}</span></span>`;
}

export function render(ctx) {
  const M = model(ctx);
  const y25 = M.Y === 2025
    ? callout({ kind: 'info', title: 'Показана е 2025 г.', body: html`<p>За 2025 г. екранът показва само отчета: без годишен план и без сравнение с предходна година.</p>`, id: 's15-y25' })
    : '';
  const body = M.notYet ? notYetFrame(M) : M.tab === 'pera' ? peraView(M) : M.tab === 'byudzheti' ? byudzhetiView(M) : obshoView(M);
  return { body: html`${tabNav(M)}${controls(M)}${y25}${body}${methodDisclosure(M)}`, context: contextLine(M), ownContext: true };
}

export function mount(root, ctx) {
  if (ctx.kind === 'rerender' && ctx.data && ctx.data.execution) {
    const M = model(ctx);
    const t = M.notYet ? lede(ctx) : summaryText(M);
    if (t) ctx.announce(t);
  }
}
