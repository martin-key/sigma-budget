// S30 · Няма такава страница (the 404). The router shows it for an address that matches no screen (ctx.params.path = what was typed, without the "#/")
// and for ctx.notFound() thrown by a real screen (then the path may be empty). One sentence that names the address (it is the lede under the heading),
// a search field and six places to start from (PLAN S30). Normal chrome (not bare), no „Следва“ card (next: []), no period line (periods: 'none').
// The field carries [data-search-field] like the one of S28: "/" and Ctrl/Cmd+K focus it instead of opening the palette on top of it.
import { html } from '../html.js';
import { toHref } from '../loc.js';
import { byId, href as routeHref } from '../routes.js';
import { linkCard } from '../ui/cards.js';
import { MAX_QUERY } from '../searchlib.js';

export const needs = [];
export const styles = ['s30-404'];

const START = ['S01', 'S06', 'S07', 'S10', 'S18', 'S03'];      // start, revenue, spending, who spends, my taxes, glossary
const MAX_SHOWN = 80;                                          // characters of the address that are printed

export function render(ctx) {
  const path = String(ctx.params.path ?? '').trim();
  const shown = path.length > MAX_SHOWN ? `${path.slice(0, MAX_SHOWN - 1)}…` : path;
  // the sentence is the lede (the line under the heading), so it is not repeated in the body
  const lede = html`${shown ? html`Адресът <code class="s30-path">${toHref('/' + shown)}</code>` : 'Този адрес'} не води до екран от сайта. Може да е изписан грешно или страницата да е преместена.`;
  return {
    lede,
    body: html`<div class="s30">
    <form class="s30-find" role="search" aria-label="Търсене в сайта">
      <label class="field-label" for="s30-q">Потърси това, което ти трябва</label>
      <div class="s30-bar">
        <input class="input s30-q" id="s30-q" name="q" type="search" maxlength="${MAX_QUERY}" placeholder="Търси: ДДС, МВР, Пловдив…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" data-search-field>
        <button type="submit" class="btn btn-primary s30-go">Търси</button>
      </div>
    </form>
    <h2 class="s30-h">Или тръгни от някое от тези места</h2>
    <ul class="s30-links">${START.map(id => byId[id]).filter(Boolean).map(r => html`<li>${linkCard({ href: routeHref(r.id), title: r.title, text: r.desc, icon: r.icon })}</li>`)}</ul>
  </div>`
  };
}

export function mount(root, ctx) {
  const form = root.querySelector('.s30-find'), input = root.querySelector('#s30-q');
  if (!form || !input) return undefined;
  form.addEventListener('submit', e => {                        // a plain form cannot navigate here (hash routes, CSP form-action 'none')
    e.preventDefault();
    const q = input.value.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
    ctx.go(routeHref('tarsene', {}, q ? { q } : {}));
  });
  return undefined;
}
