// Data table (plan 6.6): caption, scoped headers, keyboard-scrollable wrapper, optional sorting, hatched mock rows, CSV export hook.
//   dataTable({id, caption, columns:[{key,label,align,fmt,sort,unit,d}], rows:[{…, _mock:true, _href}], total, sortable, sortBy, dir, query, dense, note, empty, captionVisible})
//   - columns[0] is the row header (<th scope="row">); `fmt(value,row)` may return a string or html``; numbers default to Bulgarian format
//   - rows are plain objects; a row with `_mock:true` is hatched and read as „примерни данни“; `_href` (URL or function of table state) links the first cell
//   - a null/undefined value prints an em dash (never a made-up number); an unknown number prints "—", never NaN
//   - sortable:true adds header buttons (aria-sort). With query:true the choice is written to ?sort=&dir= (pass ctx.query.sort/dir as sortBy/dir)
// The table registers itself with share.attach(), so a block's „Изтегли CSV“ finds it without extra code.
// updateRows(id, rows) updates a live-filtered body and its export while preserving sorting and header focus.
import { scoped } from '../env.js';
import { html, raw, esc, SafeHtml } from '../html.js';
import { num, DASH } from '../format.js';
import { icon } from '../icons.js';
import * as share from '../share.js';

const ownSpecs = new Map();
const specs = {
  get: (id) => scoped('table', ownSpecs).get(id),
  set: (id, v) => scoped('table', ownSpecs).set(id, v),
  clear: () => ownSpecs.clear(),
}; // one map per server request (js/env.js)
share.onReset(() => specs.clear());

const isNum = (v) => typeof v === 'number';
const unitLabel = (c) => (c.unit ? `${c.label}, ${c.unit}` : c.label);
function cell(col, row) {
  const v = row[col.key];
  if (col.fmt) {
    const o = col.fmt(v, row);
    return o instanceof SafeHtml ? o : html`${o ?? DASH}`;
  }
  if (v == null) return html`<span class="muted" title="Няма данни">${DASH}</span>`;
  if (isNum(v)) return html`${num(v, col.d ?? (Number.isInteger(v) ? 0 : 1))}`;
  return html`${v}`;
}
const alignOf = (col, rows) =>
  col.align || (col.num || rows.some((r) => isNum(r[col.key])) ? 'end' : 'start');
const cmp = (a, b, dir) => {
  const an = a == null,
    bn = b == null;
  if (an || bn) return an && bn ? 0 : an ? 1 : -1; // empty values stay last in both directions
  const r = isNum(a) && isNum(b) ? a - b : String(a).localeCompare(String(b), 'bg');
  return dir === 'desc' ? -r : r;
};
const sorted = (s) => {
  if (!s.sortBy) return s.rows;
  const c = s.columns.find((x) => x.key === s.sortBy);
  return c
    ? s.rows
        .map((r, i) => [r, i])
        .sort((x, y) => cmp(x[0][c.key], y[0][c.key], s.dir) || x[1] - y[1])
        .map((x) => x[0])
    : s.rows;
};

function rowsHtml(s) {
  if (!s.rows.length)
    return html`<tr><td colspan="${s.view.length}" class="t-empty">${s.empty || 'Няма редове за показване.'}</td></tr>`;
  return html`${sorted(s).map(
    (r) =>
      html`<tr${r._id ? html` id="${r._id}" tabindex="-1"` : ''}${r._mock ? raw(' data-mock="true"') : ''}>${s.view.map(
        (c, i) => {
          const al = s.aligns[i] === 'end' ? ' class="t-end"' : '';
          const href = i === 0 && (typeof r._href === 'function' ? r._href(s) : r._href);
          const inner = href ? html`<a href="${href}">${cell(c, r)}</a>` : cell(c, r);
          const mock =
            i === 0 && r._mock ? html`<span class="sr-only"> (примерни данни)</span>` : '';
          return i === 0
            ? html`<th scope="row"${raw(al)}>${inner}${mock}</th>`
            : html`<td${raw(al)}>${inner}</td>`;
        },
      )}</tr>`,
  )}`;
}

/** Update a live-filtered table without replacing its controls, sorting or CSV attachment. */
export function updateRows(id, rows) {
  const s = specs.get(id);
  if (!s) return;
  s.rows = rows;
  const tbody = document.getElementById(id)?.querySelector('tbody');
  if (tbody) tbody.innerHTML = rowsHtml(s).s;
}

/** the table as plain values: used by the CSV export and by figure twins */
export function tableData(s) {
  return {
    columns: s.columns.map(unitLabel),
    rows: sorted(s).map((r) =>
      s.columns.map((c) => {
        const v = r[c.key];
        return v instanceof SafeHtml ? v.s.replace(/<[^>]*>/g, '') : (v ?? '');
      }),
    ),
    statuses: sorted(s).map((r) => (r._mock ? 'mock' : r._status)),
    ...(s.rowUnitKey ? { units: sorted(s).map((r) => r[s.rowUnitKey]) } : {}),
  };
}

export function dataTable(o) {
  if (!o.id) throw new Error('dataTable: id is required');
  const rows = o.rows || [];
  const s = { ...o, rows, columns: o.columns || [], dir: o.dir === 'desc' ? 'desc' : 'asc' };
  // csvOnly columns (e.g. cell provenance) stay in the CSV export but are not shown on screen.
  s.view = s.columns.filter((c) => !c.csvOnly);
  s.aligns = s.view.map((c) => alignOf(c, rows));
  if (s.sortBy && !s.view.some((c) => c.key === s.sortBy)) s.sortBy = null;
  specs.set(o.id, s);
  share.attach(o.id, { table: () => tableData(s) });
  const cap = `${o.id}-cap`;
  const head = s.view.map((c, i) => {
    const al = s.aligns[i] === 'end' ? ' t-end' : '';
    const sortable = o.sortable && c.sort !== false;
    const on = sortable && s.sortBy === c.key;
    const lab = c.unit
      ? html`${c.label}<span class="th-unit">, ${c.unit}</span>`
      : html`${c.label}`;
    return sortable
      ? html`<th scope="col" class="${al.trim()}" aria-sort="${on ? (s.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"><button type="button" class="th-sort" data-key="${c.key}"><span class="th-lab">${lab}</span><span class="th-arrow" aria-hidden="true">${icon(on && s.dir === 'desc' ? 'chevronDown' : 'chevronUp', { size: 14 })}</span><span class="sr-only"> (сортирай)</span></button></th>`
      : html`<th scope="col" class="${al.trim()}">${lab}</th>`;
  });
  const foot = o.total
    ? html`<tfoot><tr><th scope="row">${o.total.label || 'Общо'}</th>${s.view.slice(1).map((c, i) => html`<td${raw(s.aligns[i + 1] === 'end' ? ' class="t-end"' : '')}>${o.total.values && o.total.values[c.key] != null ? cell(c, o.total.values) : DASH}</td>`)}</tr></tfoot>`
    : '';
  return html`<div class="table-wrap${o.dense ? ' dense' : ''}" id="${o.id}-wrap" tabindex="0" role="region" aria-labelledby="${cap}" data-ui="table" data-attach="${o.id}"${o.status === 'mock' ? raw(' data-mock-table="true"') : ''}>
    <table class="data" id="${o.id}"><caption id="${cap}" class="${o.captionVisible ? 'cap-visible' : 'sr-only'}">${o.caption}</caption>
    <thead><tr>${head}</tr></thead><tbody>${rowsHtml(s)}</tbody>${foot}</table>
    ${o.note ? html`<p class="table-note small muted">${o.note}</p>` : ''}</div>`;
}

export function mount(el, ctx) {
  const s = specs.get(el.dataset.attach);
  if (!s || !s.sortable) return;
  const table = el.querySelector('table'),
    tbody = table.querySelector('tbody');
  const sync = () => {
    table.querySelectorAll('thead th').forEach((th, i) => {
      const c = s.view[i],
        on = th.hasAttribute('aria-sort') && s.sortBy === c.key;
      if (th.hasAttribute('aria-sort'))
        th.setAttribute('aria-sort', on ? (s.dir === 'desc' ? 'descending' : 'ascending') : 'none');
      const ar = th.querySelector('.th-arrow');
      if (ar)
        ar.innerHTML = icon(on && s.dir === 'desc' ? 'chevronDown' : 'chevronUp', { size: 14 }).s;
    });
  };
  const onClick = (e) => {
    const b = e.target.closest('.th-sort');
    if (!b || !el.contains(b)) return;
    const key = b.dataset.key;
    s.dir = s.sortBy === key && s.dir === 'asc' ? 'desc' : 'asc';
    s.sortBy = key;
    tbody.innerHTML = rowsHtml(s).s;
    sync();
    const col = s.columns.find((c) => c.key === key);
    ctx?.announce?.(`Сортирано по „${col.label}“, ${s.dir === 'desc' ? 'низходящо' : 'възходящо'}`);
    if (s.query) ctx?.setQuery?.({ sort: key, dir: s.dir }, { rerender: false });
    b.focus({ preventScroll: true });
  };
  el.addEventListener('click', onClick);
  return () => el.removeEventListener('click', onClick);
}
