// The one explorer of the budget (V5): «Разходи | Приходи», and for the expenditure the three cuts «За какво | Кой харчи | По вид».
// It is a strip of real links (no state of its own): each cut is its own address, so back, share and a saved link keep the choice.
//   explorer(ctx, current)    current = 'rashodi:funkcii' | 'rashodi:vedomstva' | 'rashodi:vid' | 'prihodi'
// The strip keeps the period (the router adds ?per= by itself) and does not carry the other screen's own choices (unit, view, item).
import { html } from '../html.js';

const CUTS = [
  { key: 'funkcii', label: 'За какво', route: 'S07', query: { po: 'funkcii' } },
  { key: 'vedomstva', label: 'Кой харчи', route: 'S10', query: {} },
  { key: 'vid', label: 'По вид', route: 'S07', query: { po: 'vid' } }
];

export function explorer(ctx, current = 'rashodi:funkcii') {
  const [side, cut] = String(current).split(':');
  const link = (label, to, query, on) => html`<a class="exp-opt" href="${ctx.href(to, {}, query)}"${on ? html` aria-current="page"` : ''}>${label}</a>`;
  return html`<div class="explorer" data-ui="explorer">
    <nav class="exp-row" aria-label="Какво разглеждаш">
      <span class="exp-h" aria-hidden="true">Разгледай</span>
      <span class="exp-seg">${link('Разходи', 'S07', { po: 'funkcii' }, side === 'rashodi')}${link('Приходи', 'S06', {}, side === 'prihodi')}</span>
    </nav>
    ${side === 'rashodi' ? html`<nav class="exp-row" aria-label="Разрез на разходите">
      <span class="exp-h" aria-hidden="true">По какво</span>
      <span class="exp-seg">${CUTS.map(c => link(c.label, c.route, c.query, c.key === cut))}</span>
    </nav>` : ''}
  </div>`;
}
