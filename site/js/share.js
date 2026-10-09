// Sharing: registry of shareable blocks + the „Сподели“ menu (copy text, copy link, PNG, CSV, embed code, Web Share).
// A block registers a spec while its screen renders (ui/block.js does this for you); the router clears the registry on every navigation.
//   share.register(id, {title, sub, text, source:['kfp'], asOf, status, mock, chart:'chartDomId', table:{columns,rows,statuses?} | ()=>…, embed:true|'routeKey.chartId', embedParams:{code:'1000'}})
//   shareButton(id)                      the trigger button (the delegated [data-share] handler calls openMenu)
//   textFor/linkFor/csvFor/embedFor      pure builders (also used by tests)
//   renderPng(spec,{watermark,pixelRatio}) canvas with title, the figure in view (chart, drawn map or ranked list, else the tables as printed on screen) and source footer, about 1200+ px wide; „ПРИМЕРНИ ДАННИ“ watermark whenever the data is mock
// Rules that never bend: the copied text always carries the source; a mock block is never exported without saying so
// (text line, PNG watermark, CSV status column).
import { html, esc } from './html.js';
import { icon } from './icons.js';
import { data } from './data.js';
import { date, csvCell, num, DASH } from './format.js';
import { statusLabel } from './ui/status.js';
import { srcShort } from './ui/source.js';
import { popover, sheet } from './ui/sheet.js';
import { toast } from './ui/toast.js';

/* ---------------------------------------------------------------- registry */
const registry = new Map();
const resetHooks = new Set();
let curRoute = null;
/** called by the router at the start of every render: clears specs and lets registries (charts…) clear theirs */
export const reset = route => { registry.clear(); curRoute = route || null; resetHooks.forEach(f => { try { f(); } catch (e) { console.error(e); } }); };
export const onReset = fn => { resetHooks.add(fn); return () => resetHooks.delete(fn); };
export const register = (id, spec) => { registry.set(id, { id, route: curRoute?.key || null, ...spec }); return id; };
export const get = id => registry.get(id);
export const all = () => [...registry.entries()];
/** the route row of the screen being drawn (ui/block.js and ui/cards.js use its key for „Намерих грешка“ and embeds) */
export const currentRoute = () => curRoute;

/** mock when flagged, or when the block on screen contains something hatched as mock (a mock chart/table/KPI inside a „real“ block still exports labelled) */
const MOCK_INSIDE = '[data-mock-fig="true"],[data-mock-table="true"],[data-kpi-mock="true"]';
export const isMock = spec => !!(spec && (spec.mock || spec.status === 'mock' || (spec.id && typeof document !== 'undefined' && document.getElementById(spec.id)?.querySelector(MOCK_INSIDE))));
const keysOf = s => (Array.isArray(s) ? s : String(s || '').split(',')).map(x => x.trim()).filter(Boolean);
const val = x => (typeof x === 'function' ? x() : x);

/* Charts and tables register what they can export (a table twin for CSV); blocks find them in their own DOM at share time.
   attach(domId, {table:()=>({columns,rows,statuses?}), chart:true, draw:kit=>({w,h,paint(x,X,Y,pr)})|null}) — cleared with the registry on every navigation.
   `draw` is the picture of a figure that is not an ECharts chart (a map, a ranked list): PNG paints it instead of dumping the table; it sees only what is visible. */
const attached = new Map();
resetHooks.add(() => attached.clear());
export const attach = (id, o) => { attached.set(id, o); return id; };
const blockEl = spec => (spec.id ? document.getElementById(spec.id) : null);
/** inside a closed <details> (its summary stays in view): Chromium still gives such content boxes, so getClientRects() alone says "visible" */
const closedIn = n => { for (let d = n.closest('details'); d; d = d.parentElement?.closest('details')) if (!d.open && !d.querySelector(':scope > summary')?.contains(n)) return true; return false; };
/** really in view on the screen: has boxes and is not inside a closed disclosure */
const shown = n => n.getClientRects().length > 0 && !closedIn(n);
function attachments(spec) {
  const root = blockEl(spec);
  if (!root) return [];
  return [...root.querySelectorAll('[data-attach]')].map(n => ({ el: n, vis: n.getClientRects().length > 0, on: shown(n), ...attached.get(n.dataset.attach) })).filter(a => a.table || a.chart || a.draw).sort((x, y) => y.vis - x.vis);
}
const tableOf = spec => {
  const t = val(spec.table) ?? attachments(spec).find(a => a.table)?.table();
  return t && Array.isArray(t.columns) && Array.isArray(t.rows) ? t : null;
};
/** the chart container to turn into a PNG: spec.chart (dom id) when visible, or the first drawn, visible chart inside the block; chart:false disables */
const chartEl = spec => {
  if (spec.chart === false) return null;
  if (spec.chart) { const e = document.getElementById(spec.chart); return e && e.getClientRects().length ? e : null; }   // a hidden chart has no picture
  const root = blockEl(spec);
  const cs = root ? [...root.querySelectorAll('.chart[data-ready="1"]')].filter(c => c.offsetParent !== null) : [];
  return cs.find(c => !closedIn(c)) || cs[0] || null;       // a chart in view first; one inside a closed disclosure only when no other is drawn
};
const hasChart = spec => { const el = chartEl(spec); return !!(el && window.echarts?.getInstanceByDom(el)); };
/** the picture a visible figure of this block paints for itself (map, ranked list), else null */
const drawOf = spec => attachments(spec).find(a => a.draw && a.on)?.draw || null;
/** the text of an element as read on screen (no icons, no screen-reader-only parts; no-break spaces kept) */
const textOf = n => { const c = n.cloneNode(true); c.querySelectorAll('.sr-only,svg').forEach(e => e.remove()); return c.textContent.replace(/[ \t\r\n\f]+/g, ' ').trim(); };
/** the tables a PNG prints, each with the title of its disclosure: those in view (open disclosures count), none in view: all of the block's, else its own */
function pngTables(spec) {
  const ok = t => t && Array.isArray(t.columns) && Array.isArray(t.rows);
  const tabs = attachments(spec).filter(a => a.table && a.vis), seen = tabs.filter(a => a.on);
  const out = (seen.length ? seen : tabs).map(a => {
    const sum = a.el.closest('details')?.querySelector(':scope > summary'), tt = sum && !sum.contains(a.el) ? sum.querySelector('.disc-title') || sum : null, mt = tt && sum.querySelector('.disc-meta');
    return { t: a.table(), text: tt ? textOf(tt) : '', meta: mt ? textOf(mt) : '' };
  }).filter(o => ok(o.t));
  const own = tableOf(spec);
  return out.length ? out : ok(own) ? [{ t: own, text: '', meta: '' }] : [];
}
const canPng = spec => hasChart(spec) || !!drawOf(spec) || !!tableOf(spec);

/** trigger button for a block header */
export const shareButton = (id, o = {}) => html`<button type="button" class="btn btn-sm btn-quiet share-btn" data-share="${id}" aria-haspopup="dialog" aria-expanded="false">${icon('share', { size: 16 })}<span>${o.label || 'Сподели'}</span></button>`;

/* ---------------------------------------------------------------- builders */
/** link to this block on the current screen (keeps ?per= and the other state, adds ?to=<block>) */
export function linkFor(spec) {
  const u = new URL(location.href);
  const [path, qs = ''] = (location.hash.replace(/^#/, '') || '/').split('?');
  const q = new URLSearchParams(qs);
  q.delete('demo');
  if (spec?.id) q.set('to', spec.id);
  u.hash = '#' + path + (q.toString() ? '?' + q : '');
  return u.href;
}
export function sourceLine(spec) {
  const ks = keysOf(spec.source);
  if (!ks.length) return '';
  return `Източник: ${ks.map(srcShort).join('; ')}${spec.asOf ? ` (към ${date(spec.asOf)})` : ''}.`;
}
/** the text that „Копирай текст“ puts on the clipboard: claim, source, status, link */
export function textFor(spec) {
  const lines = [];
  if (isMock(spec)) lines.push('ПРИМЕРНИ ДАННИ: стойностите са измислени, не ги цитирай.');
  lines.push(spec.title);
  const body = val(spec.text);
  if (body) lines.push(body);
  const src = sourceLine(spec);
  if (src) lines.push(src);
  if (spec.status && spec.status !== 'real' && spec.status !== 'mock') lines.push(`Статус на данните: ${statusLabel(spec.status)}.`);
  lines.push(linkFor(spec));
  return lines.join('\n');
}
const csvVal = v => (v == null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v).replace('.', ',') : '') : String(v).replace(/\s*[\r\n]+\s*/g, ' '));   // a cell is one line: a break inside a cell breaks row-by-row tools
/** CSV: UTF-8 BOM, ";" separator, decimal comma, CRLF; last two columns are „статус“ and „източник“ */
export function csvFor(spec) {
  const t = tableOf(spec);
  if (!t) return '';
  const src = keysOf(spec.source).map(srcShort).join('; ');
  const st = i => statusLabel(t.statuses?.[i] || spec.status || (isMock(spec) ? 'mock' : 'real'));
  const lines = [[...t.columns, 'статус', 'източник'].map(c => csvCell(csvVal(c))).join(';')];
  t.rows.forEach((r, i) => lines.push([...r.map(csvVal), st(i), src].map(csvCell).join(';')));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
/** hash of the embed view (S29): #/embed/<routeKey>.<chartId>[?per=…&<spec.embedParams>]
 *  embedParams = the host screen's own address parameters ({code:'1000'} for #/vedomstvo/1000): S29 hands them back to the screen as its params.
 *  Keys are plain names (never per/demo), values primitives. */
export function embedHash(spec) {
  const e = spec.embed, pre = spec.route || 'embed';
  const key = e === true ? `${pre}.${spec.chart || spec.id}` : typeof e === 'string' && e ? (e.includes('.') ? e : `${pre}.${e}`) : '';
  if (!key) return '';
  const q = new URLSearchParams();
  const per = new URLSearchParams((location.hash.split('?')[1] || '')).get('per');
  if (per) q.set('per', per);
  for (const [k, v] of Object.entries(spec.embedParams || {})) {
    if (/^[A-Za-z][\w-]*$/.test(k) && k !== 'per' && k !== 'demo' && v != null && v !== '' && typeof v !== 'object') q.set(k, String(v));
  }
  const qs = q.toString();
  return `#/embed/${key}${qs ? '?' + qs : ''}`;
}
/** iframe code for the embed view (S29) */
export function embedFor(spec) {
  const h = embedHash(spec);
  if (!h) return '';
  const u = new URL(location.href);
  u.hash = h;
  return `<iframe src="${esc(u.href)}" title="${esc(spec.title)}" width="720" height="440" loading="lazy" style="border:0;max-width:100%" referrerpolicy="no-referrer"></iframe>`;
}

/* ---------------------------------------------------------------- clipboard and downloads */
export async function copyText(t) {
  const pol = document.permissionsPolicy || document.featurePolicy;
  const allowed = !pol || typeof pol.allowsFeature !== 'function' || pol.allowsFeature('clipboard-write');
  try { if (allowed && navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; } } catch { /* denied: fall back */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    return ok;
  } catch { return false; }
}
/** copy; when the browser refuses, show the text in a sheet to copy by hand */
export async function copyOrShow(text, doneMsg, title = 'Копирай ръчно', returnFocus) {
  if (await copyText(text)) { toast(doneMsg); return true; }
  sheet.open({
    title, returnFocus,
    body: html`<p class="small muted">Браузърът не позволи автоматично копиране. Маркирай текста и натисни Ctrl+C (⌘C на Mac).</p><textarea class="sheet-text" readonly rows="6">${text}</textarea>`
  });
  const ta = document.querySelector('dialog.sheet textarea');
  if (ta) { ta.focus(); ta.select(); }
  return false;
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.hidden = true;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const fileName = (spec, ext) => `bns-${[spec.route, spec.id].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}.${ext}`;

/* ---------------------------------------------------------------- PNG */
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
async function fonts() {
  try { await Promise.all([document.fonts.load('700 22px "Sofia Sans Condensed"'), document.fonts.load('400 13px "Sofia Sans"'), document.fonts.load('700 13px "Sofia Sans"')]); } catch { /* system fonts are fine */ }
}
const FB = '"Sofia Sans",system-ui,sans-serif', FD = '"Sofia Sans Condensed","Sofia Sans",system-ui,sans-serif';
/** off-screen canvas that sits in the page with lang="bg" while text is drawn, so every browser shapes the Bulgarian letterforms as the page does */
function pageCanvas() {
  const c = document.createElement('canvas');
  c.lang = 'bg'; c.setAttribute('aria-hidden', 'true');
  c.style.cssText = 'position:fixed;left:-20000px;top:0;width:1px;height:1px;pointer-events:none';
  document.body.appendChild(c);
  return c;
}
function ctxOf(c) {
  const x = c.getContext('2d');
  try { x.lang = 'bg'; } catch { /* engines without ctx.lang use the canvas element's lang */ }
  x.textBaseline = 'top';
  return x;
}
/** line breaks only at plain spaces (no-break spaces keep a number whole); a word wider than the line is split by characters, never cut off */
function wrapLines(x, txt, font, maxW) {
  x.font = font;
  const wd = s => x.measureText(s).width, out = [];
  let line = '';
  for (let word of String(txt).split(/[ \t\r\n]+/)) {
    if (!word) continue;
    const t = line ? line + ' ' + word : word;
    if (wd(t) <= maxW) { line = t; continue; }
    if (line) out.push(line);
    while (word.length > 1 && wd(word) > maxW) {
      let k = word.length - 1;
      while (k > 1 && wd(word.slice(0, k)) > maxW) k--;
      const at = Math.max(...[...'-/.,;:'].map(ch => word.lastIndexOf(ch, k - 1)));   // prefer to break after punctuation
      if (at >= k / 2) k = at + 1;
      out.push(word.slice(0, k)); word = word.slice(k);
    }
    line = word;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
function fit(x, text, w) {
  let s = String(text);
  if (x.measureText(s).width <= w) return s;
  while (s.length > 1 && x.measureText(s + '…').width > w) s = s.slice(0, -1);
  return s + '…';
}
/** the narrowest width (lo..hi) at which the text still wraps into at most `lines` lines */
function narrowest(x, txt, font, lines, lo, hi) {
  if (wrapLines(x, txt, font, lo).length <= lines) return lo;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (wrapLines(x, txt, font, m).length <= lines) hi = m; else lo = m; }
  return hi;
}
/** diagonal „ПРИМЕРНИ ДАННИ“ tiles over the whole image */
function drawWatermark(x, W, H, fam) {
  x.save();
  x.globalAlpha = 0.16; x.fillStyle = cssv('--st-mock') || '#8A3F6B'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `700 34px ${fam}`;
  x.translate(W / 2, H / 2); x.rotate(-Math.PI / 7);
  const stepX = 330, stepY = 120, span = Math.hypot(W, H);
  for (let r = 0, y = -span; y < span; y += stepY, r++) for (let px = -span + (r % 2 ? stepX / 2 : 0); px < span; px += stepX) x.fillText('ПРИМЕРНИ ДАННИ', px, y);
  x.restore();
}
/** path of a rounded rectangle (fill, stroke or clip it) */
function rrect(x, X, Y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
}
/** 45deg stripes like repeating-linear-gradient(45deg, col 0 th, transparent th per): the mock hatch of bars and swatches (clip first) */
function stripes(x, X, Y, w, h, col, th = 2, per = 6) {
  x.save(); x.strokeStyle = col; x.lineWidth = th; x.beginPath();
  for (let o = -h; o < w + h; o += per * Math.SQRT2) { x.moveTo(X + o, Y); x.lineTo(X + o + h, Y + h); }
  x.stroke(); x.restore();
}
/** what a figure's draw(kit) gets: a context to measure with, the site fonts and colours, text wrapping and two drawing helpers */
const kitOf = (x, spec) => ({ x, spec, FB, FD, cssv, loadImg, rrect, stripes, wrap: (txt, font, w) => wrapLines(x, txt, font, w) });
/* Tables are measured first and drawn second: natural column widths, text wrapped (never cut off), numbers right-aligned, a bold total row.
   A table from ui/table.js brings what the screen prints (`heads`, `shown`, `aligns`, `total`); a raw {columns, rows} table gets the site's number format. */
const TB = { fs: 14, hfs: 13, sfs: 12.5, slh: 16, lh: 18, py: 6, px: 10, minInner: 520, maxInner: 1360, capFirst: 360, capText: 300, rows: 40, shown: 36, maxLines: 10, gap: 22 };
/** the fewest decimals (0..2) that show every number of a column exactly; long fractions print like the screen: one decimal, two below 10 */
function fewestDecimals(vals) {
  const v = vals.filter(n => typeof n === 'number' && Number.isFinite(n));
  const d = [0, 1, 2].find(k => v.every(n => Math.abs(n - Number(n.toFixed(k))) < 1e-9 * Math.max(1, Math.abs(n))));
  return d ?? (Math.max(0, ...v.map(Math.abs)) >= 10 ? 1 : 2);
}
function shownTable(t) {
  const head = (t.heads || t.columns).map(c => String(c ?? '').replace(/\s*\n+\s*/g, ' ').replace(/ (?=[€%]$)/, '\u00a0'));   // a unit sign never wraps alone
  const dec = head.map((_, j) => fewestDecimals(t.rows.map(r => r[j])));
  const text = (v, j) => (v == null || v === '' ? DASH : typeof v === 'number' ? num(v, dec[j]) : /^\d{4}-\d\d-\d\d$/.test(v) ? date(v) : String(v).replace(/\s*[\r\n]+\s*/g, ' '));
  return {
    head,
    aligns: t.aligns || head.map((_, j) => (t.rows.some(r => typeof r[j] === 'number') ? 'end' : 'start')),
    shown: t.shown || t.rows.map(r => head.map((_, j) => text(r[j], j))),
    total: t.total || null
  };
}
/** measures the table (column widths, wrapped lines, row heights) and returns {inner, h, draw(x, X, Y)}; the picture is as wide as the content needs, 560..1400 px.
 *  A cell is its label plus muted sub-lines (line breaks in the shown text), like the <small> under a name or a number on screen. */
function layoutTable(x, t, minInner = TB.minInner) {
  const { head, aligns, shown, total } = shownTable(t);
  const body = shown.length > TB.rows ? shown.slice(0, TB.shown) : shown, more = shown.length - body.length;
  const fB = `400 ${TB.fs}px ${FB}`, fT = `700 ${TB.fs}px ${FB}`, fH = `700 ${TB.hfs}px ${FB}`, fS = `400 ${TB.sfs}px ${FB}`, cp = TB.px * 2;
  const fOf = j => (j === 0 ? fT : fB);                              // the row label is bold, like the row header on screen
  const wid = (s, f) => { x.font = f; return x.measureText(s).width; };
  const words = (s, f) => Math.max(0, ...s.split(' ').map(wd => wid(wd, f)));
  const parts = (s, f) => String(s).split('\n').map((p, i) => [p, i ? fS : f]);
  const cols = head.map((h, j) => {
    const cells = [...body.map(r => parts(r[j], fOf(j))), ...(total ? [parts(total[j], fT)] : [])].flat();
    const end = aligns[j] === 'end';
    const nat = Math.max(0, ...cells.map(([s, f]) => wid(s, f))) + cp;
    const tok = Math.max(0, ...cells.map(([s, f]) => words(s, f))) + cp;
    const h1 = wid(h, fH), hw = words(h, fH);
    const h2 = narrowest(x, h, fH, 2, hw, h1) + cp, h3 = narrowest(x, h, fH, 3, hw, h1) + cp;      // header on 2 lines is preferred, 3 is the limit
    const need2 = j === 0 ? Math.max(0, ...cells.map(([s, f]) => narrowest(x, s, f, 2, words(s, f), wid(s, f)))) + cp : 0;   // row labels: 2 lines at most
    const lb = Math.max(tok, h3, need2);
    return { end, lb, pref: Math.max(end ? nat : Math.min(nat, Math.max(j === 0 ? TB.capFirst : TB.capText, need2)), h2, lb) };
  });
  const sumPref = cols.reduce((a, c) => a + c.pref, 0), sumLb = cols.reduce((a, c) => a + c.lb, 0);
  const inner = Math.min(TB.maxInner, Math.max(minInner, Math.round(sumPref)));
  let w;
  if (sumPref <= inner) {                                            // spare room goes to the text columns
    const grow = cols.map(c => (c.end ? 0 : c.pref)), gs = grow.reduce((a, b) => a + b, 0);
    w = cols.map((c, j) => c.pref + (gs ? ((inner - sumPref) * grow[j]) / gs : j === 0 ? inner - sumPref : 0));
  } else {                                                           // too wide: columns give up room down to their minimum
    const give = cols.map(c => c.pref - c.lb), gs = give.reduce((a, b) => a + b, 0), need = sumPref - inner;
    w = gs >= need ? cols.map((c, j) => c.pref - (need * give[j]) / gs) : cols.map(c => (c.lb * inner) / sumLb);
  }
  w = w.map(Math.floor);
  if (w.length) w[w.indexOf(Math.max(...w))] += inner - w.reduce((a, b) => a + b, 0);
  const lines = (s, f, j, cap) => {
    const ls = wrapLines(x, s, f, w[j] - cp);
    if (ls.length <= cap) return ls;
    x.font = f;                                                      // last resort only: more lines than the cap
    return [...ls.slice(0, cap - 1), fit(x, ls.slice(cap - 1).join(' '), w[j] - cp)];
  };
  const cellOf = (s, f, j, cap) => {                                 // [{l: text, f: font, y: offset, sub}] with .h = height
    const out = []; let y = 0;
    parts(s, f).forEach(([p, ft], i) => {
      if (i && out.length) y += 2;
      lines(p, ft, j, i ? 3 : cap).forEach(l => { out.push({ l, f: ft, y, sub: i > 0 }); y += i ? TB.slh : TB.lh; });
    });
    out.h = y;
    return out;
  };
  const hl = head.map((h, j) => cellOf(h, fH, j, 3));
  const bl = body.map(r => r.map((s, j) => cellOf(s, fOf(j), j, TB.maxLines)));
  const tl = total ? total.map((s, j) => cellOf(s, fT, j, TB.maxLines)) : null;
  const rowH = r => Math.max(TB.lh, ...r.map(c => c.h)) + TB.py * 2, hMax = Math.max(TB.lh, ...hl.map(c => c.h));
  const headH = rowH(hl), noteH = (more ? 26 : 0) + (body.length ? 0 : 30);
  const h = headH + 2 + bl.reduce((a, r) => a + rowH(r), 0) + noteH + (tl ? 2 + rowH(tl) : 0);
  const draw = (x, X, Y) => {
    const xs = []; let a = X; w.forEach(cw => { xs.push(a); a += cw; });
    const ink = cssv('--ink'), muted = cssv('--muted'), line = cssv('--line'), strong = cssv('--line-strong'), sunk = cssv('--sunk');
    const put = (cell, j, y, col, dy = 0) => {
      x.textAlign = cols[j].end ? 'right' : 'left';
      const tx = cols[j].end ? xs[j] + w[j] - TB.px : xs[j] + TB.px;
      cell.forEach(o => { x.font = o.f; x.fillStyle = o.sub ? muted : col; x.fillText(o.l, tx, y + TB.py + dy + o.y); });
    };
    let y = Y;
    x.fillStyle = sunk; x.fillRect(X, y, inner, headH);
    hl.forEach((c, j) => put(c, j, y, muted, hMax - c.h));           // headers sit on the rule
    y += headH; x.fillStyle = strong; x.fillRect(X, y, inner, 2); y += 2;
    bl.forEach((r, i) => {
      r.forEach((c, j) => put(c, j, y, ink));
      y += rowH(r);
      if (!(tl && !more && i === bl.length - 1)) { x.fillStyle = line; x.fillRect(X, y - 1, inner, 1); }
    });
    x.textAlign = 'left'; x.fillStyle = muted; x.font = `400 13px ${FB}`;
    if (!body.length) { x.fillText('Няма редове за показване.', X + TB.px, y + 8); y += 30; }
    if (more) { x.fillText(`… и още ${more} реда в CSV файла`, X + TB.px, y + 6); y += 26; }
    if (tl) {
      x.fillStyle = strong; x.fillRect(X, y, inner, 2); y += 2;
      x.fillStyle = sunk; x.fillRect(X, y, inner, rowH(tl));
      tl.forEach((c, j) => put(c, j, y, ink));
    }
  };
  return { inner, h, draw };
}
/** the title above a table: the disclosure's title in bold, its meta line (count, total) muted below */
function layoutHead(x, o, w) {
  const tl = wrapLines(x, o.text, `700 16px ${FB}`, w), ml = o.meta ? wrapLines(x, o.meta, `400 13px ${FB}`, w) : [];
  const h = tl.length * 21 + (ml.length ? 2 + ml.length * 17 : 0);
  return { h, draw: (x, X, Y) => {
    x.textAlign = 'left'; x.fillStyle = cssv('--ink'); x.font = `700 16px ${FB}`; tl.forEach((l, i) => x.fillText(l, X, Y + i * 21));
    x.fillStyle = cssv('--muted'); x.font = `400 13px ${FB}`; ml.forEach((l, i) => x.fillText(l, X, Y + tl.length * 21 + 2 + i * 17));
  } };
}
/** one or more tables one under the other, all as wide as the widest; a titled one gets its disclosure's title above it. One untitled table is laid out exactly as layoutTable does. */
function layoutStack(x, items) {
  const first = items.map(o => layoutTable(x, o.t)), inner = Math.max(...first.map(l => l.inner));
  const parts = items.map((o, i) => ({ tb: first[i].inner === inner ? first[i] : layoutTable(x, o.t, inner), hd: o.text ? layoutHead(x, o, inner) : null }));
  const h = parts.reduce((a, p, i) => a + (i ? TB.gap : 0) + (p.hd ? p.hd.h + 8 : 0) + p.tb.h, 0);
  const draw = (x, X, Y) => { let y = Y; parts.forEach((p, i) => { if (i) y += TB.gap; if (p.hd) { p.hd.draw(x, X, y); y += p.hd.h + 8; } p.tb.draw(x, X, y); y += p.tb.h; }); };
  return { inner, h, draw };
}
/** device pixels per drawn pixel: at least 2, more for narrow pictures so every PNG is about 1200 px wide (whole numbers for chart images, which are not resampled), never past ~16 million pixels */
function pngRatio(W, H, whole) {
  let r = Math.min(4, Math.max(2, 1200 / W));
  if (whole) r = Math.ceil(r - 1e-9);
  const cap = Math.sqrt(16e6 / (W * H));
  return r > cap ? Math.max(1, whole ? Math.floor(cap) : cap) : r;
}
/**
 * Composes the picture: title, subtitle, chart (or table), source footer.
 * watermark defaults to „is this block mock?“; the checker calls renderPng(spec,{watermark:false}) to prove the pixels differ.
 * pixelRatio defaults to „sharp enough to be about 1200 px wide“; the checker passes 1.
 */
export async function renderPng(spec, { watermark = isMock(spec), pixelRatio } = {}) {
  await fonts();
  const { chartImage } = await import('./charts.js');
  const el = chartEl(spec);
  const inst = el && window.echarts?.getInstanceByDom(el);
  const dr = inst ? null : drawOf(spec);
  const ts = inst ? [] : pngTables(spec);                    // also what a figure falls back to when it cannot paint itself
  if (!inst && !dr && !ts.length) throw new Error('няма какво да се нарисува');
  const cv = pageCanvas();
  try {
    let x = ctxOf(cv), pic = null, kind = 'table';
    if (inst) {                                              // ECharts: its own canvas image
      const cw = Math.round(el.clientWidth), ch = Math.round(el.clientHeight);
      pic = { w: cw, h: ch, whole: true, paint: async (c, X, Y, r) => c.drawImage(await loadImg(chartImage(inst, el, { pixelRatio: r }).url), X, Y, cw, ch) };
      kind = 'chart';
    } else if (dr) {
      try { pic = await dr(kitOf(x, spec)); if (pic) kind = 'draw'; } catch (e) { console.error(e); pic = null; }
    }
    if (!pic && ts.length) { const tb = layoutStack(x, ts); pic = { w: tb.inner, h: tb.h, paint: tb.draw }; }
    if (!pic) throw new Error('няма какво да се нарисува');
    const { w, h } = pic;
    const pad = 20, W = Math.max(w || 560, 320) + pad * 2, maxW = W - pad * 2;
    const tl = wrapLines(x, spec.title || '', `700 22px ${FD}`, maxW);
    const sl = spec.sub ? wrapLines(x, spec.sub, `400 13px ${FB}`, maxW) : [];
    const src = sourceLine(spec);
    const fl = [...(isMock(spec) ? wrapLines(x, 'Примерни данни: измислени стойности, не са истински.', `700 12px ${FB}`, maxW) : []), ...(src ? wrapLines(x, src, `400 12px ${FB}`, maxW) : []), ...wrapLines(x, 'Бюджет на светло · прототип', `400 12px ${FB}`, maxW)];
    const H = pad + tl.length * 26 + (sl.length ? 4 + sl.length * 18 : 0) + 12 + h + 14 + fl.length * 17 + pad;
    const pr = pixelRatio ?? pngRatio(W, H, !!pic.whole);
    cv.width = Math.round(W * pr); cv.height = Math.round(H * pr);
    x = ctxOf(cv);
    x.scale(pr, pr);
    x.fillStyle = cssv('--surface'); x.fillRect(0, 0, W, H);
    let y = pad;
    x.fillStyle = cssv('--ink'); x.font = `700 22px ${FD}`; tl.forEach(l => { x.fillText(l, pad, y); y += 26; });
    if (sl.length) { y += 4; x.fillStyle = cssv('--muted'); x.font = `400 13px ${FB}`; sl.forEach(l => { x.fillText(l, pad, y); y += 18; }); }
    y += 12;
    x.save(); await pic.paint(x, pad, y, pr); x.restore();
    y += h + 14;
    fl.forEach(l => { const mockLine = l.startsWith('Примерни данни'); x.fillStyle = mockLine ? cssv('--st-mock') : cssv('--muted'); x.font = `${mockLine ? 700 : 400} 12px ${FB}`; x.textAlign = 'left'; x.fillText(l, pad, y); y += 17; });
    if (watermark) drawWatermark(x, W, H, FD);
    cv.dataset.kind = kind; cv.dataset.tables = String(kind === 'table' ? ts.length : 0);   // what the picture is made of: 'chart' | 'draw' | 'table' and how many tables (tests)
    return cv;
  } finally { cv.remove(); }
}
/** test helper: how many pixels differ between the PNG with and without the watermark */
export async function pngDiff(spec) {
  const [a, b] = [await renderPng(spec, { watermark: true, pixelRatio: 1 }), await renderPng(spec, { watermark: false, pixelRatio: 1 })];
  if (a.width !== b.width || a.height !== b.height) return { w: a.width, h: a.height, diff: -1 };
  const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
  let diff = 0;
  for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) diff++;
  return { w: a.width, h: a.height, diff, mock: isMock(spec) };
}

/* ---------------------------------------------------------------- the menu */
function menuItems(spec) {
  const items = [
    { act: 'copy-text', ic: 'copy', label: 'Копирай текст', desc: 'Числото, източникът и връзката.' },
    { act: 'copy-link', ic: 'link', label: 'Копирай връзка', desc: 'Връзка, която отваря точно този блок.' }
  ];
  if (canPng(spec)) items.push({ act: 'png', ic: 'image', label: 'Изтегли PNG', desc: isMock(spec) ? 'Картинка с воден знак „примерни данни“.' : 'Картинка със заглавие и източник.' });
  if (tableOf(spec)) items.push({ act: 'csv', ic: 'table', label: 'Изтегли CSV', desc: 'За Excel; с колони „статус“ и „източник“.' });
  if (spec.embed) items.push({ act: 'embed', ic: 'code', label: 'Код за вграждане', desc: 'HTML за друг уебсайт.' });
  if (typeof navigator.share === 'function') items.push({ act: 'share', ic: 'share', label: 'Сподели…', desc: 'През приложение на устройството.' });
  return items;
}
async function run(act, spec, anchor) {
  try {
    if (act === 'copy-text') await copyOrShow(textFor(spec), 'Копирано: текст с числото и източника.', 'Копирай ръчно', anchor);
    else if (act === 'copy-link') await copyOrShow(linkFor(spec), 'Връзката е копирана.', 'Копирай ръчно', anchor);
    else if (act === 'csv') { download(new Blob([csvFor(spec)], { type: 'text/csv;charset=utf-8' }), fileName(spec, 'csv')); toast('CSV файлът се изтегля.'); }
    else if (act === 'png') {
      toast('Подготвям картинката…');
      const c = await renderPng(spec);
      await new Promise((ok, no) => c.toBlob(b => { if (!b) return no(new Error('toBlob')); download(b, fileName(spec, 'png')); ok(); }, 'image/png'));
      toast(isMock(spec) ? 'PNG е изтеглен, с воден знак „примерни данни“.' : 'PNG е изтеглен.');
    } else if (act === 'embed') {
      const code = embedFor(spec);
      sheet.open({
        title: 'Код за вграждане', returnFocus: anchor,
        body: html`<p class="small muted">Постави този код в HTML на друга страница. Графиката се показва с източника си${isMock(spec) ? ' и с белег „примерни данни“' : ''}.</p><textarea class="sheet-text" readonly rows="5" data-embed-code>${code}</textarea><p class="state-act"><button type="button" class="btn btn-primary" data-copy-embed>Копирай кода</button> <a class="btn" href="${embedHash(spec)}">Виж вградения изглед</a></p>`
      });
      const dlg = document.querySelector('dialog.sheet');
      dlg?.querySelector('[data-copy-embed]')?.addEventListener('click', () => copyOrShow(code, 'Кодът е копиран.', 'Копирай ръчно'));
      dlg?.querySelector('textarea')?.select();
    } else if (act === 'share') {
      await navigator.share({ title: spec.title, text: val(spec.text) || spec.title, url: linkFor(spec) });
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
    console.error(e);
    toast('Не успяхме. Опитай пак или копирай текста.', { kind: 'bad' });
  }
}
export function openMenu(anchor, id) {
  const spec = get(id);
  if (!spec) { toast('Този блок не може да се споделя.'); return null; }
  const body = html`<ul class="share-menu">${menuItems(spec).map(i => html`<li><button type="button" class="share-item" data-act="${i.act}">${icon(i.ic, { size: 20 })}<span class="share-txt"><span class="share-label">${i.label}</span><span class="share-desc">${i.desc}</span></span></button></li>`)}</ul>${isMock(spec) ? html`<p class="small muted share-note">Този блок е с примерни данни: във всичко, което споделяш, пише „примерни данни“.</p>` : ''}`;
  const pop = popover.open(anchor, { title: 'Сподели', body, label: 'Споделяне', align: 'end' });
  pop.el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    pop.close();
    run(act, spec, anchor);
  });
  return pop;
}
