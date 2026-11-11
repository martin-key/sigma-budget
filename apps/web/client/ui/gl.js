// A glossary term in running text: a dotted-underlined link that opens the term popover (glossary.js) and,
// without JS or data, simply goes to the glossary page.  Rules (PLAN 6.3): once per screen, at most 3 per paragraph,
// never inside headings, numbers, tables or buttons.
//   gl('dds', 'ДДС')   ->   <a class="gl" data-gl="dds" href="#/rechnik/dds">ДДС</a>
import { html } from '../html.js';

export const gl = (slug, text) =>
  html`<a class="gl" data-gl="${slug}" href="#/rechnik/${slug}" aria-haspopup="dialog">${text ?? slug}</a>`;
