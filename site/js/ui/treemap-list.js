// Treemap („карта“) or ranked list of the same items, switched by a control. The list is the readable default on phones (< 600 px),
// the map is the overview on wide screens; both are always in the page, one is hidden.
//   treemapList({id, title, sub, label, desc, unit, fmt, d, unitLabel, categoryLabel, sort, shares, view, defaultView, query, mock, height, items:[…]})
// - `items`: the ranklist shape {label (or name), sub, value, href, mock, status, pctGdp, children, id}. The list shows every row (a row without a number is
//   „Предстои“); the map draws only rows with a positive number and says how many it left out.
// - `view:'list'|'map'|'pie'` forces a view, anything else = by screen width (and it follows a resize until the visitor chooses). `query:'view'` mirrors the
//   visitor's choice into `?view=…` (pass `view: ctx.query.view` so a shared link opens the same view). The switch never re-renders the screen; the choice is
//   kept while the screen is open, so a unit switch (which re-renders it) does not throw it away.
// - `pie: true` adds a third view «Кръгова» (a donut of the positive top-level rows with a legend that carries the value and the share of each part; the tail
//   beyond 8 slices is folded into «Други»). Only for rows that add up to a whole; `pieHeight` sets its height.
// - `unit` ('mln' default | 'pct' | 'num'), `fmt`, `d`, `unitLabel`, `categoryLabel`, `shares` (default true), `sort` ('desc' default; `false` keeps your order)
//   go to the list (see ranklist.js). The map prints the raw numbers with the same unit text: million euro, so the „на човек“, „% от БВП“ and „лв.“
//   switches change the list only.
// - `title`/`sub` are an optional small caption left of the switch (leave them out inside a block() that already has a title); `label` names the figure
//   for assistive tech (default: `title`).
// - a click on an area of the map fires a cancelable, bubbling `tmap:select` event on the element ({detail:{id, label, href, item}}); when nobody calls
//   preventDefault() and the item has an `href`, the screen goes there. A screen that wants a detail panel listens and prevents the default.
// - the table twins: the list registers one, the map's figure another; a block() around this finds the visible one.
import { html, raw, cx, plain } from '../html.js';
import { ranklist } from './ranklist.js';
import { chart } from './chart.js';
import { seg } from './seg.js';
import { emptyState } from './states.js';
import * as share from '../share.js';
import { num } from '../format.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const REG = new Map();                 // id -> normalised items, for the map's click handler
share.onReset(() => REG.clear());
const chosen = new Map();              // `${screen}:${id}` -> the visitor's choice of view; outlives the re-render of a unit switch
const keyOf = id => `${share.currentRoute()?.key ?? ''}:${id}`;

const norm = it => ({ ...it, label: it.label ?? it.name, children: it.children?.filter(c => c && (c.label ?? c.name) != null).map(norm) });
const isMock = it => it.mock === true || it.status === 'mock';

export function treemapList(o = {}) {
  if (!o.id) throw new Error('treemapList: id is required');
  const items = (o.items || []).filter(it => it && (it.label ?? it.name) != null && (it.label ?? it.name) !== '').map(norm);
  if (!items.length) return emptyState({ title: o.emptyTitle || 'Няма данни за показване', text: o.emptyText || 'За тази селекция няма числа.', icon: 'pieChart' });
  REG.set(o.id, items);

  const unit = o.unit || 'mln';
  const unitText = o.unitLabel ?? (unit === 'pct' ? '%' : unit === 'num' ? '' : 'млн. €');
  const fmt = o.fmt ? v => plain(o.fmt(v)) : undefined;
  const pos = it => ok(it.value) && it.value > 0 && it.status !== 'pending';

  // map data: positive top-level rows (+ their positive children); count what is left out
  let left = 0;
  const data = [];
  for (const it of items) {
    if (!pos(it)) { left++; continue; }
    const kids = (it.children || []).filter(pos).map(c => ({ name: plain(c.label), value: c.value }));
    data.push({ name: plain(it.label), value: it.value, mock: isMock(it) || undefined, children: kids.length ? kids : undefined });
  }

  const wide = typeof matchMedia === 'function' && !matchMedia('(max-width: 599px)').matches;
  const pieOn = o.pie === true && data.length >= 2;
  const ck = keyOf(o.id), saved = chosen.get(ck);
  const allowed = v => v === 'list' || v === 'map' || (v === 'pie' && pieOn);
  const forced = allowed(o.view) ? o.view : allowed(saved) ? saved : null;
  const dflt = allowed(o.defaultView) ? o.defaultView : null;     // the screen's own first view; without one the width decides (map on wide screens)
  const view = data.length ? (forced || dflt || (wide ? 'map' : 'list')) : 'list';
  const name = o.label ?? o.title;

  const list = ranklist({
    id: `${o.id}-list`, label: name, unit, fmt: o.fmt, d: o.d, unitLabel: o.unitLabel, categoryLabel: o.categoryLabel,
    sort: o.sort === false || o.sort === 'none' ? undefined : (o.sort || 'desc'), shares: o.shares !== false, mock: o.mock === true, items
  });
  if (!data.length) return html`<div class="tmap" id="${o.id}" data-view="list">${list}</div>`;

  const map = chart({
    id: `${o.id}-map`, type: 'treemap', label: name || 'Разпределение', desc: o.desc, unit: unitText, d: o.d, fmt, height: o.height || 340,
    categoryLabel: o.categoryLabel, mock: o.mock === true, data
  });
  const control = seg({
    name: `${o.id}-view`, label: 'Начин на показване', value: view, norender: true, query: o.query || undefined,
    options: [{ value: 'list', label: 'Списък', icon: 'list' }, { value: 'map', label: 'Карта', icon: 'grid' }, ...(pieOn ? [{ value: 'pie', label: 'Кръгова', icon: 'pieChart' }] : [])]
  });
  const pie = pieOn ? chart({
    id: `${o.id}-pie`, type: 'donut', label: name || 'Разпределение', unit: unitText, d: o.d, fmt, height: o.pieHeight || 300, legendValues: true, categoryLabel: o.categoryLabel,
    mock: o.mock === true, data: data.map(({ name: n, value, mock }) => ({ name: n, value, mock }))
  }) : '';
  const cap = o.title || o.sub
    ? html`<p class="fig-cap">${o.title ? html`<span class="fig-title">${o.title}</span>` : ''}${o.sub ? html`<span class="fig-sub">${o.sub}</span>` : ''}</p>`
    : '';
  return html`<div class="${cx('tmap', o.cls)}" id="${o.id}" data-ui="treemap-list" data-view="${view}" data-ck="${ck}"${forced || dflt ? raw(' data-explicit="1"') : ''}>
    <div class="tmap-bar">${cap}${control}</div>
    <div class="tmap-list">${list}</div>
    <div class="tmap-map">${map}${left ? html`<p class="tmap-note">На картата няма ${num(left, 0)} ${left === 1 ? 'ред' : 'реда'} без положително число. ${left === 1 ? 'Той е' : 'Те са'} в списъка.</p>` : ''}</div>
    ${pieOn ? html`<div class="tmap-pie">${pie}${left ? html`<p class="tmap-note">На кръговата графика няма ${num(left, 0)} ${left === 1 ? 'ред' : 'реда'} без положително число. ${left === 1 ? 'Той е' : 'Те са'} в списъка.</p>` : ''}</div>` : ''}
  </div>`;
}

export function mount(el, ctx) {
  const radios = [...el.querySelectorAll('.tmap-bar input[type="radio"]')];
  const set = v => { el.dataset.view = v; radios.forEach(r => { r.checked = r.value === v; }); };
  const onChange = e => {
    const r = e.target;
    if (!(r instanceof HTMLInputElement) || r.type !== 'radio' || !r.checked || !radios.includes(r)) return;
    el.dataset.explicit = '1';
    if (el.dataset.ck) chosen.set(el.dataset.ck, r.value);
    set(r.value);
  };
  el.addEventListener('change', onChange);

  // without an explicit choice the view follows the screen width (a phone turned sideways, a resized window)
  const mq = window.matchMedia('(max-width: 599px)');
  const onMq = () => { if (el.dataset.explicit !== '1' && el.querySelector('.tmap-map')) set(mq.matches ? 'list' : 'map'); };
  mq.addEventListener?.('change', onMq);

  // a click on the map: let the screen decide (tmap:select), else follow the item's link
  const box = el.querySelector('.tmap-map .chart');
  let bound = null;
  const find = path => {
    let level = REG.get(el.id) || [], hit = null;
    for (const n of path) {
      hit = level.find(it => plain(it.label) === n) || null;
      if (!hit) return null;
      level = hit.children || [];
    }
    return hit;
  };
  const bind = () => {
    const inst = box && window.echarts?.getInstanceByDom?.(box);
    if (!inst || inst === bound) return;
    bound = inst;
    inst.on('click', p => {
      const path = (p.treePathInfo || []).map(n => n.name).filter(Boolean);
      const item = find(path.length ? path : [p.name]);
      if (!item) return;
      const ev = new CustomEvent('tmap:select', { bubbles: true, cancelable: true, detail: { id: item.id ?? null, label: plain(item.label), href: item.href || null, item } });
      if (el.dispatchEvent(ev) && item.href) ctx?.go?.(item.href);
    });
  };
  const mo = box ? new MutationObserver(bind) : null;
  mo?.observe(box, { attributes: true, attributeFilter: ['data-ready'] });
  bind();

  return () => { el.removeEventListener('change', onChange); mq.removeEventListener?.('change', onMq); mo?.disconnect(); };
}
