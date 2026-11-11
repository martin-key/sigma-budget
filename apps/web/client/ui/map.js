// Choropleth map (regions shaded by one number): plain SVG drawn from GeoJSON. No tiles, no library, no network. Added by G4 for S20 „Моята община“.
//   mapFigure({id:'obshtini-karta', title:'Трансфер на жител', sub:'€ на жител по общини', geo, items:[{id:'BLG03', label:'Благоевград', sub:'област Благоевград', value:345.2, group:'BLG', href:'#/obshtina/BLG03', mock:false, aria:'…'}],
//              unitLabel:'Трансфер на жител, €', valueLabel:'трансфер на жител', fmt:v=>eur(v), d:0, bins:5 | [120,250,400,700], focusGroup:'BLG', selected:'BLG03', mock:false,
//              categoryLabel:'Община', groupLabel:'Област', hint:'…', help:'…', desc:'…', openLabel:'Виж общината', twin:true, cls:''})
//   filterMap(figureEl, ids|null)       dims every region that is not in ids (null clears the filter); pages with their own search call it from mount
//   binEdges(values, n)                 pure: the class edges the legend uses (quantiles rounded to two significant digits, never an empty class)
// Rules: geo is a GeoJSON FeatureCollection in WGS84 (Polygon / MultiPolygon) whose feature.properties.id equals item.id; a feature without an item is drawn as neutral context;
// a region whose value is null is „няма данни“ (dotted, never the lowest class); focusGroup zooms the view to the items of that group and greys out the rest.
// Colour is never the only encoding: every region has its name, value and place in text (info line, accessible name, optional table twin) and the legend lists the ranges with counts;
// mock figures get a hatched overlay, the „Примерни данни“ badge and data-mock-fig for exports. If the geometry cannot be read the figure is a short note (the page shows its list).
// Keyboard: the map is ONE tab stop (roving tabindex); arrows jump to the nearest region in that direction, Home/End to the first/last (alphabetical), Enter opens, Space selects/opens.
// Pointer: hover shows the card; click opens. Touch: the first tap selects and shows the card (with a link), the second opens. Events (bubble from the figure): map:select {id}.
// Colours and strokes come from design tokens (css/charts.css, the map-* block); the light palette follows the tokens; forced-colors keeps the ramp and uses system colours for the outlines.
import { html, raw, esc } from '../html.js';
import { num, DASH } from '../format.js';
import { mockBadge } from './states.js';
import { icon } from '../icons.js';
import { dataTable, tableData } from './table.js';
import * as share from '../share.js';

const W = 1000; // width of the drawing in viewBox units; the height follows the aspect of the geometry
const MAX_BINS = 5;
const LADDER = { 1: [2], 2: [0, 4], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] }; // class index (colour step) of bin i for n bins
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (n) => {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
};
const byName = (a, b) => String(a).localeCompare(String(b), 'bg');

/* ---------------------------------------------------------------- geometry: WGS84 -> flat drawing (equirectangular, longitude scaled by cos(mean latitude)) */
const projected = new WeakMap();
const polygonsOf = (g) =>
  g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
const goodPt = (p) =>
  Array.isArray(p) &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 180 &&
  Math.abs(p[1]) <= 90;

function build(geo) {
  const feats = (Array.isArray(geo.features) ? geo.features : []).filter((f) => f && f.geometry);
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const f of feats)
    for (const poly of polygonsOf(f.geometry))
      for (const ring of poly)
        for (const p of ring) {
          if (!goodPt(p)) continue;
          if (p[0] < x0) x0 = p[0];
          if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1];
          if (p[1] > y1) y1 = p[1];
        }
  if (!(x1 > x0 && y1 > y0)) return null;
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const sc = W / ((x1 - x0) * k);
  const H = (y1 - y0) * sc;
  const list = [];
  for (const f of feats) {
    const id = String(f.properties?.id ?? f.id ?? '');
    if (!id) continue;
    let d = '',
      best = null;
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polygonsOf(f.geometry)) {
      poly.forEach((ring, ri) => {
        const pts = [];
        let last = '';
        for (const p of ring) {
          if (!goodPt(p)) continue;
          const x = (p[0] - x0) * k * sc,
            y = (y1 - p[1]) * sc,
            s = r1(x) + ' ' + r1(y);
          if (s === last) continue;
          last = s;
          pts.push([x, y, s]);
        }
        if (pts.length > 1 && pts[0][2] === pts[pts.length - 1][2]) pts.pop();
        if (pts.length < 3) return;
        d += 'M' + pts.map((q) => q[2]).join(' ') + 'Z';
        if (ri !== 0) return; // outer rings only: bounding box and centroid
        let a = 0,
          cx = 0,
          cy = 0;
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i],
            [bx, by] = pts[(i + 1) % pts.length];
          const cr = ax * by - bx * ay;
          a += cr;
          cx += (ax + bx) * cr;
          cy += (ay + by) * cr;
          if (ax < bb[0]) bb[0] = ax;
          if (ay < bb[1]) bb[1] = ay;
          if (ax > bb[2]) bb[2] = ax;
          if (ay > bb[3]) bb[3] = ay;
        }
        if (!best || Math.abs(a) > best.a)
          best = {
            a: Math.abs(a),
            cx: Math.abs(a) > 1e-9 ? cx / (3 * a) : (pts[0][0] + pts[1][0]) / 2,
            cy: Math.abs(a) > 1e-9 ? cy / (3 * a) : (pts[0][1] + pts[1][1]) / 2,
          };
      });
    }
    if (!d || !best) continue;
    list.push({ id, name: String(f.properties?.name ?? ''), d, bb, cx: best.cx, cy: best.cy });
  }
  return list.length ? { w: W, h: H, feats: list } : null;
}
/** the projected geometry of a FeatureCollection (cached per object); null when it cannot be read */
export function project(geo) {
  if (!geo || typeof geo !== 'object') return null;
  if (projected.has(geo)) return projected.get(geo);
  let out = null;
  try {
    out = build(geo);
  } catch (e) {
    console.error('[map] geometry could not be read', e);
  }
  projected.set(geo, out);
  return out;
}

/** viewBox [x, y, w, h]: the whole country, or the bounding box of the given features; always the aspect of the whole country, so the figure keeps its size when the focus changes */
function viewBoxFor(p, ids) {
  let x0 = 0,
    y0 = 0,
    x1 = p.w,
    y1 = p.h;
  if (ids?.size) {
    let a = Infinity,
      b = Infinity,
      c = -Infinity,
      e = -Infinity;
    for (const f of p.feats)
      if (ids.has(f.id)) {
        a = Math.min(a, f.bb[0]);
        b = Math.min(b, f.bb[1]);
        c = Math.max(c, f.bb[2]);
        e = Math.max(e, f.bb[3]);
      }
    if (a < c && b < e) {
      const px = (c - a) * 0.08 + 8,
        py = (e - b) * 0.08 + 8;
      x0 = a - px;
      y0 = b - py;
      x1 = c + px;
      y1 = e + py;
    }
  }
  const asp = p.w / p.h;
  let w = x1 - x0,
    h = y1 - y0;
  if (w / h < asp) {
    const nw = h * asp;
    x0 -= (nw - w) / 2;
    w = nw;
  } else {
    const nh = w / asp;
    y0 -= (nh - h) / 2;
    h = nh;
  }
  return [x0, y0, w, h];
}

/* ---------------------------------------------------------------- classes */
/** class edges (ascending) for n classes: quantiles rounded to two significant digits; classes that would be empty are dropped */
export function binEdges(values, n = MAX_BINS) {
  const v = (values || []).filter(ok).sort((a, b) => a - b);
  const k = Math.max(1, Math.min(MAX_BINS, Math.floor(n) || MAX_BINS));
  if (v.length < 2 || k < 2) return [];
  const edges = [];
  for (let i = 1; i < k; i++) {
    const e = Number(v[Math.min(v.length - 1, Math.floor((v.length * i) / k))].toPrecision(2));
    if (e > v[0] && e <= v[v.length - 1] && (!edges.length || e > edges[edges.length - 1]))
      edges.push(e);
  }
  return edges;
}
const binOf = (v, edges) => {
  let i = 0;
  while (i < edges.length && v >= edges[i]) i++;
  return i;
};

/* ---------------------------------------------------------------- the figure */
export function mapFigure(spec = {}) {
  const id = spec.id;
  if (!id) throw new Error('mapFigure(): id is required');
  const p = project(spec.geo);
  const items = (spec.items || [])
    .filter((it) => it && it.id != null)
    .map((it) => ({ ...it, id: String(it.id) }));
  if (!p || !items.length)
    return html`<p class="fig-fail" role="note">Картата не се зареди. Същите данни има в списъка.</p>`;

  const by = new Map(items.map((it) => [it.id, it]));
  const mockAll = !!spec.mock;
  const isMock = (it) => mockAll || !!it.mock;
  const fmtv = (v) => String(spec.fmt ? spec.fmt(v) : num(v, spec.d ?? 0)).replace(/<[^>]*>/g, '');
  const vals = items.map((it) => it.value).filter(ok);
  const edges = Array.isArray(spec.bins)
    ? spec.bins
        .filter(ok)
        .slice()
        .sort((a, b) => a - b)
        .slice(0, MAX_BINS - 1)
    : binEdges(vals, spec.bins ?? MAX_BINS);
  const nb = edges.length + 1;
  const ladder = LADDER[nb];

  // focus: zoom to one group, grey out the rest
  const focus = spec.focusGroup != null && spec.focusGroup !== '' ? String(spec.focusGroup) : null;
  const focusIds = focus
    ? new Set(items.filter((it) => String(it.group) === focus).map((it) => it.id))
    : null;
  const zoomed = !!(focusIds && focusIds.size && p.feats.some((f) => focusIds.has(f.id)));
  const vb = viewBoxFor(p, zoomed ? focusIds : null);
  const inView = (it) => !zoomed || focusIds.has(it.id);

  const ranked = items.filter((it) => ok(it.value)).sort((a, b) => b.value - a.value);
  const rankOf = new Map(ranked.map((it, i) => [it.id, i + 1]));

  // regions: one link per item (alphabetical = reading order); everything else is context
  const live = p.feats
    .filter((f) => by.has(f.id) && inView(by.get(f.id)))
    .sort((a, b) => byName(by.get(a.id).label ?? a.name, by.get(b.id).label ?? b.name));
  const ctxFeats = p.feats.filter((f) => !(by.has(f.id) && inView(by.get(f.id))));
  const cxv = vb[0] + vb[2] / 2,
    cyv = vb[1] + vb[3] / 2;
  const selId =
    spec.selected != null && live.some((f) => f.id === String(spec.selected))
      ? String(spec.selected)
      : null;
  const stopId =
    selId ||
    (live.length
      ? live.reduce((m, f) =>
          Math.hypot(f.cx - cxv, f.cy - cyv) < Math.hypot(m.cx - cxv, m.cy - cyv) ? f : m,
        ).id
      : null);

  const regionsSvg = live
    .map((f) => {
      const it = by.get(f.id);
      const label = it.label ?? f.name;
      const has = ok(it.value);
      const valText = has ? fmtv(it.value) : 'няма данни';
      const aria =
        it.aria ||
        `${[label, it.sub].filter(Boolean).join(', ')}: ${spec.valueLabel ? spec.valueLabel + ' ' : ''}${valText}${isMock(it) ? ' (примерни данни)' : ''}`;
      const cls = 'map-r' + (has ? ` map-b${ladder[binOf(it.value, edges)]}` : ' map-nd');
      const common = ` class="${cls}" tabindex="${f.id === stopId ? 0 : -1}" aria-label="${esc(aria)}" data-id="${esc(f.id)}" data-name="${esc(label)}" data-sub="${esc(it.sub || '')}" data-vl="${esc(spec.valueLabel || '')}" data-val="${esc(valText)}" data-place="${rankOf.has(f.id) ? `${rankOf.get(f.id)} от ${ranked.length}` : ''}" data-cx="${r1(f.cx)}" data-cy="${r1(f.cy)}"${has ? '' : ` fill="url(#${id}-nd)"`}`;
      return it.href
        ? `<a${common} href="${esc(it.href)}"><path d="${f.d}"/></a>`
        : `<g${common} role="button"><path d="${f.d}"/></g>`;
    })
    .join('');
  const ctxSvg = ctxFeats.map((f) => `<path class="map-ctx" d="${f.d}"/>`).join('');
  const mockD = live
    .filter((f) => isMock(by.get(f.id)) && ok(by.get(f.id).value))
    .map((f) => f.d)
    .join('');
  const selD = selId ? live.find((f) => f.id === selId).d : '';
  const anyMock = mockAll || items.some((it) => it.mock);
  const anyNoData = items.some((it) => !ok(it.value));

  // legend: one entry per class with its range and the number of regions in it. The class edges come from all items, so a colour keeps its meaning when the view zooms; the counts are of what is on the map
  const counts = Array.from({ length: nb }, () => 0);
  items
    .filter((it) => inView(it) && ok(it.value))
    .forEach((it) => {
      counts[binOf(it.value, edges)]++;
    });
  const lo = Math.min(...vals),
    hi = Math.max(...vals);
  const rangeText = (i) => {
    if (!vals.length) return '';
    if (nb === 1) return lo === hi ? fmtv(lo) : `от ${fmtv(lo)} до ${fmtv(hi)}`;
    if (i === 0) return `под ${fmtv(edges[0])}`;
    if (i === nb - 1) return `${fmtv(edges[i - 1])} и повече`;
    return `от ${fmtv(edges[i - 1])} до ${fmtv(edges[i])}`;
  };
  const legend = html`<div class="map-legend">${spec.unitLabel ? html`<p class="map-legend-title" id="${id}-lg">${spec.unitLabel}</p>` : ''}
    <ul class="fig-legend map-legend-list"${spec.unitLabel ? raw(` aria-labelledby="${esc(id)}-lg"`) : raw(' aria-label="Легенда на картата"')}>
      ${vals.length ? counts.map((c, i) => html`<li class="map-lg"><span class="sw map-sw map-b${ladder[i]}" aria-hidden="true"></span><span>${rangeText(i)}</span> <span class="map-n">(${num(c, 0)})</span></li>`) : ''}
      ${anyNoData ? html`<li class="map-lg"><span class="sw map-sw map-nd-sw" aria-hidden="true"></span><span>няма данни</span> <span class="map-n">(${num(items.filter((it) => inView(it) && !ok(it.value)).length, 0)})</span></li>` : ''}
      ${anyMock ? html`<li class="map-lg"><span class="sw map-sw" data-mock="true" aria-hidden="true"></span><span>щриховка: примерни данни</span></li>` : ''}
    </ul>${zoomed && vals.length ? html`<p class="map-legend-note">Цветовете са еднакви с картата на цялата страна.</p>` : ''}</div>`;

  // table twin (also the source of the CSV)
  const tcols = [
    { key: 'n', label: spec.categoryLabel || 'Район' },
    { key: 'g', label: spec.groupLabel || 'Група' },
    {
      key: 'v',
      label: spec.valueLabel
        ? spec.valueLabel.charAt(0).toUpperCase() + spec.valueLabel.slice(1)
        : 'Стойност',
      num: true,
      fmt: (v) => (ok(v) ? fmtv(v) : DASH),
    },
  ];
  const trows = items
    .slice()
    .sort((a, b) => byName(a.label ?? '', b.label ?? ''))
    .map((it) => ({
      n: it.label ?? '',
      g: it.sub ?? '',
      v: ok(it.value) ? it.value : null,
      _mock: isMock(it),
    }));
  share.attach(id, { table: () => tableData({ columns: tcols, rows: trows }) });

  const label = `Картограма: ${spec.title || 'без заглавие'}. ${num(items.length, 0)} района${vals.length ? `, ${nb === 1 ? 'един клас' : num(nb, 0) + ' класа'} по стойност` : ''}.${spec.desc ? ' ' + spec.desc : ''}${spec.twin === false ? '' : ' Данните са и в таблицата под картата.'}`;
  const help =
    spec.help ||
    'Картата е един елемент за Tab. Със стрелките се местиш между районите, с Enter отваряш избрания. Същите данни има и в списъка.';
  const hint = spec.hint || 'Посочи район на картата или го избери с Tab и стрелките.';
  return html`<figure class="fig map${spec.cls ? ' ' + spec.cls : ''}" id="${id}-fig" data-ui="map" data-map-id="${id}" data-attach="${id}" data-open="${spec.openLabel || 'Виж подробности'}"${selId ? raw(` data-selected="${esc(selId)}"`) : ''}${anyMock ? raw(' data-mock-fig="true"') : ''}>
    ${spec.title || spec.sub || anyMock ? html`<figcaption class="fig-cap">${spec.title ? html`<span class="fig-title">${spec.title}</span>` : ''}${spec.sub ? html`<span class="fig-sub">${spec.sub}</span>` : ''}${anyMock ? html`<span class="fig-mock">${mockBadge()}</span>` : ''}</figcaption>` : ''}
    <div class="map-stage">
      <svg class="map-svg" viewBox="${vb.map(r1).join(' ')}" role="group" aria-label="${esc(label)}" aria-describedby="${id}-help" data-vbw="${r1(vb[2])}">
        <defs>
          <pattern id="${id}-hatch" class="map-p-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" class="map-hatch-line" stroke-width="1.6"/></pattern>
          <pattern id="${id}-nd" class="map-p-nd" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" class="map-nd-bg"/><circle cx="2" cy="2" r="1" class="map-nd-dot"/></pattern>
        </defs>
        <g class="map-ctxs">${raw(ctxSvg)}</g>
        <g class="map-regs">${raw(regionsSvg)}</g>
        ${mockD ? html`<path class="map-hatch" d="${raw(mockD)}" fill="url(#${id}-hatch)"/>` : ''}
        <g class="map-ovl" aria-hidden="true">
          <path class="map-ovl-sel map-ovl-halo" d="${selD}"${selD ? '' : raw(' hidden')}/><path class="map-ovl-sel map-ovl-ring" d="${selD}"${selD ? '' : raw(' hidden')}/>
          <path class="map-ovl-hl map-ovl-halo" hidden/><path class="map-ovl-hl map-ovl-ring" hidden/>
        </g>
      </svg>
    </div>
    <p class="sr-only" id="${id}-help">${help}</p>
    <div class="map-info" data-map-info>${hint}</div>
    ${legend}
    ${spec.twin === false ? '' : html`<details class="disc fig-table" id="${id}-tbl"><summary><span class="disc-title">${icon('table', { size: 16 })} Таблица с данните</span></summary><div class="disc-body">${dataTable({ id: id + '-t', caption: spec.title ? `Данни за картата: ${spec.title}` : 'Данни за картата', columns: tcols, rows: trows, dense: true, status: anyMock ? 'mock' : undefined })}</div></details>`}
  </figure>`;
}

/* ---------------------------------------------------------------- behaviour */
const DIRS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

/** the region nearest to `from` inside a ±70° cone around the direction; near and straight ahead wins */
function nearest(from, list, [dx, dy]) {
  const fx = +from.dataset.cx,
    fy = +from.dataset.cy;
  let best = null,
    bestScore = Infinity;
  for (const el of list) {
    if (el === from) continue;
    const vx = +el.dataset.cx - fx,
      vy = +el.dataset.cy - fy,
      len = Math.hypot(vx, vy);
    if (!len) continue;
    const cos = (vx * dx + vy * dy) / len;
    if (cos < 0.34) continue;
    const score = len * (2 - cos);
    if (score < bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}

/** dims every region that is not in `ids` (array/Set of item ids); null clears. Works through the figure's own listener, so it is safe to call before or after mount. */
export function filterMap(fig, ids) {
  fig?.dispatchEvent(
    new CustomEvent('map:filter', { detail: { ids: ids == null ? null : [...ids] } }),
  );
}

export function mount(fig, ctx) {
  const svg = fig.querySelector('.map-svg'),
    info = fig.querySelector('[data-map-info]');
  if (!svg || !info) return;
  const hint = info.innerHTML;
  const open = fig.dataset.open || 'Виж подробности';
  const hlP = svg.querySelectorAll('.map-ovl-hl'),
    selP = svg.querySelectorAll('.map-ovl-sel');
  const all = () => [...svg.querySelectorAll('.map-r')];
  const alive = () => all().filter((r) => !r.classList.contains('map-off'));
  const byId = (id) => (id ? all().find((r) => r.dataset.id === id) || null : null);
  const dOf = (r) => r?.querySelector('path')?.getAttribute('d') || '';
  const coarse = window.matchMedia('(pointer:coarse)');
  let sel = fig.dataset.selected || '',
    hov = null,
    foc = null;

  const setPaths = (list, r) => {
    const d = dOf(r);
    // SVG elements have no `hidden` property: toggle the attribute that the global [hidden] rule reads
    list.forEach((p) => {
      if (d) {
        p.setAttribute('d', d);
        p.removeAttribute('hidden');
      } else p.setAttribute('hidden', '');
    });
  };
  const paint = () => {
    const s = byId(sel);
    const a = hov || foc || s;
    setPaths(hlP, hov || foc);
    setPaths(selP, s);
    if (!a) {
      info.innerHTML = hint;
      return;
    }
    const d = a.dataset,
      href = a === s ? a.getAttribute('href') : null;
    info.innerHTML =
      `<span class="map-info-name">${esc(d.name)}</span>` +
      (d.sub ? `<span class="map-info-sub">${esc(d.sub)}</span>` : '') +
      `<span class="map-info-val">${d.vl ? esc(d.vl) + ': ' : ''}<strong>${esc(d.val)}</strong></span>` +
      (d.place ? `<span class="map-info-sub">Място: ${esc(d.place)}</span>` : '') +
      (href
        ? `<a class="map-info-open" href="${esc(href)}">${esc(open)}<span class="sr-only"> за ${esc(d.name)}</span></a>`
        : '');
  };
  let last = null; // the region that had the tab stop most recently: it keeps it after a filter is cleared
  const stop = (r) => {
    last = r;
    all().forEach((x) => {
      if (x.hasAttribute('tabindex')) x.setAttribute('tabindex', x === r ? '0' : '-1');
    });
  };
  const ensureStop = () => {
    const l = alive();
    if (!l.length || l.some((r) => r.getAttribute('tabindex') === '0')) return;
    const s = byId(sel),
      vb = svg.viewBox.baseVal,
      cx = vb.x + vb.width / 2,
      cy = vb.y + vb.height / 2;
    const pick =
      [last, s].find((r) => r && l.includes(r)) ||
      l.reduce((m, r) =>
        Math.hypot(+r.dataset.cx - cx, +r.dataset.cy - cy) <
        Math.hypot(+m.dataset.cx - cx, +m.dataset.cy - cy)
          ? r
          : m,
      );
    stop(pick);
  };
  const choose = (r) => {
    sel = r.dataset.id;
    fig.dataset.selected = sel;
    paint();
    fig.dispatchEvent(new CustomEvent('map:select', { bubbles: true, detail: { id: sel } }));
    const d = r.dataset;
    ctx?.announce?.(`${d.name}${d.sub ? ', ' + d.sub : ''}: ${d.vl ? d.vl + ' ' : ''}${d.val}`);
  };
  const regionOf = (e) => (e.target instanceof Element ? e.target.closest('.map-r') : null);

  const onFocusIn = (e) => {
    const r = regionOf(e);
    if (!r) return;
    foc = r;
    stop(r);
    paint();
  };
  const onFocusOut = (e) => {
    const r = regionOf(e);
    if (r && foc === r) {
      foc = null;
      paint();
    }
  };
  const onOver = (e) => {
    if (e.pointerType === 'touch') return;
    const r = regionOf(e);
    if (r !== hov) {
      hov = r;
      paint();
    }
  };
  const onLeave = () => {
    if (hov) {
      hov = null;
      paint();
    }
  };
  const onClick = (e) => {
    const r = regionOf(e);
    if (!r) return;
    const href = r.getAttribute('href');
    if (!href) {
      choose(r);
      return;
    }
    if (e.detail > 0 && coarse.matches && sel !== r.dataset.id) {
      e.preventDefault();
      choose(r);
    } // touch: first tap previews, second opens
  };
  const onKey = (e) => {
    const r = regionOf(e);
    if (!r || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (!r.getAttribute('href')) {
        e.preventDefault();
        choose(r);
      } else if (e.key === ' ') {
        e.preventDefault();
        r.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      return;
    }
    let t = null;
    if (DIRS[e.key]) t = nearest(r, alive(), DIRS[e.key]);
    else if (e.key === 'Home') t = alive()[0];
    else if (e.key === 'End') t = alive().at(-1);
    else return;
    e.preventDefault();
    if (t && t !== r) {
      stop(t);
      t.focus();
    }
  };

  const setOff = (r, off) => {
    r.classList.toggle('map-off', off);
    if (off) {
      if (r.hasAttribute('href')) {
        r.dataset.href = r.getAttribute('href');
        r.removeAttribute('href');
      }
      r.removeAttribute('tabindex');
      r.setAttribute('aria-hidden', 'true');
      if (foc === r) foc = null;
      if (hov === r) hov = null;
    } else {
      if (r.dataset.href) {
        r.setAttribute('href', r.dataset.href);
        delete r.dataset.href;
      }
      r.setAttribute('tabindex', '-1');
      r.removeAttribute('aria-hidden');
    }
  };
  const onFilter = (e) => {
    const ids = e.detail?.ids;
    const keep = ids == null ? null : new Set(ids.map(String));
    all().forEach((r) => setOff(r, keep ? !keep.has(r.dataset.id) : false));
    fig.classList.toggle('map-filtered', !!keep);
    ensureStop();
    paint();
  };

  // pattern sizes are in drawing units: keep the hatch and the dots the same size on screen at every zoom
  const fit = () => {
    const w = svg.getBoundingClientRect().width,
      vbw = parseFloat(svg.dataset.vbw);
    if (!(w > 0) || !(vbw > 0)) return;
    const u = vbw / w;
    const hp = svg.querySelector('.map-p-hatch'),
      np = svg.querySelector('.map-p-nd');
    if (hp) {
      hp.setAttribute('width', 7 * u);
      hp.setAttribute('height', 7 * u);
      const l = hp.querySelector('line');
      l.setAttribute('y2', 7 * u);
      l.setAttribute('stroke-width', 1.6 * u);
    }
    if (np) {
      np.setAttribute('width', 6 * u);
      np.setAttribute('height', 6 * u);
      const rc = np.querySelector('rect'),
        c = np.querySelector('circle');
      rc.setAttribute('width', 6 * u);
      rc.setAttribute('height', 6 * u);
      c.setAttribute('cx', 2 * u);
      c.setAttribute('cy', 2 * u);
      c.setAttribute('r', 1 * u);
    }
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(svg);

  // listeners live on the HTML stage, not on the <svg>: Chromium makes an SVG element focusable when it has focus listeners, which put a dead tab stop on the map
  const stage = svg.parentElement || fig;
  stage.addEventListener('focusin', onFocusIn);
  stage.addEventListener('focusout', onFocusOut);
  stage.addEventListener('pointerover', onOver);
  stage.addEventListener('pointerleave', onLeave);
  stage.addEventListener('click', onClick);
  stage.addEventListener('keydown', onKey);
  fig.addEventListener('map:filter', onFilter);
  fig.classList.add('map-live');
  fit();
  ensureStop();
  paint();
  return () => {
    ro?.disconnect();
    stage.removeEventListener('focusin', onFocusIn);
    stage.removeEventListener('focusout', onFocusOut);
    stage.removeEventListener('pointerover', onOver);
    stage.removeEventListener('pointerleave', onLeave);
    stage.removeEventListener('click', onClick);
    stage.removeEventListener('keydown', onKey);
    fig.removeEventListener('map:filter', onFilter);
  };
}
