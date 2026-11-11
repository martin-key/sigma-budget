// Disclosure: a native <details> with the shared look. No ARIA needed: the browser exposes expanded/collapsed itself.
//   disclosure({id, title, meta, body, open, cls})
// - `id` is required (it is the `?to=` target and the key of the remembered state)
// - the visitor's own open/close survives a re-render (period or unit switch, „Опитай пак“) of the same screen: it is remembered
//   per screen + id until the page is reloaded. `open` is only the starting state (opening via `?to=` is not remembered).
// - `title` / `meta` may be text or markup; `body` is markup (a plain string is text). Do not put headings inside `title`.
// - `?to=<id>` of the disclosure itself or of anything inside it opens it (router).
import { html, raw, cx } from '../html.js';
import { here, parts as addrParts } from '../loc.js';

const MEM = new Map();
const memKey = (id) => `${addrParts(here()).path}|${id}`;

export function disclosure(o = {}) {
  if (!o.id) throw new Error('disclosure: id is required');
  const key = memKey(o.id);
  const open = MEM.has(key) ? MEM.get(key) : !!o.open;
  return html`<details class="${cx('disc', o.cls)}" id="${o.id}" data-ui="disclosure" data-mem="${key}"${open ? raw(' open') : ''}>
    <summary><span class="disc-title">${o.title}</span>${o.meta ? html` <span class="disc-meta">${o.meta}</span>` : ''}</summary>
    <div class="disc-body">${o.body ?? ''}</div>
  </details>`;
}

export function mount(el) {
  const key = el.dataset.mem,
    sum = el.querySelector(':scope > summary');
  if (!key || !sum) return undefined;
  let armed = false; // only a toggle that follows a click on the summary is the visitor's own choice
  const arm = () => {
    armed = true;
  };
  const on = () => {
    if (armed) {
      MEM.set(key, el.open);
      armed = false;
    }
  };
  sum.addEventListener('click', arm);
  el.addEventListener('toggle', on);
  return () => {
    sum.removeEventListener('click', arm);
    el.removeEventListener('toggle', on);
  };
}
