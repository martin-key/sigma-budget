// Sharing: registry of shareable blocks + the ONE block menu „Сподели“ (V5: „Изтегли изображение“ and „Копирай връзка“; the table file for experts; „Намерих грешка“).
// A block registers a spec while its screen renders (ui/block.js does this for you); the router clears the registry on every navigation.
//   share.register(id, {title, sub, text, source:['kfp'], asOf, status, mock, chart:'chartDomId', table:{columns,rows,statuses?} | ()=>…, embed:true|'routeKey.chartId', embedParams:{code:'1000'}, report:'#/vrazka?…',
//                       link:{mesec:8,g1:2025,g2:2026}|()=>…   the address parameters that restore the same result (written explicitly, even when they are the defaults),
//                       period:'януари—август'               the period line of the picture (default: the period button of the page)})
//   shareButton(id)                      the trigger button (the delegated [data-share] handler calls openMenu)
//   textFor/linkFor/csvFor/embedFor      pure builders (also used by tests)
//   renderPng(spec,{watermark})          canvas with title, period, the block, source and short link; „ПРИМЕРНИ ДАННИ“ watermark whenever the data is mock
// Rules that never bend: the copied text always carries the source; a mock block is never exported without saying so
// (text line, PNG watermark, CSV status column).
import { scoped, serverScope } from './env.js';
import { html, esc } from './html.js';
import { here, parts as addrParts, absolute } from './loc.js';
import { icon } from './icons.js';
import { data } from './data.js';
import { date, csvCell } from './format.js';
import { SCOPES } from './store.js';
import { statusLabel } from './ui/status.js';
import { srcShort } from './ui/source.js';
import { popover, sheet } from './ui/sheet.js';
import { toast } from './ui/toast.js';

/* ---------------------------------------------------------------- registry */
const own = new Map();
const resetHooks = new Set();
let curRoute = null;
const registryOf = () => scoped('share', own);              // the server draws each request into its own registry (js/env.js)
/** called by the router at the start of every render: clears specs and lets registries (charts…) clear theirs. On the server the
 *  request starts with empty maps of its own and only names its screen */
export const reset = route => {
  const sc = serverScope();
  if (sc) { sc.route = route || null; return; }
  own.clear(); curRoute = route || null; resetHooks.forEach(f => { try { f(); } catch (e) { console.error(e); } });
};
export const onReset = fn => { resetHooks.add(fn); return () => resetHooks.delete(fn); };
/** the route row of the screen being drawn (ui/block.js and ui/cards.js use its key for „Намерих грешка“ and embeds) */
export const currentRoute = () => { const sc = serverScope(); return sc ? sc.route || null : curRoute; };
export const register = (id, spec) => { registryOf().set(id, { id, route: currentRoute()?.key || null, ...spec }); return id; };
export const get = id => registryOf().get(id);
export const all = () => [...registryOf().entries()];

/** mock when flagged, or when the block on screen contains something hatched as mock (a mock chart/table/KPI inside a „real“ block still exports labelled) */
const MOCK_INSIDE = '[data-mock-fig="true"],[data-mock-table="true"],[data-kpi-mock="true"]';
export const isMock = spec => !!(spec && (spec.mock || spec.status === 'mock' || (spec.id && typeof document !== 'undefined' && document.getElementById(spec.id)?.querySelector(MOCK_INSIDE))));
const keysOf = s => (Array.isArray(s) ? s : String(s || '').split(',')).map(x => x.trim()).filter(Boolean);
const val = x => (typeof x === 'function' ? x() : x);

/* Charts and tables register what they can export (a table twin for CSV); blocks find them in their own DOM at share time.
   attach(domId, {table:()=>({columns,rows,statuses?}), chart:true}) — cleared with the registry on every navigation. */
const ownAttached = new Map();
const attachedOf = () => scoped('attached', ownAttached);   // one map per server request (js/env.js)
resetHooks.add(() => ownAttached.clear());
export const attach = (id, o) => { attachedOf().set(id, o); return id; };
const blockEl = spec => (spec.id ? document.getElementById(spec.id) : null);
function attachments(spec) {
  const root = blockEl(spec);
  if (!root) return [];
  return [...root.querySelectorAll('[data-attach]')].map(n => ({ el: n, vis: n.getClientRects().length > 0, ...attachedOf().get(n.dataset.attach) })).filter(a => a.table || a.chart).sort((x, y) => y.vis - x.vis);
}
const tableOf = spec => {
  const t = val(spec.table) ?? attachments(spec).find(a => a.table)?.table();
  return t && Array.isArray(t.columns) && Array.isArray(t.rows) ? t : null;
};
/** the chart container to turn into a PNG: spec.chart (dom id), or the first drawn, visible chart inside the block; chart:false disables */
const chartEl = spec => {
  if (spec.chart === false) return null;
  if (spec.chart) return document.getElementById(spec.chart);
  const root = blockEl(spec);
  return root ? [...root.querySelectorAll('.chart[data-ready="1"]')].find(c => c.offsetParent !== null) || null : null;
};
const hasChart = spec => { const el = chartEl(spec); return !!(el && window.echarts?.getInstanceByDom(el)); };
/** what ui/png.js can draw from the DOM: charts, rankings, KPI tiles, progress bars, maps, data tables, the revenue strip, the 5-minute scenes */
export const STAT_SEL = '.chart,.rank,.kpi,.prog,.map-svg,table.data,.s06-strip,.s04-fig,.s18-stat';
export const statNodes = root => (root ? [...root.querySelectorAll(STAT_SEL)].filter(n => !n.closest('details.fig-table')) : []);
const hasStat = spec => { const el = blockEl(spec); return !!(el && statNodes(el).length); };
const canPng = spec => hasChart(spec) || !!tableOf(spec) || hasStat(spec);

/** trigger button for a block header */
export const shareButton = (id, o = {}) => {
  const label = o.label || 'Сподели', t = registryOf().get(id)?.title;
  return html`<button type="button" class="btn btn-sm btn-quiet share-btn" data-share="${id}"${t ? html` aria-label="${label}: ${t}"` : ''} aria-haspopup="dialog" aria-expanded="false">${icon('share', { size: 16 })}<span>${label}</span></button>`;
};

/* ---------------------------------------------------------------- builders */
/** what a link never carries: the visitor's own figures (the calculator keeps its inputs on the screen only) */
const PERSONAL = new Set(['demo', 'brutno', 'bruto', 'zaplata', 'dohod', 'neto', 'sum', 'salary', 'gross']);
/** link to this block on the current screen: keeps the state of the address (?per=, ?g1=…), adds the block's own `link` parameters (the same result on every opening) and ?to=<block> */
export function linkFor(spec, { to = true } = {}) {
  const { path, query: qs } = addrParts(here());
  const q = new URLSearchParams(qs);
  PERSONAL.forEach(k => q.delete(k));
  const own = val(spec?.link);
  if (own && typeof own === 'object') for (const [k, v] of Object.entries(own)) { if (v == null || v === '') q.delete(k); else if (!PERSONAL.has(k)) q.set(k, String(v)); }
  if (to && spec?.id) q.set('to', spec.id); else q.delete('to');
  return absolute(path + (q.toString() ? '?' + q : ''));
}
/** the address printed under a picture: no scheme, no ?to= */
export const shortLink = spec => linkFor(spec, { to: false }).replace(/^https?:\/\//, '');
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
// spreadsheet formula injection (docs/approach-specification.md, section 9.2): a text cell that begins with = + - @, a tab or a carriage
// return (or their full-width forms) gets a leading apostrophe, so a spreadsheet shows it as text and never runs it. Numbers are written as
// numbers (decimal comma) and are not touched: -3,08 stays a number.
export const FORMULA_START = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;
const guard = s => (FORMULA_START.test(s) ? "'" + s : s);
const csvVal = v => (v == null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v).replace('.', ',') : '') : guard(String(v).replace(/\s*[\r\n]+\s*/g, ' ')));   // a cell is one line: a break inside a cell breaks row-by-row tools
/** what every row of a CSV says about itself (section 9.2): the period, the unit, the budget scope and the release of the data. The period
 *  line of a block is „януари—септември 2026 г. · млрд. €“: the part after „ · “ is the unit, unless the block names one */
export function csvMeta(spec) {
  const [per, ...rest] = String(spec.period || '').split(' · ');
  const scope = typeof spec.scope === 'string' ? spec.scope : spec.scope?.key;
  return {
    period: per || (spec.asOf ? `към ${date(spec.asOf)}` : ''),
    unit: spec.unit || rest.join(' · '),
    scope: scope ? SCOPES[scope]?.long || SCOPES[scope]?.label || scope : '',
    release: data.get('releases/current')?.release_id || '',
  };
}
/** CSV: UTF-8 BOM, ";" separator, decimal comma, CRLF; then „период“, „единица“, „обхват“, „издание“; the last two columns are „статус“ and „източник“ */
export function csvFor(spec) {
  const t = tableOf(spec);
  if (!t) return '';
  const src = keysOf(spec.source).map(srcShort).join('; ');
  const st = i => statusLabel(t.statuses?.[i] || spec.status || (isMock(spec) ? 'mock' : 'real'));
  const m = csvMeta(spec);
  const lines = [[...t.columns, 'период', 'единица', 'обхват', 'издание', 'статус', 'източник'].map(c => csvCell(csvVal(c))).join(';')];
  t.rows.forEach((r, i) => lines.push([...r.map(csvVal), ...[m.period, m.unit, m.scope, m.release].map(csvVal), st(i), src].map(csvCell).join(';')));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
/** address of the embed view (S29): /embed/<routeKey>.<chartId>[?per=…&<spec.embedParams>] (internal form, js/loc.js)
 *  embedParams = the host screen's own address parameters ({code:'1000'} for #/vedomstvo/1000): S29 hands them back to the screen as its params.
 *  Keys are plain names (never per/demo), values primitives. */
export function embedHash(spec) {
  const e = spec.embed, pre = spec.route || 'embed';
  const key = e === true ? `${pre}.${spec.chart || spec.id}` : typeof e === 'string' && e ? (e.includes('.') ? e : `${pre}.${e}`) : '';
  if (!key) return '';
  const q = new URLSearchParams();
  const per = new URLSearchParams(addrParts(here()).query).get('per');
  if (per) q.set('per', per);
  for (const [k, v] of Object.entries(spec.embedParams || {})) {
    if (/^[A-Za-z][\w-]*$/.test(k) && k !== 'per' && k !== 'demo' && v != null && v !== '' && typeof v !== 'object') q.set(k, String(v));
  }
  const qs = q.toString();
  return `/embed/${key}${qs ? '?' + qs : ''}`;
}
/** iframe code for the embed view (S29) */
export function embedFor(spec) {
  const h = embedHash(spec);
  if (!h) return '';
  return `<iframe src="${esc(absolute(h))}" title="${esc(spec.title)}" width="720" height="440" loading="lazy" style="border:0;max-width:100%" referrerpolicy="no-referrer"></iframe>`;
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
  try { await document.fonts.ready; } catch { /* system fonts are fine */ }
}
function wrapLines(x, txt, font, maxW) {
  x.font = font;
  const out = []; let line = '';
  for (const wd of String(txt).split(/\s+/)) { const t = line ? line + ' ' + wd : wd; if (line && x.measureText(t).width > maxW) { out.push(line); line = wd; } else line = t; }
  if (line) out.push(line);
  return out;
}
/** like wrapLines, but an address wider than the line is broken at ? & / = # or, last, anywhere */
function wrapLink(x, txt, font, maxW) {
  x.font = font;
  const out = []; let line = '';
  for (const part of String(txt).split(/(?<=[?&/=#])/)) {
    if (x.measureText(line + part).width <= maxW) { line += part; continue; }
    if (line) out.push(line);
    line = '';
    for (const ch of part) { if (line && x.measureText(line + ch).width > maxW) { out.push(line); line = ''; } line += ch; }
  }
  if (line) out.push(line);
  return out;
}
function fit(x, text, w) {
  let s = String(text);
  if (x.measureText(s).width <= w) return s;
  while (s.length > 1 && x.measureText(s + '…').width > w) s = s.slice(0, -1);
  return s + '…';
}
/** diagonal „ПРИМЕРНИ ДАННИ“ tiles over the whole image */
function drawWatermark(x, W, H, fam) {
  x.save();
  x.globalAlpha = 0.16; x.fillStyle = cssv('--st-mock') || '#AC1B18'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `700 34px ${fam}`;
  x.translate(W / 2, H / 2); x.rotate(-Math.PI / 7);
  const stepX = 330, stepY = 120, span = Math.hypot(W, H);
  for (let r = 0, y = -span; y < span; y += stepY, r++) for (let px = -span + (r % 2 ? stepX / 2 : 0); px < span; px += stepX) x.fillText('ПРИМЕРНИ ДАННИ', px, y);
  x.restore();
}
/** a simple table drawn on canvas (for blocks without a chart) */
function drawTable(x, t, W, y, pad, fam) {
  const maxRows = 16, rows = t.rows.slice(0, maxRows), cols = t.columns.length;
  const inner = W - pad * 2;
  x.font = `700 13px ${fam}`;
  const widths = t.columns.map((c, i) => Math.max(x.measureText(c).width, ...rows.map(r => { x.font = `400 13px ${fam}`; return x.measureText(csvVal(r[i])).width; })) + 16);
  const sum = widths.reduce((a, b) => a + b, 0), k = Math.min(1, inner / sum), ws = widths.map(w => w * k);
  const slack = Math.max(0, inner - ws.reduce((a, b) => a + b, 0));
  ws[0] += slack;
  const draw = (cells, bold, yy) => {
    let px = pad;
    cells.forEach((c, i) => { x.font = `${bold ? 700 : 400} 13px ${fam}`; x.textAlign = i === 0 ? 'left' : 'right'; x.fillText(fit(x, c, ws[i] - 12), i === 0 ? px : px + ws[i] - 8, yy); px += ws[i]; });
  };
  x.textBaseline = 'top'; x.fillStyle = cssv('--ink');
  draw(t.columns, true, y);
  y += 22; x.strokeStyle = cssv('--line-strong'); x.beginPath(); x.moveTo(pad, y - 3); x.lineTo(W - pad, y - 3); x.stroke();
  rows.forEach(r => { x.fillStyle = cssv('--ink'); draw(r.map(csvVal), false, y); y += 22; x.strokeStyle = cssv('--line'); x.beginPath(); x.moveTo(pad, y - 3); x.lineTo(W - pad, y - 3); x.stroke(); });
  if (t.rows.length > maxRows) { x.fillStyle = cssv('--muted'); x.textAlign = 'left'; x.font = `400 12px ${fam}`; x.fillText(`… и още ${t.rows.length - maxRows} реда в CSV файла`, pad, y); y += 20; }
  return y;
}
/**
 * Composes the picture: title, subtitle, chart (or table), source footer.
 * watermark defaults to „is this block mock?“; the checker calls renderPng(spec,{watermark:false}) to prove the pixels differ.
 */
export async function renderPng(spec, { watermark = isMock(spec), pixelRatio = 2 } = {}) {
  await import('./ui/motion.js').then(m => m.settle()).catch(() => {});      // V6: a picture shows the final state, never a half-counted number
  await fonts();
  const viaDom = await import('./ui/png.js').then(m => m.canvasFor(spec, { watermark, pixelRatio })).catch(e => { console.error('[png]', e); return null; });
  if (viaDom) return viaDom;
  const { chartImage } = await import('./charts.js');
  const el = chartEl(spec);
  const inst = el && window.echarts?.getInstanceByDom(el);
  const t = tableOf(spec);
  let img = null, w = 0, h = 0;
  if (inst) { const r = chartImage(inst, el, { pixelRatio }); img = await loadImg(r.url); w = r.w; h = r.h; }
  else if (!t) throw new Error('няма какво да се нарисува');
  const fB = 'system-ui,-apple-system,"Segoe UI",Arial,sans-serif', fD = 'Charter,"Iowan Old Style",Georgia,"Times New Roman",serif';   // v4: system stacks
  const pad = 20, W = Math.max(w || 560, 320) + pad * 2, maxW = W - pad * 2;
  const probe = document.createElement('canvas').getContext('2d');
  const tl = wrapLines(probe, spec.title || '', `400 24px ${fD}`, maxW);
  const sl = spec.sub ? wrapLines(probe, spec.sub, `400 13px ${fB}`, maxW) : [];
  const src = sourceLine(spec);
  const lnk = shortLink(spec);
  const fl = [...(isMock(spec) ? wrapLines(probe, 'Примерни данни: измислени стойности, не са истински.', `700 12px ${fB}`, maxW) : []), ...(src ? wrapLines(probe, src, `400 12px ${fB}`, maxW) : []), ...(lnk ? wrapLink(probe, `Връзка: ${lnk}`, `400 12px ${fB}`, maxW) : []), ...wrapLines(probe, 'Бюджет на светло · прототип', `400 12px ${fB}`, maxW)];
  const bodyH = img ? h : 22 * (Math.min(t.rows.length, 16) + 1) + (t.rows.length > 16 ? 20 : 0);
  const H = pad + tl.length * 26 + (sl.length ? 4 + sl.length * 18 : 0) + 12 + bodyH + 14 + fl.length * 17 + pad;
  const c = document.createElement('canvas');
  c.width = Math.round(W * pixelRatio); c.height = Math.round(H * pixelRatio);
  c.lang = 'bg';
  const x = c.getContext('2d');
  if ('lang' in x) x.lang = 'bg';
  x.scale(pixelRatio, pixelRatio); x.textBaseline = 'top';
  x.fillStyle = cssv('--surface'); x.fillRect(0, 0, W, H);
  let y = pad;
  x.fillStyle = cssv('--ink'); x.font = `400 24px ${fD}`; tl.forEach(l => { x.fillText(l, pad, y); y += 26; });
  if (sl.length) { y += 4; x.fillStyle = cssv('--muted'); x.font = `400 13px ${fB}`; sl.forEach(l => { x.fillText(l, pad, y); y += 18; }); }
  y += 12;
  if (img) { x.drawImage(img, pad, y, w, h); y += h; } else y = drawTable(x, t, W, y, pad, fB);
  y += 14;
  fl.forEach(l => { const mockLine = l.startsWith('Примерни данни'); x.fillStyle = mockLine ? cssv('--st-mock') : cssv('--muted'); x.font = `${mockLine ? 700 : 400} 12px ${fB}`; x.textAlign = 'left'; x.fillText(l, pad, y); y += 17; });
  if (watermark) drawWatermark(x, W, H, fD);
  return c;
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
/** the image and the link are the whole menu of a result; the table file is a quiet option for experts; „Намерих грешка“ closes it.
 *  The text copy, the embed code and the device share sheet are not offered (their code stays: S29 and the tests use it). */
function menuItems(spec) {
  const items = [];
  if (canPng(spec)) items.push({ act: 'png', ic: 'image', label: 'Изтегли изображение', desc: isMock(spec) ? 'Картинка с воден знак „примерни данни“.' : 'Заглавие, период, източник и връзка.' });
  items.push({ act: 'copy-link', ic: 'link', label: 'Копирай връзка', desc: 'Отваря същия резултат.' });
  if (tableOf(spec)) items.push({ act: 'csv', ic: 'table', label: 'Таблица за Excel (CSV)', desc: 'За експерти: с колони „статус“ и „източник“.', sep: true });
  if (spec.report) items.push({ act: 'report', ic: 'flag', label: 'Намерих грешка', desc: 'Съобщи за неточност точно в този блок.', href: spec.report, sep: true });
  return items;
}
async function run(act, spec, anchor) {
  try {
    if (act === 'copy-text') await copyOrShow(textFor(spec), 'Копирано: текст с числото и източника.', 'Копирай ръчно', anchor);
    else if (act === 'copy-link') await copyOrShow(linkFor(spec), 'Връзката е копирана.', 'Копирай ръчно', anchor);
    else if (act === 'csv') { download(new Blob([csvFor(spec)], { type: 'text/csv;charset=utf-8' }), fileName(spec, 'csv')); toast('CSV файлът се изтегля.'); }
    else if (act === 'png') {
      toast('Подготвям изображението…');
      const c = await renderPng(spec);
      await new Promise((ok, no) => c.toBlob(b => { if (!b) return no(new Error('toBlob')); download(b, fileName(spec, 'png')); ok(); }, 'image/png'));
      toast(isMock(spec) ? 'Изображението е изтеглено, с воден знак „примерни данни“.' : 'Изображението е изтеглено.');
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
  const inner = i => html`${icon(i.ic, { size: 20 })}<span class="share-txt"><span class="share-label">${i.label}</span><span class="share-desc">${i.desc}</span></span>`;
  const body = html`<ul class="share-menu">${menuItems(spec).map(i => html`<li${i.sep ? html` class="share-sep"` : ''}>${i.href ? html`<a class="share-item" href="${i.href}" data-act="${i.act}">${inner(i)}</a>` : html`<button type="button" class="share-item" data-act="${i.act}">${inner(i)}</button>`}</li>`)}</ul>${isMock(spec) ? html`<p class="small muted share-note">Този блок е с примерни данни: във всичко, което споделяш, пише „примерни данни“.</p>` : ''}`;
  const pop = popover.open(anchor, { title: 'Сподели', body, label: 'Споделяне', align: 'end' });
  pop.el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'report') return;                      // a real link: the popover closes itself and the router opens the form for this block
    pop.close();
    run(act, spec, anchor);
  });
  return pop;
}
/** for ui/png.js: the loose „PNG“ buttons (blocks without the menu) run the same download as the menu item */
export { fileName, run as runAct, drawWatermark, wrapLines, wrapLink };
