// Catalogue helpers shared by S24 „Откъде са данните?“ and S25 „Отворени данни и API“ (written by G5). Pure: no DOM, no render state; the only fetch is loadMeta, and it goes through data.load.
// Input: data/catalog.json (DATA_SPEC §3.20, built by pipeline/budget_pipeline/build/catalog.py). Every optional field may be missing: a thinner or older catalogue
// still gives a usable model, and a malformed entry is dropped instead of breaking the page.
//   model(cat, sources?)      -> M    the normalised catalogue, cached per catalogue object (and per `core.sources`, which feeds the search text):
//                                      {meta, counts, sets, bySlug, groups, screens, sourceKeys, traps, methods, files, find(key), src(key)}
//                                      set: {i, id, slug, file, stem, ext, template, title, desc, group, status, mock, source[], period, asOf, unit, format,
//                                            mediaType, bytes, gz, screens[], screenRoutes[], eager, contains[], pending[], expected, schema[], parts[], hay}
//   find(key)                 a set by slug, then by id, then by an id it contains (the first one wins; D09 is two sets) · src(key) a source of core.sources
//   stemOf(file)              'data/geo/obshtini.json' -> 'geo/obshtini' (the stem data.load() takes); null for anything that is not a JSON data file
//   fileUrl(file, base?)      absolute address of a file of the site (base defaults to the page's base URL)
//   dlName(set, part?)        the name a download gets: the path below data/ with „/“ turned into „-“ (geo-obshtini.json, feed.xml; a part: ministries-0200.json)
//   screenOf(id)              the route of the screen a route id belongs to (S08 -> S07), null when it has no screen of its own
//   readFilter(query, M)      -> {status, ekran, izvor, q, active}   from ?status= ?ekran= ?izvor= ?q= ; an unknown value is dropped
//   passes(set, filter, skip) -> boolean   skip = parts of the filter to leave out (the status chips count with `q` and `status` left out)
//   matchQ(hay, q)            every word of q is a part of the haystack (Cyrillic or Latin spelling: „kfp“ finds „КФП“)
//   relatedTo(items, set) · filesOf(M, set)   traps/methodology items and primary files that name a set
//   citation(set, M, o)       the one-paragraph citation of a set (o: {url, version}); a mock set says „Създадени на“ instead of „Данни към“
//   loadMeta(set, {signal})   async -> {meta, state}   the `meta` block of the set's own file (notes, notice) for a detail view. Reads the cache first, fetches
//                             only a small JSON file (< 120 KB) through data.load, never passes `demo`; state: 'ok' | 'skip' | 'pending' | 'error'; an abort is rethrown
//   periodLabel(p) · sizeLabel(bytes) · paras(text) · idPart(s) · cleanQ(text) · kindLabel(kind) · accessLabel(access, hasUrl)
//   yearSpan(p) · periodYears(M) · coversYear(set, y)   the years a period reaches ([2024, 2028]), the years any set covers (newest first), and whether a set covers a year (FB4: the „Период“ filter of ПРОВЕРИ)
//   rich(text, M)             text from the catalogue -> SafeHtml: escaped, with `code`, „slug“ (a set of the catalogue) and P01..P07 (a pending set) as links or <code>
import { ROOT } from './loc.js';
import { ROUTES, byId, href as routeHref } from './routes.js';
import { esc, raw } from './html.js';
import { date, num, monthYear, NBSP } from './format.js';
import { data, PendingError } from './data.js';
import { norm, lat } from './searchlib.js';
import { STATUS } from './ui/status.js';
import { srcShort } from './ui/source.js';

export const STATUSES = ['real', 'partial', 'forecast', 'mock', 'pending'];
const OTHER = { id: 'other', label: 'Други набори' };

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
const strs = (v) =>
  arr(v)
    .map(str)
    .map((s) => s.trim())
    .filter(Boolean);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const uniq = (a) => [...new Set(a)];
const httpUrl = (u) => (/^https?:\/\//i.test(str(u).trim()) ? str(u).trim() : '');
/** a file of the site: data/<path>.<ext>, no dots in the path; anything else is not offered as a link */
const safeFile = (f) =>
  /^data\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.[A-Za-z0-9]+$/.test(str(f)) ? str(f) : '';
const extOf = (f) => (/\.([A-Za-z0-9]+)$/.exec(str(f)) || [])[1]?.toLowerCase() || '';
/** part of an element id: letters, digits, dashes */
export const idPart = (s) =>
  str(s)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/* ---------------------------------------------------------------- files and addresses */
export function stemOf(file) {
  const m = /^data\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\.json$/.exec(str(file));
  return m ? m[1] : null;
}
export function fileUrl(file, base) {
  const b = base ?? ROOT.href;
  try {
    return new URL(file, b).href;
  } catch {
    return str(file);
  }
}
/** the name a download gets: the path below data/ with the slashes turned into dashes (data/geo/obshtini.json -> geo-obshtini.json); a part is one file of a multi-file set */
const nameOf = (file) =>
  str(file)
    .replace(/^data\//, '')
    .replace(/\//g, '-');
export const dlName = (set, part) => nameOf(part ? part.file : set.file) || `${set.slug}.json`;

/* ---------------------------------------------------------------- screens */
const needsParam = (r) =>
  !!r?.pattern &&
  r.pattern
    .split('/')
    .filter(Boolean)
    .some((s) => /^:\w+(\([^)]*\))?$/.test(s));
/** the route of the screen that shows a route id: a child without its own menu entry (S08, S11, S21) belongs to its parent; a route that needs a parameter is never a target */
export function screenOf(id) {
  let r = byId[id];
  for (let n = 0; r && n < 6 && (needsParam(r) || (!r.nav && r.parent)); n++)
    r = r.parent ? byId[r.parent] : null;
  return r && r.pattern && !needsParam(r) ? r : null;
}
const ORDER = new Map(ROUTES.map((r, i) => [r.key, i]));
/** the distinct screens of a list of route ids, in the order of the route table */
export function screensOf(ids) {
  const seen = new Set(),
    out = [];
  for (const id of strs(ids)) {
    const r = screenOf(id);
    if (r && !seen.has(r.key)) {
      seen.add(r.key);
      out.push(r);
    }
  }
  return out.sort((a, b) => ORDER.get(a.key) - ORDER.get(b.key));
}

/* ---------------------------------------------------------------- display helpers */
const YMD = /^\d{4}-\d{2}-\d{2}$/,
  YM = /^(\d{4})-(\d{2})$/;
const point = (s) => {
  const t = s.trim();
  const m = YM.exec(t);
  return YMD.test(t) ? date(t) : m ? monthYear(+m[1], +m[2]) : t;
};
/** '2025-01 … 2026-07' -> 'януари 2025 – юли 2026'; '2025-07-17 … 2026-07-31' -> '17.07.2025 – 31.07.2026'; '2024–2028' stays; {from,to} works too */
export function periodLabel(p) {
  if (!p) return '';
  if (typeof p === 'object') {
    const a = str(p.from),
      b = str(p.to);
    return a && b ? `${point(a)} – ${point(b)}` : point(a || b);
  }
  const s = str(p).trim();
  const two = s.split(/\s*…\s*|\s*\.\.\.\s*/).filter(Boolean);
  return two.length === 2 ? `${point(two[0])} – ${point(two[1])}` : point(s);
}
/** the first and the last year a period reaches: '2024–2028' -> [2024, 2028] · '2025-01 … 2026-07' -> [2025, 2026] · '2026' -> [2026, 2026] · no period -> null */
export function yearSpan(p) {
  const text = p && typeof p === 'object' ? `${str(p.from)} ${str(p.to)}` : str(p);
  const ys = (text.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}
/** the years at least one set covers, newest first (the options of the „Период“ filter) */
export function periodYears(M) {
  const ys = new Set();
  for (const s of M.sets) {
    const sp = yearSpan(s.period);
    if (sp) for (let y = sp[0]; y <= sp[1]; y++) ys.add(y);
  }
  return [...ys].sort((a, b) => b - a);
}
export function coversYear(set, y) {
  const sp = yearSpan(set.period);
  return !!sp && sp[0] <= y && y <= sp[1];
}
/** 9025 -> '8,8 КБ' · 5655187 -> '5,4 МБ' (no-break space before the unit) */
export function sizeLabel(bytes) {
  if (!isNum(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${num(bytes, 0)}${NBSP}Б`;
  if (bytes < 1024 * 1024) return `${num(bytes / 1024, bytes < 10 * 1024 ? 1 : 0)}${NBSP}КБ`;
  return `${num(bytes / 1048576, 1)}${NBSP}МБ`;
}
/** a text as paragraphs (blank lines separate them; a single text is one paragraph) */
export const paras = (text) =>
  str(text)
    .split(/\n\s*\n/)
    .map((s) => s.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
/** the search text as the screens keep it: one line, collapsed spaces, at most 80 characters */
export const cleanQ = (text) => str(text).replace(/\s+/g, ' ').trim().slice(0, 80);
const KIND = {
  xls: 'Таблица (xls)',
  pdf: 'Документ (PDF)',
  html: 'Уеб страница',
  api: 'API',
  doc: 'Документ (Word)',
  generator: 'Генериран набор',
};
const ACCESS = {
  open: 'Отворен достъп',
  'browser-only': 'Достъпен само през браузър',
  none: 'Няма публичен достъп',
};
export const kindLabel = (kind) => KIND[kind] || '';
/** the way to reach a source; a source that is not a published thing (our own texts, the generator) has no address rather than „no access“ */
export const accessLabel = (access, hasUrl) =>
  access === 'none' && !hasUrl ? 'Няма външен адрес' : ACCESS[access] || '';

/* ---------------------------------------------------------------- the model */
function normSchema(s) {
  return arr(s)
    .filter((x) => x && str(x.key))
    .map((x) => ({
      key: str(x.key),
      type: str(x.type) || 'object',
      length: isNum(x.length) ? x.length : null,
    }));
}
function normSet(d, i) {
  const slug = str(d.slug).trim().toLowerCase() || str(d.id).trim().toLowerCase();
  const file = safeFile(d.file);
  const status = STATUSES.includes(d.status) ? d.status : 'pending';
  const parts = arr(d.parts)
    .map((p) => ({
      code: str(p?.code),
      file: safeFile(p?.file),
      bytes: isNum(p?.bytes) ? p.bytes : null,
      gz: isNum(p?.gzipBytes) ? p.gzipBytes : null,
    }))
    .filter((p) => p.file);
  const screens = strs(d.screens);
  return {
    i,
    id: str(d.id).trim(),
    slug,
    file,
    stem: stemOf(file),
    ext: extOf(file),
    template: str(d.fileTemplate),
    title: str(d.title).trim() || slug,
    desc: str(d.description).trim(),
    group: str(d.group),
    status,
    mock: d.mock === true || status === 'mock',
    source: strs(d.source),
    period: str(d.period).trim(),
    asOf: str(d.asOf),
    unit: str(d.unit).trim(),
    format: str(d.format).trim() || (file ? extOf(file).toUpperCase() : ''),
    mediaType: str(d.mediaType),
    bytes: isNum(d.bytes) ? d.bytes : null,
    gz: isNum(d.gzipBytes) ? d.gzipBytes : null,
    screens,
    screenRoutes: screensOf(screens),
    eager: d.eager === true,
    contains: strs(d.contains),
    pending: strs(d.pending),
    expected: str(d.expected).trim(),
    schema: normSchema(d.schema),
    parts,
    hay: '',
  };
}

const MEMO = new WeakMap();
export function model(cat, sources) {
  const c = cat && typeof cat === 'object' ? cat : {};
  const hit = MEMO.get(c);
  if (hit && hit.sources === sources) return hit.M;
  const M = build(c, sources && typeof sources === 'object' ? sources : {});
  MEMO.set(c, { sources, M });
  return M;
}

function build(c, srcs) {
  const seen = new Set();
  const sets = arr(c.datasets)
    .filter((d) => d && typeof d === 'object')
    .map(normSet)
    .filter((s) => s.slug && !seen.has(s.slug) && seen.add(s.slug));
  const bySlug = new Map(sets.map((s) => [s.slug, s]));
  const byId = new Map(),
    byContained = new Map();
  for (const s of sets) {
    if (s.id && !byId.has(s.id.toLowerCase())) byId.set(s.id.toLowerCase(), s);
    for (const k of s.contains)
      if (!byContained.has(k.toLowerCase())) byContained.set(k.toLowerCase(), s);
  }
  const find = (key) => {
    const k = str(key).trim().toLowerCase();
    return (k && (bySlug.get(k) || byId.get(k) || byContained.get(k))) || null;
  };
  const resolve = (keys) => uniq(strs(keys).map(find).filter(Boolean));

  const src = (key) => {
    const s = srcs[key] && typeof srcs[key] === 'object' ? srcs[key] : {};
    return {
      key,
      title: str(s.title) || srcShort(key),
      publisher: str(s.publisher),
      url: httpUrl(s.url),
      kind: str(s.kind),
      access: str(s.access),
      note: str(s.note),
    };
  };

  const defs = arr(c.groups)
    .filter((g) => g && str(g.id))
    .map((g) => ({
      id: str(g.id),
      label: g.id === 'budget' ? 'Бюджет и прогноза' : str(g.label) || str(g.id),
    }));
  const known = new Set(defs.map((g) => g.id));
  const groups = [...defs, ...(sets.some((s) => !known.has(s.group)) ? [OTHER] : [])]
    .map((g) => ({
      ...g,
      sets: sets.filter((s) => (g === OTHER ? !known.has(s.group) : s.group === g.id)),
    }))
    .filter((g) => g.sets.length);
  const groupLabel = Object.fromEntries(groups.map((g) => [g.id, g.label]));

  const screenMap = new Map();
  for (const s of sets)
    for (const r of s.screenRoutes) screenMap.set(r.key, (screenMap.get(r.key) || 0) + 1);
  const screens = ROUTES.filter((r) => screenMap.has(r.key)).map((r) => ({
    key: r.key,
    id: r.id,
    title: r.title,
    n: screenMap.get(r.key),
  }));

  const used = uniq(sets.flatMap((s) => s.source));
  const order = Object.keys(srcs);
  const sourceKeys = [
    ...order.filter((k) => used.includes(k)),
    ...used.filter((k) => !order.includes(k)),
  ];

  for (const s of sets) {
    const text = [
      s.title,
      s.desc,
      s.slug,
      s.id,
      s.contains.join(' '),
      s.file,
      s.template,
      s.format,
      s.mediaType,
      s.unit,
      s.period,
      periodLabel(s.period),
      groupLabel[s.group],
      STATUS[s.status]?.label,
      s.expected,
      ...s.source.flatMap((k) => [k, src(k).title, src(k).publisher]),
      ...s.screenRoutes.map((r) => r.title),
    ]
      .filter(Boolean)
      .join(' ');
    const n = norm(text);
    s.hay = `${n} ${lat(n)}`;
  }

  const item = (original) => {
    const t =
      original.id === 'two-versions'
        ? {
            ...original,
            text: 'Историческото извличане от PDF (проект от юни 2026 г.) и внесения на 01.07.2026 г. DOCX се отнася само за старите масиви към проекта за 2026 г. Разликите са в 9 реда на Приложение 3 (до 4,3 млн. €) и 7 реда на Табл. III-1; общите суми и осемте групи приходи съвпадат. Полетата „versions“ в „outlook“ и „expenditure“ описват тези исторически разлики. Серията byPeriod е отделна: 2026.expected е очаквано изпълнение, 2027.draft е проект, а 2028.forecast и 2029.forecast са прогнози. Приходите и икономическите разходни редове са от Приложение 3 (стр. 191–192), а разходите по функции са от Табл. III-1 (стр. 73) на АСБП 2027–2029, публикувана на 06.11.2026 г.',
          }
        : original;
    return {
      id: str(t.id),
      title: str(t.title),
      text: str(t.text),
      paras: paras(t.text),
      related: resolve(t.related),
      evidence: arr(t.evidence)
        .map((e) => ({
          url: httpUrl(e?.url),
          status: isNum(e?.httpStatus) ? e.httpStatus : null,
          checked: str(e?.checked),
        }))
        .filter((e) => e.url),
    };
  };
  const traps = arr(c.traps)
    .filter((t) => t && str(t.id) && str(t.title))
    .map(item);
  const methods = arr(c.methodology)
    .filter((t) => t && str(t.id) && str(t.title))
    .map(item);
  const files = arr(c.files)
    .filter((f) => f && str(f.name))
    .map((f) => ({
      name: str(f.name),
      title: str(f.title).trim() || str(f.name),
      url: httpUrl(f.url),
      page: httpUrl(f.page),
      sha256: /^[0-9a-f]{64}$/i.test(str(f.sha256)) ? str(f.sha256).toLowerCase() : '',
      bytes: isNum(f.bytes) ? f.bytes : null,
      retrieved: str(f.retrieved),
      source: strs(f.source),
      usedBy: resolve(f.usedBy),
      role: str(f.role),
      note: str(f.note).trim(),
    }));

  const count = (st) => sets.filter((s) => s.status === st).length;
  const counts = {
    datasets: sets.length,
    files: sets.filter((s) => s.file).length + sets.reduce((n, s) => n + s.parts.length, 0),
    real: count('real'),
    partial: count('partial'),
    forecast: count('forecast'),
    mock: count('mock'),
    pending: count('pending'),
    primaryFiles: files.length,
  };
  const meta = c.meta && typeof c.meta === 'object' ? c.meta : {};
  return {
    meta: { asOf: str(meta.asOf), retrieved: str(meta.retrieved), title: str(meta.title) },
    counts,
    sets,
    bySlug,
    groups,
    screens,
    sourceKeys,
    traps,
    methods,
    files,
    find,
    src,
  };
}

/* ---------------------------------------------------------------- filter */
export const words = (q) => norm(q).split(' ').filter(Boolean);
export const matchQ = (hay, q) => words(q).every((w) => hay.includes(w));

export function readFilter(query, M) {
  const q = query || {};
  const status = STATUSES.includes(q.status) ? q.status : '';
  const e = str(q.ekran);
  const scr = M.screens.find((s) => s.key === e || s.id === e.toUpperCase());
  const izvor = M.sourceKeys.includes(q.izvor) ? str(q.izvor) : '';
  const text = cleanQ(q.q);
  return {
    status,
    ekran: scr ? scr.key : '',
    izvor,
    q: text,
    active: !!(status || scr || izvor || text),
  };
}
export function passes(set, f, skip = []) {
  if (f.status && !skip.includes('status') && set.status !== f.status) return false;
  if (f.ekran && !skip.includes('ekran') && !set.screenRoutes.some((r) => r.key === f.ekran))
    return false;
  if (f.izvor && !skip.includes('izvor') && !set.source.includes(f.izvor)) return false;
  if (f.q && !skip.includes('q') && !matchQ(set.hay, f.q)) return false;
  return true;
}

/* ---------------------------------------------------------------- relations */
export const relatedTo = (items, set) => items.filter((t) => t.related.includes(set));
export const filesOf = (M, set) => M.files.filter((f) => f.usedBy.includes(set));

/** the citation of a set as one paragraph: what, where from, how much to trust it, as of when, and the address (o: {url, version}) */
export function citation(set, M, o = {}) {
  const who = set.source
    .map((k) => M.src(k))
    .map((s) => {
      const pub = s.publisher.replace(/;\s*/g, ', ');
      return pub ? `${pub}, „${s.title}“` : `„${s.title}“`;
    });
  const from = !who.length
    ? ''
    : who.length === 1
      ? `Източник: ${who[0]}.`
      : `Източници: ${who.map((w, i) => `${i + 1}) ${w}`).join('; ')}.`;
  return [
    set.mock ? 'ПРИМЕРНИ ДАННИ: стойностите са измислени, не ги цитирай.' : '',
    `СИГМА Бюджет, набор „${set.title}“${set.file ? ` (${dlName(set)})` : ''}.`,
    from,
    `Статус: ${(STATUS[set.status]?.label || STATUS.pending.label).toLowerCase()}.`,
    set.asOf ? (set.mock ? `Създадени на ${date(set.asOf)}.` : `Данни към ${date(set.asOf)}.`) : '',
    o.version ? `Версия на данните: ${o.version}.` : '',
    set.unit ? `Мерна единица: ${set.unit}.` : '',
    o.url ? `Адрес: ${o.url}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/* ---------------------------------------------------------------- the notes of one set */
const META_LIMIT = 120000;
const metaOf = (json) =>
  json && typeof json === 'object' && json.meta && typeof json.meta === 'object' ? json.meta : null;
export async function loadMeta(set, { signal } = {}) {
  if (!set || !set.stem) return { meta: null, state: 'skip' };
  const have = data.get(set.stem);
  if (have) return { meta: metaOf(have), state: 'ok' };
  if (set.bytes != null && set.bytes > META_LIMIT) return { meta: null, state: 'skip' };
  try {
    return { meta: metaOf(await data.load(set.stem, { signal })), state: 'ok' };
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return { meta: null, state: e instanceof PendingError ? 'pending' : 'error' };
  }
}

/* ---------------------------------------------------------------- texts of the catalogue as markup */
// The descriptions and notes are plain text from the data builder. A few tokens in them read better as markup: `code`, „slug“ (a set of the catalogue),
// P01..P07 (a pending set) and Eurostat table codes (snake_case, or tps00001). Everything else is escaped.
const TOKEN =
  /`([^`]+)`|„([A-Za-z][A-Za-z0-9_-]*)“|\b(P0[1-7])\b|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+|tps\d{5})\b/g;
/** text -> SafeHtml. A set named in quotes („outlook“) or by its P0n id becomes a link to #/danni/<slug>; a quoted word that is no set, and a table code, becomes <code> */
export function rich(text, M) {
  const s = str(text);
  const re = new RegExp(TOKEN.source, 'g');
  const link = (slug, inner, label) =>
    `<a href="${esc(routeHref('danni', { set: slug }))}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</a>`;
  let out = '',
    last = 0,
    m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    last = m.index + m[0].length;
    const [, tick, quoted, pid, snake] = m;
    if (tick != null) out += `<code>${esc(tick)}</code>`;
    else if (quoted != null) {
      const set = M?.bySlug?.get(quoted.toLowerCase());
      out += set ? link(set.slug, `<code>${esc(quoted)}</code>`) : `<code>${esc(quoted)}</code>`;
    } else if (pid != null) {
      const set = M?.bySlug?.get(pid.toLowerCase());
      out += set ? link(set.slug, esc(pid), `${pid}: ${set.title}`) : esc(pid);
    } else out += `<code>${esc(snake)}</code>`;
  }
  return raw(out + esc(s.slice(last)));
}
