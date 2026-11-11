// Tiny escaping template tag. Everything interpolated is escaped unless it is already SafeHtml.
// Rule for page authors: ALWAYS put attribute values in double quotes: <a href="${url}">.
export class SafeHtml {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
export const raw = (s) => (s instanceof SafeHtml ? s : new SafeHtml(String(s ?? '')));
function flat(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) {
    let o = '';
    for (const x of v) o += flat(x);
    return o;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) {
    console.error('[html] non-finite number rendered as a dash');
    return '—';
  }
  return esc(v);
}
export function html(strings, ...vals) {
  let o = strings[0];
  for (let i = 0; i < vals.length; i++) o += flat(vals[i]) + strings[i + 1];
  return new SafeHtml(o);
}
/** class list helper: cx('a', cond && 'b', {c: true}) */
export const cx = (...a) =>
  a
    .flatMap((x) => (x && typeof x === 'object' ? Object.keys(x).filter((k) => x[k]) : [x]))
    .filter(Boolean)
    .join(' ');
/** attribute helper: attrs({id:'x', hidden:true, 'data-a':1}) -> SafeHtml ' id="x" hidden data-a="1"' (false/null skipped) */
export const attrs = (o) =>
  raw(
    Object.entries(o || {})
      .filter(([, v]) => v !== false && v != null)
      .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
      .join(''),
  );
/** slug used for ids */
export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/g, '-')
    .replace(/^-|-$/g, '');
let uid = 0;
export const nextId = (p = 'id') => `${p}-${++uid}`;
/** plain text of a value that may be SafeHtml (tags dropped, entities decoded): for aria-labels, share text, document titles */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
export const plain = (v) =>
  v instanceof SafeHtml
    ? v.s
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot|#39);/g, (m, c) => ENT[c])
        .replace(/\s+/g, ' ')
        .trim()
    : String(v ?? '');
