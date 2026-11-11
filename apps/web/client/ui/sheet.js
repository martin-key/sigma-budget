// Sheet (modal dialog / bottom sheet on phones) and popover (anchored, non-modal on wide screens).
//   sheet.open({title, body, id, wide, cls, returnFocus, onClose}) -> {el, close}   (cls: extra class, e.g. 'sheet-drawer' = the right-side menu drawer)
//   popover.open(anchor, {title, body, label, id, align:'start'|'end', onClose}) -> {el, close}
// body is SafeHtml (html`…`) | Node | string (shown as plain text).  Sheets use the native <dialog>: focus trap, Esc, inert background.
// A popover on a <=600px screen becomes a sheet.  Both return focus to the opener and close on Esc.
// Opening one while another is open replaces it at once; a change of the address hash (any navigation, also Back) closes it, so neither outlives its screen.
import { SafeHtml, esc, nextId } from '../html.js';
import { isAppLink } from '../loc.js';
import { icon } from '../icons.js';

const toNode = (body, into) => {
  if (body instanceof Node) into.appendChild(body);
  else into.innerHTML = body instanceof SafeHtml ? body.s : esc(body ?? ''); // plain strings are text, markup needs html``
};
const phone = () => window.matchMedia('(max-width:600px)').matches;
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let activeSheet = null;
let activePop = null;

export const sheet = {
  open(o = {}) {
    if (activeSheet) activeSheet.end(); // a second sheet replaces the first one at once (the native close event would come too late)
    const tid = nextId('sheet-t');
    const opener = o.returnFocus || document.activeElement;
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet' + (o.wide ? ' sheet-wide' : '') + (o.cls ? ' ' + o.cls : '');
    if (o.id) dlg.id = o.id;
    dlg.setAttribute('aria-labelledby', tid);
    dlg.innerHTML = `<div class="sheet-in"><header class="sheet-head"><h2 class="sheet-title" id="${tid}">${esc(o.title || '')}</h2><button type="button" class="icon-btn" data-close aria-label="Затвори">${icon('x', { size: 20 })}</button></header><div class="sheet-body"></div></div>`;
    toNode(o.body, dlg.querySelector('.sheet-body'));
    document.body.appendChild(dlg);
    let closed = false,
      moved = false;
    const onHash = () => {
      moved = true;
      if (dlg.open) dlg.close();
      else finish();
    }; // navigation: the router moves the focus, not this sheet
    const finish = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
      dlg.remove();
      const mine = !!activeSheet && activeSheet.el === dlg; // not the one that was already replaced
      if (mine) {
        activeSheet = null;
        document.documentElement.classList.remove('has-modal');
      }
      try {
        o.onClose?.();
      } catch (e) {
        console.error(e);
      }
      if (mine && !moved && opener && opener.isConnected && typeof opener.focus === 'function')
        opener.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    dlg.addEventListener('close', finish);
    dlg.addEventListener('cancel', () => {
      /* Esc: native close follows */
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) {
        dlg.close();
        return;
      } // backdrop or the X
      // a plain click on an in-app link: the router follows it (history.pushState fires no hashchange), so the sheet must go with the screen
      if (
        !e.defaultPrevented &&
        e.button === 0 &&
        !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) &&
        isAppLink(e.target.closest('a[href]'))
      ) {
        moved = true;
        dlg.close();
      }
    });
    document.documentElement.classList.add('has-modal');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    activeSheet = {
      el: dlg,
      close: () => (dlg.open ? dlg.close() : finish()),
      end: () => {
        if (dlg.open) dlg.close();
        finish();
      },
    };
    return activeSheet;
  },
  close() {
    activeSheet?.end();
  }, // synchronous: when this returns the sheet is gone (has-modal cleared, focus restored)
  get isOpen() {
    return !!activeSheet;
  },
};

function place(anchor, el, align) {
  const a = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth,
    vh = window.innerHeight;
  el.style.left = '0px';
  el.style.top = '0px';
  const w = el.offsetWidth,
    h = el.offsetHeight,
    m = 8;
  let left = align === 'end' ? a.right - w : a.left;
  left = Math.max(m, Math.min(left, vw - w - m));
  let top = a.bottom + 6;
  if (top + h > vh - m && a.top - 6 - h >= m) top = a.top - 6 - h; // flip above
  top = Math.max(m, Math.min(top, vh - h - m));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

export const popover = {
  open(anchor, o = {}) {
    if (phone())
      return sheet.open({
        title: o.title || o.label || '',
        body: o.body,
        returnFocus: anchor,
        id: o.id,
        onClose: o.onClose,
      });
    popover.close();
    const el = document.createElement('div');
    el.className = 'popover';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', o.label || o.title || 'Подробности');
    el.tabIndex = -1;
    if (o.id) el.id = o.id;
    el.innerHTML = `${o.title ? `<div class="pop-head"><strong>${esc(o.title)}</strong>` : '<div class="pop-head pop-head-bare">'}<button type="button" class="icon-btn" data-close aria-label="Затвори">${icon('x', { size: 18 })}</button></div><div class="pop-body"></div>`;
    toNode(o.body, el.querySelector('.pop-body'));
    document.body.appendChild(el);
    place(anchor, el, o.align);
    anchor.setAttribute('aria-expanded', 'true');
    let closed = false;
    const off = [];
    const on = (t, ev, fn, opt) => {
      t.addEventListener(ev, fn, opt);
      off.push(() => t.removeEventListener(ev, fn, opt));
    };
    const close = (back = true) => {
      if (closed) return;
      closed = true;
      off.forEach((f) => f());
      if (document.documentElement.classList.contains('mo')) {
        el.setAttribute('data-closing', '');
        el.setAttribute('inert', '');
        setTimeout(() => el.remove(), 170);
      } else el.remove(); // V6: a short fade-out (css/motion.css), only with motion on
      anchor.setAttribute('aria-expanded', 'false');
      if (activePop && activePop.el === el) activePop = null;
      try {
        o.onClose?.();
      } catch (e) {
        console.error(e);
      }
      if (back && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
    on(
      document,
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(true);
          return;
        }
        if (e.key === 'Tab') {
          const f = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
          if (!f.length) {
            close(true);
            return;
          }
          const first = f[0],
            last = f[f.length - 1];
          if (
            (!e.shiftKey && document.activeElement === last) ||
            (e.shiftKey && (document.activeElement === first || document.activeElement === el))
          )
            close(true);
        }
      },
      true,
    );
    on(
      document,
      'pointerdown',
      (e) => {
        if (!el.contains(e.target) && !anchor.contains(e.target)) close(false);
      },
      true,
    );
    on(el, 'click', (e) => {
      if (e.target.closest('[data-close]')) close(true);
      else if (isAppLink(e.target.closest('a[href]'))) close(false);
    });
    const reflow = () => {
      if (!anchor.isConnected) close(false);
      else place(anchor, el, o.align);
    };
    on(window, 'hashchange', () => close(false));
    on(window, 'popstate', () => close(false));
    on(window, 'resize', reflow);
    on(window, 'scroll', reflow, { passive: true, capture: true });
    // focus the first control (or the popover itself) so keyboard users land inside
    const first = el.querySelector(`.pop-body ${FOCUSABLE.split(',').join(',.pop-body ')}`);
    (first || el).focus({ preventScroll: true });
    activePop = { el, close };
    return activePop;
  },
  close() {
    activePop?.close(true);
  },
  get isOpen() {
    return !!activePop;
  },
};

/** Convenience: a small confirm-less message sheet */
export const note = (title, body) => sheet.open({ title, body });
