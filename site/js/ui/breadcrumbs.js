// Breadcrumbs: breadcrumbs([{label, href}, …, {label}]) — the last item is the current page.
import { html } from '../html.js';

export function breadcrumbs(items = []) {
  if (!items.length) return html``;
  return html`<nav class="crumbs" aria-label="Трохи"><ol>${items.map((it, i) => (i === items.length - 1 || !it.href
    ? html`<li><span aria-current="page">${it.label}</span></li>`
    : html`<li><a href="${it.href}">${it.label}</a></li>`))}</ol></nav>`;
}
