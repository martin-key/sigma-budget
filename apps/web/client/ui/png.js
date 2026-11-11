// PNG download for every statistic: the „Изтегли изображение“ item of the block menu (share.js), a visible „PNG“ button in the header of a block that has no
// menu, and the picture composer behind both.
//   scan(root)                                 adds the button to each menu-less block with a statistic (chart, ranking, KPI tiles, progress bars, map, data table,
//                                              the home-page strips, the 5-minute scenes) and a small bar under a loose statistic that sits outside a block;
//                                              one delegated click handler downloads the picture (file name bns-<route>-<block>.png)
//   canvasFor(spec, {watermark, pixelRatio})   the picture: title, scope / period line, the block as it looks on screen, „Примерни данни“ line and
//                                              watermark when the data is mock, source line, brand line.  share.renderPng() delegates here.
// No library and no network: the block is cloned off screen at a fixed width, laid out by the browser and walked once (boxes, borders, hatch, words,
// inline SVG; ECharts goes through charts.chartImage).  Only the 2D canvas API is used, so the canvas is never tainted.
import { icon } from '../icons.js';
import * as share from '../share.js';

const W = 760, PAD = 20, INNER = W - PAD * 2, MAXW = 1280, PP = 16;   // PP: padding of the grey panel a block is drawn on
const FAM = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif';   // v4: СИГМА's system stacks, no webfont
const SERIF = 'Charter,"Iowan Old Style",Georgia,"Times New Roman",serif';
const SKIP_ROUTES = new Set(['api']);                                    // S25: reference tables of the API, not statistics
const HOST_SEL = 'li.s05-card,.kpi-grid,.table-wrap,figure.fig,.rank';   // what a loose statistic is exported together with
const MOCK_SEL = '[data-block-mock="true"],[data-mock-fig="true"],[data-mock-table="true"],[data-kpi-mock="true"]';
const RANK_CAP = 30, TABLE_CAP = 40, MAXH = 3200;   // MAXH: tallest body (CSS px) before a long list of cards is cut at an item boundary

/* ---------------------------------------------------------------- the button */
let observer = null, orphanSeq = 0;
const text = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();

function makeButton(key, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm btn-quiet png-btn';
  b.dataset.png = key;
  b.title = 'Изтегли изображение (PNG)';
  b.setAttribute('aria-label', `Изтегли изображение: ${title}`);
  b.innerHTML = `${icon('image', { size: 16 }).s}<span>Изображение</span>`;       // the visible word is part of the accessible name (WCAG 2.5.3)
  return b;
}
function blockButton(block) {
  const head = block.querySelector(':scope > .block-head');
  if (!head || head.querySelector('.png-btn, [data-share]')) return 0;   // a block with the menu offers PNG there
  let tools = head.querySelector(':scope > .block-tools');
  if (!tools) { tools = document.createElement('div'); tools.className = 'block-tools'; head.append(tools); }
  tools.append(makeButton(block.id, text(head.querySelector('.block-title')) || 'блок'));
  return 1;
}
function orphanButton(node) {
  const host = node.closest(HOST_SEL) || node;
  if (host.closest('section.block') || host.dataset.pngHost || host.closest('[data-png-host]')) return 0;
  const key = host.id || `${share.currentRoute()?.key || 'page'}-kpi-${++orphanSeq}`;
  host.dataset.pngHost = key;
  const bar = document.createElement('div');
  bar.className = 'png-bar';
  bar.append(makeButton(key, titleOf(host) || 'статистика'));
  if (host.matches('li')) host.append(bar); else host.after(bar);
  return 1;
}
/** idempotent; returns how many buttons it added */
export function scan(root = document.querySelector('#view article.page')) {
  const article = root?.closest?.('article.page') || root;
  if (!article || !article.classList?.contains('page') || article.classList.contains('page-bare') || SKIP_ROUTES.has(article.dataset.key)) return 0;
  let n = 0;
  const blocks = new Set();
  for (const node of share.statNodes(article)) {
    const block = node.closest('section.block');
    if (block) { if (!blocks.has(block)) { blocks.add(block); n += blockButton(block); } } else n += orphanButton(node);
  }
  watch(article);
  return n;
}
/** statistics that appear later (a filter re-draws a result in place) get their button too */
function watch(article) {
  if (observer?.article === article) return;
  observer?.mo.disconnect();
  let t = 0;
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { try { scan(article); } catch (e) { console.error('[png]', e); } }, 120); });
  mo.observe(article, { childList: true, subtree: true });
  observer = { article, mo };
}

/* ---------------------------------------------------------------- what the picture is about */
function titleOf(host) {
  const own = host.querySelector('h2,h3,h4,caption,.rank-cap,.fig-title');
  if (own) return text(own);
  for (let p = host.previousElementSibling, i = 0; p && i < 3; p = p.previousElementSibling, i++) { if (/^H[1-4]$/.test(p.tagName)) return text(p); }
  const kl = host.querySelector('.kpi-label');
  return text(kl) || text(host.closest('article.page')?.querySelector('h1'));
}
function headingOf(host) { return host.querySelector('h2,h3,h4'); }
const unitEl = spec => (spec?.el && spec.el.isConnected ? spec.el : spec?.id ? document.getElementById(spec.id) || document.querySelector(`[data-png-host="${CSS.escape(spec.id)}"]`) : null);
/** the spec of a block: the registered one (title, sub, source, asOf, status), or one read from the DOM for loose statistics and blocks without a source */
function specFor(el) {
  const block = el.matches('section.block');
  const reg = block ? share.get(el.id) : null;
  if (reg) return reg;
  const keys = new Set(), asOf = [];
  el.querySelectorAll('.src-btn[data-src]').forEach(b => { b.dataset.src.split(',').forEach(k => k.trim() && keys.add(k.trim())); if (b.dataset.asof) asOf.push(b.dataset.asof); });
  if (!keys.size && !block) el.closest('article.page')?.querySelectorAll('.src-btn[data-src]').forEach(b => { b.dataset.src.split(',').forEach(k => k.trim() && keys.add(k.trim())); if (b.dataset.asof) asOf.push(b.dataset.asof); });
  const id = block ? el.id : el.dataset.pngHost;
  return {
    id, el, route: share.currentRoute()?.key || el.closest('article.page')?.dataset.key || '',
    title: block ? text(el.querySelector(':scope > .block-head .block-title')) : titleOf(el),
    sub: block ? text(el.querySelector(':scope > .block-sub')) : '',
    source: [...keys], asOf: asOf.sort().pop(), status: block ? el.dataset.blockStatus || undefined : undefined,
    mock: !!(el.matches(MOCK_SEL) || el.querySelector(MOCK_SEL) || el.closest('[data-block-mock]'))
  };
}
function metaOf(el, spec) {
  const parts = [];
  const tags = el.querySelector(':scope > .block-head > .block-tags');
  if (tags) [...tags.children].forEach(c => { if (c.matches('.src-btn, .block-asof')) return; const t = text(c); if (t) parts.push(t); });
  const tab = el.querySelector('.tab-list [role="tab"][aria-selected="true"]');
  if (tab) parts.push(text(tab));
  const per = spec && spec.period !== undefined ? spec.period : text(document.querySelector('.ctx-period strong'));
  if (per) parts.push(`Период: ${per}`);
  return parts.join(' · ');
}

/* ---------------------------------------------------------------- the off-screen stage */
const STAGE_CSS = `
[data-png-stage]{position:fixed;left:-20000px;top:0;pointer-events:none}
[data-png-stage] *,[data-png-stage] *::before,[data-png-stage] *::after{animation:none!important;transition:none!important;caret-color:transparent}
[data-png-stage] a,[data-png-stage] abbr,[data-png-stage] .gl{text-decoration:none!important}
[data-png-stage] .page-body,[data-png-stage] .page-body>*{margin:0!important}
[data-png-stage] .block{margin:0!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:none!important;overflow:visible!important}
[data-png-stage] .block-head,[data-png-stage] .block-sub,[data-png-stage] .block-foot,[data-png-stage] .block-strip,[data-png-stage] .mock-note,[data-png-stage] .tab-list,[data-png-stage] .seg,[data-png-stage] .unit-switch,[data-png-stage] .chips,[data-png-stage] .png-btn,[data-png-stage] .png-bar,[data-png-stage] .share-btn,[data-png-stage] .src-btn,[data-png-stage] .report-link,[data-png-stage] .sr-only,[data-png-stage] select,[data-png-stage] input,[data-png-stage] textarea,[data-png-stage] details.fig-table,[data-png-stage] [data-png-skip],[data-png-stage] [hidden],[data-png-stage] .s05-go,[data-png-stage] .s05-ic,[data-png-stage] .s04-go,[data-png-stage] .s04-deep,[data-png-stage] .s04-card-a,[data-png-stage] [role="search"],[data-png-stage] .btn,[data-png-stage] .s22-foot,[data-png-stage] .field:has(.seg,select,input,textarea){display:none!important}
[data-png-stage] figure[data-view="table"] .chart,[data-png-stage] figure[data-view="table"] .fig-legend{display:none!important}
[data-png-stage] figure[data-view="table"] details.fig-table{display:block!important}
[data-png-stage] figure[data-view="table"] details.fig-table>summary{display:none!important}
[data-png-stage] details:not([open])>:not(summary){display:none!important}
[data-png-stage] .table-wrap{overflow:visible!important}
[data-png-stage] .rank-label,[data-png-stage] .rank-name{white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
[data-png-stage] .png-more{margin:6px 0 0;list-style:none;font-size:12px;color:var(--muted);grid-column:1/-1}
[data-png-stage] .s12-cards,[data-png-stage] .s07-split{grid-template-columns:minmax(0,1fr)!important}
[data-png-stage] .map-info:not(:has(.map-info-name)){display:none!important}
[data-png-stage] .s15-more{display:none!important}
[data-png-stage] .fig-legend .lg{min-height:0!important;padding:2px 14px 2px 0!important;border:0!important;background:none!important}
[data-png-stage] .fig-legend{gap:2px 6px!important}
[data-png-stage] .s15-grid .s15-dh,[data-png-stage] .s15-grid td.s15-d{display:table-cell!important}
[data-png-stage] .s15-dm{display:none!important}
[data-png-stage] .s15-grid .s15-h0{width:34%!important}
[data-png-stage] .s15-grid .s15-n{font-size:var(--fs-2)!important}
[data-png-stage] .s15-grid .s15-d .s15-n{font-size:var(--fs-1)!important}`;

function note(n) { return `… и още ${n} ${n === 1 ? 'ред' : 'реда'} на сайта`; }
function capRows(clone) {
  clone.querySelectorAll('.rank-list').forEach(l => {
    const rows = [...l.children];
    if (rows.length <= RANK_CAP) return;
    rows.slice(RANK_CAP).forEach(r => r.remove());
    const li = document.createElement('li'); li.className = 'png-more'; li.textContent = note(rows.length - RANK_CAP); l.append(li);
  });
  clone.querySelectorAll('table.data').forEach(t => {
    const rows = [...t.tBodies].flatMap(b => [...b.rows]);
    if (rows.length <= TABLE_CAP) return;
    rows.slice(TABLE_CAP).forEach(r => r.remove());
    const cols = t.rows[0]?.cells.length || 1;
    const tr = t.tBodies[0].insertRow(); const td = tr.insertCell(); td.colSpan = cols; td.className = 'png-more'; td.textContent = note(rows.length - TABLE_CAP);
  });
}
/** the longest run of look-alike items (project cards, measure cards, rows of a list) in the stage: the place a cut is made */
function longestRun(stage) {
  let best = null;
  for (const host of stage.querySelectorAll('.page-body *')) {
    if (host.childElementCount < 4 || host.closest('svg,table,[data-png-skip]')) continue;
    const groups = new Map();
    for (const c of host.children) {
      if (c.matches('.png-more,style,script,template') || !c.getBoundingClientRect().height) continue;
      const k = `${c.localName}.${typeof c.className === 'string' ? c.className : ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const items of groups.values()) {
      if (items.length < 4) continue;
      const total = items.reduce((s, c) => s + c.getBoundingClientRect().height, 0);
      if (total >= 400 && (!best || total > best.total)) best = { host, items, total };
    }
  }
  return best;
}
/** a very tall run of items (S12 measure cards, long lists of panels) is cut at an item boundary and closed with a note, so the picture stays a few screens long */
async function capHeight(st, m) {
  const body = st.stage.querySelector('.page-body');
  for (let round = 0; round < 3 && m.h > MAXH; round++) {
    const run = longestRun(st.stage);
    if (!run) break;
    const { host, items } = run;
    const more = host.querySelector(':scope > .png-more') || Object.assign(document.createElement(/^(UL|OL)$/.test(host.tagName) ? 'li' : 'div'), { className: 'png-more' });
    more.textContent = '… и още 99 елемента на сайта';
    host.append(more);
    let cut = 0;
    while (items.length - cut > 2 && Math.ceil(body.getBoundingClientRect().height) > MAXH) { items[items.length - 1 - cut].remove(); cut++; }
    if (!cut) { more.remove(); break; }
    const left = (Number(more.dataset.n) || 0) + cut;
    more.dataset.n = String(left);
    more.textContent = `… и още ${left} ${left === 1 ? 'елемент' : 'елемента'} на сайта`;
    await settle();
    m = measure(st.stage);
  }
  return m;
}
function buildStage(article, el, width) {
  const stage = document.createElement('div');
  stage.setAttribute('data-png-stage', '');
  stage.setAttribute('aria-hidden', 'true');
  stage.inert = true;
  stage.style.width = width + 'px';
  const css = document.createElement('style'); css.textContent = STAGE_CSS; stage.append(css);
  const page = article.cloneNode(false);
  page.removeAttribute('aria-labelledby'); page.removeAttribute('id');
  page.className = 'page'; page.style.cssText = 'margin:0;padding:0;max-width:none;width:100%';
  const body = document.createElement('div'); body.className = 'page-body';
  const clone = el.cloneNode(true);
  const live = [...el.querySelectorAll('.chart')], pairs = [];
  [...clone.querySelectorAll('.chart')].forEach((c, i) => {
    const inst = live[i] && live[i].clientWidth > 0 && window.echarts?.getInstanceByDom(live[i]);
    if (!inst) return;
    c.replaceChildren(); c.dataset.pngChart = String(pairs.length); pairs.push({ inst });
  });
  clone.querySelectorAll('figure[data-view="table"] details.fig-table').forEach(d => { d.open = true; });
  const plain = [...clone.querySelectorAll('details:not([open])')].filter(d => !/\d/.test(text(d.querySelector(':scope > summary'))));   // a collapsed panel is drawn only when its heading is itself data (S06 sources)
  plain.forEach(d => d.setAttribute('data-png-skip', ''));
  if (!share.statNodes(clone).some(n => !n.closest('[data-png-skip]'))) plain.forEach(d => { d.removeAttribute('data-png-skip'); d.open = true; });   // …and opened when the statistic lives inside it
  const own = el.matches('section.block') ? null : headingOf(el);          // a loose statistic prints its heading in the picture's title, not twice
  if (own) { const i = [...el.querySelectorAll('*')].indexOf(own); if (i >= 0) clone.querySelectorAll('*')[i].setAttribute('data-png-skip', ''); }
  capRows(clone);
  body.append(clone); page.append(body); stage.append(page);
  return { stage, clone, pairs };
}
const settle = async () => {
  try { await document.fonts.ready; } catch { /* fine */ }
  await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise(r => setTimeout(r, 150))]);
};
function measure(stage) {
  const r0 = stage.getBoundingClientRect();
  let right = -Infinity, bottom = -Infinity;
  for (const n of stage.querySelectorAll('.page-body *')) {
    if (n.ownerSVGElement) continue;                                       // the parts of a drawing are clipped by it (a zoomed regional map reaches far past its own frame)
    const r = n.getBoundingClientRect();
    if (r.width || r.height) { right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom); }
  }
  const pb = stage.querySelector('.page-body').getBoundingClientRect();
  return { x0: r0.left, y0: r0.top, w: Math.max(Math.ceil(right - r0.left), 1), h: Math.max(Math.ceil(Math.max(bottom, pb.bottom) - r0.top), 1) };
}

/* ---------------------------------------------------------------- the rasteriser */
const ALPHA0 = /^(transparent|rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0(\.0+)?\s*\)|.*\/\s*0(\.0+)?%?\s*\))$/;
const clear = c => !c || ALPHA0.test(c.trim());
const px = v => parseFloat(v) || 0;
function radii(cs, w, h) {
  const one = v => { const s = String(v).split(' ')[0]; return s.endsWith('%') ? (parseFloat(s) / 100) * Math.min(w, h) : px(s); };
  return [one(cs.borderTopLeftRadius), one(cs.borderTopRightRadius), one(cs.borderBottomRightRadius), one(cs.borderBottomLeftRadius)];
}
function rrPath(ctx, x, y, w, h, r) {
  const [a, b, c, d] = r.map(v => Math.max(0, Math.min(v, w / 2, h / 2)));
  ctx.beginPath();
  ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.arcTo(x + w, y, x + w, y + b, b);
  ctx.lineTo(x + w, y + h - c); ctx.arcTo(x + w, y + h, x + w - c, y + h, c);
  ctx.lineTo(x + d, y + h); ctx.arcTo(x, y + h, x, y + h - d, d);
  ctx.lineTo(x, y + a); ctx.arcTo(x, y, x + a, y, a);
  ctx.closePath();
}
/** the site's repeating gradients: 45deg hatch of a „mock“ block, and 90deg dashes (the swatch of a dashed line in a legend) */
function hatch(ctx, bg, x, y, w, h, rad) {
  const m = /repeating-linear-gradient\(\s*(-?[\d.]+)deg\s*,(.*)\)/.exec(bg);
  if (!m) return;
  const deg = parseFloat(m[1]);
  const stops = [...m[2].matchAll(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})((?:\s+-?[\d.]+px)+)/g)].map(s => ({ c: s[1], p: s[2].trim().split(/\s+/).map(parseFloat) }));
  if (stops.length < 2 || clear(stops[0].c)) return;
  if (Math.abs(deg - 90) < 0.5) {                                          // vertical stripes: [from, to) of every period in the colour of the first stop
    const from = stops[0].p[0], to = stops[0].p[1] ?? stops[1].p[0], per = stops[stops.length - 1].p.slice(-1)[0];
    if (!(per > 0) || !(to > from)) return;
    ctx.save(); rrPath(ctx, x, y, w, h, rad); ctx.clip(); ctx.fillStyle = stops[0].c;
    for (let px = x; px < x + w; px += per) ctx.fillRect(px + from, y, to - from, h);
    ctx.restore();
    return;
  }
  if (Math.abs(deg - 45) > 0.5) return;
  const t = Math.max(stops[1].p[0] - stops[0].p[0], 0.5), p = Math.max(stops[stops.length - 1].p[0], t + 0.5);
  ctx.save();
  rrPath(ctx, x, y, w, h, rad); ctx.clip();
  ctx.strokeStyle = stops[0].c; ctx.lineWidth = t;
  const L = (w + h) * Math.SQRT1_2, cx = x + w / 2, cy = y + h / 2;
  for (let k = Math.floor(-t / p); k * p < L + t; k++) {
    const D = (k * p + t / 2 - L / 2) * Math.SQRT2 + cx - cy;            // the stripe is the line x - y = D
    ctx.beginPath(); ctx.moveTo(D + (y - w), y - w); ctx.lineTo(D + (y + h + w), y + h + w); ctx.stroke();
  }
  ctx.restore();
}
function paintBox(ctx, cs, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  const rad = radii(cs, w, h);
  if (!clear(cs.backgroundColor)) { rrPath(ctx, x, y, w, h, rad); ctx.fillStyle = cs.backgroundColor; ctx.fill(); }
  if (cs.backgroundImage && cs.backgroundImage !== 'none') hatch(ctx, cs.backgroundImage, x, y, w, h, rad);
  const sides = ['Top', 'Right', 'Bottom', 'Left'].map(s => ({ w: px(cs[`border${s}Width`]), c: cs[`border${s}Color`], st: cs[`border${s}Style`] })).map(s => (s.st === 'none' || s.st === 'hidden' || clear(s.c) ? { ...s, w: 0 } : s));
  if (!sides.some(s => s.w > 0)) return;
  const [t, r, b, l] = sides;
  const same = sides.every(s => s.w === t.w && s.c === t.c && s.st === t.st);
  if (same) {
    ctx.save();
    ctx.lineWidth = t.w; ctx.strokeStyle = t.c;
    if (t.st === 'dashed') ctx.setLineDash([t.w * 3, t.w * 2]); else if (t.st === 'dotted') ctx.setLineDash([t.w, t.w * 1.5]);
    rrPath(ctx, x + t.w / 2, y + t.w / 2, w - t.w, h - t.w, rad.map(v => Math.max(0, v - t.w / 2)));
    ctx.stroke(); ctx.restore();
    return;
  }
  const bar = (s, bx, by, bw, bh) => { if (s.w > 0) { ctx.fillStyle = s.c; ctx.fillRect(bx, by, bw, bh); } };
  bar(t, x, y, w, t.w); bar(b, x, y + h - b.w, w, b.w); bar(l, x, y, l.w, h); bar(r, x + w - r.w, y, r.w, h);
}
const fontOf = cs => `${cs.fontStyle === 'italic' ? 'italic ' : ''}${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
/** every letter is drawn where the browser laid it out (a canvas cannot switch on tabular figures or the other font features, so whole words would drift) */
function paintText(S, tn) {
  const raw = tn.nodeValue, pe = tn.parentElement;
  if (!raw || !pe || !/\S/.test(raw)) return;
  const cs = getComputedStyle(pe);
  if (cs.visibility === 'hidden') return;
  const { ctx } = S;
  ctx.save();
  ctx.font = fontOf(cs); ctx.fillStyle = cs.color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText('Hxg'), asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent, desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 0;
  const tt = cs.textTransform, range = document.createRange();
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch) || ch === '\u00AD' || ch === '\u200B') continue;
    range.setStart(tn, i); range.setEnd(tn, i + 1);
    const rc = range.getClientRects()[0];
    if (!rc || !rc.width) continue;
    const g = tt === 'uppercase' ? ch.toUpperCase() : tt === 'lowercase' ? ch.toLowerCase() : ch;
    const dw = rc.width - ctx.measureText(g).width;                         // tabular figures are wider cells than the canvas's own digits: centre the digit in its cell
    ctx.fillText(g, rc.left - S.x0 + (Math.abs(dw) > 0.75 ? dw / 2 : 0), rc.top + (rc.height - (asc + desc)) / 2 + asc - S.y0);
  }
  ctx.restore();
}
const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'paint-order', 'visibility', 'display'];
const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('img')); i.src = src; });
async function paintSvg(S, svg, x, y, w, h) {
  if (w < 2 || h < 2) return;
  const copy = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll('*')], dst = [copy, ...copy.querySelectorAll('*')];
  src.forEach((s, i) => {
    const cs = getComputedStyle(s);
    let st = '';
    for (const p of SVG_PROPS) {
      if (i === 0 && (p === 'display' || p === 'opacity')) continue;
      let v = cs.getPropertyValue(p);
      if (!v) continue;
      if (v.includes('url(')) v = v.replace(/url\(["']?[^)#]*#([^"')]+)["']?\)/g, 'url(#$1)');
      st += `${p}:${v};`;
    }
    dst[i].setAttribute('style', st); dst[i].removeAttribute('class');
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(w)); copy.setAttribute('height', String(h));
  if (!copy.getAttribute('viewBox') && svg.getAttribute('width') && svg.getAttribute('height')) copy.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width'))} ${parseFloat(svg.getAttribute('height'))}`);
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy)));
  S.ctx.drawImage(img, x, y, w, h);
}
async function paintChart(S, el, x, y, w, h) {
  const pr = S.pairs[Number(el.dataset.pngChart)];
  if (!pr || w < 2 || h < 2) return;
  const { chartImage } = await import('../charts.js');
  const r = chartImage(pr.inst, { clientWidth: w, clientHeight: h }, { pixelRatio: S.pr, background: 'rgba(0,0,0,0)' });
  S.ctx.drawImage(await loadImg(r.url), x, y, w, h);
}
async function paintTree(S, node) {
  if (node.nodeType === 3) { paintText(S, node); return; }
  if (node.nodeType !== 1) return;
  const tag = node.localName;
  if (tag === 'style' || tag === 'script' || tag === 'template' || tag === 'noscript') return;
  const cs = getComputedStyle(node);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  const op = parseFloat(cs.opacity);
  if (op === 0) return;
  const r = node.getBoundingClientRect(), x = r.left - S.x0, y = r.top - S.y0, w = r.width, h = r.height, { ctx } = S;
  ctx.save();
  try {
    if (op < 1) ctx.globalAlpha *= op;
    if (tag === 'svg') { await paintSvg(S, node, x, y, w, h); return; }
    paintBox(ctx, cs, x, y, w, h);
    if (node.dataset?.pngChart != null) { await paintChart(S, node, x, y, w, h); return; }
    if (tag === 'img') { try { if (node.complete && node.naturalWidth) ctx.drawImage(node, x, y, w, h); } catch { /* skip */ } return; }
    if (w > 0 && h > 0 && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) { rrPath(ctx, x, y, w, h, radii(cs, w, h)); ctx.clip(); }
    const kids = tag === 'details' && !node.open ? [...node.children].filter(c => c.localName === 'summary') : node.childNodes;   // a closed panel shows only its summary
    for (const c of kids) await paintTree(S, c);
  } finally { ctx.restore(); }
}

/* ---------------------------------------------------------------- the picture */
async function fonts() {
  try { await document.fonts.ready; } catch { /* system fonts are fine */ }
}
function wrap(ctx, txt, font, maxW) {
  ctx.font = font;
  const out = []; let line = '';
  for (const wd of String(txt).split(/\s+/).filter(Boolean)) { const t = line ? line + ' ' + wd : wd; if (line && ctx.measureText(t).width > maxW) { out.push(line); line = wd; } else line = t; }
  if (line) out.push(line);
  return out;
}
/** like wrap(), but a word wider than the line (a web address) is broken at ? & / = or, as the last resort, anywhere */
function wrapLink(ctx, txt, font, maxW) {
  ctx.font = font;
  const out = []; let line = '';
  for (const part of String(txt).split(/(?<=[?&/=#])/)) {
    if (ctx.measureText(line + part).width <= maxW) { line += part; continue; }
    if (line) out.push(line);
    line = '';
    for (const ch of part) { if (line && ctx.measureText(line + ch).width > maxW) { out.push(line); line = ''; } line += ch; }
  }
  if (line) out.push(line);
  return out;
}
/** diagonal „ПРИМЕРНИ ДАННИ“ tiles over the whole picture, spaced by the measured width of the words */
function mark(x, W, H, colour) {
  const txt = 'ПРИМЕРНИ ДАННИ';
  x.save();
  x.globalAlpha = 0.14; x.fillStyle = colour || '#AC1B18'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `700 30px ${FAM}`;
  const stepX = x.measureText(txt).width + 120, stepY = 130, span = Math.hypot(W, H);
  x.translate(W / 2, H / 2); x.rotate(-Math.PI / 7);
  for (let r = 0, y = -span; y < span; y += stepY, r++) for (let px = -span + (r % 2 ? stepX / 2 : 0); px < span; px += stepX) x.fillText(txt, px, y);
  x.restore();
}
/** the PNG of a block or loose statistic; null when the spec has nothing statistical in the DOM (the caller falls back to its own picture) */
export async function canvasFor(spec, { watermark, pixelRatio = 2 } = {}) {
  const el = unitEl(spec);
  if (!el || (!share.statNodes(el).length && !el.matches(share.STAT_SEL))) return null;
  const article = el.closest('article.page');
  if (!article) return null;
  const mock = share.isMock(spec) || !!spec.mock;
  const wm = watermark ?? mock;
  await fonts();
  const panel = el.matches('section.block') ? PP : 0;                     // a block sits on its grey card, as on the page, so the white tiles inside stay visible
  const inner = INNER - 2 * panel;
  let st = buildStage(article, el, inner);
  try {
    document.body.append(st.stage);
    for (const n of st.stage.querySelectorAll('.page-body *:not(svg *)')) if (getComputedStyle(n).position === 'sticky') n.style.setProperty('position', 'static', 'important');   // a pinned column would be laid out against the window
    await settle();
    let m = measure(st.stage);
    if (m.w > inner + 1) { st.stage.style.width = Math.min(m.w, MAXW) + 'px'; await settle(); m = measure(st.stage); }
    m = await capHeight(st, m);
    const sw = Math.max(m.w, inner), k = Math.min(1, inner / sw);
    const bodyH = Math.ceil(m.h * k) + 2 * panel;
    const probe = document.createElement('canvas').getContext('2d');
    const tl = wrap(probe, spec.title || '', `400 24px ${SERIF}`, INNER);
    const sl = [...(spec.sub ? wrap(probe, spec.sub, `400 13px ${FAM}`, INNER) : [])];
    const meta = wrap(probe, metaOf(el, spec), `400 12px ${FAM}`, INNER);
    const src = share.sourceLine(spec);
    const link = share.shortLink(spec);
    const fl = [...(mock ? wrap(probe, 'Примерни данни: измислени стойности, не са истински.', `700 12px ${FAM}`, INNER).map(t => ({ t, mock: true })) : []),
      ...(src ? wrap(probe, src, `400 12px ${FAM}`, INNER) : []).map(t => ({ t })),
      ...(link ? wrapLink(probe, `Връзка: ${link}`, `400 12px ${FAM}`, INNER) : []).map(t => ({ t })), { t: 'СИГМА Бюджет' }];
    const H = PAD + tl.length * 26 + (sl.length ? 4 + sl.length * 18 : 0) + (meta.length ? 4 + meta.length * 17 : 0) + 14 + bodyH + 16 + fl.length * 17 + PAD;
    const pr = Math.max(1, Math.min(pixelRatio, Math.sqrt(16e6 / (W * H))));   // iOS Safari caps a canvas at about 16 million pixels
    const c = document.createElement('canvas');
    c.width = Math.round(W * pr); c.height = Math.round(H * pr);
    c.lang = 'bg';
    const x = c.getContext('2d');
    if ('lang' in x) x.lang = 'bg';
    x.scale(pr, pr); x.textBaseline = 'top';
    const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    x.fillStyle = cssv('--surface') || '#fff'; x.fillRect(0, 0, W, H);
    let y = PAD;
    x.fillStyle = cssv('--ink'); x.font = `400 24px ${SERIF}`; tl.forEach(l => { x.fillText(l, PAD, y); y += 26; });
    if (sl.length) { y += 4; x.fillStyle = cssv('--muted'); x.font = `400 13px ${FAM}`; sl.forEach(l => { x.fillText(l, PAD, y); y += 18; }); }
    if (meta.length) { y += 4; x.fillStyle = cssv('--muted'); x.font = `400 12px ${FAM}`; meta.forEach(l => { x.fillText(l, PAD, y); y += 17; }); }
    y += 14;
    if (panel) { x.fillStyle = cssv('--ink') || '#15110C'; x.fillRect(PAD, y, INNER, 1); }   // v4: no card; an ink rule on top of the block, as on the page
    x.save(); x.translate(PAD + panel, y + panel); x.scale(k, k);
    await paintTree({ ctx: x, x0: m.x0, y0: m.y0, pairs: st.pairs, pr: pr * k }, st.clone);
    x.restore();
    y += bodyH + 16;
    fl.forEach(l => { x.fillStyle = l.mock ? cssv('--st-mock') : cssv('--muted'); x.font = `${l.mock ? 700 : 400} 12px ${FAM}`; x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText(l.t, PAD, y); y += 17; });
    if (wm) mark(x, W, H, cssv('--st-mock'));
    return c;
  } finally { st.stage.remove(); }
}

/* ---------------------------------------------------------------- the click */
document.addEventListener('click', e => {
  const b = e.target.closest?.('.png-btn');
  if (!b || b.dataset.busy) return;
  e.preventDefault();
  const el = b.closest('section.block') || document.querySelector(`[data-png-host="${CSS.escape(b.dataset.png)}"]`);
  if (!el) return;
  b.dataset.busy = '1'; b.setAttribute('aria-busy', 'true');
  share.runAct('png', specFor(el), b).finally(() => { delete b.dataset.busy; b.removeAttribute('aria-busy'); });
});

