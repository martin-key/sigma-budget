// Chart figure: caption, HTML legend (toggles series), the chart itself (ECharts, SVG), and a table twin that is always in the DOM.
//   chart({id:'prihodi-po-godini', type:'bar', title:'Приходи по години', sub:'млрд. €', unit:'млрд. €', categories:['2024','2025'], series:[{name:'Приходи', data:[1,2]}]})
// types: bar | barh | line | donut | treemap | sankey | option (see charts.js for the full spec).  id is required and must be unique on the screen.
// Rules: the chart is hidden from assistive tech (role="img" + a name) and the table twin carries the data; a mock series is hatched
// (decal) and the figure says „Примерни данни“; ECharts is loaded only when a chart becomes visible; colours follow the design tokens
// and the theme switch re-draws in place.
import { html, raw, esc } from '../html.js';
import { DASH } from '../format.js';
import { emptyState, mockBadge } from './states.js';
import { icon } from '../icons.js';
import { dataTable, tableData } from './table.js';
import * as share from '../share.js';
import { loadECharts, buildOption } from '../charts.js';

const specs = new Map();
share.onReset(() => specs.clear());
export const chartSpec = id => specs.get(id);

const KIND = { bar: 'Колонна графика', barh: 'Хоризонтална стълбовидна графика', line: 'Линейна графика', donut: 'Кръгова графика', treemap: 'Карта с площи', sankey: 'Диаграма на потоците', option: 'Графика' };
const HEIGHT = { bar: 280, line: 280, donut: 260, treemap: 340, sankey: 360, option: 280 };
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const valOf = d => (isObj(d) ? d.value : d);

/** is any part of this spec mock? */
export const isMockSpec = spec => !!(spec.mock || spec.series?.some(s => s.mock || s.data?.some(d => isObj(d) && d.mock)) || spec.data?.some?.(d => d.mock) || spec.nodes?.some?.(n => isObj(n) && n.mock));

function hasData(spec) {
  if (spec.type === 'option') return true;
  if (spec.type === 'donut' || spec.type === 'treemap') return !!spec.data?.length;
  if (spec.type === 'sankey') return !!spec.links?.length;
  return !!spec.series?.some(s => s.data?.some(d => valOf(d) != null));
}

/** css colour of slot i for the HTML legend (the chart itself gets resolved hex values from charts.js) */
function cssColor(spec, c, i) {
  if (typeof c === 'number') return `var(--series-${c})`;
  if (c === 'other') return 'var(--series-other)';
  if (typeof c === 'string' && c.startsWith('--')) return `var(${c})`;
  if (typeof c === 'string') return c;
  return i < 8 ? `var(--series-${i + 1})` : 'var(--series-other)';
}
function legendOf(spec) {
  if (spec.legend === false) return [];
  if (spec.type === 'bar' || spec.type === 'barh' || spec.type === 'line') return spec.series.map((s, i) => ({ name: s.name, color: cssColor(spec, s.color ?? spec.colors?.[i], i), mock: !!(s.mock || spec.mock) }));
  if (spec.type === 'donut') {
    const src = spec.data || [];
    const out = src.slice(0, 8).map((d, i) => ({ name: d.name, color: cssColor(spec, d.color ?? spec.colors?.[i], i), mock: !!(spec.mock || d.mock) }));
    if (src.length > 8) out.push({ name: 'Други', color: 'var(--series-other)', mock: src.slice(8).some(d => d.mock) });
    return out;
  }
  return [];
}

/** table twin as a dataTable spec (also the source of the CSV export) */
function tableSpec(spec) {
  if (spec.table) return spec.table;
  const f = spec.fmt ? (v => (v == null ? DASH : spec.fmt(v))) : null;
  const col = (key, label, extra = {}) => ({ key, label, unit: spec.unit, d: spec.d, fmt: f || undefined, num: true, ...extra });
  switch (spec.type) {
    case 'bar': case 'barh': case 'line': {
      const columns = [{ key: 'c', label: spec.categoryLabel || 'Категория' }, ...spec.series.map((s, i) => col('s' + i, s.name))];
      const rows = (spec.categories || []).map((cat, j) => {
        const r = { c: cat };
        spec.series.forEach((s, i) => { const d = s.data[j]; r['s' + i] = valOf(d) ?? null; if (s.mock || spec.mock || (isObj(d) && d.mock)) r._mock = true; });
        return r;
      });
      return { columns, rows };
    }
    case 'donut': {
      const total = (spec.data || []).reduce((a, d) => a + (Number.isFinite(d.value) ? d.value : 0), 0);
      return {
        columns: [{ key: 'n', label: spec.categoryLabel || 'Позиция' }, col('v', 'Стойност'), { key: 'p', label: 'Дял', unit: '%', d: 1, num: true }],
        rows: (spec.data || []).map(d => ({ n: d.name, v: d.value ?? null, p: total > 0 && Number.isFinite(d.value) ? (d.value / total) * 100 : null, _mock: !!(spec.mock || d.mock) }))
      };
    }
    case 'treemap': {
      const rows = [];
      const walk = (nodes, path) => (nodes || []).forEach(n => { rows.push({ n: [...path, n.name].join(' › '), v: n.value ?? null, _mock: !!(spec.mock || n.mock) }); if (n.children) walk(n.children, [...path, n.name]); });
      walk(spec.data, []);
      return { columns: [{ key: 'n', label: spec.categoryLabel || 'Позиция' }, col('v', 'Стойност')], rows };
    }
    case 'sankey':
      return { columns: [{ key: 'a', label: 'От' }, { key: 'b', label: 'Към' }, col('v', 'Стойност')], rows: (spec.links || []).map(l => ({ a: l.source, b: l.target, v: l.value ?? null, _mock: !!(spec.mock || l.mock) })) };
    default:
      return null;
  }
}

export function chart(spec) {
  const id = spec?.id;
  if (!id) throw new Error('chart(): id is required');
  if (!hasData(spec)) return emptyState({ title: spec.emptyTitle || 'Няма данни за показване', text: spec.emptyText || 'За тази селекция няма числа.', icon: 'barChart' });
  specs.set(id, spec);
  const ts = tableSpec(spec);
  share.attach(id, { chart: true, table: ts ? () => tableData({ ...ts, rows: ts.rows || [] }) : undefined });
  const mock = isMockSpec(spec);
  const legend = legendOf(spec);
  const cats = spec.categories?.length || spec.data?.length || 8;
  const h = spec.height || (spec.type === 'barh' ? Math.max(180, 36 * cats + 40) : HEIGHT[spec.type] || 280);
  const label = `${KIND[spec.type] || 'Графика'}: ${spec.title || spec.label || 'без заглавие'}.${spec.desc ? ' ' + spec.desc : ''}${ts ? ' Данните са в таблицата под графиката.' : ''}`;
  return html`<figure class="fig fig-${spec.type}${spec.cls ? ' ' + spec.cls : ''}" id="${id}-fig" data-ui="chart" data-chart-id="${id}" data-type="${spec.type}" data-attach="${id}"${mock ? raw(' data-mock-fig="true"') : ''}>
    ${spec.title || spec.sub || mock ? html`<figcaption class="fig-cap">${spec.title ? html`<span class="fig-title">${spec.title}</span>` : ''}${spec.sub ? html`<span class="fig-sub">${spec.sub}</span>` : ''}${mock ? html`<span class="fig-mock">${mockBadge()}</span>` : ''}</figcaption>` : ''}
    ${legend.length > 1 ? html`<ul class="fig-legend" aria-label="Легенда. Натисни име, за да го скриеш или покажеш">${legend.map(l => html`<li><button type="button" class="lg" aria-pressed="true" data-name="${l.name}"><span class="sw"${l.mock ? raw(' data-mock="true"') : ''} style="background-color:${l.color}"></span><span class="lg-name">${l.name}</span></button></li>`)}</ul>` : ''}
    <div class="chart" id="${id}" role="img" aria-label="${label}" style="height:${h}px" data-ready="0"></div>
    ${ts ? html`<details class="disc fig-table" id="${id}-tbl"><summary><span class="disc-title">${icon('table', { size: 16 })} Таблица с данните</span></summary><div class="disc-body">${dataTable({ id: id + '-t', caption: spec.title ? `Данни за графиката: ${spec.title}` : 'Данни за графиката', columns: ts.columns, rows: ts.rows || [], dense: true, status: mock ? 'mock' : undefined })}</div></details>` : ''}
  </figure>`;
}

export async function mount(fig, ctx) {
  const id = fig.dataset.chartId, spec = specs.get(id);
  const box = fig.querySelector('.chart');
  if (!spec || !box) return;
  let inst = null, dead = false, narrow = null, busy = false;
  const off = new Set();                                     // names hidden through the legend
  const fail = e => {
    console.error(`[chart ${id}]`, e);
    box.dataset.ready = 'err';
    box.removeAttribute('role');
    box.innerHTML = '<p class="fig-fail">Графиката не се зареди. Данните са в таблицата под нея.</p>';
    const d = fig.querySelector('details.fig-table'); if (d) d.open = true;
  };
  const paint = () => {
    if (!inst) return;
    const w = box.clientWidth;
    narrow = w < 480;
    inst.setOption(buildOption(spec, { width: w }), true);
    off.forEach(name => inst.dispatchAction({ type: 'legendUnSelect', name }));
  };
  const ensure = async () => {
    if (inst || dead || busy || box.clientWidth < 10) return;   // hidden (inactive tab, display:none): wait for the resize observer
    busy = true;
    try {
      const ec = await loadECharts();
      if (dead || inst || box.clientWidth < 10) return;
      inst = ec.init(box, null, { renderer: 'svg' });
      paint();
      box.dataset.ready = '1';
    } catch (e) { fail(e); } finally { busy = false; }
  };
  const ro = new ResizeObserver(() => {
    if (!inst) { ensure(); return; }
    if (box.clientWidth < 10) return;
    inst.resize();
    if ((box.clientWidth < 480) !== narrow) paint();
  });
  ro.observe(box);
  const repaint = () => paint();
  const mo = new MutationObserver(repaint);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', repaint);

  const onClick = e => {
    const b = e.target.closest('.lg');
    if (!b || !fig.contains(b)) return;
    const name = b.dataset.name, hide = b.getAttribute('aria-pressed') === 'true';
    b.setAttribute('aria-pressed', hide ? 'false' : 'true');
    hide ? off.add(name) : off.delete(name);
    inst?.dispatchAction({ type: 'legendToggleSelect', name });
    ctx?.announce?.(`${name}: ${hide ? 'скрито' : 'показано'}`);
  };
  fig.addEventListener('click', onClick);
  ensure();
  return () => {
    dead = true;
    ro.disconnect(); mo.disconnect(); mq.removeEventListener?.('change', repaint);
    fig.removeEventListener('click', onClick);
    try { inst?.dispose(); } catch { /* already gone */ }
    inst = null;
  };
}
