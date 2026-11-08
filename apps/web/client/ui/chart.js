// Chart figure: caption, HTML legend (toggles series), the chart itself (ECharts, SVG), and a table twin that is always in the DOM.
//   chart({id:'prihodi-po-godini', type:'bar', title:'Приходи по години', sub:'млрд. €', unit:'млрд. €', categories:['2024','2025'], series:[{name:'Приходи', data:[1,2]}]})
// types: bar | barh | line | donut | treemap | sankey | option (see charts.js for the full spec).  id is required and must be unique on the screen.
// Rules: the chart is hidden from assistive tech (role="img" + a name) and the table twin carries the data; a mock series is hatched
// (decal) and the figure says „Примерни данни“; ECharts is loaded only when a chart becomes visible; colours follow the design tokens
// (v4 is light only, so there is no theme re-draw).
//
// View switch (opt-in, one place for every screen): `views: ['bars','pie','table']` for the additive parts of one whole (a barh/bar with ONE series, or a donut),
// `views: ['line','bars','table']` for a time series. A segmented control under the caption swaps the picture in place; the visitor's choice is kept for
// the screen while it is open (a unit switch re-renders the figure and the choice stays).
//   - the first view that matches the spec's own type is the default (`view: 'pie'` overrides it);
//   - 'pie' is offered ONLY when the parts are additive and honest: at least two positive parts and no negative one; a tail beyond 8 slices is folded into «Други»;
//     `partColors: [..]` (parallel to the categories) keeps the colours of the parts the same as on the rest of the screen; `pieHeight` sets its height;
//   - 'bars' of a donut = horizontal bars of its parts (`axis: fn` formats the value axis); 'bars' of a line = columns (`stackBars: true` stacks the series: only for
//     series that add up, such as revenue by source); points from `dashFrom` on are a forecast and are drawn paler;
//   - 'table' hides the picture and opens the table twin; a single-series part-of-a-whole table gets a «Дял» column.
import { scoped } from '../env.js';
import { html, raw, esc } from '../html.js';
import { DASH, NBSP, num } from '../format.js';
import { emptyState, mockBadge } from './states.js';
import { icon } from '../icons.js';
import { dataTable, tableData } from './table.js';
import { seg } from './seg.js';
import * as share from '../share.js';
import { loadECharts, buildOption, tailAt } from '../charts.js';

const ownSpecs = new Map();
const specs = { get: id => scoped('chart', ownSpecs).get(id), set: (id, v) => scoped('chart', ownSpecs).set(id, v), clear: () => ownSpecs.clear() };   // one map per server request (js/env.js)
share.onReset(() => specs.clear());
export const chartSpec = id => specs.get(id);

const KIND = { bar: 'Колонна графика', barh: 'Хоризонтална стълбовидна графика', line: 'Линейна графика', donut: 'Кръгова графика', treemap: 'Карта с площи', sankey: 'Диаграма на потоците', option: 'Графика' };
const HEIGHT = { bar: 280, line: 280, donut: 260, treemap: 340, sankey: 360, option: 280 };
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const valOf = d => (isObj(d) ? d.value : d);
const okn = v => typeof v === 'number' && Number.isFinite(v);

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

/** the legend of a donut with numbers: value and share of the whole (a pie has no axis to read them from) */
function donutLegend(spec) {
  const src = spec.data || [];
  const cut = tailAt(src.length);
  const parts = src.slice(0, cut).map((d, i) => ({ name: d.name, value: d.value, color: cssColor(spec, d.color ?? spec.colors?.[i], i), mock: !!(spec.mock || d.mock) }));
  if (src.length > cut) parts.push({ name: 'Други', value: src.slice(cut).reduce((a, d) => a + (okn(d.value) ? d.value : 0), 0), color: 'var(--series-other)', mock: src.slice(cut).some(d => d.mock) });
  if (spec.legendValues) {
    const total = parts.reduce((a, p) => a + (okn(p.value) ? p.value : 0), 0);
    const f = spec.fmt || (v => num(v, spec.d ?? (Math.abs(v) >= 100 ? 0 : 1)));
    parts.forEach(p => { p.val = okn(p.value) ? f(p.value) : DASH; p.pct = okn(p.value) && total > 0 ? `${num((p.value / total) * 100, 1)}${NBSP}%` : ''; });
  }
  return parts;
}
function legendOf(spec) {
  if (spec.legend === false) return [];
  if (spec.type === 'bar' || spec.type === 'barh' || spec.type === 'line') return spec.series.map((s, i) => ({ name: s.name, color: cssColor(spec, s.color ?? spec.colors?.[i], i), mock: !!(s.mock || spec.mock), dashed: !!s.dashed && spec.type === 'line' }));
  if (spec.type === 'donut') return donutLegend(spec);
  return [];
}
const legendItems = items => html`${items.map(l => html`<li><button type="button" class="lg" aria-pressed="true" data-name="${l.name}"><span class="sw"${l.mock ? raw(' data-mock="true"') : ''}${l.dashed ? raw(' data-dashed="true"') : ''} style="background-color:${l.color};color:${l.color}"></span><span class="lg-name">${l.name}</span>${l.val != null ? html`<span class="lg-val"><span class="lg-num">${l.val}</span>${l.pct ? html`<span class="lg-pct">${l.pct}</span>` : ''}</span>` : ''}</button></li>`)}`;

/** table twin as a dataTable spec (also the source of the CSV export) */
function tableSpec(spec) {
  if (spec.table) return spec.table;
  const f = spec.fmt ? (v => (v == null ? DASH : spec.fmt(v))) : null;
  const col = (key, label, extra = {}) => ({ key, label, unit: spec.unit, d: spec.d, fmt: f || undefined, num: true, ...extra });
  switch (spec.type) {
    case 'bar': case 'barh': case 'line': {
      const columns = [{ key: 'c', label: spec.categoryLabel || 'Категория' }, ...spec.series.map((s, i) => col('s' + i, s.name))];
      const share1 = spec.views?.includes('pie') && spec.series.length === 1 && pieOk(partsOf(spec));        // one whole in parts: say each part's share
      const total = share1 ? spec.series[0].data.reduce((a, d) => a + (okn(valOf(d)) && valOf(d) > 0 ? valOf(d) : 0), 0) : 0;
      if (share1) columns.push({ key: 'p', label: 'Дял', unit: '%', d: 1, num: true });
      const rows = (spec.categories || []).map((cat, j) => {
        const r = { c: cat };
        spec.series.forEach((s, i) => { const d = s.data[j]; r['s' + i] = valOf(d) ?? null; if (s.mock || spec.mock || (isObj(d) && d.mock)) r._mock = true; });
        if (share1) r.p = total > 0 && okn(r.s0) ? (r.s0 / total) * 100 : null;
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

/* ---------------------------------------------------------------- view switch */
const VIEW = {
  bars: { label: 'Стълбове', icon: 'barChart', say: 'стълбове' },
  pie: { label: 'Кръгова', icon: 'pieChart', say: 'кръгова графика' },
  line: { label: 'Линия', icon: 'trendingUp', say: 'линия' },
  table: { label: 'Таблица', icon: 'table', say: 'таблица' }
};
const NATIVE = { donut: 'pie', bar: 'bars', barh: 'bars', line: 'line' };      // the view a spec of this type draws by itself
const chosen = new Map();                                                     // `${screen}:${chart id}` -> the visitor's choice; outlives the re-render of a unit switch
const choiceKey = id => `${share.currentRoute()?.key ?? ''}:${id}`;

/** the additive parts of one whole: a donut's data, or the categories of a bar chart with ONE series; null for anything else */
function partsOf(spec) {
  if (spec.type === 'donut') return (spec.data || []).map(d => ({ ...d }));
  if ((spec.type === 'bar' || spec.type === 'barh') && spec.series?.length === 1) {
    const s = spec.series[0];
    return (spec.categories || []).map((c, i) => {
      const d = s.data[i];
      return { name: String(c), value: valOf(d) ?? null, color: spec.partColors?.[i], mock: !!(spec.mock || s.mock || (isObj(d) && d.mock)) || undefined };
    });
  }
  return null;
}
/** a pie is honest only for at least two positive parts and no negative one */
const pieOk = parts => !!parts && parts.filter(p => okn(p.value) && p.value > 0).length >= 2 && !parts.some(p => okn(p.value) && p.value < 0);
const isSeries = spec => spec.type === 'bar' || spec.type === 'barh' || spec.type === 'line';

/** the views this spec really offers (the author's list minus whatever the data cannot honestly make); [] = no switch */
function viewsOf(spec) {
  if (!Array.isArray(spec.views) || !(spec.type in NATIVE)) return [];
  const parts = partsOf(spec), hasTable = !!tableSpec(spec);
  const out = [];
  for (const v of spec.views) {
    if (!VIEW[v] || out.includes(v)) continue;
    if (v === 'pie' && !pieOk(parts)) continue;
    if (v === 'table' && !hasTable) continue;
    if (v === 'bars' && spec.type === 'donut' && !parts?.length) continue;
    if ((v === 'bars' || v === 'line') && spec.type !== 'donut' && !isSeries(spec)) continue;
    if (v === 'line' && spec.type === 'donut') continue;
    out.push(v);
  }
  return out.length > 1 ? out : [];
}
const defaultView = (spec, list) => (list.includes(spec.view) ? spec.view : list.includes(NATIVE[spec.type]) ? NATIVE[spec.type] : list[0]);

/** the spec that draws `view` (the spec itself for its own type; 'table' draws nothing, the native picture stays underneath) */
function variant(spec, view) {
  if (!view || view === 'table' || view === NATIVE[spec.type]) return spec;
  if (view === 'pie') {
    const parts = (partsOf(spec) || []).filter(p => okn(p.value) && p.value > 0);
    return { ...spec, type: 'donut', data: parts, categories: undefined, series: undefined, stack: undefined, labels: false, legend: true, legendValues: spec.legendValues !== false, option: undefined, height: spec.pieHeight || 300 };
  }
  if (view === 'bars' && spec.type === 'donut') {
    const parts = partsOf(spec) || [];
    return {
      ...spec, type: 'barh', data: undefined, categories: parts.map(p => p.name), categoryLabel: spec.categoryLabel,
      series: [{ name: spec.valueName || 'Стойност', data: parts.map(p => (p.mock ? { value: p.value, mock: true } : p.value)), color: spec.barColor ?? '--data' }],
      labels: true, legend: false, labelWidth: 'auto', labelOverflow: 'break', option: spec.axis ? { xAxis: { axisLabel: { formatter: spec.axis } } } : undefined,
      height: Math.max(240, parts.length * 44 + 40)
    };
  }
  if (view === 'bars') return { ...spec, type: 'bar', stack: spec.stackBars ? true : spec.stack, labels: false };
  if (view === 'line') return { ...spec, type: 'line', stack: undefined, labels: false };
  return spec;
}
const heightOf = (spec, view) => {
  const v = variant(spec, view), n = v.categories?.length || v.data?.length || 8;
  return v.height || (v.type === 'barh' ? Math.max(180, 36 * n + 40) : HEIGHT[v.type] || 280);
};
const labelOf = (spec, view, hasTbl) => {
  const v = variant(spec, view);
  return `${KIND[v.type] || 'Графика'}: ${spec.title || spec.label || 'без заглавие'}.${v === spec && spec.desc ? ' ' + spec.desc : ''}${hasTbl ? ' Данните са в таблицата под графиката.' : ''}`;
};
/** does a series carry a forecast (points from dashFrom on)? the figure then says how the forecast looks in each view */
const hasForecast = spec => !!spec.series?.some(s => !s.mock && !s.dashed && s.dashFrom > 0 && s.dashFrom < (s.data || []).length);

export function chart(spec) {
  const id = spec?.id;
  if (!id) throw new Error('chart(): id is required');
  if (!hasData(spec)) return emptyState({ title: spec.emptyTitle || 'Няма данни за показване', text: spec.emptyText || 'За тази селекция няма числа.', icon: 'barChart' });
  specs.set(id, spec);
  const ts = tableSpec(spec);
  share.attach(id, { chart: true, table: ts ? () => tableData({ ...ts, rows: ts.rows || [] }) : undefined });
  const mock = isMockSpec(spec);
  const list = viewsOf(spec);
  const key = choiceKey(id);
  const view = list.length ? (list.includes(chosen.get(key)) ? chosen.get(key) : defaultView(spec, list)) : null;
  const legend = legendOf(variant(spec, view));
  const h = heightOf(spec, view);
  const label = labelOf(spec, view, !!ts);
  const gaps = list.includes('pie') ? (partsOf(spec) || []).filter(p => !okn(p.value)).map(p => p.name) : [];
  const control = list.length
    ? html`<div class="fig-views">${seg({ name: `${id}-vw`, label: 'Начин на показване', value: view, norender: true, cls: 'fig-seg', options: list.map(v => ({ value: v, label: VIEW[v].label, icon: VIEW[v].icon })) })}</div>`
    : '';
  const notes = list.length && hasForecast(spec)
    ? html`<span class="fig-sub fig-note" data-for="line">Прекъснатата линия е прогноза.</span><span class="fig-sub fig-note" data-for="bars">Бледите колони са прогноза.</span>` : '';
  return html`<figure class="fig fig-${spec.type}${spec.cls ? ' ' + spec.cls : ''}" id="${id}-fig" data-ui="chart" data-chart-id="${id}" data-type="${spec.type}" data-attach="${id}"${list.length ? html` data-view="${view}" data-views="${list.join(' ')}"` : ''}${mock ? raw(' data-mock-fig="true"') : ''}>
    ${spec.title || spec.sub || mock ? html`<figcaption class="fig-cap">${spec.title ? html`<span class="fig-title">${spec.title}</span>` : ''}${spec.sub ? html`<span class="fig-sub">${spec.sub}</span>` : ''}${notes}${mock ? html`<span class="fig-mock">${mockBadge()}</span>` : ''}</figcaption>` : ''}
    ${control}
    ${list.length || legend.length > 1 ? html`<ul class="fig-legend${legend.some(l => l.val != null) ? ' fig-legend-val' : ''}" aria-label="Легенда. Натисни име, за да го скриеш или покажеш"${list.length && (legend.length < 2 || view === 'table') ? raw(' hidden') : ''}>${legend.length > 1 ? legendItems(legend) : ''}</ul>` : ''}
    <div class="chart" id="${id}" role="img" aria-label="${label}" style="height:${h}px" data-ready="0"></div>
    ${gaps.length ? html`<p class="fig-note fig-gaps" data-for="pie">Няма данни за: ${gaps.join(', ')}. Тези части не са в кръговата графика.</p>` : ''}
    ${ts ? html`<details class="disc fig-table" id="${id}-tbl"${view === 'table' ? raw(' open') : ''}><summary><span class="disc-title">${icon('table', { size: 16 })} Таблица с данните</span></summary><div class="disc-body">${dataTable({ id: id + '-t', caption: spec.title ? `Данни за графиката: ${spec.title}` : 'Данни за графиката', columns: ts.columns, rows: ts.rows || [], dense: true, status: mock ? 'mock' : undefined })}</div></details>` : ''}
  </figure>`;
}

export async function mount(fig, ctx) {
  const id = fig.dataset.chartId, spec = specs.get(id);
  const box = fig.querySelector('.chart');
  if (!spec || !box) return;
  let inst = null, dead = false, narrow = null, busy = false;
  let view = fig.dataset.view || null, shown = null;                // the visible view; `shown` = the view the instance was last painted with
  const off = new Set();                                             // names hidden through the legend
  const fail = e => {
    console.error(`[chart ${id}]`, e);
    box.dataset.ready = 'err';
    box.removeAttribute('role');
    box.innerHTML = '<p class="fig-fail">Графиката не се зареди. Данните са в таблицата под нея.</p>';
    const d = fig.querySelector('details.fig-table'); if (d) d.open = true;
  };
  const paint = () => {
    if (!inst || view === 'table') return;
    const w = box.clientWidth;
    narrow = w < 480;
    inst.setOption(buildOption(variant(spec, view), { width: w }), true);
    shown = view;
    off.forEach(name => inst.dispatchAction({ type: 'legendUnSelect', name }));
  };
  const ensure = async () => {
    if (inst || dead || busy || box.clientWidth < 10) return;   // hidden (inactive tab, display:none, the table view): wait for the resize observer
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
    if ((box.clientWidth < 480) !== narrow || shown !== view) paint();
  });
  ro.observe(box);

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

  // the view switch: the picture, its legend, its height and its name change in place; the table view only shows the twin
  const twin = fig.querySelector('details.fig-table');
  let twinWas = twin ? twin.open : false;
  const setView = v => {
    if (!VIEW[v] || v === view) return;
    if (twin) { if (v === 'table') { twinWas = twin.open; twin.open = true; } else if (view === 'table') twin.open = twinWas; }
    view = v;
    fig.dataset.view = v;
    chosen.set(choiceKey(id), v);
    const ul = fig.querySelector('.fig-legend');
    if (v !== 'table') {
      off.clear();
      const items = legendOf(variant(spec, v));
      if (ul) { ul.innerHTML = String(legendItems(items.length > 1 ? items : [])); ul.hidden = items.length < 2; ul.classList.toggle('fig-legend-val', items.some(l => l.val != null)); }
      box.style.height = `${heightOf(spec, v)}px`;
      box.setAttribute('aria-label', labelOf(spec, v, !!twin));
      if (inst) { inst.resize(); paint(); } else ensure();
    } else if (ul) ul.hidden = true;
    ctx?.announce?.(`Начин на показване: ${VIEW[v].say}`);
  };
  const onChange = e => {
    const r = e.target;
    if (!(r instanceof HTMLInputElement) || r.type !== 'radio' || !r.checked || !r.closest('.fig-views') || !fig.contains(r)) return;
    setView(r.value);
  };
  fig.addEventListener('change', onChange);
  ensure();
  return () => {
    dead = true;
    ro.disconnect();
    fig.removeEventListener('click', onClick);
    fig.removeEventListener('change', onChange);
    try { inst?.dispose(); } catch { /* already gone */ }
    inst = null;
  };
}
