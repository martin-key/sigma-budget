// Source UI (plan 2.4 / F10). Every number can name its source and date; the „Източници“ toggle in the top bar
// shows a tag next to each value (html[data-sources="1"]); the buttons open a small card.
//   sourceBtn(['kfp'], {asOf:'2026-07-31'})       a „Източник“ button for a block header
//   val('26,35 млрд. €', {src:'kfp', asOf:'…'})   a number with a (hidden by default) source tag
//   openSource(anchor, ['kfp'], {asOf})           the card itself (the delegated click handler calls this)
import { html } from '../html.js';
import { icon } from '../icons.js';
import { data } from '../data.js';
import { date } from '../format.js';
import { popover } from './sheet.js';

const SHORT = {
  kfp: 'МФ · КФП', asbp: 'МФ · АСБП', bill: 'Законопроект', zdb: 'ЗДБРБ · ДВ', zbdoo: 'ЗБДОО · ДВ', zbnzok: 'ЗБНЗОК · ДВ', prb: 'Програмни бюджети',
  parliament: 'Парламент', eurostat: 'Евростат', bnb: 'БНБ', nap: 'НАП', sebra: 'СЕБРА', gisco: 'GISCO', dataeuropa: 'data.europa.eu',
  minfin: 'МФ', wg: 'Редакционно', mockgen: 'Примерни данни'
};
const KIND = { xls: 'Таблица (xls)', pdf: 'Документ (PDF)', html: 'Уеб страница', api: 'API', doc: 'Документ (Word)', generator: 'Генериран набор' };
const ACCESS = { open: 'Отворен достъп', 'browser-only': 'Достъпен само през браузър', none: 'Няма публичен достъп' };
const list = k => (Array.isArray(k) ? k : String(k || '').split(',')).map(s => s.trim()).filter(Boolean);

export const srcShort = key => { const s = data.source(key); return s.short || SHORT[key] || s.publisher || s.title || key; };

export function sourceBtn(keys, o = {}) {
  const ks = list(keys);
  if (!ks.length) return html``;
  return html`<button type="button" class="src-btn" data-src="${ks.join(',')}"${o.asOf ? html` data-asof="${o.asOf}"` : ''} aria-haspopup="dialog" aria-expanded="false">${icon('info', { size: 14 })}<span>${o.label || 'Източник'}</span></button>`;
}
export function srcTag(keys, o = {}) {
  const ks = list(keys);
  if (!ks.length) return html``;
  const label = ks.map(srcShort).join(', ');
  return html`<button type="button" class="src-tag" data-src="${ks.join(',')}"${o.asOf ? html` data-asof="${o.asOf}"` : ''} aria-haspopup="dialog" aria-expanded="false" aria-label="Източник: ${label}">${label}</button>`;
}
/** a displayed number/phrase with its source tag (visible only when „Източници“ is on) */
export function val(text, o = {}) {
  return html`<span class="val${o.mock ? ' val-mock' : ''}"${o.mock ? html` data-mock="true"` : ''}>${text}${o.src ? srcTag(o.src, o) : ''}</span>`;
}

export function sourceCard(keys, o = {}) {
  const ks = list(keys);
  const items = ks.map(k => {
    const s = data.source(k);
    const known = !!(s.url || s.publisher || s.note);
    return html`<section class="src-item">
      <h3>${s.title || k}</h3>
      ${known ? html`<p class="small muted">${[s.publisher, KIND[s.kind], ACCESS[s.access]].filter(Boolean).join(' · ')}</p>` : html`<p class="small muted">Подробностите за този източник предстои да бъдат заредени.</p>`}
      ${s.note ? html`<p class="small">${s.note}</p>` : ''}
      ${s.url ? html`<p class="small"><a class="ext" href="${s.url}" target="_blank" rel="noopener noreferrer">Отвори източника ${icon('external', { size: 14 })}<span class="sr-only"> (в нов раздел)</span></a></p>` : ''}
    </section>`;
  });
  return html`<div class="src-card">${o.asOf ? html`<p class="small"><strong>Данни към ${date(o.asOf)}</strong></p>` : ''}${items}<p class="small"><a href="#/danni">Данни и методика</a> · <a href="#/proverka">Данни и проверка</a>: изданието, оригиналите и SHA-256 им</p></div>`;
}
export function openSource(anchor, keys, o = {}) {
  return popover.open(anchor, { title: 'Източник на данните', body: sourceCard(keys, o), label: 'Източник на данните' });
}
