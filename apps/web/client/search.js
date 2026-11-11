// The search palette: a modal dialog opened with "/" or Ctrl/Cmd+K or the top-bar button, on every screen (actions.js and shell.js call openPalette).
//   openPalette(opener?, {q}?) -> {close, input}   idempotent: when it is already open it only refocuses the field
//   On the search page (S28) there is no palette: the page's own field (input[data-search-field]) is focused instead.
//   closePalette()
// Accessibility (ARIA combobox with a listbox popup): focus stays in the field; ArrowUp/ArrowDown move the active option (aria-activedescendant),
// Enter follows it (no active option: the full search page), Esc closes (native <dialog>, so focus is trapped and the page behind is inert).
// The first result is active from the start, so „ДДС“ + Enter is enough. Focus goes back to the opener on close, except after navigating
// (the router moves focus to the new screen's h1). The engine and the index are in searchlib.js; the full page is S28.
import { html } from './html.js';
import { isAppLink } from './loc.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { sheet, popover } from './ui/sheet.js';
import { statusPill } from './ui/status.js';
import {
  getIndex,
  parse,
  run,
  mark,
  countText,
  hiddenText,
  groupLabel,
  metaOf,
  POPULAR,
  MAX_QUERY,
} from './searchlib.js';

const MAX_SHOWN = 8;
let cur = null;

export const closePalette = () => cur?.close();

const allHref = (q) => `#/tarsene${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`;

function chipRow(words, label) {
  return html`<div class="chips" role="group" aria-label="${label}">${words.map((w) => html`<button type="button" class="chip" data-pal-q="${w}">${w}</button>`)}</div>`;
}

function itemHtml(e, id, toks) {
  return html`<a class="pal-item" role="option" id="${id}" href="${e.href}" tabindex="-1" aria-selected="false"><span class="pal-title">${mark(e.title, toks)}${e.status === 'real' ? '' : html` ${statusPill(e.status)}`}</span>${metaOf(e) ? html`<span class="pal-sub">${metaOf(e)}</span>` : ''}${e.value ? html`<span class="pal-val">${e.value}</span>` : ''}</a>`;
}

export function openPalette(opener, o = {}) {
  if (cur) {
    cur.input.focus();
    cur.input.select();
    return cur;
  }
  const own = document.querySelector('input[data-search-field]'); // the search page has its own field: focus it instead of opening a second search
  if (own && own.isConnected && !document.querySelector('dialog[open]')) {
    popover.close();
    if (o.q != null) {
      own.value = String(o.q).slice(0, MAX_QUERY);
      own.dispatchEvent(new Event('input', { bubbles: true }));
    }
    own.focus();
    own.select();
    return { input: own, close() {}, focus: () => own.focus() };
  }
  popover.close();
  sheet.close(); // one dialog at a time (synchronous: the scroll lock is released before this one takes it)
  const back =
    opener instanceof Element && opener.isConnected
      ? opener
      : document.getElementById('btn-search');
  const base = `pal${Date.now().toString(36)}`;
  const dlg = document.createElement('dialog');
  dlg.className = 'palette';
  dlg.id = 'palette';
  dlg.setAttribute('aria-labelledby', `${base}-t`);
  dlg.innerHTML = html`<div class="pal-in">
    <h2 class="sr-only" id="${base}-t">Търсене в сайта</h2>
    <div class="pal-field">${icon('search', { size: 20 })}<input id="${base}-q" type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-haspopup="listbox" aria-label="Търси в сайта" placeholder="Търси: ДДС, МВР, Пловдив…" maxlength="${MAX_QUERY}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search"><button type="button" class="icon-btn" data-close aria-label="Затвори търсенето">${icon('x', { size: 20 })}</button></div>
    <div class="pal-body" aria-busy="true"></div>
    <div class="pal-foot"><span class="kbd-hint"><kbd>↑</kbd> <kbd>↓</kbd> избор · <kbd>Enter</kbd> отваря · <kbd>Esc</kbd> затваря</span><a class="pal-all" href="#/tarsene">Всички резултати</a></div>
    <p class="sr-only" role="status" id="${base}-live"></p>
  </div>`.s;
  const input = dlg.querySelector('input'),
    body = dlg.querySelector('.pal-body'),
    live = dlg.querySelector('[role=status]'),
    all = dlg.querySelector('.pal-all');
  let ix = null,
    options = [],
    active = -1,
    moved = false,
    done = false,
    dirty = false,
    tPaint = 0,
    tLive = 0;

  const say = (msg) => {
    clearTimeout(tLive);
    tLive = setTimeout(() => {
      live.textContent = msg;
    }, 500);
  };
  const setActive = (i, scroll = true) => {
    active = options.length ? Math.max(0, Math.min(i, options.length - 1)) : -1;
    options.forEach((el, k) => el.setAttribute('aria-selected', k === active ? 'true' : 'false'));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', options[active].id);
      if (scroll) options[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  function paint() {
    dirty = false;
    clearTimeout(tPaint);
    const q = input.value,
      toks = parse(q),
      onlyReal = !!store.get('onlyReal');
    all.setAttribute('href', allHref(q));
    body.removeAttribute('aria-busy');
    if (!ix) {
      body.innerHTML = '<p class="pal-hint">Зареждаме…</p>';
      body.setAttribute('aria-busy', 'true');
      options = [];
      setActive(-1);
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    const noIndex = ix.hasIndex
      ? ''
      : html`<p class="pal-note">Предстои: показатели, ведомства и общини. Засега търсим по екрани и понятия.</p>`;
    if (!toks.length) {
      body.innerHTML =
        html`<div class="pal-hint"><p>Търси показатели, ведомства, общини, мерки и понятия.</p><p class="small">Можеш да пишеш и с латински букви: dds, plovdiv.</p>${chipRow(POPULAR, 'Примерни търсения')}</div>${noIndex}`.s;
      options = [];
      setActive(-1);
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-controls');
      say('');
      return;
    }
    const res = run(ix.entries, toks, { onlyReal });
    const shown = res.hits.slice(0, MAX_SHOWN);
    const hiddenNote = res.hidden
      ? html`<p class="pal-note">${hiddenText(res.hidden)} <button type="button" class="link-btn" data-pal-show-mock>Покажи</button></p>`
      : '';
    if (!shown.length) {
      body.innerHTML =
        html`<div class="pal-hint"><p>${res.hidden ? 'Няма официални резултати за' : 'Няма резултат за'} „${q.trim()}“.</p><p class="small">Опитай с по-кратка дума, с друго изписване или с някое от тези:</p>${chipRow(POPULAR, 'Примерни търсения')}</div>${hiddenNote}${noIndex}`.s;
      options = [];
      setActive(-1);
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-controls');
      say(`Няма резултати за „${q.trim()}“`);
      return;
    }
    const order = [];
    for (const e of shown) if (!order.includes(e.group)) order.push(e.group); // groups in the order of their best hit
    let n = 0;
    const groups = order.map((g) => {
      const hid = `${base}-g${order.indexOf(g)}`;
      return html`<div class="pal-group" role="group" aria-labelledby="${hid}"><div class="pal-gh" id="${hid}">${groupLabel(g)}</div>${shown.filter((e) => e.group === g).map((e) => itemHtml(e, `${base}-o${n++}`, toks))}</div>`;
    });
    const more =
      res.hits.length > shown.length
        ? html`<a class="pal-item pal-more" role="option" id="${base}-o${n++}" href="${allHref(q)}" tabindex="-1" aria-selected="false"><span class="pal-title">Покажи всички ${res.hits.length} резултата</span>${icon('arrowRight', { size: 18 })}</a>`
        : '';
    body.innerHTML =
      html`${res.fuzzy ? html`<p class="pal-note">Няма точно съвпадение за „${q.trim()}“. Най-близките са:</p>` : ''}<div class="pal-list" role="listbox" id="${base}-l" aria-label="Резултати">${groups}${more}</div>${hiddenNote}${noIndex}`.s;
    options = [...body.querySelectorAll('[role=option]')];
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', `${base}-l`);
    setActive(0, false);
    body.scrollTop = 0;
    say(`${countText(res.hits.length)}${res.fuzzy ? ', най-близките до написаното' : ''}`);
  }
  const schedule = () => {
    dirty = true;
    clearTimeout(tPaint);
    tPaint = setTimeout(paint, 60);
  };

  input.addEventListener('input', schedule);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (dirty) paint(); // the last key was not painted yet
      const target =
        active >= 0 && options[active] ? options[active] : parse(input.value).length ? all : null;
      // a real click on the link, with the modifiers of the key: Enter follows it, Ctrl/Cmd+Enter opens it in a new tab
      target?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        }),
      );
    }
  });
  dlg.addEventListener('pointermove', (e) => {
    const i = options.indexOf(e.target.closest?.('[role=option]'));
    if (i >= 0 && i !== active) setActive(i, false);
  });
  dlg.addEventListener('click', (e) => {
    const t = e.target;
    if (t === dlg || t.closest('[data-close]')) {
      dlg.close();
      return;
    } // backdrop or the X
    const chip = t.closest('[data-pal-q]');
    if (chip) {
      input.value = chip.dataset.palQ;
      input.focus();
      paint();
      return;
    }
    if (t.closest('[data-pal-show-mock]')) {
      store.set('onlyReal', false);
      input.focus();
      paint();
      return;
    }
    // a plain click on an in-app link: the router follows it (no hashchange for pushState), so the palette goes with the screen
    if (
      !e.defaultPrevented &&
      e.button === 0 &&
      !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) &&
      isAppLink(t.closest('a[href]'))
    ) {
      moved = true;
      dlg.close();
    }
  });
  const onHash = () => {
    moved = true;
    if (dlg.open) dlg.close();
    else finish();
  };
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(tPaint);
    clearTimeout(tLive);
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('popstate', onHash);
    dlg.remove();
    if (back) back.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('has-modal');
    if (cur === me) cur = null;
    if (!moved && back && back.isConnected) back.focus({ preventScroll: true });
  };
  dlg.addEventListener('close', finish);
  window.addEventListener('hashchange', onHash);
  window.addEventListener('popstate', onHash); // path mode: Back is a popstate, not a hashchange

  // V6 (26.10): the panel hangs under the header, below the magnifier that opened it (CSS: dialog.palette); the top edge follows the header, also after the page was scrolled
  const hb = document.getElementById('topbar');
  dlg.style.setProperty(
    '--pal-top',
    `${Math.max(8, Math.round(hb ? hb.getBoundingClientRect().bottom : 0) + 4)}px`,
  );
  if (back) back.setAttribute('aria-expanded', 'true');
  document.body.appendChild(dlg);
  document.documentElement.classList.add('has-modal');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  const me = (cur = {
    input,
    close: () => {
      if (dlg.open) dlg.close();
      else finish();
    },
    focus: () => input.focus(),
  });
  input.value = String(o.q || '').slice(0, MAX_QUERY);
  paint();
  input.focus();
  if (input.value) input.select();
  getIndex().then((x) => {
    ix = x;
    if (!done) paint();
  });
  return me;
}
