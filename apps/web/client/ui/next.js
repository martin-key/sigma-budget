// The „Следва“ card at the end of every screen (F09). The router builds it from the route table (route.next),
// a page can override it with its own export next(ctx) -> ['S12'] | [{href, title, text, kicker}].
import { html } from '../html.js';
import { icon } from '../icons.js';

/** nextCard({kicker, title, text, href, more:[{label, href}]}) */
export function nextCard(o) {
  return html`<aside class="next" aria-labelledby="next-h" data-ui="next">
    <a class="next-main" href="${o.href}">
      <span class="next-body">
        <span class="next-kicker" id="next-h">${o.heading || 'Следва'}${o.kicker ? ` · ${o.kicker}` : ''}</span>
        <span class="next-title">${o.title}</span>
        ${o.text ? html`<span class="next-text">${o.text}</span>` : ''}
      </span>
      <span class="next-go" aria-hidden="true">${icon('arrowRight', { size: 22 })}</span>
    </a>
    ${o.more?.length ? html`<p class="next-more">Или: ${o.more.map((m, i) => html`${i ? ' · ' : ''}<a href="${m.href}">${m.label}</a>`)}</p>` : ''}
  </aside>`;
}
