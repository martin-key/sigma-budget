// Segmented control = native radio inputs (arrow keys, form semantics and screen-reader grouping for free).
//   seg({name:'po', label:'Покажи по', value:'fn', options:[{value:'fn', label:'Функции'}, {value:'vid', label:'Вид разход'}], query:'po'})
// With `query`, a change writes ?po=… into the URL (delegated [data-query] handler; the screen re-renders).
// ids are `${name}-${value}`: keep `name` unique on a screen.  Options may carry an icon name.
import { html } from '../html.js';
import { icon } from '../icons.js';

export function seg(o) {
  const id = v => `${o.name}-${v}`;
  return html`<div class="seg${o.cls ? ' ' + o.cls : ''}" role="radiogroup" aria-label="${o.label}">${o.options.map(opt => html`<span class="seg-opt"><input type="radio" id="${id(opt.value)}" name="${o.name}" value="${opt.value}" data-fk="${id(opt.value)}"${opt.value === o.value ? html` checked` : ''}${o.query ? html` data-query="${o.query}"` : ''}${o.norender ? html` data-norender` : ''}><label for="${id(opt.value)}">${opt.icon ? icon(opt.icon, { size: 16 }) : ''}<span>${opt.label}</span></label></span>`)}</div>`;
}
