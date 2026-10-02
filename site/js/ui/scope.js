// Scope chip (plan 2.3, F11): which budget a number belongs to — КФП / национален / ЕС / ЗДД / Маастрихт.
// A numeric block always shows one. The chip links to the glossary entry when there is one.
//   scopeChip('kfp')  ·  scopeChip('zdd', {note:'без гаранциите'})
import { html } from '../html.js';
import { SCOPES } from '../store.js';

export function scopeChip(key, o = {}) {
  const s = SCOPES[key];
  const label = o.label || s?.label || String(key);
  const long = s?.long || label;
  const gl = o.gl === undefined ? s?.gl : o.gl;
  const inner = html`<span class="sr-only">Обхват: </span>${label}${o.note ? html` <span class="scope-note">· ${o.note}</span>` : ''}`;
  return gl
    ? html`<a class="scope" href="#/rechnik/${gl}" data-gl="${gl}" title="${long}">${inner}</a>`
    : html`<span class="scope" title="${long}">${inner}</span>`;
}
