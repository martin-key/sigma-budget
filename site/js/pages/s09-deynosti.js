// S09 · Дейности · #/razhodi/:fn/deynosti · next S12 (route default) · periods come from routes.js · phase 2, MOCK data (M01)
// Data, only through `needs`:
//   core                  REAL  the nine functions (name, share, % of GDP of 2026)
//   mock/activities  M01  REAL total and growth per function (Табл. III-1) + MOCK groups and activities (hatched, labelled, constrained by the real total)
//   expenditure?          REAL  optional: only the „Данни към“ date of the real function totals
// Only the functions present in M01 have activities (Здравеопазване, Образование): any other valid :fn gets an empty state, an unknown :fn is a 404.
// The file's own `meta.label` and `meta.notice` are printed in the banner. The real total is never mixed into a mock row: it sits in the real block
// and in the „Общо“ row of the table. The tree is function › group › activity (the group level is a model, `meta.groupsNote`).
import { html } from '../html.js';
import { num, plural, DASH, NBSP } from '../format.js';
import { moneyCol, periodStatus } from '../view.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { dataTable } from '../ui/table.js';
import { disclosure } from '../ui/disclosure.js';
import { callout } from '../ui/cards.js';
import { emptyState } from '../ui/states.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';

export const needs = ['core', 'mock/activities', 'expenditure?'];
export const styles = ['s09-deynosti'];

const ok = v => typeof v === 'number' && Number.isFinite(v);
const arr = v => (Array.isArray(v) ? v : []);
const N = (v, d) => (ok(v) ? num(v, d) : DASH);
const joinBg = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} и ${a[a.length - 1]}`);
const growth = (a, b) => (ok(a) && ok(b) && a > 0 ? (b / a - 1) * 100 : null);
const nameOf = f => f?.short || f?.name || '';
/** the same scope chip without its glossary link: a term is linked once per screen (the first block carries the link) */
const NOGL = { key: 'kfp', gl: null };
/** the file's notice starts with its own label („ПРИМЕРНИ ДАННИ. …“): the label is the banner title, so it is not repeated in the text */
const noLabel = (text, label) => (label && String(text).startsWith(label) ? String(text).slice(label.length).replace(/^[\s.:]+/, '') : String(text ?? ''));

function modelOf(ctx) {
  const id = ctx.params?.fn;
  const F0 = arr(ctx.core?.functions).find(f => f.id === id);
  if (!F0) return null;
  const A = ctx.data?.['mock/activities'] ?? null;
  const F = arr(A?.functions).find(f => f.id === id) ?? null;
  const years = arr(A?.meta?.years);
  return {
    ctx, id, F0, A, F, name: nameOf(F0), years,
    yl: [0, 1].map(i => A?.meta?.yearLabels?.[i] ?? String(years[i] ?? '')),
    items: F ? arr(A.items).filter(i => i.function === id) : []
  };
}

function columns(M, C, withGroup) {
  const money = (key, i) => ({
    key, label: M.yl[i], unit: C.unit, d: C.d, num: true,
    fmt: (v, r) => html`${N(v, C.d)}${C.lev(r.mln?.[i]) ? html`<small class="s09-sub">${C.lev(r.mln[i])}</small>` : ''}`
  });
  return [
    { key: 'name', label: 'Дейност', fmt: (v, r) => html`${v}${withGroup && r.group ? html`<small class="s09-sub">${r.group}</small>` : ''}` },
    money('a0', 0), money('a1', 1),
    { key: 'chg', label: 'Промяна', unit: '%', num: true, fmt: v => (ok(v) ? num(v, 1, { sign: true }) : DASH) },
    { key: 'share', label: 'Дял от функцията', unit: '%', num: true, fmt: v => (ok(v) ? num(v, 1) : DASH) }
  ];
}

const shareOf = (M, mln) => { const base = M.F.totalMln?.[1]; return ok(mln) && ok(base) && base > 0 ? (mln / base) * 100 : null; };

const rowsOf = (M, C, items, groupOf) => items.map(it => ({
  name: it.name, group: groupOf?.(it), mln: it.mln,
  a0: C.raw(it.mln?.[0]), a1: C.raw(it.mln?.[1]),
  chg: ok(it.growthPct) ? it.growthPct : growth(it.mln?.[0], it.mln?.[1]),
  share: shareOf(M, it.mln?.[1]),
  _mock: true
}));

/* ---------------------------------------------------------------- blocks */
function banner(M) {
  const { label, notice } = M.A.meta;
  return callout({ kind: 'warn', title: label, body: noLabel(notice, label) });
}

function sumsMatch(M) {
  return [0, 1].every(i => ok(M.F.totalMln?.[i]) && M.items.length > 0 && Math.abs(Math.round(M.items.reduce((s, it) => s + (it.mln?.[i] ?? 0), 0) * 10) / 10 - M.F.totalMln[i]) < 0.05);
}

function realBlock(M) {
  const { ctx, F, F0 } = M;
  const tiles = [
    kpi({
      label: `Разходи през ${M.years[1] ?? ''} г.`, mln: F.totalMln?.[1] ?? null, pctGdp: F0.pctGdp, sub: 'По проекта на бюджета',
      delta: ok(F.growthPct) ? { value: F.growthPct, d: 1, label: `спрямо ${M.yl[0]}` } : null
    }),
    kpi({ label: 'Дял от разходите по функции', value: ok(F0.share) ? num(F0.share, 1) : null, unit: '%', sub: 'От всички функции заедно.' })
  ];
  return block({
    id: 's09-funkciya', title: `Функция „${M.name}“ в бюджета`, scope: 'kfp', status: periodStatus(ctx), source: ['asbp'], asOf: ctx.data?.expenditure?.meta?.asOf,
    body: html`${kpiGrid(tiles, { label: `Основни числа за функция „${M.name}“` })}
      ${sumsMatch(M) ? html`<p class="s09-text">Общата сума за функцията е реална. Групите и дейностите по-долу са примерни, но сборът им е точно равен на нея.</p>` : ''}`,
    foot: html`<p>Числата за функцията са от мотивите към проекта на бюджета. Приетият закон може да се различава от проекта: какво е променено, виж в „<a href="${ctx.href('S14')}">Как се прие бюджетът?</a>“.</p>`
  });
}

function groupNode(M, C, g, i) {
  const its = M.items.filter(x => x.group === g.id).sort((a, b) => (b.mln?.[1] ?? 0) - (a.mln?.[1] ?? 0));
  const gr = growth(g.mln?.[0], g.mln?.[1]);
  const meta = html`${plural(its.length, 'дейност', 'дейности')} · ${N(C.raw(g.mln?.[1]), C.d)}${NBSP}${C.unit}${ok(gr) ? html` · ${num(gr, 1, { sign: true })}%` : ''}`;
  const table = dataTable({
    id: `s09-t-${g.id}`, caption: `Дейности в група „${g.name}“, функция „${M.name}“`, dense: true, status: 'mock',
    columns: columns(M, C, false), rows: rowsOf(M, C, its),
    total: { label: 'Общо за групата', values: { a0: C.raw(g.mln?.[0]), a1: C.raw(g.mln?.[1]), mln: g.mln, chg: gr, share: shareOf(M, g.mln?.[1]) } }
  });
  return disclosure({ id: `s09-g-${g.id}`, title: g.name, meta, open: i === 0, body: table });
}

function treeBlock(M, C) {
  const { A, F } = M;
  return block({
    id: 's09-dyrvo', title: 'От функцията към групи и дейности', scope: NOGL, mock: true, why: F.why, source: A.meta.source, asOf: A.meta.asOf, sub: A.meta.groupsNote,
    body: html`<div class="s09-stack">${arr(F.groups).map((g, i) => groupNode(M, C, g, i))}</div>`
  });
}

function tableBlock(M, C) {
  const { A, F } = M;
  const gname = Object.fromEntries(arr(F.groups).map(g => [g.id, g.name]));
  const table = dataTable({
    id: 's09-t-vsichki', caption: `Всички дейности във функция „${M.name}“`, sortable: true, sortBy: 'a1', dir: 'desc', status: 'mock',
    columns: columns(M, C, true), rows: rowsOf(M, C, M.items, it => gname[it.group]),
    total: { label: 'Общо за функцията (реално)', values: { a0: C.raw(F.totalMln?.[0]), a1: C.raw(F.totalMln?.[1]), mln: F.totalMln, chg: F.growthPct, share: 100 } }
  });
  return block({
    id: 's09-tablitsa', title: 'Всички дейности в една таблица', scope: NOGL, mock: true, why: M.items[0]?.why ?? F.why, source: A.meta.source, asOf: A.meta.asOf,
    sub: 'Натисни заглавие на колона, за да подредиш таблицата. Редът „Общо“ е реалната сума, а редовете над него са примерни.',
    body: html`${table}<p class="s09-note">Колоната „${M.yl[0]}“ е програмата за ${M.years[0] ?? ''} г., както е отпечатана в таблицата към проекта на бюджета, а не отчетът за годината. Промяната е спрямо нея.</p>`
  });
}

function emptyBody(M) {
  const { ctx, A } = M;
  const have = arr(A?.functions).map(f => ({ id: f.id, name: nameOf(arr(ctx.core?.functions).find(x => x.id === f.id)) || f.name }));
  return emptyState({
    icon: 'list', title: `Няма разбивка по дейности за функция „${M.name}“`,
    text: `Пълната разбивка до около 500 дейности я има само Министерството на финансите.${have.length ? ` В прототипа има примерни дейности само за ${joinBg(have.map(h => h.name.toLowerCase()))}.` : ''}`,
    actions: [{ label: `Към функция „${M.name}“`, href: ctx.href('S08', { fn: M.id }) }, ...have.map(h => ({ label: `Дейности: ${h.name}`, href: ctx.href('S09', { fn: h.id }), primary: false }))]
  });
}

function introBody(M) {
  const { ctx, A } = M;
  const others = arr(A.functions).filter(f => f.id !== M.id).map(f => ({ id: f.id, name: nameOf(arr(ctx.core?.functions).find(x => x.id === f.id)) || f.name }));
  return html`<p class="s09-text">Всяка функция на бюджета се състои от конкретни дейности. Тук виждаш как е разделена функция „${M.name}“: на групи и на отделни дейности. Натисни група, за да отвориш дейностите в нея. Пълната разбивка до около 500 дейности я има само Министерството на финансите.</p>
    <p class="s09-text s09-links"><a href="${ctx.href('S08', { fn: M.id })}">Назад към функция „${M.name}“</a>${others.map(o => html` · <a href="${ctx.href('S09', { fn: o.id })}">Дейности: ${o.name}</a>`)}</p>`;
}

/* ---------------------------------------------------------------- page contract */
export function crumbs(ctx) {
  const M = modelOf(ctx);
  return M ? [{ label: 'Къде отиват парите?', href: ctx.href('S07') }, { label: M.name, href: ctx.href('S08', { fn: M.id }) }, { label: 'Дейности' }] : null;
}

export function render(ctx) {
  const M = modelOf(ctx);
  if (!M) return ctx.notFound();
  const head = { title: `Дейности във функция „${M.name}“`, eyebrow: 'Фаза 2 · примерни данни' };
  if (!M.F) return { ...head, lede: `За функция „${M.name}“ в прототипа няма разбивка по дейности.`, body: emptyBody(M) };
  const C = moneyCol(ctx, { d: 1 });                  // the tables stay in млн. € (or € на човек, and the leva addendum): „% от БВП“ is for the headline total only
  return {
    ...head,
    lede: `Разходите за ${M.name.toLowerCase()} през ${M.years[1] ?? ''} г., разделени на групи и отделни дейности. Реална е само общата сума, останалото е примерно.`,
    context: 'Консолидирана фискална програма (КФП): разходи по функции · дейностите са примерни',
    body: html`${banner(M)}
      ${unitSwitch(ctx, { name: 's09-unit', note: `„% от БВП“ е за общата сума за функцията, спрямо планирания БВП за ${M.years[1] ?? ''} г. Таблиците с дейности остават в милиони евро.` })}
      ${introBody(M)}${realBlock(M)}${treeBlock(M, C)}${tableBlock(M, C)}`
  };
}

export function mount(root, ctx) {
  return bindUnitSwitch(root, ctx, 's09-unit');
}
