// S22 · Големите проекти · #/proekti/:id? · next S23 · periods 2026.draft and 2026.law · phase 2
// Data, only through `needs`:
//   core            REAL  core.kpis.capex: the plan and the execution of the capital expenditure of the state (the one real block of the screen)
//   mock/projects   M05, MOCK  14 invented capital projects: the list, the filters, the cards and one page per project
//                   (optional: without it the examples are „предстои“ and the real block still shows)
// #/proekti is the list (banner, the real plan, the example projects with their filters, how to read the cards); #/proekti/pr-01 is one project.
// The screen is a pure function of ctx. The filters live in the address (?oblast= ?status= ?srok= ?napredak= ?sort=), an unknown value is ignored.
// Nothing is typed in: every sum, share, percentage and date sentence is computed from the data. The share of the year's total in the real capital plan
// is computed from core.kpis.capex.planMln (the file's own yearSharePct is only a cross-check in the tests).
// Money of one project is printed in млн. € with „и в лева“ only: „на човек“ and „% от БВП“ make no sense for one project.
import { html, raw } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { progress } from '../ui/progress.js';
import { timeline } from '../ui/timeline.js';
import { ranklist } from '../ui/ranklist.js';
import { callout, facts } from '../ui/cards.js';
import { disclosure } from '../ui/disclosure.js';
import { field, selectInput } from '../ui/forms.js';
import { emptyState, pendingState, mockBadge } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { icon } from '../icons.js';
import { toast } from '../ui/toast.js';
import { csvFor, download, copyOrShow } from '../share.js';
import { num, pct, plural, money, moneyParts, date } from '../format.js';

export const needs = ['core', 'mock/projects?'];
export const styles = ['s22-proekti'];
export const periods = ['2026.draft', '2026.law'];
export const lede = ctx => (ctx.params?.id
  ? 'Един примерен проект: докъде е стигнал, колко струва и откъде идват парите.'
  : 'Виж кои големи обекти строи държавата и докъде са стигнали. Проектите тук са измислени и показват как ще работи екранът.');

const SRC = ['mockgen'];
const PLAN_TITLE = 'Капиталови разходи на държавата';
const EX_TITLE = 'Примерни проекти';
const HOW_TITLE = 'Как да четеш картите';
const STATES = ['planned', 'building', 'late', 'done'];
const STATE_LABEL = { planned: 'Предстои', building: 'В изпълнение', late: 'С изоставане', done: 'Завършен' };   // used only when the data carries no labels
const STATE_ICON = { planned: 'clock', building: 'hardHat', late: 'alert', done: 'checkCircle' };
// the progress filter: bands of whole percents (a project is in the band when lo <= progress < hi + 1)
const BANDS = [
  { id: '0', lo: 0, hi: 24, label: 'Под 25%' },
  { id: '25', lo: 25, hi: 49, label: 'От 25% до 49%' },
  { id: '50', lo: 50, hi: 74, label: 'От 50% до 74%' },
  { id: '75', lo: 75, hi: 99, label: 'От 75% до 99%' },
  { id: '100', lo: 100, hi: 100, label: 'Напълно изпълнен (100%)' }
];
const SORTS = [
  { value: '', label: 'Най-голяма стойност' },
  { value: 'srok', label: 'Най-близък краен срок' },
  { value: 'napredak', label: 'Най-малък напредък' },
  { value: 'oblast', label: 'Област (по азбучен ред)' }
];
const COMPARE = {
  '': (a, b) => b.totalMln - a.totalMln,
  srok: (a, b) => dayN(a.deadline) - dayN(b.deadline),
  napredak: (a, b) => a.progressPct - b.progressPct,
  oblast: (a, b) => bg(a.region, b.region)
};

const ok = v => typeof v === 'number' && Number.isFinite(v);
const bg = (a, b) => String(a).localeCompare(String(b), 'bg');
const lower1 = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const inBand = (b, p) => ok(p) && p >= b.lo && p < b.hi + 1;
/** a day number from an ISO date („2026-08-31“), NaN when it is not one (UTC, so the same answer everywhere) */
const dayN = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN; };
/** a share of a total, 2,6% or 0,04% (a tiny share keeps two decimals so it is not printed as 0,0%) */
const shareText = v => (!ok(v) ? '—' : v > 0 && v < 0.1 ? pct(v, 2) : pct(v, 1));
/** the leva part of a million-euro amount („≈ 46,9 млн. лв.“) without the brackets */
const levaOf = mln => { const s = money(mln, { leva: true, scale: 'mln', d: 1 }); const i = s.indexOf('(≈'); return i < 0 ? '' : s.slice(i + 1, -1); };
const lastStage = p => (Array.isArray(p.stages) && p.stages.length ? p.stages[p.stages.length - 1] : null);
const doneDate = p => lastStage(p)?.date ?? p.deadline;

/* ---------------------------------------------------------------- the model: everything the screen shows, from ctx alone */
function model(ctx) {
  const doc = ctx.data['mock/projects'];
  const items = (Array.isArray(doc?.items) ? doc.items : []).filter(p => p && p.id && p.name && ok(p.totalMln) && ok(p.yearMln) && ok(p.paidMln) && ok(p.progressPct));
  const core = ctx.core || ctx.data.core || {};
  const capex = core.kpis?.capex;
  const plan = ok(capex?.planMln) && capex.planMln > 0 ? capex.planMln : null;
  const base = { core, capex, plan, lv: !!ctx.store.get('leva'), onlyReal: !!ctx.store.get('onlyReal') };
  if (!items.length) return { ok: false, ...base };

  const meta = doc.meta || {};
  const asOf = typeof meta.progressAsOf === 'string' && Number.isFinite(dayN(meta.progressAsOf)) ? meta.progressAsOf : null;
  const labels = { ...STATE_LABEL };
  for (const s of Array.isArray(meta.statusLabels) ? meta.statusLabels : []) if (s && s.id && s.label) labels[s.id] = String(s.label);
  const regionOf = p => String(p.regionId ?? p.region ?? '');
  const regionNames = new Map();
  for (const p of items) if (!regionNames.has(regionOf(p))) regionNames.set(regionOf(p), String(p.region ?? regionOf(p)));
  const regions = [...regionNames].map(([id, name]) => ({ id, name })).sort((a, b) => bg(a.name, b.name));
  const years = [...new Set(items.map(p => String(p.deadline).slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort();
  const statuses = STATES.filter(s => items.some(p => p.status === s));
  const bands = BANDS.filter(b => items.some(p => inBand(b, p.progressPct)));
  const q = ctx.query || {};
  const f = {
    oblast: regions.some(r => r.id === q.oblast) ? q.oblast : '',
    status: statuses.includes(q.status) ? q.status : '',
    srok: years.includes(q.srok) ? q.srok : '',
    napredak: bands.some(b => b.id === q.napredak) ? q.napredak : '',
    sort: SORTS.some(s => s.value && s.value === q.sort) ? q.sort : ''
  };
  const anyFilter = !!(f.oblast || f.status || f.srok || f.napredak);
  const band = bands.find(b => b.id === f.napredak);
  const list = items
    .filter(p => (!f.oblast || regionOf(p) === f.oblast) && (!f.status || p.status === f.status) && (!f.srok || String(p.deadline).startsWith(f.srok)) && (!band || inBand(band, p.progressPct)))
    .sort(COMPARE[f.sort]);
  const sum = key => list.reduce((a, p) => a + p[key], 0);
  const sums = { total: sum('totalMln'), year: sum('yearMln'), paid: sum('paidMln') };
  const counts = Object.fromEntries(STATES.map(s => [s, list.filter(p => p.status === s).length]));
  const stageNames = Array.isArray(items[0].stages) ? items[0].stages.map(s => String(s.name)) : [];
  const weights = Array.isArray(meta.stageWeights) && meta.stageWeights.length === stageNames.length && meta.stageWeights.every(ok) ? meta.stageWeights : null;
  return {
    ok: true, ...base, doc, meta, items, byId: new Map(items.map(p => [String(p.id).toLowerCase(), p])),
    asOf, asOfN: asOf ? dayN(asOf) : NaN, year: asOf ? asOf.slice(0, 4) : null, labels, regions, years, statuses, bands, f, anyFilter, list, sums, counts,
    shareYear: plan && list.length ? (sums.year / plan) * 100 : null,
    sources: Array.isArray(meta.financingSources) ? meta.financingSources.map(String) : [],
    stageNames, weights, why: String(items[0].why || ''),
    sortLabel: SORTS.find(s => s.value === f.sort)?.label ?? SORTS[0].label
  };
}

/* ---------------------------------------------------------------- sentences (pure) */
const yearText = md => (md.year ? `Планирано за ${md.year} г.` : 'Планирано за годината');

/** how much of the time to the deadline has passed (0-100) on the date of the data, null when the dates are not there */
function timePct(p, asOfN) {
  const a = dayN(p.start), b = dayN(p.deadline);
  if (![a, b, asOfN].every(Number.isFinite) || b <= a) return null;
  return Math.min(100, Math.max(0, ((asOfN - a) / (b - a)) * 100));
}
function lateText(p, md) {
  const dl = dayN(p.deadline);
  if (Number.isFinite(dl) && Number.isFinite(md.asOfN) && dl < md.asOfN) return `Крайният срок (${date(p.deadline)}) е минал, а проектът още не е завършен.`;
  const t = timePct(p, md.asOfN);
  if (ok(t) && t > p.progressPct) return `Изминали са около ${pct(t, 0)} от времето до крайния срок (${date(p.deadline)}), а напредъкът е ${pct(p.progressPct, 0)}.`;
  return `Проектът изостава от плана. Крайният срок е ${date(p.deadline)}.`;
}
/** one sentence on where the project stands; a project that simply runs needs none (the pill says it) */
function stateText(p, md) {
  if (p.status === 'late') return lateText(p, md);
  if (p.status === 'planned') return `Строителството още не е започнало. То започва на ${date(p.start)}.`;
  if (p.status === 'done') return `Проектът е завършен на ${date(doneDate(p))}.`;
  return '';
}
function stageInfo(s, md) {
  const overdue = s.status === 'doing' && dayN(s.date) < md.asOfN;
  return { overdue, kind: s.status === 'todo' ? 'expected' : overdue ? 'warning' : 'event' };
}
function daysText(p, md) {
  if (p.status === 'done') return `Завършен на ${date(doneDate(p))}.`;
  const d = dayN(p.deadline) - md.asOfN;
  if (!Number.isFinite(d) || !md.asOf) return '';
  if (d > 1) return `Остават ${num(d, 0)} дни към ${date(md.asOf)}.`;
  if (d === 1) return `Остава 1 ден към ${date(md.asOf)}.`;
  if (d === 0) return `Срокът изтича на ${date(md.asOf)}.`;
  return `Срокът е минал преди ${plural(-d, 'ден', 'дни')} (към ${date(md.asOf)}).`;
}

/* ---------------------------------------------------------------- small pieces */
const moneyCell = (mln, lv) => {
  const { v, u } = moneyParts(mln, { scale: 'mln', d: 1 });
  return html`<span class="s22-num">${v}</span> <span class="s22-unit">${u}</span>${lv ? html` <span class="s22-lev">(${levaOf(mln)})</span>` : ''}`;
};
const statePill = (p, md) => html`<span class="s22-st" data-s22-state="${p.status}">${icon(STATE_ICON[p.status] || 'clock', { size: 14 })}<span>${md.labels[p.status] ?? p.status}</span></span>`;
const pctOf = (a, b) => (ok(a) && ok(b) && b > 0 ? (a / b) * 100 : null);

function countText(md) {
  const n = md.list.length, all = md.items.length;
  if (!n) return 'Няма проекти с тези филтри.';
  if (!md.anyFilter) return all === 1 ? 'Показан е 1 примерен проект.' : `Показани са всички ${num(all, 0)} примерни проекта.`;
  return n === 1 ? `Показан е 1 от ${num(all, 0)} примерни проекта.` : `Показани са ${num(n, 0)} от ${num(all, 0)} примерни проекта.`;
}

/** the table of the list: the same rows for the CSV button and for the „Сподели“ menu of the block */
function csvTable(md) {
  return {
    columns: ['Проект', 'Област', 'Състояние на проекта', 'Начало на строителството', 'Краен срок', 'Напредък, %', 'Обща стойност, млн. €', `${yearText(md)}, млн. €`, 'Платено досега, млн. €', 'Очакван резултат'],
    rows: md.list.map(p => [p.name, p.region, md.labels[p.status] ?? p.status, date(p.start), date(p.deadline), p.progressPct, p.totalMln, p.yearMln, p.paidMln, p.expectedResult])
  };
}
const csvSpec = md => ({ id: 's22-spisak', route: 'proekti', source: SRC, status: 'mock', mock: true, asOf: md.asOf, table: () => csvTable(md) });

/* ---------------------------------------------------------------- the list */
function findCard(md) {
  const pick = (id, label, name, value, options) => field({ id, label, control: selectInput({ id, name, value, options, query: name }) });
  const first = (value, label) => ({ value, label });
  return html`<div class="s22-find" role="search" aria-label="Филтри за примерните проекти">
    <div class="s22-controls">
      ${pick('s22-oblast', 'Област', 'oblast', md.f.oblast, [first('', 'Всички области'), ...md.regions.map(r => first(r.id, r.name))])}
      ${pick('s22-status', 'Състояние', 'status', md.f.status, [first('', 'Всички състояния'), ...md.statuses.map(s => first(s, md.labels[s] ?? s))])}
      ${pick('s22-srok', 'Краен срок', 'srok', md.f.srok, [first('', 'Всички срокове'), ...md.years.map(y => first(y, `През ${y} г.`))])}
      ${pick('s22-napredak', 'Напредък', 'napredak', md.f.napredak, [first('', 'Всеки напредък'), ...md.bands.map(b => first(b.id, b.label))])}
      <div class="s22-sortcell">${pick('s22-sort', 'Подреди по', 'sort', md.f.sort, SORTS)}</div>
    </div>
    <div class="s22-bar">
      <p class="s22-count" id="s22-count">${countText(md)}</p>
      <div class="s22-actions">
        ${md.anyFilter ? html`<button type="button" class="btn btn-sm btn-quiet" id="s22-clear">${icon('x', { size: 16 })}<span>Изчисти филтрите</span></button>` : ''}
        ${md.list.length ? html`<button type="button" class="btn btn-sm btn-quiet" id="s22-csv">${icon('download', { size: 16 })}<span>Свали като CSV</span></button>` : ''}
      </div>
    </div>
  </div>`;
}

function stagesList(p, md) {
  return html`<ol class="s22-stages">${(p.stages || []).map(s => {
    const { overdue } = stageInfo(s, md);
    const word = s.status === 'done' ? `Завършен на ${date(s.date)}` : s.status === 'doing' ? `В ход, краят е планиран за ${date(s.date)}` : `Предстои, до ${date(s.date)}`;
    return html`<li data-s22-stage="${s.status}"><span class="s22-stage-name">${s.name}</span><span class="s22-stage-state">${word}${overdue ? html`<span class="s22-late-flag">${icon('alert', { size: 14 })}<span>срокът е минал</span></span>` : ''}</span></li>`;
  })}</ol>`;
}
function financingList(p, md) {
  const total = (p.financing || []).reduce((a, x) => a + (ok(x.mln) ? x.mln : 0), 0);
  return html`<ul class="s22-fin">${(p.financing || []).filter(x => x && x.source && ok(x.mln)).map(x => html`<li><span class="s22-fin-name">${x.source}</span><span class="s22-fin-val">${moneyCell(x.mln, md.lv)} <span class="s22-fin-share">(${pct(pctOf(x.mln, total), 0)})</span></span></li>`)}</ul>`;
}

function card(p, md, ctx) {
  const id = `s22-${p.id}`;
  const text = stateText(p, md);
  const stages = Array.isArray(p.stages) ? p.stages.length : 0;
  const sources = Array.isArray(p.financing) ? p.financing.length : 0;
  return html`<article class="s22-card" id="${id}" data-s22-state="${p.status}" aria-labelledby="${id}-t">
    <span class="s22-strip" data-mock="true" aria-hidden="true"></span>
    <h3 class="s22-name" id="${id}-t"><a href="${ctx.href('proekti', { id: p.id })}">${p.name}</a></h3>
    <div class="s22-meta"><span class="s22-region">Област ${p.region}</span>${statePill(p, md)}${mockBadge()}</div>
    ${progress({ id: `${id}-p`, label: 'Напредък', value: p.progressPct, max: 100, text: pct(p.progressPct, 0), mock: true })}
    <dl class="s22-nums">
      <div><dt>Обща стойност</dt><dd>${moneyCell(p.totalMln, md.lv)}</dd></div>
      <div><dt>${yearText(md)}</dt><dd>${moneyCell(p.yearMln, md.lv)}</dd></div>
      <div><dt>Платено досега</dt><dd>${moneyCell(p.paidMln, md.lv)}</dd></div>
      <div><dt>Краен срок</dt><dd><time datetime="${p.deadline}">${date(p.deadline)}</time></dd></div>
    </dl>
    ${text ? html`<p class="s22-state">${text}</p>` : ''}
    ${p.expectedResult ? html`<p class="s22-result"><strong>Очакван резултат:</strong> ${p.expectedResult}</p>` : ''}
    ${disclosure({
      id: `${id}-det`,
      title: 'Етапи и финансиране',
      meta: [stages ? plural(stages, 'етап', 'етапа') : '', sources ? plural(sources, 'източник', 'източника') : ''].filter(Boolean).join(' · '),
      body: html`<div class="s22-det"><p class="s22-det-h">Етапи</p>${stagesList(p, md)}<p class="s22-det-h">Откъде са парите</p>${financingList(p, md)}</div>`
    })}
    <p class="s22-foot"><a class="s22-more" href="${ctx.href('proekti', { id: p.id })}">Страница на проекта<span class="sr-only">: ${p.name}</span></a>
      <button type="button" class="btn btn-sm btn-quiet" data-s22-copy="${p.id}">${icon('copy', { size: 16 })}<span>Копирай линк</span><span class="sr-only"> към проекта „${p.name}“</span></button></p>
  </article>`;
}

function tiles(md) {
  const { sums, counts, list } = md;
  const breakdown = STATES.filter(s => counts[s] > 0).map(s => `${md.labels[s] ?? s}: ${num(counts[s], 0)}`).join(' · ');
  const lvl = mln => (md.lv ? ` (${levaOf(mln)})` : '');
  const tot = moneyParts(sums.total, { scale: 'mln', d: 1 }), yr = moneyParts(sums.year, { scale: 'mln', d: 1 }), paid = moneyParts(sums.paid, { scale: 'mln', d: 1 });
  const shareSub = md.shareYear !== null ? `Това е ${shareText(md.shareYear)} от плана за капиталови разходи на държавата за ${md.year ?? 'годината'} г. (${money(md.plan)}).` : '';
  return kpiGrid([
    kpi({ label: 'Проекти', value: list.length, mock: true, sub: breakdown }),
    kpi({ label: 'Обща стойност', value: tot.v, unit: tot.u, mock: true, sub: `Пълната цена на показаните проекти.${lvl(sums.total)}` }),
    kpi({ label: yearText(md), value: yr.v, unit: yr.u, mock: true, sub: `${shareSub}${lvl(sums.year)}`.trim() || undefined }),
    kpi({ label: 'Платено досега', value: paid.v, unit: paid.u, mock: true, sub: `${pct(pctOf(sums.paid, sums.total), 1)} от общата стойност${md.asOf ? `, към ${date(md.asOf)}` : ''}.${lvl(sums.paid)}` })
  ], { label: 'Основни числа за показаните проекти' });
}

function banner() {
  return callout({
    kind: 'warn', icon: 'hatch', id: 's22-banner',
    title: 'Измислени примери, които показват функционалността.',
    body: html`<p>Проектите на тази страница ги няма в действителност: името, мястото, сроковете и сумите са примерни. Реално е само числото за капиталовите разходи на държавата.</p>`
  });
}

function realBlock(ctx, md) {
  const c = md.capex;
  if (md.plan === null) {
    return block({ id: 's22-plan', title: PLAN_TITLE, scope: 'kfp', status: 'pending', source: ['kfp'], body: pendingState({ title: 'Предстои', text: 'Числото за капиталовите разходи на държавата още не е заредено.' }) });
  }
  const asOf = md.core.kpis?.asOf;
  const execTile = ok(c.execMln)
    ? kpi({ label: asOf ? `Изразходвано до ${date(asOf)}` : 'Изразходвано досега', mln: c.execMln, sub: ok(c.execPct) ? `Това е ${pct(c.execPct, 1)} от плана за годината.` : undefined })
    : '';
  return block({
    id: 's22-plan', title: PLAN_TITLE, scope: 'kfp', source: ['kfp'], asOf,
    sub: 'Колко пари държавата планира и е изразходвала за обекти, които служат много години.',
    body: html`<div class="s22-stack">
      ${kpiGrid([kpi({ label: 'План за годината', mln: c.planMln, pctGdp: c.pctGdp, sub: 'Колко пари е заложила държавата за такива разходи.' }), execTile], { label: 'Капиталови разходи на държавата: план и изпълнение' })}
      <p class="s22-read">${gl('kapitalovi-razhodi', 'Капиталовите разходи')} са парите за пътища, сгради, болници, техника и други неща, които служат много години. Проектите по-долу са измислени и показват как ще се следи един голям обект.</p>
      <p class="s22-links"><a class="btn btn-quiet" href="${ctx.href('izpalnenie', { sub: 'pera' })}">Виж изпълнението по пера${icon('arrowRight', { size: 16 })}</a></p>
    </div>`
  });
}

function examplesBlock(ctx, md) {
  if (!md.ok) {
    return block({ id: 's22-spisak', title: EX_TITLE, status: 'pending', body: pendingState({ title: 'Предстои', text: 'Примерният списък с проекти още не е зареден.' }) });
  }
  if (md.onlyReal) return block({ id: 's22-spisak', title: EX_TITLE, mock: true });
  const n = md.list.length;
  const body = html`<div class="s22-stack">
    ${n ? tiles(md) : ''}
    ${findCard(md)}
    ${n
      ? html`<ul class="s22-list" aria-label="Списък с примерни проекти">${md.list.map(p => html`<li>${card(p, md, ctx)}</li>`)}</ul>`
      : emptyState({
        title: 'Няма проекти с тези филтри',
        text: 'Махни някой филтър или го смени, за да видиш проектите.',
        actions: [{ label: 'Покажи всички проекти', href: ctx.href('proekti'), primary: true }]
      })}
  </div>`;
  return block({
    id: 's22-spisak', title: EX_TITLE, mock: true, why: md.why, source: SRC, asOf: md.asOf,
    share: { text: `Измислени примери: ${plural(n, 'проект', 'проекта')} с обща стойност ${money(md.sums.total, { scale: 'mln', d: 1 })}.`, table: () => csvTable(md) },
    sub: 'Филтрирай по област, състояние, срок и напредък. Сумите са в милиони евро.',
    body
  });
}

function howBlock(md) {
  if (!md.ok || md.onlyReal) return '';
  const weights = md.weights
    ? html`<p>Напредъкът е сборът от тежестта на завършените етапи: ${md.stageNames.map((n, i) => `${lower1(n)} — ${pct(md.weights[i], 0)}`).join(', ')}. Ако един етап още върви, добавяме дела, който е готов.</p>`
    : '';
  const sources = md.sources.length ? html`<p>Финансирането показва откъде идват парите: ${md.sources.map(lower1).join(', ')}.</p>` : '';
  return block({
    id: 's22-chetene', title: HOW_TITLE, status: false, share: false,
    body: html`<div class="prose s22-read">
      ${weights}
      <p>Състоянието „${md.labels.late ?? STATE_LABEL.late}“ значи, че крайният срок е минал или че напредъкът е доста по-малък от очаквания за изминалото време.</p>
      <p>Сумите са в милиони евро (млн. €).${md.asOf ? ` „Платено досега“ е сумата, платена до ${date(md.asOf)}.` : ''} „${yearText(md)}“ е частта, предвидена за тази година.</p>
      ${sources}
      <p>При реален проект тук ще има и връзка към ${gl('obshtestvena-porachka', 'обществената поръчка')} за него в ЦАИС ЕОП, държавната система за обществените поръчки. Измислените проекти нямат поръчка, затова връзка няма.</p>
    </div>`
  });
}

function listPage(ctx, md) {
  return html`${md.ok && !md.onlyReal ? banner() : ''}${realBlock(ctx, md)}${examplesBlock(ctx, md)}${howBlock(md)}`;
}

/* ---------------------------------------------------------------- one project */
export function crumbs(ctx) {
  if (!ctx.params?.id) return null;
  const md = model(ctx);
  const p = md.ok ? md.byId.get(String(ctx.params.id).toLowerCase()) : null;
  return [{ label: 'Големите проекти', href: ctx.href('proekti') }, { label: p && !md.onlyReal ? p.name : 'Проект' }];
}

function detailPage(ctx, md) {
  if (!md.ok) return pendingState({ title: 'Предстои', text: 'Данните за примерните проекти още не са заредени.' });
  const p = md.byId.get(String(ctx.params.id).toLowerCase());
  if (!p) ctx.notFound();
  const back = html`<p class="s22-links"><a class="btn btn-quiet" href="${ctx.href('proekti')}">Всички примерни проекти</a></p>`;
  if (md.onlyReal) {
    return {
      lede: 'Страниците на отделните проекти са с примерни данни.',
      body: html`${block({ id: 's22-d-nakratko', title: 'Страница на примерен проект', mock: true })}${back}`
    };
  }
  const lv = md.lv;
  const tot = moneyParts(p.totalMln, { scale: 'mln', d: 1 }), yr = moneyParts(p.yearMln, { scale: 'mln', d: 1 }), paid = moneyParts(p.paidMln, { scale: 'mln', d: 1 });
  const lvl = mln => (lv ? ` (${levaOf(mln)})` : '');
  const paidShare = pctOf(p.paidMln, p.totalMln), yearShare = pctOf(p.yearMln, p.totalMln);
  const text = stateText(p, md);
  const days = daysText(p, md);

  const summary = block({
    id: 's22-d-nakratko', title: 'Накратко за проекта', mock: true, why: p.why, source: SRC, asOf: md.asOf,
    share: { text: `${p.name} (измислен проект): ${md.labels[p.status] ?? p.status}, напредък ${pct(p.progressPct, 0)}, обща стойност ${money(p.totalMln, { scale: 'mln', d: 1 })}.` },
    body: html`<div class="s22-stack">
      <p class="s22-meta"><span class="s22-region">Област ${p.region}</span>${statePill(p, md)}</p>
      ${kpiGrid([
        kpi({ label: 'Обща стойност', value: tot.v, unit: tot.u, mock: true, sub: lvl(p.totalMln).trim() || undefined }),
        kpi({ label: yearText(md), value: yr.v, unit: yr.u, mock: true, sub: `${ok(yearShare) ? `Това е ${pct(yearShare, 0)} от общата стойност.` : ''}${lvl(p.yearMln)}`.trim() || undefined }),
        kpi({ label: 'Платено досега', value: paid.v, unit: paid.u, mock: true, sub: `${ok(paidShare) ? `Това е ${pct(paidShare, 0)} от общата стойност` : ''}${md.asOf ? `, към ${date(md.asOf)}` : ''}.${lvl(p.paidMln)}`.replace(/^,\s*/, '').trim() || undefined }),
        kpi({ label: 'Краен срок', value: date(p.deadline), mock: true, sub: days || undefined })
      ], { label: 'Основни числа за проекта' })}
      ${progress({ id: 's22-d-p', label: 'Напредък на работата', value: p.progressPct, max: 100, text: pct(p.progressPct, 0), mock: true })}
      ${ok(paidShare) ? progress({ id: 's22-d-paid', label: 'Платено от общата стойност', value: paidShare, max: 100, text: pct(paidShare, 0), mock: true }) : ''}
      ${text ? (p.status === 'late' ? callout({ kind: 'warn', title: 'Внимание: проектът е с изоставане', body: html`<p>${text}</p>` }) : html`<p class="s22-state">${text}</p>`) : ''}
      ${facts([
        { k: 'Начало на строителството', v: date(p.start) },
        { k: 'Очакван резултат', v: p.expectedResult }
      ])}
      <p class="s22-links"><button type="button" class="btn btn-sm btn-quiet" id="s22-d-copy" data-s22-copy="${p.id}">${icon('copy', { size: 16 })}<span>Копирай линк</span></button><a class="btn btn-quiet btn-sm" href="${ctx.href('proekti')}">Всички примерни проекти</a></p>
    </div>`
  });

  const stages = block({
    id: 's22-d-etapi', title: 'Етапи', mock: true, why: p.why, source: SRC, asOf: md.asOf,
    share: { text: `${p.name}: етапите на измисления проект.` },
    sub: 'Датата на всеки етап е краят му.',
    body: timeline({
      label: 'Етапи на проекта',
      items: (p.stages || []).map(s => {
        const { kind, overdue } = stageInfo(s, md);
        return {
          date: s.date, kind, title: s.name,
          text: s.status === 'done' ? 'Завършен.' : s.status === 'doing' ? (overdue ? 'В ход, а планираният край е минал.' : 'В ход.') : 'Предстои.'
        };
      })
    })
  });

  const fin = (p.financing || []).filter(x => x && x.source && ok(x.mln));
  const finTotal = fin.reduce((a, x) => a + x.mln, 0);
  const financing = fin.length
    ? block({
      id: 's22-d-finansirane', title: 'Откъде са парите', mock: true, why: p.why, source: SRC, asOf: md.asOf,
      share: { text: `${p.name}: откъде са парите на измисления проект.` },
      sub: `Сборът на източниците е равен на общата стойност: ${money(finTotal, { scale: 'mln', d: 1 })}.`,
      body: ranklist({
        id: 's22-d-fin', label: 'Финансиране по източници', mock: true, unit: 'num', d: 1, shares: true, sort: 'desc',
        categoryLabel: 'Източник на финансиране', unitLabel: 'млн. €',
        fmt: v => html`${moneyCell(v, lv)}`,
        items: fin.map(x => ({ label: x.source, value: x.mln }))
      })
    })
    : '';
  return { title: p.name, lede: `Примерен проект в област ${p.region}. Измислен е, за да покаже как изглежда страницата на един проект.`, body: html`${summary}${stages}${financing}` };
}

export function render(ctx) {
  const md = model(ctx);
  return ctx.params?.id ? detailPage(ctx, md) : listPage(ctx, md);
}

/* ---------------------------------------------------------------- the live part: announcements, copy link, CSV, clear */
export function mount(root, ctx) {
  const md = model(ctx);
  const offs = [];
  const on = (type, fn) => { root.addEventListener(type, fn); offs.push(() => root.removeEventListener(type, fn)); };
  const say = msg => { try { ctx.announce?.(msg); } catch { /* the live region is a courtesy */ } };
  const val = id => root.querySelector(`#${id}`)?.value ?? '';

  on('change', e => {
    const t = e.target instanceof Element ? e.target.closest('.s22-find select') : null;
    if (!t || !md.ok) return;
    // the delegated handler has not updated the address yet when this runs: read the controls themselves
    const next = model({ ...ctx, query: { oblast: val('s22-oblast'), status: val('s22-status'), srok: val('s22-srok'), napredak: val('s22-napredak'), sort: val('s22-sort') } });
    say(t.id === 's22-sort' ? `Проектите са подредени по: ${next.sortLabel}.` : countText(next));
  });

  on('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const clear = t.closest('#s22-clear');
    if (clear) {
      root.querySelector('#s22-oblast')?.focus();             // the button disappears with the filters: keep the focus on a control that stays
      ctx.setQuery({ oblast: '', status: '', srok: '', napredak: '' }, { rerender: true });
      say(`Филтрите са изчистени. ${countText(model({ ...ctx, query: { sort: val('s22-sort') } }))}`);
      return;
    }
    const copy = t.closest('[data-s22-copy]');
    if (copy) {
      const url = new URL(ctx.href('proekti', { id: copy.dataset.s22Copy }), location.href).href;
      void copyOrShow(url, 'Връзката е копирана.', 'Копирай връзката към проекта', copy);
      return;
    }
    if (t.closest('#s22-csv') && md.ok) {
      download(new Blob([csvFor(csvSpec(md))], { type: 'text/csv;charset=utf-8' }), 'bns-proekti-spisak.csv');
      toast('CSV файлът се изтегля.');
    }
  });

  return () => offs.forEach(f => f());
}
