// Chips: a row of small pill buttons/links (filters, quick links).
//   chips({label, items:[{label, count, query, pressed, href, icon, key}], id, cls})
// - `query:'g=sotsialni'`  → <button class="chip" data-query="g=sotsialni" aria-pressed="true|false">: the delegated handler in actions.js writes
//                             `?g=sotsialni` and re-renders (`'g='` removes the key). `pressed` (boolean) is the current state of a filter chip: compute
//                             it from ctx.query; leave it out for a chip that only triggers something (then there is no aria-pressed).
//                             Every such chip carries `data-fk`, so keyboard focus returns to it after the re-render.
// - `href:'#/rechnik'`     → <a class="chip" href>; `pressed:true` marks the current one with aria-current="true"
// - neither                → a plain <button class="chip" data-chip="<key>"> that your own `mount` listens to
// - `label` (group name) becomes the group's aria-label; `count` is shown after the label (number: formatted, text: as is)
import { html, raw, cx, plain } from '../html.js';
import { icon } from '../icons.js';
import { num } from '../format.js';

function chip(it) {
  const count =
    typeof it.count === 'number' && Number.isFinite(it.count)
      ? num(it.count, 0)
      : typeof it.count === 'string'
        ? it.count
        : '';
  const inner = html`${it.icon ? icon(it.icon, { size: 16 }) : ''}<span class="chip-label">${it.label}</span>${count !== '' ? html`<span class="chip-count">${count}</span>` : ''}`;
  if (it.href) {
    return html`<a class="chip" href="${it.href}"${it.pressed ? raw(' aria-current="true"') : ''}>${inner}</a>`;
  }
  const pressed =
    it.pressed === undefined ? '' : html` aria-pressed="${it.pressed ? 'true' : 'false'}"`; // no `pressed` → a plain action button, not a toggle
  if (it.query)
    return html`<button type="button" class="chip" data-query="${it.query}" data-fk="chip:${it.query}"${pressed}>${inner}</button>`;
  return html`<button type="button" class="chip"${it.key ? html` data-chip="${it.key}" data-fk="chip:${it.key}"` : ''}${pressed}>${inner}</button>`;
}

export function chips(o = {}) {
  const items = (o.items || []).filter((it) => it && it.label != null && it.label !== '');
  if (!items.length) return html``;
  return html`<div class="${cx('chips', o.cls)}"${o.id ? html` id="${o.id}"` : ''}${o.label ? html` role="group" aria-label="${plain(o.label)}"` : ''}>${items.map(chip)}</div>`;
}
