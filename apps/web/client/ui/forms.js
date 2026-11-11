// Form controls. Every control has a visible <label>; hints and errors are tied with aria-describedby.
//   field({id, label, hint, error, control})  ·  textInput({id,name,value,placeholder,type,query})  ·  selectInput({id,options,value,query})
//   toggle({id,label,checked,hint,attrs})     a labelled switch (native checkbox)
import { html } from '../html.js';

export function field(o) {
  const hid = o.hint ? `${o.id}-hint` : '',
    eid = o.error ? `${o.id}-err` : '';
  return html`<div class="field${o.error ? ' field-bad' : ''}"><label class="field-label" for="${o.id}">${o.label}</label>${o.hint ? html`<p class="field-hint" id="${hid}">${o.hint}</p>` : ''}${o.control}${o.error ? html`<p class="field-error" id="${eid}" role="alert">${o.error}</p>` : ''}</div>`;
}
export function textInput(o) {
  const desc = [o.hint ? `${o.id}-hint` : '', o.error ? `${o.id}-err` : '']
    .filter(Boolean)
    .join(' ');
  return html`<input class="input" id="${o.id}" name="${o.name || o.id}" type="${o.type || 'text'}" value="${o.value ?? ''}"${o.placeholder ? html` placeholder="${o.placeholder}"` : ''}${o.inputmode ? html` inputmode="${o.inputmode}"` : ''}${o.autocomplete ? html` autocomplete="${o.autocomplete}"` : ''}${desc ? html` aria-describedby="${desc}"` : ''}${o.error ? html` aria-invalid="true"` : ''}${o.query ? html` data-query="${o.query}"` : ''}${o.required ? html` required` : ''}>`;
}
export function selectInput(o) {
  const desc = [o.hint ? `${o.id}-hint` : '', o.error ? `${o.id}-err` : '']
    .filter(Boolean)
    .join(' ');
  return html`<span class="select"><select id="${o.id}" name="${o.name || o.id}"${o.query ? html` data-query="${o.query}"` : ''}${desc ? html` aria-describedby="${desc}"` : ''}${o.error ? html` aria-invalid="true"` : ''}>${o.options.map((x) => html`<option value="${x.value}"${String(x.value) === String(o.value) ? html` selected` : ''}>${x.label}</option>`)}</select></span>`;
}
export function toggle(o) {
  return html`<label class="toggle"><input type="checkbox" id="${o.id}"${o.name ? html` name="${o.name}"` : ''}${o.checked ? html` checked` : ''}${o.query ? html` data-query="${o.query}"` : ''}${o.attrs || ''}><span class="toggle-box" aria-hidden="true"></span><span class="toggle-text"><span class="toggle-label">${o.label}</span>${o.hint ? html`<span class="toggle-hint">${o.hint}</span>` : ''}</span></label>`;
}
