// Flow diagram (Sankey): who pays into which pot and where it goes. Wide screens get the diagram, phones (< 600 px) get the same flows as a grouped list.
//   sankey({id, title, sub, label, desc, unit, unitLabel, fmt, d, mock, height, cls, nodes:[name | {name, mock, color}], links:[{source, target, value, mock}]})
// - `links` use node NAMES. `nodes` is optional: it fixes the order and the colour of the nodes (slot 1…8 by position; a node keeps its colour when
//   others drop out) and a name that only appears in `links` is added after them. Several links between the same two nodes are drawn as they are.
// - `unit` 'mln' (default, „млн. €“) | 'pct' (%) | 'num' (no unit) or any other text as it is; `unitLabel` overrides the text; `fmt:v=>string` (then no unit
//   text is added unless you pass `unit`); `d` = decimals (default: none when every number is whole, else one, the same in the diagram, list and table).
//   The numbers are printed raw (no „на човек“ / „лв.“ switches): convert them yourself before you pass them.
// - only links with a positive number are drawn. A link without a number (null) or with 0 / a negative number stays in the list and in the table twin
//   („Предстои“ for null), never in the diagram. No link has a number, or the links loop back (a diagram needs a one-way flow) → the diagram is
//   left out and the list is shown at every width (class `sankey-flat`).
// - `mock:true` (everything) or `mock:true` on a link/node → badge „Примерни данни“, hatched nodes (a node touched by a mock link counts as mock)
//   and hatched bars in the list.
// - the table twin (От / Към / Стойност, CSV export) is registered under `<id>-chart` (diagram) or `<id>` (list only); `desc` is the one-sentence takeaway
//   that names the diagram for assistive tech; `height` defaults to the busiest column of the layout (320…720 px).
// - ids: wrapper `#<id>.sankey`, diagram `#<id>-chart` (figure `<id>-chart-fig`), list `.sankey-fallback`.
import { html, raw, cx, plain } from '../html.js';
import { num, DASH } from '../format.js';
import { icon } from '../icons.js';
import { chart } from './chart.js';
import { emptyState, mockBadge } from './states.js';
import { dataTable, tableData } from './table.js';
import * as share from '../share.js';

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const UNITS = { mln: 'млн. €', pct: '%', num: '' };
const nameOf = (n) =>
  (typeof n === 'string' ? n : n && n.name != null ? String(n.name) : '').trim();

/** is the flow one-way, and how many nodes does its busiest column hold (for the default height)? */
function shape(names, links) {
  const indeg = new Map(names.map((n) => [n, 0]));
  const outdeg = new Map(names.map((n) => [n, 0]));
  links.forEach((l) => {
    indeg.set(l.target, indeg.get(l.target) + 1);
    outdeg.set(l.source, outdeg.get(l.source) + 1);
  });
  const depth = new Map();
  const queue = names.filter((n) => indeg.get(n) === 0);
  queue.forEach((n) => depth.set(n, 0));
  let seen = 0;
  while (queue.length) {
    const n = queue.shift();
    seen++;
    for (const l of links) {
      if (l.source !== n) continue;
      depth.set(l.target, Math.max(depth.get(l.target) ?? 0, depth.get(n) + 1));
      indeg.set(l.target, indeg.get(l.target) - 1);
      if (indeg.get(l.target) === 0) queue.push(l.target);
    }
  }
  const last = Math.max(0, ...depth.values());
  const cols = new Map();
  names.forEach((n) => {
    const c = outdeg.get(n) === 0 ? last : (depth.get(n) ?? 0);
    cols.set(c, (cols.get(c) || 0) + 1);
  });
  return { dag: seen === names.length, busiest: Math.max(1, ...cols.values()) };
}

function flowList(o, { nodes, links, fmt, unitText, mockAll }) {
  const max = Math.max(0, ...links.filter((l) => ok(l.value) && l.value > 0).map((l) => l.value));
  const groups = nodes
    .map((n) => ({ n, out: links.filter((l) => l.source === n.name) }))
    .filter((g) => g.out.length);
  const unitSr = unitText ? html`<span class="sr-only"> ${unitText}</span>` : '';
  const flow = (l) => {
    const known = ok(l.value);
    const mock = mockAll || l.mock === true;
    const width = known && l.value > 0 && max > 0 ? Math.min(100, (l.value / max) * 100) : 0;
    return html`<li><div class="rank-row"${known ? '' : raw(' data-st="pending"')}>
      <span class="rank-label"><span class="sk-arrow" aria-hidden="true">→</span><span class="sr-only">към </span>${l.target}${mock ? html`<span class="sr-only"> (примерни данни)</span>` : ''}</span>
      <span class="rank-val">${known ? html`${fmt(l.value)}${unitSr}` : 'Предстои'}</span>
      <span class="rank-bar" aria-hidden="true">${width > 0 ? html`<span class="rank-fill"${mock ? raw(' data-mock="true"') : ''} style="width:${Number(width.toFixed(1))}%"></span>` : ''}</span>
    </div></li>`;
  };
  return html`<div class="sankey-fallback"><ul class="rank-list sk-list" aria-label="${plain(o.label ?? o.title ?? 'Потоци')}: потоци по източник">${groups.map(
    (g) => {
      const sum = g.out.filter((l) => ok(l.value) && l.value > 0).reduce((a, l) => a + l.value, 0);
      return html`<li class="sk-src"><p class="sk-from"><span class="sk-name">${g.n.name}</span><span class="sk-sum">${sum > 0 ? html`${fmt(sum)}${unitText ? html` ${unitText}` : ''}` : html`<span class="sk-pending">Предстои</span>`}</span></p>
      <ul class="rank-list sk-to">${g.out.map(flow)}</ul></li>`;
    },
  )}</ul></div>`;
}

export function sankey(o = {}) {
  if (!o.id) throw new Error('sankey: id is required');
  const links = (o.links || [])
    .map((l) =>
      l
        ? {
            source: nameOf(l.source),
            target: nameOf(l.target),
            value: l.value,
            mock: l.mock === true,
          }
        : null,
    )
    .filter((l) => l && l.source && l.target && l.source !== l.target);
  if (!links.length)
    return emptyState({
      title: o.emptyTitle || 'Няма данни за показване',
      text: o.emptyText || 'За тази селекция няма потоци.',
      icon: 'barChart',
    });

  // nodes in the order given, then the names that only occur in links; the colour slot is the position among ALL nodes
  const all = [];
  const add = (n) => {
    const name = nameOf(n);
    if (name && !all.some((x) => x.name === name))
      all.push({
        name,
        mock: typeof n === 'object' && n.mock === true,
        color: typeof n === 'object' ? n.color : undefined,
      });
  };
  (o.nodes || []).forEach(add);
  links.forEach((l) => {
    add(l.source);
    add(l.target);
  });
  all.forEach((n, i) => {
    n.color = n.color ?? (i < 8 ? i + 1 : 'other');
  });
  links.forEach((l) => {
    if (l.mock)
      all.forEach((n) => {
        if (n.name === l.source || n.name === l.target) n.mock = true;
      });
  });

  // a custom `fmt` brings its own unit: no unit text is added unless `unit` / `unitLabel` is given
  const unit = o.unit ?? (o.fmt ? '' : 'mln');
  const unitText = o.unitLabel ?? (Object.hasOwn(UNITS, unit) ? UNITS[unit] : String(unit));
  // one number of decimals for the whole diagram: none when every number is whole, else one (unless `d` says otherwise)
  const nums = links.map((l) => l.value).filter(ok);
  const d = o.d ?? (nums.every(Number.isInteger) ? 0 : 1);
  const fmt = o.fmt ? (v) => plain(o.fmt(v)) : (v) => num(v, d);
  const mockAll = o.mock === true;
  const anyMock = mockAll || all.some((n) => n.mock) || links.some((l) => l.mock);

  const drawn = links.filter((l) => ok(l.value) && l.value > 0);
  const used = all.filter((n) => drawn.some((l) => l.source === n.name || l.target === n.name));
  const { dag, busiest } = drawn.length
    ? shape(
        used.map((n) => n.name),
        drawn,
      )
    : { dag: false, busiest: 1 };
  if (drawn.length && !dag)
    console.error(`[sankey ${o.id}] the links loop back; showing the list only`);
  const withChart = drawn.length > 0 && dag;

  const table = {
    columns: [
      { key: 'a', label: 'От' },
      { key: 'b', label: 'Към' },
      {
        key: 'v',
        label: 'Стойност',
        unit: unitText || undefined,
        d,
        fmt: o.fmt ? (v) => (v == null ? DASH : fmt(v)) : undefined,
        num: true,
      },
    ],
    rows: links.map((l) => ({
      a: l.source,
      b: l.target,
      v: ok(l.value) ? l.value : null,
      _mock: mockAll || l.mock,
      _status: ok(l.value) ? undefined : 'pending',
    })),
  };
  const list = flowList(o, { nodes: all, links, fmt, unitText, mockAll });

  if (withChart) {
    const fig = chart({
      id: `${o.id}-chart`,
      type: 'sankey',
      title: o.title,
      sub: o.sub,
      label: o.label,
      desc: o.desc,
      unit: unitText,
      d,
      fmt: o.fmt ? fmt : undefined,
      mock: mockAll,
      nodes: used.map((n) => ({ name: n.name, mock: n.mock || undefined, color: n.color })),
      links: drawn.map((l) => ({
        source: l.source,
        target: l.target,
        value: l.value,
        mock: l.mock || undefined,
      })),
      height: o.height || Math.min(720, Math.max(320, busiest * 30 + 40)),
      table,
    });
    return html`<div class="${cx('sankey', o.cls)}" id="${o.id}">${fig}${list}</div>`;
  }

  // no diagram: caption, list and the table twin (the list stays visible at every width)
  share.attach(o.id, { table: () => tableData({ ...table, rows: table.rows }) });
  const cap =
    o.title || o.sub || anyMock
      ? html`<p class="fig-cap">${o.title ? html`<span class="fig-title">${o.title}</span>` : ''}${o.sub ? html`<span class="fig-sub">${o.sub}</span>` : ''}${anyMock ? html`<span class="fig-mock">${mockBadge()}</span>` : ''}</p>`
      : '';
  return html`<div class="${cx('sankey sankey-flat', o.cls)}" id="${o.id}" data-attach="${o.id}"${anyMock ? raw(' data-mock-fig="true"') : ''}>${cap}${list}
    <details class="disc fig-table"><summary><span class="disc-title">${icon('table', { size: 16 })} Таблица с данните</span></summary><div class="disc-body">${dataTable({ id: `${o.id}-t`, caption: o.title ? `Данни за диаграмата: ${o.title}` : 'Данни за диаграмата', columns: table.columns, rows: table.rows, dense: true, status: anyMock ? 'mock' : undefined })}</div></details>
  </div>`;
}
