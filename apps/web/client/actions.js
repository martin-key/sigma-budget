// Global delegated handlers: one listener per event type for the whole document, so page markup only needs data-attributes.
//   [data-src="kfp,asbp"] [data-asof]   source card                 [data-share="blockId"]   share menu of a block
//   a[data-gl="slug"]                   glossary popover            [data-action="…"]        retry | set-period | legend | search | dismiss-banner | show-mock
//   [data-query="key"] on input/select  -> ?key=<value> (text inputs commit on Enter/blur)   <button data-query="key=value">
//       add data-norender when the page updates itself in place (tabs do this)
// "/" and Ctrl/Cmd+K open the search palette from any screen.
import { router, setQuery, rerender } from './router.js';
import { internal } from './loc.js';
import { store } from './store.js';
import { openSource } from './ui/source.js';
import { openLegend } from './ui/status.js';
import { shell, openSearch } from './shell.js';

const inField = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const plain = e => !(e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);

function onClick(e) {
  const t = e.target;
  if (!(t instanceof Element) || t.closest('[data-react-owned]')) return;

  const src = t.closest('[data-src]');
  if (src) { e.preventDefault(); openSource(src, src.dataset.src.split(',').map(s => s.trim()).filter(Boolean), { asOf: src.dataset.asof }); return; }

  const gl = t.closest('a[data-gl]');
  if (gl && plain(e)) {
    e.preventDefault();
    const slug = gl.dataset.gl || internal(gl.getAttribute('href') || '').replace(/^\/rechnik\//, '');
    import('./glossary.js').then(m => m.openTerm(gl, slug)).catch(err => { console.error(err); router.go(gl.getAttribute('href') || '#/rechnik'); });
    return;
  }

  const sh = t.closest('[data-share]');
  if (sh) {
    e.preventDefault();
    const address = location.href, id = sh.dataset.share;
    // SSR buttons precede the client share registry. Preserve the request until
    // the initial screen has registered its blocks, and never replay on another URL.
    router.initialReady.then(() => {
      if (location.href !== address) return;
      const anchor = sh.isConnected ? sh : [...document.querySelectorAll('[data-share]')].find(el => el.dataset.share === id);
      if (anchor) return import('./share.js').then(m => m.openMenu(anchor, id));
    }).catch(err => console.error(err));
    return;
  }

  const act = t.closest('[data-action]');
  if (act) {
    const a = act.dataset.action;
    if (a === 'retry') { e.preventDefault(); rerender(); }
    else if (a === 'set-period') { e.preventDefault(); store.set('period', act.dataset.value); }
    else if (a === 'legend') { e.preventDefault(); openLegend(act); }
    else if (a === 'search') { e.preventDefault(); openSearch(act); }
    else if (a === 'dismiss-banner') { e.preventDefault(); shell.dismissBanner(); }
    else if (a === 'show-mock') { e.preventDefault(); store.set('onlyReal', false); }
    return;
  }

  const q = t.closest('button[data-query],a[data-query]');
  if (q) {
    const [k, ...rest] = q.dataset.query.split('=');
    if (k) { e.preventDefault(); setQuery({ [k]: rest.join('=') }, { rerender: q.dataset.norender === undefined }); }
  }
}

function onChange(e) {
  const t = e.target;
  if (!(t instanceof Element) || t.closest('[data-react-owned]')) return;
  if (!router.current && t.matches('.unit-switch input[type=radio]') && t.checked) { store.set('unit', t.value); return; }
  if (!t.dataset || !t.dataset.query || t.tagName === 'BUTTON' || t.tagName === 'A') return;
  const k = t.dataset.query;
  let v = t.value;
  if (t.type === 'checkbox') v = t.checked ? '1' : '';
  else if (t.type === 'radio' && !t.checked) return;
  setQuery({ [k]: v }, { rerender: t.dataset.norender === undefined });
}

function onKey(e) {
  if (e.defaultPrevented) return;
  const k = e.key;
  const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === 'k' || k === 'K');
  const slash = k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !inField(e.target);
  if (!ctrlK && !slash) return;
  if (slash && document.querySelector('dialog[open]')) return;
  e.preventDefault();
  openSearch(document.getElementById('btn-search'));
}

// first touch of a glossary word (pointer or keyboard): fetch the module and the data so the click opens the popover at once
let warm = false;
function onWarm(e) {
  if (warm || e.target.closest?.('[data-react-owned]') || !(e.target instanceof Element) || !e.target.closest('a[data-gl]')) return;
  warm = true;
  import('./glossary.js').then(m => m.ready()).catch(() => { /* pending data: the click falls back to the full entry */ });
}

export function initActions() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerover', onWarm, { passive: true });
  document.addEventListener('focusin', onWarm, { passive: true });
}
