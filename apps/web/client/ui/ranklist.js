// Ranked bar list: label, value and a thin bar per row. The accessible, phone-first alternative to a bar chart with many labels.
//   ranklist({id, caption, label, ordered, unit, fmt, d, max, sort, shares, categoryLabel, mock, items:[{label, sub, value, share, href, mock, status, pctGdp, children}]})
// - `unit`: 'mln' (default; million euro through view.amount, so „% от БВП“ (needs item.pctGdp), „на човек“ and „и в лева“ apply),
//   'pct' (value is already a percent), 'num' (plain number); or `fmt:(value, item) => string | html``
// - bars are relative to `max` (default: the largest top-level value); a child's bar is relative to its parent's value
// - `ordered:true` numbers the rows (<ol>); rows keep the given order unless `sort:'desc'|'asc'` (rows without a value go last)
// - `value` null/undefined/NaN → a dashed „Предстои“ row, no number and no bar; a negative value prints with its minus and gets no bar
// - `share` (percent) shows „дял“ after the value; `shares:true` computes it from the top-level total; items with `children` expand (<details>)
// - `href` makes the label a link (for a row with children the link „Към …“ follows the children: a link inside <summary> would also toggle it)
// - `caption` is visible and names the list; without it `label` gives the list an accessible name only
// - the table twin (CSV export) is registered with share.attach under `id`; `categoryLabel` names its first column, `unitLabel` the unit
//   of the raw values (default „млн. €“ for unit 'mln', „%“ for 'pct')
// - any mock row/option → the „Примерни данни“ badge, a hatched bar and a spoken „(примерни данни)" on the row
import { html, raw, esc, cx, plain, SafeHtml } from '../html.js';
import { num, pct, DASH } from '../format.js';
import { amount } from '../view.js';
import * as share from '../share.js';
import { mockBadge } from './states.js';
import { statusPill } from './status.js';
import { tableData } from './table.js';

const ok = (v) => typeof v === 'number' && Number.isFinite(v);

function valueHtml(o, it, v) {
  if (o.fmt) {
    const r = o.fmt(v, it);
    return r instanceof SafeHtml ? r : html`${r ?? DASH}`;
  }
  if (o.unit === 'pct') return html`${pct(v, o.d ?? 1)}`;
  if (o.unit === 'num') return html`${num(v, o.d ?? (Number.isInteger(v) ? 0 : 1))}`;
  return html`${amount(undefined, { mln: v, pctGdp: it.pctGdp, d: o.d })}`;
}

function rowHtml(o, it, { tag, n, rel, total }) {
  const known = ok(it.value) && it.status !== 'pending';
  const mock = o.mock === true || it.mock === true || it.status === 'mock';
  const width =
    known && ok(rel) && rel > 0 ? Math.min(100, Math.max(0, (it.value / rel) * 100)) : 0;
  const shareV = ok(it.share)
    ? it.share
    : o.shares && known && ok(total) && total > 0
      ? (it.value / total) * 100
      : null;
  const label =
    it.href && !it.children?.length ? html`<a href="${it.href}">${it.label}</a>` : it.label;
  const st =
    it.status && it.status !== 'real' && it.status !== 'pending' && it.status !== 'mock'
      ? html` <span class="rank-st">${statusPill(it.status)}</span>`
      : '';
  const val = known
    ? html`${valueHtml(o, it, it.value)}${ok(shareV) ? html`<span class="rank-share">${pct(shareV, 1)}</span>` : ''}`
    : html`Предстои`;
  return new SafeHtml(
    `<${tag} class="rank-row"${known ? '' : ' data-st="pending"'}>` +
      (n ? `<span class="rank-n" aria-hidden="true">${n}</span>` : '') +
      html`<span class="rank-label">${label}${it.sub ? html`<small>${it.sub}</small>` : ''}${st}${mock ? html`<span class="sr-only"> (примерни данни)</span>` : ''}</span><span class="rank-val">${val}</span>`
        .s +
      `<span class="rank-bar" aria-hidden="true">${known && width > 0 ? `<span class="rank-fill"${mock ? ' data-mock="true"' : ''} style="width:${Number(width.toFixed(1))}%"></span>` : ''}</span>` +
      `</${tag}>`,
  );
}

export function ranklist(o = {}) {
  if (!o.id) throw new Error('ranklist: id is required');
  let items = (o.items || []).filter((it) => it && it.label != null && it.label !== '');
  if (o.sort === 'desc' || o.sort === 'asc') {
    const dir = o.sort === 'desc' ? -1 : 1;
    items = items
      .map((it, i) => [it, i])
      .sort((a, b) => {
        const av = ok(a[0].value),
          bv = ok(b[0].value);
        if (!av || !bv) return av === bv ? a[1] - b[1] : av ? -1 : 1;
        return (a[0].value - b[0].value) * dir || a[1] - b[1];
      })
      .map((x) => x[0]);
  }
  const finite = items
    .filter((it) => ok(it.value) && it.status !== 'pending')
    .map((it) => it.value);
  const rel = ok(o.max) && o.max > 0 ? o.max : Math.max(0, ...finite);
  const total = finite.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const anyMock =
    o.mock === true ||
    items.some(
      (it) => it.mock === true || it.status === 'mock' || it.children?.some((c) => c.mock === true),
    );
  const listTag = o.ordered ? 'ol' : 'ul';
  const cap = o.caption ? html`<p class="rank-cap" id="${o.id}-cap">${o.caption}</p>` : '';

  const li = (it, i) => {
    const n = o.ordered ? i + 1 : 0;
    const kids = (it.children || []).filter((c) => c && c.label != null && c.label !== '');
    if (!kids.length) return html`<li>${rowHtml(o, it, { tag: 'div', n, rel, total })}</li>`;
    const kidFinite = kids.filter((c) => ok(c.value) && c.status !== 'pending').map((c) => c.value);
    const kidRel = ok(it.value) && it.value > 0 ? it.value : Math.max(0, ...kidFinite);
    const kidTotal = kidFinite.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    return html`<li><details class="rank-det"><summary>${rowHtml(o, it, { tag: 'span', n, rel, total })}</summary>
      <ul class="rank-children">${kids.map((c) => html`<li>${rowHtml({ ...o, shares: false }, c, { tag: 'div', n: 0, rel: kidRel, total: kidTotal })}</li>`)}</ul>
      ${it.href ? html`<p class="rank-more"><a href="${it.href}">Към „${plain(it.label)}“</a></p>` : ''}</details></li>`;
  };

  // table twin: parent › child rows, raw values (million euro for unit 'mln'), shares when shown
  const rows = [];
  const walk = (list, path, top) =>
    list.forEach((it) => {
      const known = ok(it.value) && it.status !== 'pending';
      const s = ok(it.share)
        ? it.share
        : o.shares && top && known && total > 0
          ? (it.value / total) * 100
          : null;
      rows.push({
        n: [...path, plain(it.label)].join(' › '),
        v: known ? it.value : null,
        p: ok(s) ? Number(s.toFixed(2)) : null,
        _mock: o.mock === true || it.mock === true || it.status === 'mock',
        _status: known ? it.status : 'pending',
      });
      if (it.children?.length)
        walk(
          it.children.filter((c) => c && c.label != null),
          [...path, plain(it.label)],
          false,
        );
    });
  walk(items, [], true);
  const unitLabel =
    o.unitLabel ??
    (o.fmt ? undefined : o.unit === 'pct' ? '%' : o.unit === 'num' ? undefined : 'млн. €');
  const columns = [
    { key: 'n', label: o.categoryLabel || 'Позиция' },
    { key: 'v', label: 'Стойност', unit: unitLabel, d: o.d, num: true },
  ];
  if (rows.some((r) => ok(r.p)))
    columns.push({ key: 'p', label: 'Дял', unit: '%', d: 1, num: true });
  share.attach(o.id, { table: () => tableData({ columns, rows }) });

  return html`<div class="${cx('rank', o.ordered && 'rank-ordered', o.cls)}" id="${o.id}" data-attach="${o.id}"${anyMock ? raw(' data-mock-fig="true"') : ''}>
    ${cap}${anyMock ? html`<p class="rank-mock">${mockBadge()}</p>` : ''}
    ${
      items.length
        ? new SafeHtml(
            `<${listTag} class="rank-list"${o.caption ? ` aria-labelledby="${esc(o.id)}-cap"` : o.label ? ` aria-label="${esc(plain(o.label))}"` : ''}>${items
              .map(li)
              .map((x) => x.s)
              .join('')}</${listTag}>`,
          )
        : html`<p class="muted">Няма редове за показване.</p>`
    }
  </div>`;
}
