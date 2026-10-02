// Glossary in place: the term popover (a bottom sheet on phones) and the scanner that links terms in running text.
//   openTerm(anchor, slug)   open the popover for `slug` next to `anchor`; called by the delegated `a[data-gl]` click handler (actions.js)
//   scan(root)               link the first mention of each term inside `[data-gl-scan]` containers; the router awaits it after every render. -> Promise<number linked>
//   ready() -> Promise<{terms, by:Map(slug -> term)}>, termOf(slug), titleOf(term)   for screens that need the data themselves (S03, tests)
// Data: data/glossary.json -> terms[{slug, title, name, abbr?, def, example, aliases[], related[{slug, note}], see[{label, href}]}].
// Without the data (pending) or for an unknown slug the visitor simply lands on #/rechnik/<slug>: a click is never dead and never an error.
//
// The popover: definition, example, related terms (they swap the content in place, with a „back“ button), the „Виж в бюджета“ links of the term and a
// link to the full entry. Keyboard: focus lands on the popover (its name and the definition are read out), Tab walks the links, Tab past the last one or
// Esc closes it and the focus returns to the word. A second click on the same word closes it.
// The scanner (PLAN 6.3): the first mention of a term on the screen becomes a link, at most 3 per paragraph, never inside headings, numbers (the word right
// after „5,7% от“), tables, buttons or other links. Only the curated forms below are linked (with articles and plurals); common words alone („бюджет“,
// „приходи“, „разходи“) never are. A term the screen already linked by hand with gl() counts as done.
import { html, nextId } from './html.js';
import { data } from './data.js';
import { popover } from './ui/sheet.js';
import { go } from './router.js';

const HREF = slug => `#/rechnik/${slug}`;
export const titleOf = t => (t.abbr ? `${t.name} – ${t.abbr}` : t.title || t.name || t.slug);

/* ------------------------------------------------------------------ data */
let ix = null;
function index(doc) {
  if (ix && ix.doc === doc) return ix;
  const terms = Array.isArray(doc?.terms) ? doc.terms.filter(t => t && t.slug) : [];
  ix = { doc, terms, by: new Map(terms.map(t => [t.slug, t])) };
  return ix;
}
export const ready = () => data.load('glossary').then(index);
export const termOf = slug => { const d = data.get('glossary'); return d ? index(d).by.get(slug) : undefined; };
const expected = e => e instanceof data.PendingError || e instanceof data.LoadError;

/* ------------------------------------------------------------------ popover */
let cur = null;       // the open popover: {pop, opener, slug, trail:[slugs we came from], g}

function bodyOf(term, g, trail) {
  const rel = (term.related || []).map(r => ({ t: g.by.get(r.slug), note: r.note })).filter(r => r.t);
  const notes = [...new Set(rel.map(r => r.note).filter(Boolean))];
  const see = (term.see || []).filter(s => s && s.label && /^#\//.test(s.href || ''));
  const prev = trail.length ? g.by.get(trail[trail.length - 1]) : null;
  return html`<div class="gl-pop" tabindex="-1">
    ${prev ? html`<p class="gl-trail"><button type="button" class="link-btn" data-gl-back>← ${titleOf(prev)}</button></p>` : ''}
    <p class="gl-def" id="${nextId('gl-def')}">${term.def || ''}</p>
    ${term.example ? html`<div class="gl-ex"><strong class="gl-ex-h">Пример</strong><p>${term.example}</p></div>` : ''}
    ${rel.length ? html`<div class="gl-relbox"><p class="gl-h">Свързани понятия</p>
      <ul class="gl-rel">${rel.map(r => html`<li><a class="chip" href="${HREF(r.t.slug)}" data-gl-rel="${r.t.slug}">${r.t.name || titleOf(r.t)}</a>${notes.length > 1 && r.note ? html` <span class="gl-note">${r.note}</span>` : ''}</li>`)}</ul>
      ${notes.length === 1 ? html`<p class="gl-note">${notes[0]}</p>` : ''}</div>` : ''}
    <p class="gl-more">${see.map(s => html`<a class="gl-see" href="${s.href}">${s.label} <span aria-hidden="true">→</span></a>`)}<a class="gl-full" href="${HREF(term.slug)}">Пълно обяснение в речника <span aria-hidden="true">→</span></a></p>
  </div>`;
}

function show(opener, term, g, trail) {
  const title = titleOf(term);
  const pop = popover.open(opener, {
    title, label: `Речник: ${title}`, id: 'gl-pop', body: bodyOf(term, g, trail),
    onClose: () => { if (cur && cur.pop === pop) cur = null; }
  });
  cur = { pop, opener, slug: term.slug, trail, g };
  const box = pop.el.querySelector('.gl-pop');
  const def = box && box.querySelector('.gl-def');
  if (def) pop.el.setAttribute('aria-describedby', def.id);
  pop.el.addEventListener('click', onPopClick, true);       // capture: runs before the popover's own „close on in-app link“ handler
  if (box) box.focus({ preventScroll: true });
}

/** a related term or „back“ inside the popover: swap the content, keep the word the visitor started from as the place to return the focus to */
function onPopClick(e) {
  if (!cur || !(e.target instanceof Element)) return;
  const rel = e.target.closest('a[data-gl-rel]');
  const back = e.target.closest('button[data-gl-back]');
  if (!rel && !back) return;
  if (rel && (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;     // new tab and the like: let the link work
  e.preventDefault();
  e.stopPropagation();
  const { opener, g, trail, slug } = cur;
  const next = g.by.get(rel ? rel.dataset.glRel : trail[trail.length - 1]);
  if (!next) return;
  cur.pop.close(false);
  show(opener, next, g, rel ? [...trail, slug] : trail.slice(0, -1));
}

export async function openTerm(anchor, slug) {
  const to = (anchor && anchor.getAttribute && anchor.getAttribute('href')) || HREF(slug);
  let g;
  try { g = await ready(); } catch (e) { if (!expected(e)) console.error(e); go(to); return; }
  const term = g.by.get(slug);
  if (!term) { go(to); return; }
  if (cur && cur.opener === anchor && cur.pop.el.isConnected) { cur.pop.close(true); return; }   // the same word again: close
  show(anchor, term, g, []);
}

/* ------------------------------------------------------------------ scanner */
// [slug, forms] — forms are regular-expression source: Bulgarian articles and plurals; matched case-insensitively between non-letters.
const LINKS = [
  ["kfp", "КФП|консолидиран(?:ата|а)\\s+фискалн(?:ата|а)\\s+програм(?:ата|а)"],
  ["bvp", "БВП|брут(?:ен|ния|ният)\\s+вътрешен\\s+продукт"],
  ["dds", "ДДС|данък(?:а|ът)?\\s+върху\\s+добавената\\s+стойност"],
  ["nov-dalg-novo-zaemane", "нов(?:ия|ият)?\\s+дълг|новопоет(?:ия|ият)?\\s+дълг|ново(?:то)?\\s+заемане"],
  ["darzhaven-dalg", "държав(?:ен|ния|ният)\\s+дълг(?:ът|а)?|(?<!общинския\\s|общински\\s|нов\\s|новия\\s|новият\\s|новопоет\\s|новопоетия\\s|новопоетият\\s)дълг(?:ът|а)?"],
  ["byudzheten-defitsit", "дефицит(?:ът|а|и|ите)?"],
  ["byudzheten-izlishak", "излиш(?:ък|ъкът|ъка|ъци|ъците)"],
  ["byudzhetno-saldo", "салдо(?:то)?"],
  ["balansiran-byudzhet", "балансиран(?:ия|ият)?\\s+бюджет(?:ът|а)?"],
  ["lihva", "лихв(?:а|ата|и|ите)"],
  ["glavnitsa", "главниц(?:а|ата)"],
  ["refinansirane", "рефинансиране(?:то)?"],
  ["fiskalen-rezerv", "фискал(?:ен|ния|ният)\\s+резерв(?:ът|а)?"],
  ["darzhavna-garantsiya", "държавн(?:а|ата|и|ите)\\s+гаранци(?:я|ята|и|ите)"],
  ["kapitalovi-razhodi", "капиталов(?:и|ите)\\s+разход(?:и|ите)|капиталов\\s+разход"],
  ["tekushti-razhodi", "текущ(?:и|ите)\\s+разход(?:и|ите)|текущ\\s+разход"],
  ["nedanachni-prihodi", "неданъчн(?:и|ите)\\s+приход(?:и|ите)"],
  ["danachni-prihodi", "данъчн(?:и|ите)\\s+приход(?:и|ите)"],
  ["bezvazmezdno-finansirane", "безвъзмездно(?:то)?\\s+финансиране"],
  ["aktsiz", "акциз(?:ът|а|и|ите)?"],
  ["osiguritelni-vnoski", "осигурителн(?:и|ите)\\s+вноск(?:и|ите)|осигуровк(?:и|ите)"],
  ["osiguritelen-dohod", "осигурител(?:ен|ния|ният)\\s+доход(?:ът|а)?"],
  ["brutna-zaplata", "брутн(?:а|ата)(?:\\s+си)?(?:\\s+месечн(?:а|ата))?\\s+заплат(?:а|ата)"],
  ["netna-zaplata", "нетн(?:а|ата)\\s+заплат(?:а|ата)"],
  ["danak-varhu-dohodite", "данък(?:ът|а)?\\s+върху\\s+доход(?:а|ите)"],
  ["korporativen-danak", "корпоратив(?:ен|ния|ният)\\s+данък"],
  ["danachna-osnova", "данъчн(?:а|ата)\\s+основ(?:а|ата)"],
  ["danachna-stavka", "данъчн(?:а|ата|и|ите)\\s+ставк(?:а|ата|и|ите)"],
  ["byudzhetna-funktsiya", "(?:бюджетн(?:а|ата|и|ите)\\s+)?функци(?:я|ята|и|ите)"],
  ["byudzhetna-programa", "бюджетн(?:а|ата|и|ите)\\s+програм(?:а|ата|и|ите)|(?<=политики\\s+и\\s+)програм(?:и|ите)"],
  ["parvostepenen-razporeditel-s-byudzhet", "(?:първостепен(?:ен|ния|ният|ни|ните)\\s+)?разпоредител(?:и|ите|я|ят)?(?:\\s+с\\s+бюджет)?"],
  ["prihodna-myarka", "приходн(?:а|ата)\\s+мярк(?:а|ата)|приходн(?:и|ите)\\s+мерк(?:и|ите)"],
  ["razhodna-myarka", "разходн(?:а|ата)\\s+мярк(?:а|ата)|разходн(?:и|ите)\\s+мерк(?:и|ите)"],
  ["fiskalen-efekt", "(?:фискал|бюджет)(?:ен|ния|ният)\\s+ефект(?:ът|а)?"],
  ["bazov-stsenariy", "(?:базов(?:ия|ият)?\\s+)?сценари(?:й|я|ят)"],
  ["nachislena-osnova", "начислен(?:а|ата)\\s+основ(?:а|ата)"],
  ["kasova-osnova", "касов(?:а|ата)\\s+основ(?:а|ата)"],
  ["sezonnost", "сезонност(?:та)?"],
  ["inflatsiya", "инфлаци(?:я|ята)"],
  ["protsenten-punkt", "процент(?:ен|ния|ният)\\s+пункт(?:ът|а)?|процентни(?:те)?\\s+пункт(?:а|ове|овете)"],
  ["nominalen-rast", "номинал(?:ен|ния|ният)\\s+ръст(?:ът|а)?"],
  ["realen-rast", "реал(?:ен|ния|ният)\\s+ръст(?:ът|а)?"],
  ["dyal-ot-bvp", "(?:дял|дела|делът)\\s+от\\s+БВП"],
  ["sektor-darzhavno-upravlenie", "сектор(?:а|ът)?\\s+„Държавно\\s+управление“"],
  ["konsolidirane", "консолидиране(?:то)?|консолидаци(?:я|ята)"],
  ["byudzheten-transfer", "(?:бюджет(?:ен|ния|ният)\\s+)?трансфер(?:ът|а|и|ите)?"],
  ["subsidiya", "субсиди(?:я|ята|и|ите)"],
  ["obshtestvena-porachka", "обществен(?:а|ата|и|ите)\\s+поръчк(?:а|ата|и|ите)"],
  ["priet-byudzhet", "прие(?:т|тия|тият)\\s+бюджет(?:ът|а)?"],
  ["proektobyudzhet", "проектобюджет(?:ът|а)?"],
  ["aktualizatsiya-na-byudzheta", "актуализаци(?:я|ята)\\s+на\\s+бюджета"],
  ["byudzhetna-prognoza", "(?:бюджетн(?:а|ата|и|ите)\\s+)?прогноз(?:а|ата|и|ите)"],
  ["darzhaven-byudzhet", "държав(?:ен|ния|ният)\\s+бюджет(?:ът|а)?"],
  ["obshtinski-byudzhet", "общинск(?:и|ия|ият|ите)\\s+бюджет(?:и|ите|ът|а)?"],
  ["obsht-razhod-na-rabotodatelya-za-zaplata", "общ(?:ия|ият)?\\s+разход(?:ът|а)?\\s+на\\s+работодателя(?:\\s+за\\s+заплат(?:а|ата))?|разход(?:ът|а)?\\s+на\\s+работодателя"],
  ["razhod-na-chovek", "разход(?:ът|а)?\\s+на\\s+(?:един\\s+)?човек"],
  ["otchet-za-byudzheta", "отчет(?:ът|а)?\\s+за\\s+(?:изпълнението\\s+на\\s+)?(?:държавния\\s+)?бюджет(?:а|ът)?"],
  ["izpalnenie-na-byudzheta", "изпълнение(?:то)?\\s+на\\s+(?:държавния\\s+)?бюджет(?:а|ът)?"],
  ["byudzhetna-godina", "бюджетн(?:а|ата)\\s+годин(?:а|ата)"]
];
// the same word after a number is a quantity, not a lesson („5,7% от БВП“, „70 млн. евро дълг“)
const NUM = /\d[\d\s.,]*(?:\s*(?:%|€|евро|лв\.|лева|млрд\.|млн\.|хил\.|пр\.п\.))*\s*(?:от\s+)?$/u;
// a bare „дълг“ in a sentence about municipalities is municipal debt, not „Държавен дълг“
const GUARD = { 'darzhaven-dalg': (m, s) => /^държав/i.test(m[0]) || !/общин/i.test(s) };
const IN = 'p, li, dd, blockquote, figcaption';
const SKIP = 'a, button, summary, label, select, option, textarea, input, h1, h2, h3, h4, h5, h6, table, svg, code, kbd, mark, nav, [data-gl-skip], .sr-only, .kpi, .chip, .eyebrow, .fig-legend';
const MAX = 3;        // links per paragraph; the rest wait for their next mention

let compiled = null;
function patterns(g) {
  if (compiled && compiled.g === g) return compiled.list;
  const list = LINKS.filter(([slug]) => g.by.has(slug))
    .map(([slug, re]) => ({ slug, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${re})(?![\\p{L}\\p{N}])`, 'giu') }));
  compiled = { g, list };
  return list;
}

function find(p, s) {
  p.re.lastIndex = 0;
  for (let m = p.re.exec(s); m; m = p.re.exec(s)) {
    if (!NUM.test(s.slice(Math.max(0, m.index - 24), m.index)) && (!GUARD[p.slug] || GUARD[p.slug](m, s))) return m;
  }
  return null;
}

function link(root, g) {
  const pats = patterns(g);
  const all = [...(root.matches && root.matches('[data-gl-scan]') ? [root] : []), ...root.querySelectorAll('[data-gl-scan]')];
  const hosts = all.filter(c => !all.some(o => o !== c && o.contains(c)));
  if (!hosts.length) return 0;
  const screen = root.closest ? root.closest('article.page') || root : root;
  const done = new Set();
  const per = new Map();                                       // paragraph -> links in it so far (hand-made ones count)
  const boxOf = (el, host) => { const b = el.closest(IN); return b && host.contains(b) ? b : host; };
  const hostOf = el => hosts.find(h => h.contains(el)) || hosts[0];
  screen.querySelectorAll('a[data-gl]').forEach(a => {
    done.add(a.dataset.gl);
    const h = hostOf(a);
    if (h.contains(a)) per.set(boxOf(a, h), (per.get(boxOf(a, h)) || 0) + 1);
  });

  const nodes = [];
  for (const host of hosts) {
    const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (n.nodeValue.trim().length < 3 || !el || el.closest(SKIP)) continue;
      nodes.push({ n, host, hidden: !!el.closest('details:not([open]), [hidden]') });
    }
  }
  let added = 0;
  for (const { n, host } of [...nodes.filter(x => !x.hidden), ...nodes.filter(x => x.hidden)]) {     // text you can see first, then the folded text
    const box = boxOf(n.parentElement, host);
    let cur = n;
    while (cur && (per.get(box) || 0) < MAX) {
      let best = null;
      for (const p of pats) {
        if (done.has(p.slug)) continue;
        const m = find(p, cur.nodeValue);
        if (m && (!best || m.index < best.i || (m.index === best.i && m[0].length > best.len))) best = { i: m.index, len: m[0].length, slug: p.slug };
      }
      if (!best) break;
      const word = cur.splitText(best.i);
      const rest = word.splitText(best.len);
      const a = document.createElement('a');
      a.className = 'gl';
      a.href = HREF(best.slug);
      a.dataset.gl = best.slug;
      a.setAttribute('aria-haspopup', 'dialog');
      word.replaceWith(a);
      a.appendChild(word);
      done.add(best.slug);
      per.set(box, (per.get(box) || 0) + 1);
      added++;
      cur = rest;
    }
  }
  return added;
}

export async function scan(root = document) {
  let g;
  try { g = await ready(); } catch (e) { if (!expected(e)) console.error(e); return 0; }
  return link(root, g);
}
