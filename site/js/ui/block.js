// Block: the frame of every data block (plan 4.0): one heading, scope chip + status pill, source, share, content, footnote.
//   block({id, title, level, sub, scope, status, mock, why, source, asOf, share, tools, body, foot, report, cls, flat, quiet})
// - status 'real' (default) | 'partial' | 'forecast' | 'mock' | 'pending' | 'text' | false (no status); mock:true ≡ status:'mock'
//   'text': words only, no number of the data (a definition, a guide's checklist, the visitor's own inputs): no pill, and
//   tools/mock/check_mock_v6.py fails such a block that shows a chart, a table, a KPI or a sourced number.
//   pill:false keeps the status and its data-block-status but shows no pill (a note under the figures: it cites real numbers);
//   a 'text' block has no „Намерих грешка“ link unless report is set
// - a mock block is hatched on its top edge, says „Примерни данни“ (pill + note with `why`) and, while „Само официални данни“ is on,
//   is replaced by the one-line `mockHidden` note (the id stays, so ?to= still lands somewhere)
// - one meta line under the title: scope chip, status pill, „Данни към <asOf>“, „Източник“ button (from `source`)
// - `share` registers the block for the ONE block menu „Сподели“ (copy, link, PNG, CSV, embed, „Намерих грешка“; default: on when `source`
//   is given and the block is not pending). A block without the menu keeps „Намерих грешка“ in its footer and PNG in its header;
//   see DEV_GUIDE §5.7 and §7
import { html, raw, esc, cx, plain } from '../html.js';
import { store } from '../store.js';
import * as share from '../share.js';
import { date } from '../format.js';
import { sourceBtn } from './source.js';
import { scopeChip } from './scope.js';
import { statusPill } from './status.js';
import { mockNote, mockHidden, pendingState } from './states.js';
import { reportLink, reportHref } from './cards.js';

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
  const wantReport = o.report ?? (status !== false && status !== 'pending' && status !== 'mock' && status !== 'text');
  const report = { block: id, src: src.join(','), type: 'error' };
  if (wantShare) {
    const sh = typeof o.share === 'object' && o.share ? o.share : {};
    share.register(id, {
      title,
      sub: o.sub ? plain(o.sub) : '',
      text: sh.text ?? (o.sub ? plain(o.sub) : undefined),
      source: src, asOf: o.asOf, status: status || undefined, mock,
      chart: sh.chart, table: sh.table, embed: sh.embed, embedParams: sh.embedParams, link: sh.link, period: sh.period, unit: sh.unit, scope: o.scope,
      report: wantReport ? reportHref(report) : undefined
    });
  }

  const asOfHtml = o.asOf ? html`<span class="block-asof">Данни към ${date(o.asOf)}</span>` : '';
  const tags = [scopeOf(o.scope), status && status !== 'text' && o.pill !== false ? statusPill(status, { label: o.statusLabel }) : '', asOfHtml, src.length ? sourceBtn(src, { asOf: o.asOf }) : ''];
  const tagsHtml = tags.some(t => t && (t.s ?? t)) ? html`<div class="block-tags">${tags}</div>` : '';
  const tools = [o.tools ?? '', wantShare ? share.shareButton(id) : ''];
  const toolsHtml = tools.some(t => t && (t.s ?? t)) ? html`<div class="block-tools">${tools}</div>` : '';

  const foot = typeof o.foot === 'string' && o.foot ? html`<p>${o.foot}</p>` : o.foot || '';
  const looseReport = wantReport && !wantShare;
  const footHtml = foot || looseReport ? html`<div class="block-foot">${foot}${looseReport ? reportLink(report) : ''}</div>` : '';

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
