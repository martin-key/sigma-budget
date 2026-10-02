// Timeline: a vertical list of dated events (law procedure, publication calendar, what changed and when).
//   timeline({label, items:[{date, title, text, href, kind, status, id}], cls})
// - `date`: 'YYYY-MM-DD' (printed 21.07.2026 inside <time>), 'YYYY-MM' (юли 2026), 'YYYY', or any text as it is („3-то тримесечие 2026“)
// - `kind`: 'event' (default: it happened) | 'expected' (dashed marker and the visible word „очаквано“ beside the date)
//           | 'warning' (amber marker, alert icon and a spoken „Внимание:“): the kind is never marker colour alone
// - `href` turns the title into a link (build it with ctx.href); `text` is a sentence (text or markup) under the title;
//   `status` adds a status pill (real | partial | pending | mock | forecast); `id` makes the item a `?to=` target
// - items keep the order you pass: newest first or oldest first, whichever the screen needs
// - `label` is the list's accessible name; no items → nothing is rendered
import { html, cx, plain } from '../html.js';
import { date, monthName, NBSP } from '../format.js';
import { icon } from '../icons.js';
import { statusPill } from './status.js';

const KINDS = new Set(['event', 'expected', 'warning']);

function when(d) {
  const s = String(d ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return html`<time datetime="${s}">${date(s)}</time>`;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return html`<time datetime="${s}">${monthName(+m[2])}${NBSP}${m[1]}</time>`;
  if (/^\d{4}$/.test(s)) return html`<time datetime="${s}">${s}</time>`;
  return s ? html`${s}` : '';
}

function entry(it) {
  const kind = KINDS.has(it.kind) ? it.kind : 'event';
  const dt = when(it.date);
  const flag = kind === 'expected' ? html`<span class="tl-flag">очаквано</span>` : '';
  const title = it.href ? html`<a href="${it.href}">${it.title}</a>` : it.title;
  const warn = kind === 'warning';
  return html`<li class="tl-item" data-kind="${kind}"${it.id ? html` id="${it.id}"` : ''}>
    ${dt || flag ? html`<span class="tl-date">${dt} ${flag}</span>` : ''}
    <span class="tl-title">${warn ? html`${icon('alert', { size: 16 })}<span class="sr-only">Внимание: </span>` : ''}${title}</span>
    ${it.text ? html`<div class="tl-text">${it.text}</div>` : ''}
    ${it.status ? html`<span class="tl-st">${statusPill(it.status)}</span>` : ''}
  </li>`;
}

export function timeline(o = {}) {
  const items = (o.items || []).filter(it => it && it.title != null && it.title !== '');
  if (!items.length) return html``;
  return html`<ol class="${cx('tl', o.cls)}"${o.label ? html` aria-label="${plain(o.label)}"` : ''}>${items.map(entry)}</ol>`;
}
