// ECharts wrapper: lazy loader, token-driven theme, option builders, PNG helper.
// Nothing here is imported on screens without charts: ui/chart.js loads this file (and then vendor/echarts.min.js) on demand.
// A chart spec is plain data (see DEV_GUIDE.md §Charts):
//   { id, type:'bar'|'barh'|'line'|'donut'|'treemap'|'sankey'|'option', title, sub, unit, categories, series:[{name,data,color,mock,dashed,dashFrom,stack}], labelWidth, labelOverflow,
//     data (donut/treemap), nodes+links (sankey), stack:true, area:true, mock:true, fmt:v=>string, d:1, height:280, option:{…} (deep-merged last) }
import { ROOT } from './loc.js';
import { num } from './format.js';
import { esc } from './html.js';

/* ---------------------------------------------------------------- loader */
let loading = null;
// label wrapping ('break'), containLabel and the other text layout of ECharts measure with textPx (in the page language), before the first chart
const withMeasure = ec => { ec.setPlatformAPI?.({ measureText: (text, font) => ({ width: textPx(text, font || '12px sans-serif') }) }); return ec; };
export function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (!loading) {
    loading = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = new URL('vendor/echarts.min.js', ROOT).href;
      s.onload = () => (window.echarts ? ok(withMeasure(window.echarts)) : no(new Error('echarts missing after load')));
      s.onerror = () => { loading = null; no(new Error('echarts failed to load')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/* ---------------------------------------------------------------- tokens */
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** current design tokens as real colour strings (ECharts cannot read var()) */
export function tokens() {
  return {
    ink: cssv('--ink'), muted: cssv('--muted'), faint: cssv('--faint'), line: cssv('--line'), lineStrong: cssv('--line-strong'),
    surface: cssv('--surface'), card: cssv('--card'), sunk: cssv('--sunk'), bg: cssv('--bg'), data: cssv('--data'), onData: cssv('--on-data'),
    stMock: cssv('--st-mock'), exp: cssv('--exp'), rev: cssv('--rev'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map(i => cssv(`--series-${i}`)), other: cssv('--series-other'), other2: cssv('--series-other-2'),
    font: cssv('--font-body'), head: cssv('--font-head'), mono: cssv('--font-mono') || 'monospace', accent: cssv('--accent'), paper: cssv('--paper') || cssv('--surface')
  };
}
/** '#RRGGBB' + alpha -> 'rgba(r,g,b,a)' (zrender does not parse the space-separated rgb() syntax) */
export function rgba(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
/** readable text colour on a given fill: black or white, whichever has the higher WCAG contrast (they cross at relative luminance 0.179, where both give 4.58:1,
 *  so every fill gets at least 4.5:1; a tinted dark ink would not reach it on mid-tone fills) */
export function textOn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.179 ? '#000000' : '#ffffff';
}
/** colour of a series: slot number 1..8, 'other', a token name '--exp', or a hex string; default by order (the 9th folds into "other") */
export function colorOf(spec, s, i, tk = tokens()) {
  const c = s?.color ?? spec?.colors?.[i];
  if (typeof c === 'number') return tk.series[c - 1] || tk.other;
  if (c === 'other') return tk.other;
  if (typeof c === 'string' && c.startsWith('--')) return cssv(c) || tk.other;
  if (typeof c === 'string') return c;
  return i < 8 ? tk.series[i] : tk.other;
}

/** the mock hatch as an ECharts decal. v4: paper stripes on a dark fill, crimson stripes on a light one, so the hatch never vanishes into its own
 *  series colour (the crimson series included) and always reads as different from a solid real-data fill */
const decal = (tk, fill) => ({ symbol: 'rect', symbolSize: 1, rotation: Math.PI / 4, dashArrayX: [1, 0], dashArrayY: [2, 4], color: textOn(fill) === '#ffffff' ? rgba(tk.paper || '#FDFAF4', 0.78) : rgba(tk.stMock, 0.75), backgroundColor: null });

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function merge(a, b) {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const o = { ...a };
  for (const k of Object.keys(b)) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k];
  return o;
}
const defaultFmt = spec => spec.fmt || (v => num(v, spec.d ?? (Math.abs(v) >= 100 ? 0 : 1)));

/* ---------------------------------------------------------------- builders */
function base(spec, tk) {
  return {
    animation: !reduced(), animationDuration: 350, animationDurationUpdate: 250,
    textStyle: { fontFamily: tk.font, color: tk.ink },
    aria: { enabled: true, label: { enabled: false }, decal: { show: false } },
    legend: { show: false },
    tooltip: {
      confine: true, backgroundColor: tk.surface, borderColor: tk.ink, borderWidth: 1, padding: [10, 12],
      textStyle: { color: tk.ink, fontSize: 13, fontFamily: tk.font },
      extraCssText: 'box-shadow:0 18px 40px -24px rgba(0,0,0,.45);border-radius:0;max-width:min(320px,86vw);white-space:normal'
    }
  };
}
const mark = (c, hatch) => `<span style="display:inline-block;width:10px;height:10px;border-radius:var(--r-1);margin-right:6px;background:${c};${hatch ? 'outline:1px solid ' + c : ''}"></span>`;

/* Text measured with the real font (canvas). ECharts' own `overflow:'truncate'` estimates every non-ASCII letter as one full-width CJK glyph
   (zrender truncateText/estimateLength), so Cyrillic labels are cut at about HALF the room they have; labels with a known width go through fitText().
   The context takes the page language: a canvas outside the document measures with none, but under lang="bg" system-ui draws Bulgarian letter
   forms (macOS: about 9% wider), so names wrapped or cut to a measured width ran out of their column. ECharts measures through here too (loadECharts). */
let measure = null;
export const textPx = (text, font) => {
  if (!measure) { measure = document.createElement('canvas').getContext('2d'); measure.lang = document.documentElement.lang || 'inherit'; }
  measure.font = font; return measure.measureText(String(text)).width;
};
/** `text`, cut with an ellipsis so that it is at most maxPx wide in `font` (CSS font shorthand, e.g. '13px system-ui') */
export function fitText(text, maxPx, font) {
  const t = String(text);
  if (textPx(t, font) <= maxPx) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textPx(t.slice(0, mid).trimEnd() + '…', font) <= maxPx) lo = mid; else hi = mid - 1;
  }
  return t.slice(0, lo).trimEnd() + '…';
}

function cartesian(spec, tk, env) {
  const kind = spec.type;                         // bar | barh | line
  const horiz = kind === 'barh';
  const fmt = defaultFmt(spec);
  const cats = (spec.categories || []).map(String);
  const stacked = !!spec.stack;
  const narrow = env.width < 480;
  // A line with `dashFrom: k` (the points from index k on are a forecast) becomes TWO ECharts series of one name and colour: solid up to
  // point k-1, dashed from k-1 on (ECharts ignores a per-point lineStyle). origin[] maps an ECharts series index back to spec.series,
  // split holds the indices that belong to such a pair (the tooltip lists the pair once). Ignored for stacked lines (the pair would add up).
  const origin = [], split = new Set();
  const hasSplit = kind === 'line' && !stacked && spec.series.some(s => !s.dashed && !s.mock && s.dashFrom > 0 && s.dashFrom < (s.data || []).length);
  const series = spec.series.flatMap((s, i) => {
    const color = colorOf(spec, s, i, tk);
    const mockAll = !!(s.mock || spec.mock);
    const fc = !mockAll && !s.dashed && s.dashFrom != null ? Math.floor(Number(s.dashFrom)) : NaN;   // first forecast point; bars draw it paler with a dashed outline
    const items = s.data.map((v, j) => {
      const it = isObj(v) ? v : { value: v };
      const mock = mockAll || it.mock;
      const o = { value: it.value };
      if (kind === 'line') {
        if (mock) o.itemStyle = { color: tk.surface, borderColor: color, borderWidth: 2 };
      } else if (mock) o.itemStyle = { color, decal: decal(tk, color), borderColor: color, borderWidth: 1 };
      else if (fc > 0 && j >= fc) o.itemStyle = stacked ? { color, opacity: 0.5, borderColor: tk.card, borderWidth: 1 } : { color, opacity: 0.5, borderColor: color, borderWidth: 1, borderType: 'dashed' };
      if (it.label) o.name = it.label;
      return o;
    });
    const common = { name: s.name, data: items, emphasis: { focus: hasSplit ? 'none' : 'series' }, universalTransition: false };
    if (kind === 'line') {
      const line = (data, dashed) => ({
        ...common, data, type: 'line', symbol: 'circle', symbolSize: narrow ? 6 : 8, smooth: false, connectNulls: false, showSymbol: true,
        color, lineStyle: { width: spec.endLabels && !dashed ? 3 : 2, type: dashed ? 'dashed' : 'solid' },
        endLabel: spec.endLabels ? { show: true, formatter: '{a}', color: color === tk.other ? tk.other2 : color, fontSize: 12, fontFamily: tk.mono, distance: 6 } : undefined,
        itemStyle: { color, borderColor: tk.card, borderWidth: 2 },
        areaStyle: spec.area ? { color, opacity: 0.12 } : undefined,
        stack: stacked ? 'total' : undefined
      });
      const k = !stacked && !s.dashed && !mockAll && s.dashFrom != null ? Math.floor(Number(s.dashFrom)) : NaN;
      if (k > 0 && k < items.length) {
        const gap = { value: null };
        const solid = items.map((it, j) => (j < k ? it : gap));
        const dashed = items.map((it, j) => (j < k - 1 ? gap : j === k - 1 ? { ...it, symbol: 'none' } : it));   // starts at the last solid point, without a second marker there
        split.add(origin.length); split.add(origin.length + 1);
        origin.push(i, i);
        return [line(solid, false), line(dashed, true)];
      }
      origin.push(i);
      return [line(items, !!(s.dashed || mockAll || k <= 0))];
    }
    origin.push(i);
    return [{
      ...common, type: 'bar', color, barMaxWidth: horiz ? 22 : 36, barGap: '12%',
      stack: stacked ? 'total' : undefined,
      itemStyle: { color, borderRadius: 0, borderColor: stacked ? tk.card : undefined, borderWidth: stacked ? 1 : 0, decal: mockAll ? decal(tk, color) : undefined },
      label: spec.labels ? { show: true, position: stacked ? 'inside' : horiz ? 'right' : 'top', color: stacked ? textOn(color) : tk.ink, fontSize: 12, formatter: p => fmt(p.value) } : undefined   // inside a segment: the text colour follows the FILL, outside it sits on the surface
    }];
  });
  // width of the category labels of a horizontal bar chart: spec.labelWidth = px | 'auto' (the longest name, at most 320 px) — never more than 45% of the chart;
  // spec.labelOverflow = 'truncate' (default: cut with an ellipsis) | 'break' | 'breakAll' (wrap: give the chart a `height` with room for two lines per bar)
  const labelFont = `13px ${tk.font}`;
  const wrap = spec.labelOverflow === 'break' || spec.labelOverflow === 'breakAll';
  const longest = horiz ? Math.ceil(Math.max(0, ...cats.map(c => textPx(c, labelFont)))) + 4 : 0;
  const labelWidth = Math.min(
    spec.labelWidth === 'auto' ? Math.min(320, Math.max(60, longest)) : Number(spec.labelWidth) > 0 ? Number(spec.labelWidth) : narrow ? 108 : 168,
    Math.round(env.width * 0.45)
  );
  // Vertical charts: the category labels are thinned (every n-th) until the widest one fits its slot, so 11-42 categories stay readable at 400 px.
  // spec.interval overrides it (0 = every label, n = skip n between two labels, 'auto' = ECharts' own rule); hideOverlap stays on as a safety net.
  let interval = spec.interval;
  if (!horiz && interval == null) {
    const widest = Math.ceil(Math.max(0, ...cats.flatMap(c => c.split('\n')).map(c => textPx(c, `12px ${tk.mono}`))));   // a two-line label (« 2025\nПрограма ») is as wide as its longer line
    const slot = Math.max(1, env.width - 24 - 48) / Math.max(1, cats.length);   // grid margins + a value-axis label column
    interval = Math.max(0, Math.ceil((widest + 8) / slot) - 1);
  }
  const catAxis = {
    type: 'category', data: cats, inverse: horiz, axisTick: { show: false }, axisLine: { lineStyle: { color: tk.ink } },
    axisLabel: horiz
      ? (wrap ? { color: tk.ink, fontSize: 13, fontFamily: tk.font, align: 'right', width: labelWidth, overflow: spec.labelOverflow } : { color: tk.ink, fontSize: 13, fontFamily: tk.font, formatter: v => fitText(v, labelWidth, labelFont) })
      : { color: tk.faint, fontSize: 12, fontFamily: tk.mono, hideOverlap: true, interval, rotate: 0 }
  };   // fontFamily is set on the label itself: containLabel sizes the label column from the label MODEL, which does not inherit the global textStyle (it fell back to sans-serif, ~4% narrower than Onest, so long names were clipped)
  // a horizontal value axis in a narrow chart: as many steps as its width carries (widest label + 16 px per tick), else « 1 000 2 000 3 000 » run together
  const peak = Math.max(0, ...spec.series.flatMap(s => s.data.map(v => Math.abs(Number(isObj(v) ? v.value : v)) || 0)));
  const valSteps = Math.max(2, Math.min(5, Math.floor((env.width - labelWidth - 52) / (textPx(fmt(peak), `12px ${tk.mono}`) + 16)) - 1));
  const valAxis = {
    type: 'value', min: spec.min, max: spec.max, splitNumber: horiz && narrow ? valSteps : undefined,
    axisLabel: { color: tk.faint, fontSize: 12, fontFamily: tk.mono, formatter: v => fmt(v) },
    splitLine: { lineStyle: { color: tk.line } }, axisLine: { show: false }, axisTick: { show: false }
  };
  return {
    grid: { left: 8, right: horiz ? 28 : spec.endLabels ? 52 : 16, top: spec.labels && !horiz ? 28 : 12, bottom: 8, containLabel: true },
    xAxis: horiz ? valAxis : catAxis,
    yAxis: horiz ? catAxis : valAxis,
    tooltip: {
      trigger: 'axis', axisPointer: { type: kind === 'line' ? 'line' : 'shadow', shadowStyle: { color: rgba(tk.data, 0.08) } },
      formatter: ps => {
        const seen = new Set();
        const list = [].concat(ps).filter(p => {                     // a dashFrom pair: one row per name, never the empty half
          if (!split.has(p.seriesIndex)) return true;
          if (p.value == null || p.value === '-' || seen.has(p.seriesName)) return false;
          seen.add(p.seriesName);
          return true;
        });
        const head = esc(list[0]?.axisValueLabel ?? list[0]?.name ?? '');
        const rows = list.map(p => {
          const m = !!(p.data?.itemStyle?.decal || spec.mock || spec.series[origin[p.seriesIndex]]?.mock || (kind === 'line' && p.data?.itemStyle?.color === tk.surface));
          return `<div style="display:flex;gap:12px;justify-content:space-between;align-items:center"><span>${mark(p.color, m)}${esc(p.seriesName)}</span><b style="font-variant-numeric:tabular-nums">${esc(fmt(p.value))}${spec.unit ? ' ' + esc(spec.unit) : ''}${m ? ' <i style="font-weight:400;color:' + tk.muted + '">(примерно)</i>' : ''}</b></div>`;
        });
        return `<div style="font-weight:600;margin-bottom:4px">${head}</div>${rows.join('')}`;
      }
    },
    series
  };
}

/** where a pie folds its tail into «Други»: after 8 slices, but never a tail of one */
export const tailAt = n => (n > 9 ? 8 : n);
function donut(spec, tk, env) {
  const fmt = defaultFmt(spec);
  const src = spec.data || [];
  const cut = tailAt(src.length), keep = src.slice(0, cut), rest = src.slice(cut);
  const items = keep.map((d, i) => ({ ...d, c: colorOf(spec, d, i, tk) }));
  if (rest.length) items.push({ name: 'Други', value: rest.reduce((a, d) => a + (d.value || 0), 0), c: tk.other, mock: rest.some(d => d.mock) });
  const total = items.reduce((a, d) => a + (d.value || 0), 0);
  const data = items.map(d => {
    const mock = !!(spec.mock || d.mock);
    return { name: d.name, value: d.value, itemStyle: { color: d.c, borderColor: tk.card, borderWidth: 2, decal: mock ? decal(tk, d.c) : undefined } };
  });
  return {
    title: spec.center === false ? undefined : {
      text: spec.center?.text ?? fmt(total), subtext: spec.center?.sub ?? spec.unit ?? '', left: 'center', top: '40%',
      textStyle: { color: tk.ink, fontFamily: tk.head, fontWeight: 400, fontSize: env.width < 360 ? 24 : 30 }, subtextStyle: { color: tk.faint, fontSize: 12, fontFamily: tk.mono }, itemGap: 4
    },
    tooltip: {
      trigger: 'item', formatter: p => `<div>${mark(p.color, !!p.data.itemStyle?.decal)}${esc(p.name)}</div><b style="font-variant-numeric:tabular-nums">${esc(fmt(p.value))}${spec.unit ? ' ' + esc(spec.unit) : ''}</b> · ${esc(num(p.percent, 1))}%`
    },
    series: [{ type: 'pie', radius: ['58%', '84%'], center: ['50%', '50%'], avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false }, emphasis: { scale: true, scaleSize: 4 }, data }]
  };
}

function treemap(spec, tk) {
  const fmt = defaultFmt(spec);
  const paint = (nodes, depth) => (nodes || []).map((n, i) => {
    const c = depth === 0 ? colorOf(spec, n, i, tk) : null;
    const mock = !!(spec.mock || n.mock);
    return { name: n.name, value: n.value, itemStyle: c ? { color: c, decal: mock ? decal(tk, c) : undefined } : undefined, label: c ? { color: textOn(c) } : undefined, upperLabel: c && n.children?.length ? { show: true, color: tk.ink } : undefined, children: n.children ? paint(n.children, depth + 1) : undefined };
  });
  const data = paint(spec.data, 0);
  const inherit = (nodes, color, tc) => nodes.forEach(n => { if (!n.itemStyle) n.itemStyle = { color }; if (!n.label) n.label = { color: tc }; if (n.children) inherit(n.children, color, tc); });
  data.forEach(n => { if (n.children) inherit(n.children, n.itemStyle.color, n.label.color); });
  return {
    tooltip: { trigger: 'item', formatter: p => `<div>${esc(p.name)}</div><b style="font-variant-numeric:tabular-nums">${esc(fmt(p.value))}${spec.unit ? ' ' + esc(spec.unit) : ''}</b>` },
    series: [{
      type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, left: 0, right: 0, top: 0, bottom: 0, squareRatio: 1.1,
      label: { show: true, overflow: 'truncate', fontFamily: tk.font, fontSize: 13, fontWeight: 600, formatter: p => `${p.name}\n${fmt(p.value)}`, position: 'insideTopLeft', padding: 6 },
      upperLabel: { show: false, height: 24, overflow: 'truncate', fontFamily: tk.font, fontSize: 13, fontWeight: 600, padding: [0, 6], formatter: p => `${p.name}  ${fmt(p.value)}` },
      itemStyle: { borderColor: tk.card, borderWidth: 2, gapWidth: 2, borderRadius: 0 },
      emphasis: { itemStyle: { borderColor: tk.ink, borderWidth: 2 } },
      data
    }]
  };
}

function sankey(spec, tk, env) {
  const fmt = defaultFmt(spec);
  const nodes = (spec.nodes || []).map((n, i) => {
    const o = typeof n === 'string' ? { name: n } : n;
    const mock = !!(spec.mock || o.mock);
    const c = colorOf(spec, o, i, tk);
    return { name: o.name, itemStyle: { color: c, borderColor: tk.card, decal: mock ? decal(tk, c) : undefined } };
  });
  // room on the right for the labels of the last column: the longest end-node name, at most 38% of the width; a longer label is cut with an ellipsis
  const ends = (spec.nodes || []).map(n => (typeof n === 'string' ? n : n.name)).filter(n => !(spec.links || []).some(l => l.source === n));
  const labelFont = `12px ${tk.font}`;
  const room = Math.min(Math.round(env.width * 0.38), Math.max(90, Math.ceil(Math.max(0, ...ends.map(n => textPx(n, labelFont)))) + 26));
  return {
    tooltip: { trigger: 'item', formatter: p => (p.dataType === 'edge'
      ? `<div>${esc(p.data.source)} → ${esc(p.data.target)}</div><b style="font-variant-numeric:tabular-nums">${esc(fmt(p.value))}${spec.unit ? ' ' + esc(spec.unit) : ''}</b>`
      : `<div>${esc(p.name)}</div><b style="font-variant-numeric:tabular-nums">${esc(fmt(p.value))}${spec.unit ? ' ' + esc(spec.unit) : ''}</b>`) },
    series: [{
      type: 'sankey', orient: 'horizontal', left: 8, right: room, top: 8, bottom: 8, nodeWidth: 14, nodeGap: 10, draggable: false,
      emphasis: { focus: 'adjacency' }, lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.4 },
      label: { color: tk.ink, fontFamily: tk.font, fontSize: 12, formatter: p => fitText(p.name, room - 22, labelFont) }, data: nodes, links: spec.links || []
    }]
  };
}

/** build the full ECharts option for a spec; env = {width} of the container */
export function buildOption(spec, env = { width: 600 }, tk = tokens()) {
  let o;
  switch (spec.type) {
    case 'bar': case 'barh': case 'line': o = cartesian(spec, tk, env); break;
    case 'donut': o = donut(spec, tk, env); break;
    case 'treemap': o = treemap(spec, tk); break;
    case 'sankey': o = sankey(spec, tk, env); break;
    case 'option': o = {}; break;
    default: throw new Error(`unknown chart type "${spec.type}"`);
  }
  return merge(merge(base(spec, tk), o), spec.option || {});
}

/* ---------------------------------------------------------------- PNG */
/** The display uses the SVG renderer; a PNG is rendered from a temporary canvas instance with the same option. */
export function chartImage(inst, el, { pixelRatio = 2, background } = {}) {
  const ec = window.echarts;
  if (!ec || !inst) throw new Error('няма графика');
  const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-20000px;top:0;width:${w}px;height:${h}px`;
  document.body.appendChild(box);
  try {
    const tmp = ec.init(box, null, { renderer: 'canvas', width: w, height: h });
    const opt = inst.getOption();
    opt.animation = false;
    [].concat(opt.series || []).forEach(s => { s.animation = false; });
    tmp.setOption(opt);
    const url = tmp.getDataURL({ type: 'png', pixelRatio, backgroundColor: background || cssv('--surface') });
    tmp.dispose();
    return { url, w, h };
  } finally { box.remove(); }
}
