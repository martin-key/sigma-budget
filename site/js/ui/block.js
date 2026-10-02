// Block: the frame of every data block (plan 4.0): one heading, scope chip + status pill, source, share, content, footnote.
//   block({id, title, level, sub, scope, status, mock, why, source, asOf, share, tools, body, foot, report, cls, flat, quiet})
// - status 'real' (default) | 'partial' | 'forecast' | 'mock' | 'pending' | false (no pill); mock:true ≡ status:'mock'
// - a mock block is hatched on its top edge, says „Примерни данни“ (pill + note with `why`) and, while „Само реални данни“ is on,
//   is replaced by the one-line `mockHidden` note (the id stays, so ?to= still lands somewhere)
// - `source` (keys) gives the „Източник“ button and „Данни към <asOf>“ in the footer; `share` registers the block for the
//   „Сподели“ menu (default: on when `source` is given and the block is not pending); see DEV_GUIDE §5.7 and §7
import { html, raw, esc, cx, plain } from '../html.js';
import { store } from '../store.js';
import * as share from '../share.js';
import { date } from '../format.js';
import { sourceBtn } from './source.js';
import { scopeChip } from './scope.js';
import { statusPill } from './status.js';
import { mockNote, mockHidden, pendingState } from './states.js';
import { reportLink } from './cards.js';

const keysOf = s => (Array.isArray(s) ? s : String(s || '').split(',')).map(x => x.trim()).filter(Boolean);
const scopeOf = s => (!s ? '' : typeof s === 'string' ? scopeChip(s) : scopeChip(s.key, s));   // 'kfp' | {key, note, label, gl}

export function block(o = {}) {
  if (!o.id) throw new Error('block: id is required');
  if (o.title == null || o.title === '') throw new Error(`block ${o.id}: title is required`);
  const id = o.id;
  const level = [2, 3, 4].includes(o.level) ? o.level : 2;
  const mock = o.mock === true || o.status === 'mock';
  const status = mock ? 'mock' : o.status === undefined ? 'real' : o.status;
  const title = plain(o.title);

  if (mock && store.get('onlyReal')) {
    return html`<div class="block-hidden" id="${id}" data-block-hidden="true">${mockHidden(`Скрит е блок с примерни данни: „${title}“.`)}</div>`;
  }

  const src = keysOf(o.source);
  const wantShare = o.share === undefined ? src.length > 0 && status !== 'pending' : !!o.share;
  if (wantShare) {
    const sh = typeof o.share === 'object' && o.share ? o.share : {};
    share.register(id, {
      title,
      sub: o.sub ? plain(o.sub) : '',
      text: sh.text ?? (o.sub ? plain(o.sub) : undefined),
      source: src, asOf: o.asOf, status: status || undefined, mock,
      chart: sh.chart, table: sh.table, embed: sh.embed, embedParams: sh.embedParams
    });
  }

  const tags = [scopeOf(o.scope), status ? statusPill(status, { label: o.statusLabel }) : ''];
  const tagsHtml = o.scope || status ? html`<div class="block-tags">${tags}</div>` : '';
  const tools = [o.tools ?? '', src.length ? sourceBtn(src, { asOf: o.asOf }) : '', wantShare ? share.shareButton(id) : ''];
  const toolsHtml = tools.some(t => t && (t.s ?? t)) ? html`<div class="block-tools">${tools}</div>` : '';

  const wantReport = o.report ?? (status !== false && status !== 'pending' && status !== 'mock');
  const foot = typeof o.foot === 'string' && o.foot ? html`<p>${o.foot}</p>` : o.foot || '';
  const footHtml = o.asOf || foot || wantReport
    ? html`<div class="block-foot">${o.asOf ? html`<p class="block-asof">Данни към ${date(o.asOf)}</p>` : ''}${foot}${wantReport ? reportLink({ block: id, src: src.join(','), type: 'error' }) : ''}</div>`
    : '';

  const body = o.body ?? (status === 'pending' ? pendingState(o.pending ? { id: o.pending } : { title }) : '');
  const hOpen = raw(`<h${level} class="block-title" id="${esc(id)}-t">`), hClose = raw(`</h${level}>`);

  return html`<section class="${cx('block', o.flat && 'block-flat', o.quiet && 'block-quiet', o.cls)}" id="${id}" aria-labelledby="${id}-t"${status ? html` data-block-status="${status}"` : ''}${mock ? raw(' data-block-mock="true"') : ''}>
    ${mock ? html`<span class="block-strip" data-mock="true" aria-hidden="true"></span>` : ''}
    <div class="block-head">${hOpen}${o.title}${hClose}${tagsHtml}${toolsHtml}</div>
    ${o.sub ? html`<p class="block-sub">${o.sub}</p>` : ''}
    <div class="block-body">${body}</div>
    ${mock ? mockNote(o.why, { badge: false }) : ''}
    ${footHtml}
  </section>`;
}
