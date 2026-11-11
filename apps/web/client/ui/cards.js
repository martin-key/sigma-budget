// Small content cards.
//   linkCard({href, title, text, kicker, icon, meta, cls})     a whole-card link (start page, 404, „Следва“-like lists)
//   callout({kind:'info|warn|bad|ok', title, body, icon})      a boxed note (role="note")
//   facts([{k, v}])                                            a <dl class="facts"> of label/value pairs
//   ext(url, label)                                            external link: new tab, icon, „(в нов раздел)“ for screen readers
//   reportLink({block, val, src, type, label})                 „Намерих грешка“ -> #/vrazka?type=…&from=<screen>&block=…  (reportHref = the address only)
import { html, cx } from '../html.js';
import { icon } from '../icons.js';
import { href as routeHref } from '../routes.js';
import * as share from '../share.js';

export function linkCard(o) {
  return html`<a class="${cx('link-card', o.cls)}" href="${o.href}">
    ${o.icon ? html`<span class="link-card-ic">${icon(o.icon, { size: 22 })}</span>` : ''}
    <span class="link-card-main">${o.kicker ? html`<span class="link-card-kicker">${o.kicker}</span>` : ''}<span class="link-card-title">${o.title}</span>${o.text ? html`<span class="link-card-text">${o.text}</span>` : ''}${o.meta ? html`<span class="link-card-meta">${o.meta}</span>` : ''}</span>
    <span class="link-card-go" aria-hidden="true">${icon('arrowRight', { size: 18 })}</span></a>`;
}

const KIND_ICON = { info: 'info', warn: 'alert', bad: 'alert', ok: 'checkCircle' };
export function callout(o = {}) {
  const kind = KIND_ICON[o.kind] ? o.kind : 'info';
  return html`<div class="${cx('callout', 'callout-' + kind, o.cls)}" role="note"${o.id ? html` id="${o.id}"` : ''}>
    <span class="callout-ic">${icon(o.icon || KIND_ICON[kind], { size: 20 })}</span>
    <div class="callout-main">${o.title ? html`<p class="callout-title">${o.title}</p>` : ''}<div class="callout-body">${o.body}</div></div></div>`;
}

export function facts(items = [], o = {}) {
  return html`<dl class="${cx('facts', o.cls)}">${items.filter((i) => i && i.v != null && i.v !== '').map((i) => html`<div class="facts-row"><dt>${i.k}</dt><dd>${i.v}</dd></div>`)}</dl>`;
}

export function ext(url, label) {
  return html`<a class="ext" href="${url}" target="_blank" rel="noopener noreferrer">${label ?? url}${icon('external', { size: 14 })}<span class="sr-only"> (в нов раздел)</span></a>`;
}

/** address of the feedback form for one block; the screen the visitor is on is passed along so the form can say where the report came from */
export function reportHref(o = {}) {
  const from = share.currentRoute()?.key || '';
  return routeHref(
    'vrazka',
    {},
    {
      type: o.type || 'error',
      from: from || null,
      block: o.block || null,
      val: o.val ?? null,
      src: o.src || null,
    },
  );
}
export function reportLink(o = {}) {
  return html`<a class="report-link" href="${reportHref(o)}">${icon('flag', { size: 14 })}<span>${o.label || 'Намерих грешка'}</span></a>`;
}
