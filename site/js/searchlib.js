// The search engine shared by the palette (search.js) and the S28 page: pure functions plus the index loader, no DOM.
// Ported from the v3.6 prototype (Bulgarian/Latin folding, synonyms, stop words, stems, scoring) and fed from
//   data/search-index.json (DATA_SPEC 3.21)  +  the screens of the route table  +  the glossary terms (only until the index has its own).
//
//   parse(raw)                 -> toks     a query as words with variants ([] when there is nothing to search for; several words also carry .phrase)
//   run(entries, toks, {onlyReal}) -> {hits, hidden, fuzzy}   best first; `hidden` = mock hits left out by „Само официални данни“; `fuzzy` = no exact match, these are near misses
//   mark(title, toks)          -> SafeHtml the title with the matched words in <mark>
//   getIndex()                 -> Promise<{entries, hasIndex, groups}>   never rejects; the index file is optional (pending = screens + terms only)
//   screenOf(href)             -> route | null   the screen a result opens (for „→ Екран“)
//   countText(n) · hiddenText(n) · groupLabel(id) · POPULAR · MAX_QUERY
// An entry: {group, title, sub, value, period, status: real|mock|pending, href, w, nn, t, nl, tl, mag} (the last six are matching data).
import { raw, esc } from './html.js';
import { data } from './data.js';
import { scoped } from './env.js';
import { ROUTES, match, href as routeHref } from './routes.js';

export const MAX_QUERY = 120;
export const POPULAR = ['ДДС', 'дълг', 'Пловдив', 'образование', 'МВР', 'пенсии', 'заплати'];

/* ------------------------------------------------------------------ folding */
const LAT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya' };
/** lower case and without the marks over letters (ѝ -> и, й -> и); keeps the length for highlighting */
export const fold = s => String(s ?? '').toLocaleLowerCase('bg').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** fold + quotes dropped + every other sign a space: the form words are compared in */
export const norm = s => fold(s).replace(/[„“”"«»'’`]/g, '').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
/** Latin spelling of a normalised string, so „plovdiv“ and „dds“ find Cyrillic names */
export const lat = s => s.replace(/[а-я]/g, c => LAT[c] ?? c);

// Simple synonyms: a group is one and the same thing. An abbreviation matches only whole; a longer word also by its beginning („задлъжн…“).
const SYN = [
  ['ддс', 'данък добавена стойност', 'данък върху добавената стойност'],
  ['дълг', 'задлъжнялост', 'задлъжняване'],
  ['мвр', 'вътрешните работи', 'полиция', 'вътрешен ред'], ['мвнр', 'външните работи'], ['мон', 'образованието и науката'],
  ['мз', 'здравеопазването'], ['мф', 'финансите'], ['мо', 'отбраната', 'армия'], ['мтсп', 'труда и социалната политика'],
  ['мррб', 'регионалното развитие'], ['мзх', 'земеделието и храните'], ['мтс', 'транспорта и съобщенията'], ['мосв', 'околната среда и водите'],
  ['нои', 'доо', 'обществено осигуряване', 'общественото осигуряване'], ['нзок', 'здравна каса', 'здравноосигурителна каса'],
  ['бвп', 'брутен вътрешен продукт'], ['кфп', 'консолидирана фискална програма', 'консолидираната фискална програма'],
  ['дфл', 'данък общ доход', 'данък върху доходите'], ['пенсии', 'пенсия', 'пенсионно'], ['заплати', 'заплата', 'възнаграждения', 'персонал'],
  ['еврофондове', 'европейски средства', 'средства от ес'], ['болници', 'здравеопазване'], ['училища', 'образование'], ['дефицит', 'салдо'],
  ['мерки', 'мярка'], ['данък', 'данъци', 'данъчни'], ['осигуровки', 'осигуровка', 'вноски'], ['ес', 'европейски съюз', 'евросъюз']
].map(g => g.map(norm));
const SYN_LAT = SYN.map(g => g.map(lat));
const STOP = new Set(['и', 'в', 'във', 'на', 'за', 'от', 'по', 'с', 'със', 'към', 'до', 'при', 'да', 'се', 'е', 'са', 'ли', 'как', 'колко', 'кой', 'коя', 'кое', 'кои', 'какво', 'къде']);

/** without article and ending: образованието -> образовани, пенсиите -> пенс, дълга -> дълг, общините -> общин */
function stem(t) {
  if (t.length < 5 || /[a-z]/.test(t)) return t;
  const s = t.replace(/(ите|ата|ята|ото|ето|ът|ят|та|то|те)$/, '');
  return s.length >= 5 ? s.replace(/[аяиеоуъ]$/, '') : s;
}

/** the query -> words, each with variants (itself, its stem and its synonyms); a synonym phrase („данък добавена стойност“) becomes one word */
export function parse(rawQuery) {
  let q = ` ${norm(String(rawQuery ?? '').slice(0, MAX_QUERY))} `;
  for (const g of SYN) for (const m of g) if (m.includes(' ') && q.includes(` ${m} `)) q = q.replace(` ${m} `, ` ${g[0]} `);
  let toks = q.trim().split(' ').filter(Boolean);
  if (toks.some(t => !STOP.has(t))) toks = toks.filter(t => !STOP.has(t));
  if (toks.every(t => t.length < 2)) return [];                  // one letter finds everything, so it finds nothing
  const out = toks.slice(0, 8).map(t => {
    const isLat = /[a-z]/.test(t), st = stem(t), alts = new Set([t, st]);
    (isLat ? SYN_LAT : SYN).forEach(g => { if (g.some(m => [t, st].some(x => m === x || (x.length >= 4 && !m.includes(' ') && m.startsWith(x))))) g.forEach(m => alts.add(m)); });
    return { t, lat: isLat, alts: [...alts] };
  });
  if (out.length > 1) out.phrase = out.map(k => k.t).join(' ');     // the words as one phrase („брутна заплата“, „1000.02“ = „1000 02“): run() ranks a name that has them side by side higher
  return out;
}

/* ------------------------------------------------------------------ scoring */
// A point for each word of the query (all must match): the whole name 10, a whole word in the name 7, the start of a word (the definite form) 6,
// part of a word 3; then the same in the description 2 and 1. An abbreviation of up to 3 letters matches only at the start of a word (else „МВР“ finds
// „септември“). A synonym or a stem is half a point less. The weight of the kind is added, and for a match in the name the shorter name goes first.
function tokScore(e, k) {
  const nn = k.lat ? e.nl : e.nn, t = k.lat ? e.tl : e.t;
  let best = 0;
  for (const a of k.alts) {
    const short = a.length <= 3;
    let s = nn === a ? 10 : ` ${nn} `.includes(` ${a} `) ? 7 : ` ${nn}`.includes(` ${a}`) ? 6 : !short && nn.includes(a) ? 3
      : ` ${t}`.includes(` ${a}`) ? 2 : !short && t.includes(a) ? 1 : 0;
    if (s && a !== k.t) s -= 0.5;
    if (s > best) best = s;
  }
  return best;
}
/** the distance between two words (one slip, a missing, an extra or two swapped letters count 1); max+1 when it is more than max */
function osa(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= lb; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < low) low = v;
    }
    if (low > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return Math.min(prev[lb], max + 1);
}
/** the second chance of a word that matched nowhere: a word of the name or the text that is one slip away (two for long words) — „дефецит“ -> „дефицит“ */
function near(e, k) {
  const t = k.t, max = t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0;
  if (!max) return 0;
  const dist = s => {
    let d = max + 1;
    for (const w of s.split(' ')) {
      if (w.length < 3) continue;
      d = Math.min(d, osa(t, w, max), w.length > t.length ? osa(t, w.slice(0, t.length), max) : max + 1);   // also the start of a longer word (the definite form)
    }
    return d;
  };
  const inName = dist(k.lat ? e.nl : e.nn), inText = dist(k.lat ? e.tl : e.t);
  if (inName <= max) return 4.5 - inName * 0.5;                  // 4 / 3,5: like a part of a word in the name, a little less per slip
  return inText <= max ? 2 - (inText - 1) * 0.5 : 0;             // 2 / 1,5: like the description
}
function score(e, toks, fuzzy) {
  let sum = 0, inName = true;
  for (const k of toks) {
    const best = tokScore(e, k) || (fuzzy ? near(e, k) : 0);
    if (!best) return 0;
    if (best < 3) inName = false;
    sum += best;
  }
  if (toks.phrase) {                                              // all the words side by side, in this order: in the name +2, in the text +1
    const has = (x, p) => ` ${x} `.includes(` ${p} `);
    sum += has(e.nn, toks.phrase) || has(e.nl, toks.phrase) ? 2 : has(e.t, toks.phrase) || has(e.tl, toks.phrase) ? 1 : 0;
  }
  return Math.round((sum + e.w - (inName ? Math.min(1.5, e.title.length / 80) : 0)) * 100) / 100;
}
/** the size of an amount in млн. € from its display text: at equal points the bigger one goes first */
const UNIT = { млрд: 1000, млн: 1, хил: 0.001 };
const mag = v => {
  const m = /(\d[\d\s]*(?:,\d+)?)\s*(млрд|млн|хил)/.exec(String(v ?? ''));        // \s also covers the no-break spaces of the number format
  const n = m ? parseFloat(m[1].replace(/\s/g, '').replace(',', '.')) * UNIT[m[2]] : 0;
  return Number.isFinite(n) ? n : 0;
};

/** the hits for a query, best first. `fuzzy` = nothing matched exactly, so these are the near misses (the page says so). `hidden` = mock hits left out by „Само официални данни“. */
export function run(entries, toks, o = {}) {
  let hits = [], hidden = 0, fuzzy = false;
  const pass = f => {
    const out = [];
    hidden = 0;
    for (const e of entries) {
      const s = score(e, toks, f);
      if (s <= 0) continue;
      if (o.onlyReal && e.status === 'mock') { hidden++; continue; }
      out.push([s, e]);
    }
    out.sort((a, b) => b[0] - a[0] || b[1].w - a[1].w || b[1].mag - a[1].mag || a[1].title.length - b[1].title.length);
    return out.map(x => x[1]);
  };
  if (toks.length) {
    hits = pass(false);
    if (!hits.length && !hidden) { hits = pass(true); fuzzy = hits.length > 0 || hidden > 0; }
  }
  return { hits, hidden, fuzzy };
}

/** the title with the words of the query in <mark> (word starts only; several words, overlaps merged) */
export function mark(title, toks) {
  const s = String(title ?? ''), f = fold(s);
  if (f.length !== s.length) return raw(esc(s));
  const spans = [];
  for (const k of toks) {
    if (k.lat) continue;
    let best = null;
    for (const a of k.alts) {
      if (!a) continue;
      const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'u').exec(f);
      if (m && (!best || a.length > best[1])) best = [m.index + m[1].length, a.length];
    }
    if (best) spans.push(best);
  }
  if (!spans.length) return raw(esc(s));
  spans.sort((a, b) => a[0] - b[0]);
  let out = '', at = 0;
  for (const [i, n] of spans) {
    if (i < at) continue;
    out += `${esc(s.slice(at, i))}<mark>${esc(s.slice(i, i + n))}</mark>`;
    at = i + n;
  }
  return raw(out + esc(s.slice(at)));
}

export const countText = n => `${n} ${n === 1 ? 'резултат' : 'резултата'}`;
/** „Скрит е 1 примерен резултат.“ / „Скрити са 3 примерни резултата.“ (what onlyReal hides) */
export const hiddenText = n => n === 1 ? 'Скрит е 1 примерен резултат.' : `Скрити са ${n} примерни резултата.`;

/* ------------------------------------------------------------------ index */
export const GROUP_LABEL = { indicators: 'Показатели', institutions: 'Институции', municipalities: 'Общини', measures: 'Мерки', terms: 'Понятия', datasets: 'Данни', screens: 'Екрани' };
const GROUP_ORDER = ['indicators', 'institutions', 'municipalities', 'measures', 'terms', 'screens', 'datasets'];
const WEIGHT = { indicators: 2.5, institutions: 2.5, municipalities: 1, measures: 1.2, terms: 1.5, screens: 1.8, datasets: 0.6 };
export const groupLabel = id => GROUP_LABEL[id] || 'Друго';
const STATUSES = ['real', 'mock', 'pending'];

function entry(group, title, o = {}) {
  const name = String(title);
  const nn = norm(name);
  const t = norm(`${name} ${o.sub || ''} ${o.kw || ''} ${o.period || ''} ${groupLabel(group)}`);
  return {
    group, title: name, sub: o.sub ? String(o.sub) : '', value: o.value ? String(o.value) : '', period: o.period ? String(o.period) : '',
    stage: o.stage || '', status: STATUSES.includes(o.status) ? o.status : 'real', href: o.href, w: WEIGHT[group] ?? 1,
    nn, t, nl: lat(nn), tl: lat(t), mag: mag(o.value)
  };
}

/** The stage and year of a number as the result shows it („Закон 2026“, „Отчет 2025“, „Прогноза 2026“, „По законопроекта 2026“): a bare „2026“ next to a figure could be read as
 *  what was spent. Terms and data sets have no figure, so no stage. The index rows say it in their own words (sub / title), this only names it the same way everywhere. */
export function stageOf(group, o) {
  const yr = (/\b(20\d\d)\b/.exec(o.period || '') || [])[1] || '';
  const txt = `${o.title || ''} ${o.sub || ''}`;
  let w = '';
  if (group === 'measures') w = 'По законопроекта';
  else if (group === 'indicators') {
    if (/Макроикономическа прогноза/.test(txt)) w = 'Прогноза';
    else if (/законопроект/i.test(txt)) w = 'По законопроекта';
    else if ((yr && yr < '2026') || /^Изпълнение |^Салдо на КФП, януари|· отчет\b/.test(txt)) w = 'Отчет';
    else w = 'Закон';
  } else if (group === 'institutions' || group === 'municipalities') w = 'Закон';
  return w ? `${w} ${yr}`.trim() : '';
}
/** the line under a result: its description, then stage + year (the plain year when the group has no stage) */
const SAYS = { 'Закон': /закон|бюджет \d{4}/i, 'Прогноза': /прогноз/i, 'Отчет': /отчет/i, 'По законопроекта': /законопроект/i };
export const metaOf = e => {
  const said = e.stage && SAYS[e.stage.replace(/ \d{4}$/, '')]?.test(`${e.title} ${e.sub}`) && (!e.period || `${e.title} ${e.sub}`.includes(e.period));   // the row already says it: do not say it twice
  return [e.sub, said ? '' : (e.stage || e.period)].filter(Boolean).join(' · ');
};

const FIELDS = ['g', 'title', 'sub', 'value', 'period', 'status', 'href', 'kw'];
/** the rows of data/search-index.json (DATA_SPEC 3.21); a row without a title or with a link that is not an in-app hash link is dropped */
function fromDoc(doc) {
  if (!doc || !Array.isArray(doc.items)) return [];
  const groups = Array.isArray(doc.groups) ? doc.groups : [];
  const F = {};
  (Array.isArray(doc.fields) ? doc.fields : FIELDS).forEach((n, i) => { F[n] = i; });
  const out = [];
  for (const r of doc.items) {
    if (!Array.isArray(r)) continue;
    const g = typeof r[F.g] === 'number' ? groups[r[F.g]] : r[F.g];
    const title = r[F.title], href = r[F.href];
    if (!g || !title || typeof href !== 'string' || !href.startsWith('#/')) continue;
    out.push(entry(String(g), title, { sub: r[F.sub], value: r[F.value], period: r[F.period], status: r[F.status], href, kw: r[F.kw], stage: stageOf(String(g), { title, sub: r[F.sub], period: r[F.period] }) }));
  }
  return out;
}

// Words people may use for a screen that its title and description do not contain.
const SCREEN_KW = {
  S01: 'начало начална страница държавният бюджет достъпен език', S03: 'речник термини понятия думи обяснение',
  S04: 'кратко четиво накратко основното пътеводител стъпки обучение започни пет проверки', S05: 'пари приходи разходи изпълнение', S06: 'приходи данъци осигуровки постъпления',
  S07: 'разходи функции ведомства харчене', S10: 'кой харчи ведомства министерства програми институции управлява', S12: 'мерки мярка промени бюджет 2026',
  S13: 'прогноза 2027 2028 средносрочна', S14: 'път на бюджета закон проект приемане парламент как се прие', S15: 'изпълнение месечен отчет сравнение събрано изразходвано',
  S16: 'новини последно отчети решения', S17: 'дълг задлъжнялост лихви дефицит маастрихт', S18: 'моите данъци калкулатор осигуровки заплата нето брутно лични какво внасям',
  S20: 'общини карта трансфери',
  S24: 'данни източници набори методика каталог', S25: 'api json csv отворени данни файлове',
  S26: 'проекта екип прототип', S27: 'обратна връзка грешка предложение идея',
  S31: 'бвп икономика растеж потребление инвестиции износ внос макро отрасли сектори добавена стойност промишленост строителство търговия услуги селско стопанство'
};
// a required `:name` segment (not `:name?`, not `:name(regex)?`) means the screen cannot be opened without a parameter
const needsParam = r => r.pattern.split('/').some(s => s.startsWith(':') && !s.endsWith('?'));
/** the screens that can be opened as they are (not the search itself, the embed view and the 404) */
function fromRoutes() {
  return ROUTES.filter(r => r.pattern && !needsParam(r) && !['S28', 'S29', 'S30'].includes(r.id))
    .map(r => entry('screens', r.title, { sub: r.desc, kw: SCREEN_KW[r.id] || '', href: routeHref(r.id) }));
}

const firstSentence = s => { const t = String(s || '').trim(); const m = /^(.{20,160}?[.!?])(\s|$)/.exec(t); return m ? m[1] : t.slice(0, 160); };
const glossaryTitle = t => (t.abbr ? `${t.name || t.title} – ${t.abbr}` : t.title || t.name || t.slug);
/** glossary terms (used until the index has its own „terms“ group) */
function fromGlossary(doc) {
  const terms = Array.isArray(doc?.terms) ? doc.terms.filter(t => t && t.slug) : [];
  return terms.map(t => entry('terms', glossaryTitle(t), {
    sub: firstSentence(t.def), href: `#/rechnik/${t.slug}`,
    kw: [...(t.aliases || []), t.abbr, t.name, t.def, t.example].filter(Boolean).join(' ')
  }));
}

/* the index of the release being shown: in the browser one per visit (the module's own map; resetIndex() after data.reset()), on the
   server one per request (js/env.js scoped), because one Worker serves every release in turn and a new release must not show the old index */
const own = new Map();
export function getIndex() {
  const box = scoped('search-index', own);
  const cached = box.get('index');
  if (cached) return cached;
  const p = (async () => {
    let doc = null, retry = false;
    try { doc = await data.load('search-index'); } catch (e) { retry = e instanceof data.LoadError; }   // pending: the file is not published yet
    const hasIndex = !!doc && Array.isArray(doc.items);
    const entries = hasIndex ? fromDoc(doc) : [];
    entries.push(...fromRoutes());
    if (!entries.some(e => e.group === 'terms')) {
      try { entries.push(...fromGlossary(await data.load('glossary'))); } catch (e) { retry = retry || e instanceof data.LoadError; }
    }
    const present = [...new Set(entries.map(e => e.group))];
    const groups = [...GROUP_ORDER.filter(g => present.includes(g)), ...present.filter(g => !GROUP_ORDER.includes(g))];
    if (retry && box.get('index') === p) box.delete('index');   // offline: try again next time
    return { entries, hasIndex, groups };
  })();
  box.set('index', p);
  p.catch(() => { if (box.get('index') === p) box.delete('index'); });
  return p;
}
/** forget the loaded index (after data.reset()) */
export const resetIndex = () => { own.clear(); };

/** the screen a result link opens, or null */
export function screenOf(href) {
  const path = String(href || '').replace(/^#/, '').split('?')[0];
  const segs = path.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  const m = match(segs);
  return m ? m.route : null;
}
