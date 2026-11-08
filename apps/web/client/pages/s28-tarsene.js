// S28 · Търсене (#/tarsene?q=…&g=…): the full results page of the search palette. Same engine and same index (searchlib.js).
// Results by group, updated IN PLACE while typing: the field is outside the results box and is never replaced, so the caret, the
// keyboard and an open on-screen keyboard stay where they are. ?q= and ?g= follow the screen (history.replaceState via ctx.setQuery).
// The field carries [data-search-field]: "/" and Ctrl/Cmd+K focus it instead of opening the palette (search.js checks for it).
import { html } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { byId, href as routeHref } from '../routes.js';
import { chips } from '../ui/chips.js';
import { emptyState, mockHidden } from '../ui/states.js';
import { statusPill } from '../ui/status.js';
import { getIndex, parse, run, mark, countText, hiddenText, groupLabel, screenOf, metaOf, POPULAR, MAX_QUERY } from '../searchlib.js';

export const needs = [];                                   // the index is optional and loaded by getIndex() (never rejects)
export const styles = ['s28-tarsene'];

const PER_GROUP = 5;                                       // hits per group on the „all“ view
const PER_PAGE = 40;                                       // hits per page on one group's view
const WHERE = new Set(['indicators', 'institutions', 'municipalities', 'measures', 'datasets']);   // groups whose hits say which screen they open
const START = ['S05', 'S06', 'S07', 'S10', 'S17', 'S18', 'S20', 'S03'];                            // „Или разгледай“ on the empty page

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);

function hit(e, toks) {
  const where = WHERE.has(e.group) ? screenOf(e.href) : null;
  const meta = metaOf(e);
  return html`<li class="s28-hit"${e.status === 'mock' ? html` data-mock="true"` : ''}>
    <div class="s28-top"><a class="s28-link" href="${e.href}">${mark(e.title, toks)}</a>${e.status === 'real' ? '' : statusPill(e.status)}</div>
    ${meta ? html`<p class="s28-sub">${meta}</p>` : ''}
    ${e.value ? html`<p class="s28-val">${e.value}</p>` : ''}
    ${where ? html`<p class="s28-in">Екран: ${where.title}</p>` : ''}
  </li>`;
}

const heading = (id, name, n) => html`<h2 class="s28-gh" id="${id}" tabindex="-1">${name}<span class="sr-only"> – ${countText(n)}</span><span class="s28-n" aria-hidden="true">${n}</span></h2>`;

/** the results box for a query: {html, say (the sentence for the live region), n}. Pure: used by render() and by the in-place updates of mount(). */
function view(ix, q, g, o) {
  const toks = parse(q);
  const note = ix.hasIndex ? '' : html`<p class="s28-note">${statusPill('pending')}<span>Показатели, ведомства и общини ще се търсят, когато данните бъдат включени. Засега търсим по екрани и понятия.</span></p>`;
  const suggest = chips({ label: 'Примерни търсения', items: POPULAR.map(w => ({ label: w, key: `q:${w}` })) });

  if (!toks.length) {
    const typed = !!q;                                      // something was typed, but it is too short to search for
    return {
      n: 0, say: typed ? 'Напиши поне две букви.' : '',
      html: html`<div class="s28-start">
        ${typed ? html`<p class="s28-short">Напиши поне две букви.</p>` : ''}
        <h2 class="s28-gh">Започни с някое от тези</h2>${suggest}
        <h2 class="s28-gh">Или разгледай</h2>
        <ul class="s28-quick">${START.map(id => byId[id]).filter(Boolean).map(r => html`<li><a href="${routeHref(r.id)}"><strong>${r.title}</strong><span>${r.desc}</span></a></li>`)}</ul>
        ${note}</div>`
    };
  }

  const res = run(ix.entries, toks, { onlyReal: !!o.onlyReal });
  const hiddenNote = res.hidden ? mockHidden(hiddenText(res.hidden)) : '';
  if (!res.hits.length) {
    return {
      n: 0, say: `Няма резултати за „${q}“`,
      html: html`${emptyState({ title: `${res.hidden ? 'Няма официални резултати за' : 'Няма резултат за'} „${q}“`, text: 'Опитай с по-кратка дума, с друго изписване (може и с латински букви) или с някое от тези:' })}${suggest}${hiddenNote}${note}`
    };
  }

  const by = new Map();                                     // groups in the order of their best hit (a Map: a group id is data, never a property name)
  for (const e of res.hits) { if (!by.has(e.group)) by.set(e.group, []); by.get(e.group).push(e); }
  const eg = by.has(g) ? g : '';                            // an unknown group, or one without hits for this query, shows everything
  const head = res.fuzzy
    ? html`<p class="s28-count">Няма точно съвпадение за „${q}“. Най-близките са:</p>`
    : html`<p class="s28-count"><strong>${countText(res.hits.length)}</strong> за „${q}“</p>`;
  const filter = by.size > 1
    ? chips({ label: 'Покажи само', cls: 's28-chips', items: [{ label: 'Всички', count: res.hits.length, key: 'g:', pressed: !eg }, ...[...by].map(([k, v]) => ({ label: groupLabel(k), count: v.length, key: `g:${k}`, pressed: eg === k }))] })
    : '';

  let body;
  if (eg) {
    const list = by.get(eg), shown = list.slice(0, PER_PAGE * (1 + (o.more || 0)));
    body = html`<section class="s28-grp" aria-labelledby="s28-gh">${heading('s28-gh', groupLabel(eg), list.length)}<ul class="s28-list">${shown.map(e => hit(e, toks))}</ul>
      ${list.length > shown.length ? html`<p class="s28-more">Показани са ${shown.length} от ${list.length}. <button type="button" class="btn btn-sm" data-more>Покажи още ${Math.min(PER_PAGE, list.length - shown.length)}</button></p>` : ''}</section>`;
  } else {
    body = [...by].map(([k, list], i) => html`<section class="s28-grp" aria-labelledby="s28-gh${i}">${heading(`s28-gh${i}`, groupLabel(k), list.length)}<ul class="s28-list">${list.slice(0, PER_GROUP).map(e => hit(e, toks))}</ul>
      ${list.length > PER_GROUP ? html`<p class="s28-more"><button type="button" class="btn btn-sm" data-chip="g:${k}">Покажи всички ${list.length} в „${groupLabel(k)}“</button></p>` : ''}</section>`);
  }
  return {
    n: res.hits.length,
    say: `${countText(res.hits.length)}${res.fuzzy ? ', най-близките до написаното' : ''}`,
    html: html`${head}${filter}${body}${hiddenNote}${note}`
  };
}

const form = q => html`<div class="s28-find"><form class="s28-form" role="search" aria-label="Търсене в сайта">
  <label class="field-label" for="s28-q">Какво търсиш?</label>
  <p class="field-hint" id="s28-hint">Показатели, ведомства, общини, мерки и понятия. Може и с латински букви: dds, plovdiv.</p>
  <div class="s28-bar">
    <div class="s28-wrap"><span class="s28-ic" aria-hidden="true">${icon('search', { size: 20 })}</span>
      <input class="input s28-q" id="s28-q" name="q" type="search" value="${q}" maxlength="${MAX_QUERY}" placeholder="Търси: ДДС, МВР, Пловдив…" aria-describedby="s28-hint" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" data-search-field>
      <button type="button" class="icon-btn s28-clear" aria-label="Изчисти търсенето"${q ? '' : html` hidden`}>${icon('x', { size: 18 })}</button></div>
    <button type="submit" class="btn btn-primary s28-go">Търси</button>
  </div></form></div>`;

export async function render(ctx) {
  const ix = await getIndex();
  const q = clean(ctx.query.q), g = String(ctx.query.g ?? '');
  return html`${form(q)}<div class="s28-out" id="s28-out" data-fk="s28-out">${view(ix, q, g, { onlyReal: !!store.get('onlyReal'), more: 0 }).html}</div>`;
}

export async function mount(root, ctx) {
  const ix = await getIndex();
  const input = root.querySelector('#s28-q'), out = root.querySelector('#s28-out'), clear = root.querySelector('.s28-clear'), formEl = root.querySelector('.s28-form');
  if (!input || !out || !clear || !formEl) return undefined;
  let q = clean(ctx.query.q), g = String(ctx.query.g ?? ''), more = 0, tType = 0, tSay = 0;

  const paint = () => {
    const v = view(ix, q, g, { onlyReal: !!store.get('onlyReal'), more });
    out.innerHTML = v.html.s;
    clearTimeout(tSay);
    tSay = setTimeout(() => { if (v.say) ctx.announce(v.say); }, 700);       // one sentence after the typing stops, not one per key
  };
  const apply = () => {
    clearTimeout(tType);
    clear.hidden = !input.value;
    const nq = clean(input.value);
    if (nq === q) return;
    q = nq; more = 0;
    if (!q) g = '';                                                             // an emptied field starts over
    ctx.setQuery({ q: q || null, g: q ? g || null : null }, { rerender: false });
    paint();
  };

  input.addEventListener('input', () => { clear.hidden = !input.value; clearTimeout(tType); tType = setTimeout(apply, 140); });
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown') { const first = out.querySelector('a.s28-link'); if (first) { e.preventDefault(); first.focus(); } }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; apply(); }
  });
  formEl.addEventListener('submit', e => { e.preventDefault(); apply(); });
  clear.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });

  out.addEventListener('click', e => {
    const b = e.target.closest('button[data-chip],button[data-more]');
    if (!b || !out.contains(b)) return;
    if (b.hasAttribute('data-more')) {
      const before = out.querySelectorAll('a.s28-link').length;
      more++; paint();
      out.querySelectorAll('a.s28-link')[before]?.focus();                      // the first of the newly shown hits
      return;
    }
    const k = b.dataset.chip || '';
    if (k.startsWith('q:')) { input.value = k.slice(2); apply(); input.focus(); return; }
    if (k.startsWith('g:')) {
      g = k.slice(2); more = 0;
      ctx.setQuery({ g: g || null }, { rerender: false });
      paint();
      ([...out.querySelectorAll('[data-chip]')].find(x => x.dataset.chip === k) || out.querySelector('.s28-gh'))?.focus();
    }
  });
  out.addEventListener('keydown', e => {                                        // ↑ ↓ between the results; ↑ from the first one goes back to the field
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const links = [...out.querySelectorAll('a.s28-link')], i = links.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) input.focus();
    else links[Math.max(0, Math.min(links.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });

  return () => { clearTimeout(tType); clearTimeout(tSay); };
}
