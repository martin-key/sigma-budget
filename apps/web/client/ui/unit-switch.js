// Unit switch: „Покажи сумите в: В евро | % от БВП“ for screens whose numbers exist both in млн. € and as % от БВП.
// The shell has no control for the shared `unit` preference, so every such screen carries this one (S06, S07, S08).
//   unitSwitch(ctx, {name, note})   → markup: a label, the seg and a note (the screen's own `note`, if any, then CARRIES); `name` is unique on the screen (ids `${name}-eur|pct`)
//   bindUnitSwitch(root, ctx, name) → returns the cleanup; call it from mount(): a choice writes the `unit` preference,
//                                     the router then re-renders the screen and announces the change („Показваме в проценти“ / „Показваме в евро“)
import { html } from '../html.js';
import { seg } from './seg.js';

const CARRIES = 'Изборът остава и на другите екрани.'; // `unit` is one shared, stored preference, so the choice follows the visitor; a screen's note must not say otherwise

export function unitSwitch(ctx, o = {}) {
  const name = o.name || 'unit';
  return html`<div class="unit-switch"><span class="unit-switch-label" aria-hidden="true">Покажи сумите в:</span>${seg(
    {
      name,
      label: 'Покажи сумите в',
      value: ctx.store.get('unit'),
      options: [
        { value: 'eur', label: 'В евро' },
        { value: 'pct', label: '% от БВП' },
      ],
    },
  )}<p class="unit-switch-note small muted">${o.note ? `${o.note} ` : ''}${CARRIES}</p></div>`;
}

export function bindUnitSwitch(root, ctx, name = 'unit') {
  const onChange = (e) => {
    const t = e.target;
    if (t && t.name === name && t.checked) ctx.store.set('unit', t.value);
  };
  root.addEventListener('change', onChange);
  return () => root.removeEventListener('change', onChange);
}
