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
// The scanner (PLAN 6.3, js/glossary-scan.js, which the server runs too): the first mention of a term on the screen becomes a link, at most 3 per paragraph, never inside headings, numbers (the word right
// after „5,7% от“), tables, buttons or other links. Only the curated forms below are linked (with articles and plurals); common words alone („бюджет“,
// „приходи“, „разходи“) never are. A term the screen already linked by hand with gl() counts as done.
import { html, nextId } from './html.js';
import { data } from './data.js';
import { HREF, index, link } from './glossary-scan.js';
import { popover } from './ui/sheet.js';
import { go } from './router.js';
import { glossaryLinks } from './budget-documents.js';

export const titleOf = (t) => (t.abbr ? `${t.name} – ${t.abbr}` : t.title || t.name || t.slug);

/* ------------------------------------------------------------------ data */
export const ready = () => data.load('glossary').then(index);
export const termOf = (slug) => {
  const d = data.get('glossary');
  return d ? index(d).by.get(slug) : undefined;
};
const expected = (e) => e instanceof data.PendingError || e instanceof data.LoadError;

/* ------------------------------------------------------------------ popover */
let cur = null; // the open popover: {pop, opener, slug, trail:[slugs we came from], g}

function bodyOf(term, g, trail) {
  const rel = (term.related || [])
    .map((r) => ({ t: g.by.get(r.slug), note: r.note }))
    .filter((r) => r.t);
  const notes = [...new Set(rel.map((r) => r.note).filter(Boolean))];
  const see = glossaryLinks(term).filter((s) => s && s.label && /^#\//.test(s.href || ''));
  const prev = trail.length ? g.by.get(trail[trail.length - 1]) : null;
  return html`<div class="gl-pop" tabindex="-1">
    ${prev ? html`<p class="gl-trail"><button type="button" class="link-btn" data-gl-back>← ${titleOf(prev)}</button></p>` : ''}
    <p class="gl-def" id="${nextId('gl-def')}">${term.def || ''}</p>
    ${term.example ? html`<div class="gl-ex"><strong class="gl-ex-h">Пример</strong><p>${term.example}</p></div>` : ''}
    ${
      rel.length
        ? html`<div class="gl-relbox"><p class="gl-h">Свързани понятия</p>
      <ul class="gl-rel">${rel.map((r) => html`<li><a class="chip" href="${HREF(r.t.slug)}" data-gl-rel="${r.t.slug}">${r.t.name || titleOf(r.t)}</a>${notes.length > 1 && r.note ? html` <span class="gl-note">${r.note}</span>` : ''}</li>`)}</ul>
      ${notes.length === 1 ? html`<p class="gl-note">${notes[0]}</p>` : ''}</div>`
        : ''
    }
    <p class="gl-more">${see.map((s) => html`<a class="gl-see" href="${s.href}">${s.label} <span aria-hidden="true">→</span></a>`)}<a class="gl-full" href="${HREF(term.slug)}">Пълно обяснение в речника <span aria-hidden="true">→</span></a></p>
  </div>`;
}

function show(opener, term, g, trail) {
  const title = titleOf(term);
  const pop = popover.open(opener, {
    title,
    label: `Речник: ${title}`,
    id: 'gl-pop',
    body: bodyOf(term, g, trail),
    onClose: () => {
      if (cur && cur.pop === pop) cur = null;
    },
  });
  cur = { pop, opener, slug: term.slug, trail, g };
  const box = pop.el.querySelector('.gl-pop');
  const def = box && box.querySelector('.gl-def');
  if (def) pop.el.setAttribute('aria-describedby', def.id);
  pop.el.addEventListener('click', onPopClick, true); // capture: runs before the popover's own „close on in-app link“ handler
  if (box) box.focus({ preventScroll: true });
}

/** a related term or „back“ inside the popover: swap the content, keep the word the visitor started from as the place to return the focus to */
function onPopClick(e) {
  if (!cur || !(e.target instanceof Element)) return;
  const rel = e.target.closest('a[data-gl-rel]');
  const back = e.target.closest('button[data-gl-back]');
  if (!rel && !back) return;
  if (rel && (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return; // new tab and the like: let the link work
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
  try {
    g = await ready();
  } catch (e) {
    if (!expected(e)) console.error(e);
    go(to);
    return;
  }
  const term = g.by.get(slug);
  if (!term) {
    go(to);
    return;
  }
  if (cur && cur.opener === anchor && cur.pop.el.isConnected) {
    cur.pop.close(true);
    return;
  } // the same word again: close
  show(anchor, term, g, []);
}

export async function scan(root = document) {
  let g;
  try {
    g = await ready();
  } catch (e) {
    if (!expected(e)) console.error(e);
    return 0;
  }
  return link(root, g);
}
