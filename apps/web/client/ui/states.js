// State components (plan 6.6). Each root carries data-state="loading|empty|error|pending|mock|offline":
// the checker (tests/e2e/screens.py) and ?demo= use that attribute. Texts are the plan's wording.
//   skeleton({lines})  ·  pageSkeleton()  ·  emptyState({title,text,action})  ·  errorState({retry:true})
//   pendingState({id:'P01'})  ·  pendingState({title, text, source:['minfin']})  ·  mockBadge()  ·  mockNote(text)
import { html } from '../html.js';
import { icon } from '../icons.js';
import { data } from '../data.js';
import { date } from '../format.js';

const W = ['w1', 'w2', 'w3', 'w4', 'w5'];

export function skeleton(o = {}) {
  const n = o.lines ?? 3;
  return html`<div class="skel" data-state="loading" role="status" aria-busy="true"><span class="sr-only">${o.label || 'Зареждане…'}</span>${Array.from({ length: n }, (_, i) => html`<span class="skel-bar skel-${W[i % W.length]}"></span>`)}</div>`;
}
export function pageSkeleton() {
  return html`<div class="skel skel-page" data-state="loading" role="status" aria-busy="true"><span class="sr-only">Зареждане…</span>
    <div class="skel-row"><span class="skel-card"></span><span class="skel-card"></span><span class="skel-card"></span></div>
    <span class="skel-block"></span><span class="skel-bar skel-w2"></span><span class="skel-bar skel-w4"></span></div>`;
}

function action(a) {
  if (!a) return '';
  if (a.href)
    return html`<p class="state-act"><a class="btn${a.primary === false ? '' : ' btn-primary'}" href="${a.href}">${a.label}</a></p>`;
  return html`<p class="state-act"><button type="button" class="btn${a.primary === false ? '' : ' btn-primary'}" data-action="${a.action}"${a.value ? html` data-value="${a.value}"` : ''}>${a.label}</button></p>`;
}

/** emptyState({title:'Няма резултати', text:'Опитай с други думи.', action:{label:'Изчисти', action:'clear'}}) */
export function emptyState(o = {}) {
  return html`<div class="state state-empty" data-state="empty"><span class="state-ic">${icon(o.icon || 'search', { size: 28 })}</span>
    <div class="state-main"><p class="state-title">${o.title || 'Няма какво да покажем тук'}</p>${o.text ? html`<p class="state-text">${o.text}</p>` : ''}${(o.actions || [o.action]).map(action)}</div></div>`;
}

/** errorState() -> the plan's wording + „Опитай пак“ (the delegated [data-action=retry] re-renders the screen); {title, text, retry:false, link:false (no „Откъде са данните“)} */
export function errorState(o = {}) {
  return html`<div class="state state-error" data-state="error" role="alert"><span class="state-ic">${icon('alert', { size: 28 })}</span>
    <div class="state-main"><p class="state-title">${o.title || 'Не успяхме да заредим данните.'}</p><p class="state-text">${o.text || 'Опитай пак.'}</p>
    <p class="state-act">${o.retry === false ? '' : html`<button type="button" class="btn btn-primary" data-action="retry">${icon('refresh', { size: 16 })} Опитай пак</button> `}${o.link === false ? '' : html`<a class="btn" href="#/danni">Откъде са данните</a>`}</p></div></div>`;
}

function publisherOf(keys) {
  const ps = [...new Set((keys || []).map((k) => data.source(k).publisher).filter(Boolean))];
  return ps.join(', ');
}
/**
 * pendingState({id:'P01'})            takes title/reason/expected/source from core.pending
 * pendingState({title, text, source}) explicit; with neither, the generic „Предстои“ note
 * Never shows a number: this is what stands in for data that exists at the publisher but is not extracted yet.
 */
export function pendingState(o = {}) {
  const p = (o.id && data.pending(o.id)) || {};
  const title = o.title || p.title;
  const keys = o.source || p.source || [];
  const who = publisherOf(keys);
  const text =
    o.text ||
    (who
      ? `Данните съществуват при ${who}, още не са извлечени.`
      : 'Данните съществуват при издателя, още не са извлечени.');
  const reason = o.reason || p.reason;
  const expected = o.expected || p.expected;
  return html`<div class="state state-pending" data-state="pending"${o.id ? html` data-pending-id="${o.id}"` : ''}><span class="state-ic">${icon('dashed', { size: 28 })}</span>
    <div class="state-main"><p class="state-kicker">Предстои</p>${title ? html`<p class="state-title">${title}</p>` : ''}<p class="state-text">${text}</p>
    ${reason ? html`<p class="state-text small">${reason}</p>` : ''}${expected ? html`<p class="state-text small muted">Къде да ги видиш: ${expected}</p>` : ''}${action(o.action)}</div></div>`;
}

export function offlineNote(asOf) {
  return html`<span data-state="offline">${icon('wifiOff', { size: 16 })} Няма връзка — показваме запазеното${asOf ? html` от ${date(asOf)}` : ''}</span>`;
}

/** the „Примерни данни“ badge (hatch + words) */
export const mockBadge = (text = 'Примерни данни') =>
  html`<span class="mock-badge">${icon('hatch', { size: 14 })}<span>${text}</span></span>`;
/** a note under a mock block: badge + why (the why is the dataset's own `why` text); {badge:false} drops the badge when a status pill already says it */
export const mockNote = (text, o = {}) =>
  html`<p class="mock-note" data-state="mock">${o.badge === false ? icon('hatch', { size: 14 }) : mockBadge()}<span class="small">${text || 'Стойностите са измислени и показват само как ще изглежда екранът.'}</span></p>`;
/** what stands in for a hidden mock block / tile while „Само официални данни“ is on, with a way back */
export const mockHidden = (text) =>
  html`<p class="mock-hidden" data-state="mock-hidden">${icon('hatch', { size: 16 })}<span>${text || 'Скрит е блок с примерни данни.'}</span> <button type="button" class="link-btn" data-action="show-mock">Покажи</button></p>`;
