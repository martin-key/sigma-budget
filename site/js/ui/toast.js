// Toast: a short message. The container #toasts is the aria-live="polite" region (the toast itself has no role, so it is announced once).
//   toast('Линкът е копиран')  ·  toast('Грешка', {kind:'bad'})  ·  toast('Копирано', {action:{label:'Отмени', onClick(){…}}})
import { esc } from '../html.js';

export function toast(msg, o = {}) {
  const box = document.getElementById('toasts');
  if (!box) return { close() {} };
  const el = document.createElement('div');
  el.className = 'toast' + (o.kind ? ' toast-' + o.kind : '');
  el.innerHTML = `<span class="toast-msg">${esc(msg)}</span>${o.action ? `<button type="button" class="toast-act">${esc(o.action.label)}</button>` : ''}`;
  let timer = 0;
  const close = () => { clearTimeout(timer); el.remove(); };
  el.querySelector('.toast-act')?.addEventListener('click', () => { try { o.action.onClick?.(); } finally { close(); } });
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  timer = setTimeout(close, o.ms ?? (o.action ? 7000 : 3800));
  return { close };
}
