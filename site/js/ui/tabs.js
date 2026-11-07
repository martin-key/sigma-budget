// Tabs (WAI-ARIA tabs pattern): one tab list, all panels rendered, inactive ones `hidden`.
//   tabs({id, label, active, query, tabs:[{key, label, count, body}], cls})
// - `key` should be a short ASCII slug (it goes into ids and `?tab=`); `label` may be text or markup; `body` is markup (a plain string is text)
// - `active`: key shown first (an unknown/absent key → the remembered one, else the first tab)
// - `query:'tab'`: a user choice is mirrored into `?tab=<key>` without re-rendering (ctx.setQuery(…, {rerender:false})); pass
//   `active: ctx.query.tab` so the link works. Without `query` the choice is remembered for this screen until the page is reloaded.
// - keyboard: ← → move and activate (wraps), Home / End; the active tab is the only one in the Tab order, the panel is focusable
// - a chart inside a hidden panel draws when the panel is shown (chart.js waits for a non-zero width)
// - `?to=<id>` of something inside a hidden panel: the router (revealTabs) shows the panel and syncs the tab
// - the `.tabs` element fires a bubbling `tabs:change` event ({detail:{id, key}}) after every user choice
import { html, raw, cx, plain } from '../html.js';
import { here, parts as addrParts } from '../loc.js';
import { num } from '../format.js';

const MEM = new Map();
const memKey = id => `${addrParts(here()).path}|${id}`;
const part = k => String(k).replace(/[^\w-]+/g, '_');          // the key as part of an id

export function tabs(o = {}) {
  const id = o.id;
  const items = (o.tabs || []).filter(t => t && t.key != null && t.key !== '');
  if (!id) throw new Error('tabs: id is required');
  if (!items.length) throw new Error(`tabs ${id}: no tabs`);
  const keys = items.map(t => String(t.key));
  const mem = o.query ? undefined : MEM.get(memKey(id));
  const active = keys.includes(String(o.active)) ? String(o.active) : keys.includes(mem) ? mem : keys[0];
  const tid = k => `${id}-t-${part(k)}`, pid = k => `${id}-p-${part(k)}`;

  const tab = t => {
    const k = String(t.key), on = k === active;
    const c = t.count;
    const count = typeof c === 'number' && Number.isFinite(c) ? num(c, 0) : typeof c === 'string' && c ? c : '';
    return html`<button type="button" role="tab" id="${tid(k)}" aria-controls="${pid(k)}" aria-selected="${on ? 'true' : 'false'}" tabindex="${on ? 0 : -1}" data-key="${k}">${t.label ?? k}${count !== '' ? html` <span class="tab-count">${count}</span>` : ''}</button>`;
  };
  const panel = t => {
    const k = String(t.key), on = k === active;
    return html`<div class="tab-panel" role="tabpanel" id="${pid(k)}" aria-labelledby="${tid(k)}" tabindex="0" data-key="${k}"${on ? '' : raw(' hidden')}>${t.body ?? ''}</div>`;
  };

  return html`<div class="${cx('tabs', o.cls)}" id="${id}" data-ui="tabs"${o.query ? html` data-qkey="${o.query}"` : ''}>
    <div class="tab-list" role="tablist"${o.label ? html` aria-label="${plain(o.label)}"` : ''}>${items.map(tab)}</div>
    ${items.map(panel)}
  </div>`;
}

export function mount(el, ctx) {
  const list = el.querySelector(':scope > .tab-list');
  if (!list) return undefined;
  const qkey = el.dataset.qkey || '';
  const all = () => [...list.querySelectorAll('[role="tab"]')];
  const panels = [...el.querySelectorAll(':scope > [role="tabpanel"]')];
  const panelOf = t => panels.find(p => p.id === t.getAttribute('aria-controls'));

  function select(tab, focus) {
    for (const t of all()) {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const p = panelOf(t);
      if (p) p.hidden = !on;
    }
    if (focus) { tab.focus(); tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
    const key = tab.dataset.key;
    if (qkey) ctx?.setQuery?.({ [qkey]: key }, { rerender: false });
    else MEM.set(memKey(el.id), key);
    el.dispatchEvent(new CustomEvent('tabs:change', { bubbles: true, detail: { id: el.id, key } }));
  }

  const onClick = e => {
    const t = e.target.closest('[role="tab"]');
    if (t && list.contains(t) && t.getAttribute('aria-selected') !== 'true') select(t, false);
  };
  const onKey = e => {
    const t = e.target.closest('[role="tab"]');
    if (!t || e.altKey || e.ctrlKey || e.metaKey) return;
    const all_ = all(), i = all_.indexOf(t);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % all_.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + all_.length) % all_.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = all_.length - 1;
    if (n < 0) return;
    e.preventDefault();
    select(all_[n], true);
  };
  list.addEventListener('click', onClick);
  list.addEventListener('keydown', onKey);
  return () => { list.removeEventListener('click', onClick); list.removeEventListener('keydown', onKey); };
}
