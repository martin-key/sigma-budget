// S03 · Речник · #/rechnik/:term? · next S02, S01 · periods none
// Every definition, example, alias, note and link comes verbatim from data/glossary.json (D22, 64 terms): nothing here retypes a term.
// Only the interface words are ours (labels, hints, the empty state, the form).
//   #/rechnik               search ("Коя дума не разбираш?") + 5 themes + А–Я index + the 64 terms as disclosures
//   #/rechnik?q=дълг&cat=…&l=Д   the same, with a search / theme / letter applied (kept in the address while typing, without re-rendering)
//   #/rechnik/dds           one term: definition (lede), example, „Не бъркай с…“, „Виж в бюджета“, „Още не разбирам“, more from the theme
// The search lives in this file: it forgives typos, reads Latin letters as Cyrillic ("dds", "deficit"), knows the aliases of the data
// ("осигуровки", "чиста заплата") and falls back to the words of the definitions. The in-place popover on other screens is glossary.js (SHELL).
import { html, raw, cx } from '../html.js';
import { icon } from '../icons.js';
import { plural } from '../format.js';
import { match } from '../routes.js';
import { chips } from '../ui/chips.js';
import { disclosure, mount as mountDisclosure } from '../ui/disclosure.js';
import { emptyState } from '../ui/states.js';
import { ext } from '../ui/cards.js';
import { srcTag } from '../ui/source.js';
import * as feedback from '../feedback.js';
import { siteUrl } from '../seo.js';

export const needs = ['glossary'];
export const styles = ['s03-rechnik'];

/* ------------------------------------------------------------------ search model */

const collator = new Intl.Collator('bg');
const norm = s => String(s ?? '').toLowerCase().replace(/ѝ/g, 'и').replace(/[^a-zа-я0-9]+/g, ' ').trim();

// Latin letters read as Cyrillic: the way people type Bulgarian without a Cyrillic keyboard ("dds", "deficit", "zaplata")
const DIGRAPHS = [['sht', 'щ'], ['sch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['ts', 'ц'], ['yu', 'ю'], ['ya', 'я'], ['iu', 'ю'], ['ia', 'я']];
const LATIN = { a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'и', z: 'з' };
const LOOKALIKE = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };   // a Latin C typed for the Cyrillic С
function toCyr(s) {
  let out = '';
  for (let i = 0; i < s.length;) {
    const d = DIGRAPHS.find(([k]) => s.startsWith(k, i));
    if (d) { out += d[1]; i += d[0].length; } else { out += LATIN[s[i]] ?? s[i]; i += 1; }
  }
  return out;
}
const lookalike = s => s.replace(/[a-z]/g, c => LOOKALIKE[c] ?? c);

/** edit distance with adjacent swaps; gives up (returns max + 1) as soon as it must exceed `max` */
function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

/** how well one typed word fits one word of a term: 3 same, 2.4 typed so far, 1.6 same word family (данъци ~ данък), 1.2 a typo, 0 no */
function wordScore(q, k) {
  if (q === k) return 3;
  if (q.length >= 3 && k.startsWith(q)) return 2.4;
  if (q.length >= 5 && k.length >= 5 && q.slice(0, 4) === k.slice(0, 4)) return 1.6;
  const lim = q.length <= 3 ? 0 : q.length <= 6 ? 1 : 2;
  if (lim && dist(q, k, lim) <= lim) return 1.2;
  return 0;
}

/** every typed word must fit a word of the key; the score grows with the quality of the fit and with how much of the key the query spells out */
function keyScore(qs, qt, ks, kt) {
  if (qs === ks) return 100;
  let sum = 0;
  for (const q of qt) {
    let best = 0;
    for (const k of kt) { const s = wordScore(q, k); if (s > best) best = s; if (best === 3) break; }
    if (!best) return 0;
    sum += best;
  }
  return Math.min(99, 40 + 14 * (sum / qt.length) + 16 * (qt.length / kt.length) + (ks.startsWith(qs) ? 6 : 0));
}

/** the words of the definition and the example: a weaker, no-typo fit (14 .. 32) */
function bodyScore(qt, body) {
  let sum = 0;
  for (const q of qt) {
    if (q.length < 3) return 0;
    let best = 0;
    for (const b of body) {
      const s = b === q ? 3 : b.startsWith(q) ? 2.4 : (q.length >= 5 && b.length >= 5 && q.slice(0, 4) === b.slice(0, 4)) ? 1.6 : 0;
      if (s > best) best = s;
      if (best === 3) break;
    }
    if (!best) return 0;
    sum += best;
  }
  return 14 + 6 * (sum / qt.length);
}

// Everyday and English words that name a term but are not among its aliases in the data. Search plumbing only; nothing here is shown.
const SYNONYMS = {
  gdp: ['bvp'], vat: ['dds'], ддфл: ['danak-varhu-dohodite'], растеж: ['realen-rast', 'nominalen-rast'], дупка: ['byudzheten-defitsit'], печалба: ['korporativen-danak'], budget: ['byudzhet'], debt: ['darzhaven-dalg'], tax: ['danak'], taxes: ['danak'], excise: ['aktsiz'], inflation: ['inflatsiya'],
  бруто: ['brutna-zaplata'], нето: ['netna-zaplata'], минус: ['byudzheten-defitsit'],
  заем: ['nov-dalg-novo-zaemane', 'darzhaven-dalg'], заеми: ['nov-dalg-novo-zaemane', 'darzhaven-dalg'], кредит: ['nov-dalg-novo-zaemane', 'darzhaven-dalg']
};
const TRY = ['ДДС', 'дефицит', 'дълг', 'осигуровки', 'БВП'];     // exact terms or aliases of the data: the first tries a visitor can make

const IDX = new WeakMap();
/** everything the screen derives from the glossary, built once per loaded file */
export function indexOf(g) {
  let I = IDX.get(g);
  if (I) return I;
  const entries = g.terms.map(t => {
    const keys = [{ s: norm(t.name), w: 1 }];
    if (t.abbr) keys.push({ s: norm(t.abbr), w: 1 });
    for (const a of t.aliases || []) keys.push({ s: norm(a), w: 0.97 });
    keys.push({ s: t.slug.replace(/-/g, ' '), w: 0.8 });          // the slug is the term in Latin letters
    for (const k of keys) k.toks = k.s.split(' ');
    return { t, keys, body: norm(`${t.def} ${t.example}`).split(' '), letter: t.name.charAt(0).toUpperCase() };
  });
  I = {
    g,
    entries,
    catOf: Object.fromEntries(g.categories.map(c => [c.id, c])),
    bySlug: new Map(entries.map(e => [e.t.slug, e])),
    byCat: Object.fromEntries(g.categories.map(c => [c.id, entries.filter(e => e.t.cat === c.id)])),
    alpha: [...entries].sort((a, b) => collator.compare(a.t.name, b.t.name)),
    letters: [...new Set(entries.map(e => e.letter))].sort(collator.compare)
  };
  IDX.set(g, I);
  return I;
}

/** ranked hits for a typed query: [{e, score, how:'name'|'body'}], best first */
export function searchGlossary(I, q) {
  const n = norm(q);
  if (n.length < 3) return [];
  const variants = [...new Set([n, toCyr(n), lookalike(n)])];
  const out = new Map();
  const put = (e, score, how) => { const p = out.get(e.t.slug); if (!p || score > p.score) out.set(e.t.slug, { e, score, how }); };
  for (const e of I.entries) {
    for (const v of variants) {
      const qt = v.split(' ');
      let best = 0;
      for (const k of e.keys) { const s = keyScore(v, qt, k.s, k.toks) * k.w; if (s > best) best = s; }
      if (best) put(e, best, 'name');
      const b = bodyScore(qt, e.body);
      if (b) put(e, b, 'body');
    }
  }
  for (const w of n.split(' ')) for (const slug of SYNONYMS[w] || []) { const e = I.bySlug.get(slug); if (e) put(e, 90, 'name'); }
  const words = n.split(' ').filter(w => w.length >= 3);
  if (words.length > 1 && ![...out.values()].some(h => h.score >= 18)) {   // "минимална заплата": nothing has both words, so offer what has one of them
    for (const w of words) for (const h of searchGlossary(I, w)) put(h.e, Math.min(h.score * 0.7, 60), h.how);
  }
  return [...out.values()].filter(h => h.score >= 18).sort((a, b) => b.score - a.score || a.e.t.n - b.e.t.n);
}

/** when nothing fits: the terms whose names are closest by edit distance (the "Може би:" list) */
export function nearest(I, q, count = 4) {
  const n = norm(q);
  if (n.length < 3) return [];
  const variants = [...new Set([n, toCyr(n), lookalike(n)])];
  const scored = [];
  for (const e of I.entries) {
    let best = 9;
    for (const k of e.keys) for (const v of variants) {
      const whole = dist(v, k.s, 4);
      if (whole <= 4) best = Math.min(best, whole / Math.max(v.length, k.s.length));
      for (const qw of v.split(' ')) {
        if (qw.length < 4) continue;
        for (const kw of k.toks) {
          if (kw.length < 4) continue;
          const d = dist(qw, kw, 3);
          if (d <= 3) best = Math.min(best, d / Math.max(qw.length, kw.length));
        }
      }
    }
    if (best < 0.4) scored.push({ e, best });
  }
  return scored.sort((a, b) => a.best - b.best || a.e.t.n - b.e.t.n).slice(0, count).map(x => x.e);
}

/* ------------------------------------------------------------------ screen state (the address) */

const SEARCHING = 3;                                    // letters typed before the search starts (every abbreviation of the glossary has three)
const termOf = (ctx, I) => (ctx.params.term ? I.bySlug.get(String(ctx.params.term).toLowerCase())?.t ?? null : null);

function viewState(ctx, I) {
  const q = String(ctx.query.q ?? '').trim().slice(0, 80);
  const cat = I.catOf[ctx.query.cat] ? String(ctx.query.cat) : '';
  const l = String(ctx.query.l ?? '').toUpperCase();
  return { q, cat, l: I.letters.includes(l) ? l : '' };
}
const isSearch = st => norm(st.q).length >= SEARCHING;

/** hits for the query and the letter, before the theme is applied (so every theme chip can show its own count) */
function baseHits(I, st) {
  let hits = isSearch(st) ? searchGlossary(I, st.q) : (st.l ? I.alpha : I.entries).map(e => ({ e, score: 0, how: '' }));
  if (st.l) hits = hits.filter(h => h.e.letter === st.l);
  return hits;
}
function view(I, st) {
  const base = baseHits(I, st);
  const hits = st.cat ? base.filter(h => h.e.t.cat === st.cat) : base;
  const counts = { all: base.length };
  for (const c of I.g.categories) counts[c.id] = base.filter(h => h.e.t.cat === c.id).length;
  return { hits, counts };
}

function countText(I, st, n) {
  if (!n) return isSearch(st) ? `Няма термини за „${st.q}“` : 'Няма термини за този избор';
  const what = plural(n, 'термин', 'термина');
  if (isSearch(st)) return `Намерени: ${what} за „${st.q}“`;
  if (st.l && st.cat) return `${what} на „${st.l}“ в „${I.catOf[st.cat].short}“`;
  if (st.l) return `${what} на буквата „${st.l}“`;
  if (st.cat) return `${what} в „${I.catOf[st.cat].short}“`;
  return `${what} в ${plural(I.g.categories.length, 'тема', 'теми')}`;
}

/* ------------------------------------------------------------------ pieces */

const termHref = (ctx, slug) => ctx.href('S03', { term: slug });

/** related terms of one term, grouped by the note they share: [{note, items:[term]}] */
function confusables(I, t) {
  const groups = [];
  for (const r of t.related || []) {
    const e = I.bySlug.get(r.slug);
    if (!e) continue;
    let grp = groups.find(x => x.note === r.note);
    if (!grp) { grp = { note: r.note, items: [] }; groups.push(grp); }
    grp.items.push(e.t);
  }
  return groups;
}

/** the screen a „Виж в бюджета“ link opens, by its address: for the sentence under the button */
function screenTitle(href) {
  try {
    const segs = String(href).replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
    return match(segs)?.route?.title || '';
  } catch { return ''; }
}

function termCard(ctx, I, e, o = {}) {
  const t = e.t;
  const groups = confusables(I, t);
  const body = html`
    <p class="s03-def">${t.def}</p>
    <p class="s03-ex"><span class="s03-ex-label">Пример</span> ${t.example}</p>
    ${groups.map(gr => html`<p class="s03-confuse"><strong>Не бъркай с:</strong> ${gr.items.map((x, i) => html`${i ? ', ' : ''}<a href="${termHref(ctx, x.slug)}">${x.name}</a>`)}. <span class="s03-confuse-note">${gr.note}</span></p>`)}
    <p class="s03-acts">
      ${(t.see || []).map(s => html`<a class="btn btn-sm btn-primary" href="${s.href}">${s.label}<span class="sr-only"> за „${t.name}“</span>${icon('arrowRight', { size: 14 })}</a>`)}
      <a class="btn btn-sm" href="${termHref(ctx, t.slug)}">Страница на термина<span class="sr-only"> „${t.name}“</span></a>
    </p>`;
  return html`<li class="s03-item">${disclosure({
    id: `t-${t.slug}`,
    open: !!o.open,
    title: html`<span class="s03-name">${t.name}</span>${t.abbr ? html`<span class="s03-abbr">${t.abbr}</span>` : ''}`,
    meta: o.meta || '',
    body
  })}</li>`;
}

function noHits(ctx, I, st) {
  const near = isSearch(st) ? nearest(I, st.q) : [];
  const alt = near.length ? near : TRY.map(w => I.entries.find(e => e.keys.some(k => k.s === norm(w)))).filter(Boolean);
  const text = isSearch(st)
    ? (near.length ? 'Опитай с друга дума. Може би:' : 'Опитай с друга дума. Ето няколко често търсени:')
    : 'Няма термини при този избор. Махни някой от филтрите.';
  return html`${emptyState({ title: 'Няма такъв термин', text, icon: 'search', action: { action: 's03-reset', label: 'Покажи всички термини' } })}
    ${chips({ label: near.length ? 'Може би' : 'Често търсени', items: alt.map(e => ({ label: e.t.name, href: termHref(ctx, e.t.slug) })) })}`;
}

function resultsHtml(ctx, I, st, hits) {
  if (!hits.length) return noHits(ctx, I, st);
  const searching = isSearch(st);
  const item = (h, flat) => termCard(ctx, I, h.e, { open: searching && hits.length <= 3, meta: h.how === 'body' ? 'в обяснението' : flat ? I.catOf[h.e.t.cat].short : '' });
  if (searching) {
    const top = hits[0];
    const lead = top.how === 'body' ? 'Няма термин с това име. Думата се среща в обясненията на:'
      : top.score < 80 ? 'Няма точно съвпадение. Най-близки са:' : '';
    return html`${lead ? html`<p class="s03-lead">${lead}</p>` : ''}<ul class="s03-list">${hits.map(h => item(h, true))}</ul>`;
  }
  if (st.l || st.cat) return html`<ul class="s03-list">${hits.map(h => item(h, !!st.l))}</ul>`;
  return html`${I.g.categories.map(c => {
    const rows = hits.filter(h => h.e.t.cat === c.id);
    if (!rows.length) return '';
    return html`<section class="s03-cat" aria-labelledby="s03-cat-${c.id}">
      <h3 class="s03-cat-h" id="s03-cat-${c.id}">${c.title}</h3>
      <ul class="s03-list">${rows.map(h => item(h, false))}</ul>
    </section>`;
  })}`;
}

function filterChips(I, st, counts) {
  const cats = [{ label: 'Всички', key: 'cat:', count: counts.all, pressed: !st.cat }]
    .concat(I.g.categories.map(c => ({ label: c.short, key: `cat:${c.id}`, count: counts[c.id], pressed: st.cat === c.id })));
  return html`<div class="s03-filter"><p class="s03-filter-label" id="s03-themes-l">Тема</p>${chips({ label: 'Тема', items: cats })}</div>
    <div class="s03-filter s03-az"><p class="s03-filter-label">Азбучен указател</p>${chips({ label: 'Азбучен указател', items: I.letters.map(L => ({ label: L, key: `l:${L}`, pressed: st.l === L })) })}</div>`;
}

function relations(ctx, I) {
  const g = I.g;
  const link = (slug, text) => (I.bySlug.has(slug) ? html`<a href="${termHref(ctx, slug)}">${text}</a>` : text);
  return html`<section class="s03-rel" aria-labelledby="s03-rel-h">
    <h2 id="s03-rel-h">${g.relationsTitle}</h2>
    <p class="muted">Тези думи често се бъркат. Бележката казва с какво се различават.</p>
    <ul class="s03-rel-list">${g.relations.map(r => html`<li class="s03-rel-item">
      <p class="s03-rel-text">${link(r.terms[0], r.from)} <span aria-hidden="true">→</span><span class="sr-only">е свързано с</span> ${r.to.map((p, i) => html`${i ? ', ' : ' '}${link(r.terms[i + 1], p)}`)}</p>
      <p class="s03-rel-note">${r.note}</p>
    </li>`)}</ul>
  </section>`;
}

function sources(g) {
  return disclosure({
    id: 's03-sources',
    title: g.sourcesTitle,
    body: html`<p>${g.sourcesIntro}</p><ul class="s03-src-list">${g.sources.map(s => html`<li>${ext(s.url, s.name)}</li>`)}</ul>`
  });
}

/** „Още не разбирам“: a small form. The entry stays in this browser (feedback.js); with <meta name="feedback-email"> the visitor gets
 *  a ready e-mail to send from their own mail app, as on S27 */
function askForm(id, o) {
  return html`<form class="s03-ask" id="${id}" data-s03-ask data-term="${o.term || ''}" novalidate>
    <div class="field">
      <label class="field-label" for="${id}-text">${o.label}</label>
      <p class="field-hint" id="${id}-text-hint">${o.hint}</p>
      <textarea class="input s03-textarea" id="${id}-text" name="text" rows="3" maxlength="${feedback.MAX_TEXT}" aria-describedby="${id}-text-hint ${id}-text-err" required></textarea>
      <p class="field-error" id="${id}-text-err" role="alert" hidden></p>
    </div>
    <div class="cluster"><button type="submit" class="btn btn-primary">${feedback.SEND}</button></div>
    <p class="s03-ask-done" data-s03-done hidden>${feedback.SENT}${feedback.TO ? html` <a data-s03-mail href="mailto:${feedback.TO}">Отвори имейла</a>` : ''}</p>
  </form>`;
}

const credit = g => html`<p class="s03-credit small muted">Текст на речника: Работна група „Бюджет на светло“ ${srcTag(g.meta?.source || ['wg'], { asOf: g.meta?.asOf })}</p>`;
const disclaimer = g => html`<p class="s03-note small muted"><strong>${g.intro.disclaimer.bold}</strong> ${g.intro.disclaimer.text}</p>`;

/* ------------------------------------------------------------------ page contract */

export const title = ctx => {
  const g = ctx.data?.glossary;
  if (!g) return undefined;
  if (!ctx.params.term) return g.title;
  return termOf(ctx, indexOf(g))?.title ?? 'Няма такъв термин';
};

export const lede = ctx => {
  const g = ctx.data?.glossary;
  if (!g) return undefined;
  if (!ctx.params.term) return g.subtitle;
  return termOf(ctx, indexOf(g))?.def ?? 'Такава дума няма в речника. Потърси я в целия речник.';
};

/** JSON-LD (js/seo.js): the glossary is a DefinedTermSet, a term's page a DefinedTerm with its definition, as on the screen */
const termUrl = t => siteUrl(`/rechnik/${encodeURIComponent(t.slug)}`);
const SET_ID = () => siteUrl('/rechnik') + '#terms';
export const schema = ctx => {
  const g = ctx.data?.glossary;
  if (!g) return [];
  if (ctx.params.term) {
    const t = termOf(ctx, indexOf(g));
    if (!t) return [];
    const alt = [...new Set([t.name, ...(Array.isArray(t.aliases) ? t.aliases : [])].filter(a => a && a !== t.title))];
    return [{ '@type': 'DefinedTerm', '@id': termUrl(t) + '#term', url: termUrl(t), name: t.title, alternateName: alt.length ? alt : undefined,
      description: t.def, termCode: t.slug, inLanguage: 'bg', inDefinedTermSet: { '@id': SET_ID() } }];
  }
  return [{ '@type': 'DefinedTermSet', '@id': SET_ID(), url: siteUrl('/rechnik'), name: g.title, description: g.subtitle, inLanguage: 'bg',
    hasDefinedTerm: (g.terms || []).filter(t => t && t.slug && t.title).map(t => ({ '@type': 'DefinedTerm', '@id': termUrl(t) + '#term', name: t.title, url: termUrl(t) })) }];
};

export const crumbs = ctx => {
  if (!ctx.params.term) return [{ label: 'Речник' }];
  const g = ctx.data?.glossary;
  const t = g ? termOf(ctx, indexOf(g)) : null;
  return [{ label: 'Речник', href: ctx.href('S03') }, { label: t ? t.name : 'Няма такъв термин' }];
};

function overview(ctx, I) {
  const g = I.g;
  const st = viewState(ctx, I);
  const { hits, counts } = view(I, st);
  const filtered = !!(st.q || st.cat || st.l);
  return html`
    <section class="s03-find" aria-labelledby="s03-find-h">
      <h2 class="s03-find-h" id="s03-find-h"><label for="s03-q">Коя дума не разбираш?</label></h2>
      <p class="field-hint" id="s03-q-hint">${g.intro.text}</p>
      <form class="s03-search" role="search" data-s03-search novalidate>
        <span class="s03-q-ic" aria-hidden="true">${icon('search', { size: 20 })}</span>
        <input class="input s03-q" id="s03-q" name="q" type="search" value="${st.q}" maxlength="80" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Например: ДДС" aria-describedby="s03-q-hint" aria-controls="s03-results">
      </form>
      <div class="s03-try"><span class="s03-try-label">Опитай с:</span>${chips({ label: 'Често търсени думи', items: TRY.map(w => ({ label: w, key: `q:${w}` })) })}</div>
    </section>
    <section class="s03-browse" aria-labelledby="s03-list-h">
      <h2 id="s03-list-h">Термини</h2>
      ${filterChips(I, st, counts)}
      <div class="s03-bar">
        <p class="s03-count" id="s03-count">${countText(I, st, hits.length)}</p>
        <div class="cluster">
          <button type="button" class="btn btn-quiet btn-sm" data-s03-toggle-all${hits.length ? '' : raw(' hidden')}>Разгъни всички</button>
          <button type="button" class="btn btn-quiet btn-sm" data-s03-reset${filtered && hits.length ? '' : raw(' hidden')}>Покажи всички термини</button>
        </div>
      </div>
      ${disclaimer(g)}
      <div class="s03-results" id="s03-results">${resultsHtml(ctx, I, st, hits)}</div>
    </section>
    ${relations(ctx, I)}
    ${sources(g)}
    <section class="s03-ask-block" aria-labelledby="s03-ask-h">
      <h2 id="s03-ask-h">Не намери думата?</h2>
      <p class="muted">Кажи ни коя дума липсва или кое обяснение не помага. Така речникът става по-добър.</p>
      ${askForm('s03-ask', { label: 'Коя дума липсва или кое обяснение не помага?', hint: 'Пиши със свои думи. Не пиши лични данни.' })}
    </section>
    ${credit(g)}`;
}

function termPage(ctx, I, e) {
  const g = I.g, t = e.t, cat = I.catOf[t.cat];
  const groups = confusables(I, t);
  const shown = new Set(groups.flatMap(gr => gr.items.map(x => x.slug)));
  const others = I.byCat[t.cat].filter(x => x !== e && !shown.has(x.t.slug));
  return {
    eyebrow: `Речник · ${cat.short}`,
    body: html`
      <section class="s03-block" aria-labelledby="s03-ex-h">
        <h2 id="s03-ex-h">Пример</h2>
        <p class="s03-ex s03-ex-big">${t.example}</p>
        ${/\d/.test(t.example) ? disclaimer(g) : ''}
      </section>
      ${groups.length ? html`<section class="s03-block" aria-labelledby="s03-conf-h">
        <h2 id="s03-conf-h">${g.relationsTitle}</h2>
        ${groups.map(gr => html`<p class="s03-conf-note"><strong>Не бъркай с…</strong> ${gr.note}</p>${chips({ label: 'Не бъркай с', items: gr.items.map(x => ({ label: x.name, href: termHref(ctx, x.slug) })) })}`)}
      </section>` : ''}
      ${(t.see || []).length ? html`<section class="s03-block" aria-labelledby="s03-see-h">
        <h2 id="s03-see-h">Къде е това в бюджета?</h2>
        ${t.see.map(s => html`<p class="s03-see"><a class="btn btn-primary" href="${s.href}">${s.label}${icon('arrowRight', { size: 16 })}</a>${screenTitle(s.href) ? html` <span class="muted">Отваря екрана „${screenTitle(s.href)}“.</span>` : ''}</p>`)}
      </section>` : ''}
      <section class="s03-block" aria-labelledby="s03-ask-h">
        <h2 id="s03-ask-h">Още не разбирам</h2>
        <p class="muted">Обяснението не ти помага? Кажи ни какво остава неясно.</p>
        ${askForm('s03-ask', { term: t.slug, label: `Какво още не ти е ясно за „${t.name}“?`, hint: 'Пиши със свои думи. Не пиши лични данни.' })}
      </section>
      ${others.length ? html`<section class="s03-block" aria-labelledby="s03-more-h">
        <h2 id="s03-more-h">Още от темата „${cat.short}“</h2>
        ${chips({ label: `Термини от темата ${cat.short}`, items: others.map(x => ({ label: x.t.name, href: termHref(ctx, x.t.slug) })) })}
      </section>` : ''}
      <p class="s03-back"><a href="${ctx.href('S03')}">${icon('arrowLeft', { size: 16 })} Към целия речник</a></p>
      ${credit(g)}`
  };
}

function missing(ctx, I) {
  const slug = String(ctx.params.term || '');
  const near = [...searchGlossary(I, slug.replace(/-/g, ' ')).slice(0, 4).map(h => h.e), ...nearest(I, slug.replace(/-/g, ' '))]
    .filter((e, i, a) => a.indexOf(e) === i).slice(0, 4);
  return {
    eyebrow: 'Речник',
    body: html`
      ${emptyState({ title: 'Няма такъв термин', text: 'Адресът не води до дума от речника. Може да е сгрешен или думата да е преименувана.', icon: 'search', action: { href: ctx.href('S03'), label: 'Към целия речник' } })}
      ${near.length ? html`<section class="s03-block" aria-labelledby="s03-near-h"><h2 id="s03-near-h">Може би имаш предвид</h2>${chips({ label: 'Може би имаш предвид', items: near.map(e => ({ label: e.t.name, href: termHref(ctx, e.t.slug) })) })}</section>` : ''}`
  };
}

export function render(ctx) {
  const I = indexOf(ctx.data.glossary);
  if (!ctx.params.term) return overview(ctx, I);
  const e = I.bySlug.get(String(ctx.params.term).toLowerCase());
  return e ? termPage(ctx, I, e) : missing(ctx, I);
}

/* ------------------------------------------------------------------ behaviour */

export function mount(root, ctx) {
  const off = [];
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); off.push(() => el.removeEventListener(ev, fn, opt)); };
  const g = ctx.data.glossary;
  const I = indexOf(g);

  /* „Още не разбирам“ (both views): validate, keep the entry in this browser, say thanks and, with an address, link the ready e-mail */
  on(root, 'submit', e => {
    const f = e.target.closest('form[data-s03-ask]');
    if (f) {
      e.preventDefault();
      const ta = f.elements.text, err = f.querySelector('.field-error'), done = f.querySelector('[data-s03-done]');
      const text = ta.value.trim();
      done.hidden = true;
      if (text.length < 5) {
        err.textContent = 'Напиши поне няколко думи, за да разберем какво не е ясно.';
        err.hidden = false;
        ta.setAttribute('aria-invalid', 'true');
        ta.focus();
        return;
      }
      err.hidden = true; err.textContent = '';
      ta.removeAttribute('aria-invalid');
      const rec = feedback.add({ type: 'unclear', text, route: 'S03', term: f.dataset.term });
      const mail = f.querySelector('[data-s03-mail]');
      if (mail) mail.href = feedback.mailto(rec);
      ta.value = '';
      done.hidden = false;
      ctx.announce(feedback.SENT);
      return;
    }
    if (e.target.closest('form[data-s03-search]')) e.preventDefault();          // Enter in the search box: no navigation
  });
  on(root, 'input', e => {
    const ta = e.target.closest?.('form[data-s03-ask] textarea');
    if (ta) ta.form.querySelector('[data-s03-done]').hidden = true;
    if (ta && ta.getAttribute('aria-invalid')) {
      ta.removeAttribute('aria-invalid');
      const err = ta.form.querySelector('.field-error');
      err.hidden = true; err.textContent = '';
    }
  });

  const res = root.querySelector('#s03-results');
  if (!res) return () => off.forEach(f => f());          // a single term, or an unknown address: nothing more to wire

  /* the overview: search, theme, letter; the list is swapped in place so typing never loses focus */
  const st = viewState(ctx, I);
  const input = root.querySelector('#s03-q');
  const count = root.querySelector('#s03-count');
  const toggleAll = root.querySelector('[data-s03-toggle-all]');
  const reset = root.querySelector('[data-s03-reset]');
  let discOff = [], typed = 0, said = 0;

  const wireDisclosures = () => {
    discOff.forEach(f => f());
    discOff = [];
    for (const el of res.querySelectorAll('[data-ui="disclosure"]')) {
      if (el.dataset.hydrated) continue;
      el.dataset.hydrated = '1';
      const c = mountDisclosure(el);
      if (typeof c === 'function') discOff.push(c);
    }
  };
  off.push(() => discOff.forEach(f => f()));

  const syncToggle = () => {
    const ds = [...res.querySelectorAll('details.disc')];
    toggleAll.hidden = !ds.length;
    toggleAll.textContent = ds.length && ds.every(d => d.open) ? 'Свий всички' : 'Разгъни всички';
  };

  const apply = ({ say = false } = {}) => {
    const { hits, counts } = view(I, st);
    res.innerHTML = String(resultsHtml(ctx, I, st, hits));
    wireDisclosures();
    const text = countText(I, st, hits.length);
    count.textContent = text;
    for (const b of root.querySelectorAll('[data-chip^="cat:"]')) {
      const id = b.dataset.chip.slice(4);
      b.setAttribute('aria-pressed', String(id === st.cat));
      const c = b.querySelector('.chip-count');
      if (c) c.textContent = String(counts[id || 'all']);
    }
    for (const b of root.querySelectorAll('[data-chip^="l:"]')) b.setAttribute('aria-pressed', String(b.dataset.chip.slice(2) === st.l));
    reset.hidden = !(st.q || st.cat || st.l) || !hits.length;           // with no hits the empty state carries its own button
    syncToggle();
    ctx.setQuery({ q: st.q, cat: st.cat, l: st.l }, { rerender: false });
    if (say) { clearTimeout(said); said = setTimeout(() => ctx.announce(text), 500); }
  };
  off.push(() => { clearTimeout(typed); clearTimeout(said); });

  on(input, 'input', () => {
    st.q = input.value.trim();
    clearTimeout(typed);
    typed = setTimeout(() => apply({ say: true }), 140);
  });
  on(input, 'keydown', e => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; st.q = ''; clearTimeout(typed); apply({ say: true }); }
    else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(typed); st.q = input.value.trim(); apply({ say: true }); res.querySelector('summary')?.focus(); }
  });

  on(root, 'click', e => {
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      e.preventDefault();
      const [kind, ...rest] = chip.dataset.chip.split(':'), v = rest.join(':');
      if (kind === 'cat') st.cat = v === st.cat ? '' : v;
      else if (kind === 'l') st.l = v === st.l ? '' : v;
      else if (kind === 'q') { st.q = v; input.value = v; }
      apply({ say: true });
      return;
    }
    if (e.target.closest('[data-s03-reset],[data-action="s03-reset"]')) {
      e.preventDefault();
      st.q = ''; st.cat = ''; st.l = ''; input.value = '';
      apply({ say: true });
      input.focus();
      return;
    }
    if (e.target.closest('[data-s03-toggle-all]')) {
      const ds = [...res.querySelectorAll('details.disc')];
      const open = !ds.every(d => d.open);
      ds.forEach(d => { d.open = open; });
      syncToggle();
    }
  });
  on(res, 'toggle', syncToggle, true);                  // `toggle` does not bubble: listen while it travels down
  syncToggle();

  return () => off.forEach(f => f());
}
