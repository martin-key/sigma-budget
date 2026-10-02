// S02 · Пътеводител · #/patevoditel/:step([1-8])? · next S01 · periods none
// The guide text (intro, 8 steps, the five checks) is rendered verbatim from data/guide.json (D23): nothing in this file retypes it.
// Only the interface words are ours: buttons, the progress card, the label above each note.
// Progress = store key `guide` = {step: 0..8}: the step whose screen the visitor opened last (0 = none yet).
//   #/patevoditel       the whole guide;  #/patevoditel/4  the same page, scrolled to step 4 with focus on its title.
import { html, cx } from '../html.js';
import { icon } from '../icons.js';
import { toggle } from '../ui/forms.js';
import { srcTag } from '../ui/source.js';

const TOTAL = 8;

export const needs = ['guide'];
export const styles = ['s02-patevoditel'];
export const lede = ctx => ctx.data.guide.lead;

const clampStep = v => (Number.isInteger(v) && v >= 0 && v <= TOTAL ? v : 0);

/** the thin strip: steps before `cur` are passed, `cur` is the last opened one */
function strip(cur) {
  const label = cur ? `Последно отворена: стъпка ${cur} от ${TOTAL}` : `Още няма отворена стъпка от ${TOTAL}`;
  return html`<ol class="steps s02-strip" aria-label="${label}">${Array.from({ length: TOTAL }, (_, i) => {
    const n = i + 1;
    if (n < cur) return html`<li data-done="true"><span class="sr-only">Стъпка ${n} (премината)</span></li>`;
    if (n === cur) return html`<li aria-current="step"><span class="sr-only">Стъпка ${n} (последно отворена)</span></li>`;
    return html`<li><span class="sr-only">Стъпка ${n}</span></li>`;
  })}</ol>`;
}

function resume(ctx, steps, cur) {
  const text = cur === 0 ? 'Още няма отворена стъпка.'
    : cur === TOTAL ? 'Отворена е и последната стъпка.'
      : `Последно отворена: стъпка ${cur} от ${TOTAL}.`;
  const actions = cur === 0
    ? html`<a class="btn btn-primary" href="${steps[0].screen.href}" data-s02-step="1" data-fk="s02-act">Започни със стъпка 1${icon('arrowRight', { size: 16 })}</a>`
    : html`<a class="btn btn-primary" href="${ctx.href('S02', { step: cur === TOTAL ? 1 : cur })}">${cur === TOTAL ? 'Прегледай от стъпка 1' : `Продължи от стъпка ${cur}`}</a>
      <button type="button" class="btn btn-quiet" data-s02-reset data-fk="s02-act">Започни отначало</button>`;
  return html`<section class="s02-resume" aria-labelledby="s02-resume-h">
    <h2 class="s02-resume-h" id="s02-resume-h">Твоят напредък</h2>
    ${strip(cur)}
    <p class="s02-resume-text">${text} <span class="muted">Напредъкът се пази само в този браузър.</span></p>
    <div class="cluster">${actions}</div>
  </section>`;
}

function note(b) {
  return html`<div class="s02-note"><p class="s02-note-label">На какво да внимаваш</p><p class="s02-note-text">${b.text}</p></div>`;
}

function stepItem(ctx, s, cur) {
  const n = s.n, done = n < cur, now = n === cur;
  return html`<li class="${cx('s02-step', { 'is-done': done, 'is-current': now })}" id="s02-step-${n}">
    <span class="s02-num" aria-hidden="true">${done ? icon('check', { size: 20 }) : n}</span>
    <div class="s02-main">
      <h3 class="s02-title" id="s02-step-${n}-h" tabindex="-1"><span class="sr-only">Стъпка ${n} от ${TOTAL}: </span>${s.title}${done ? html`<span class="sr-only"> (премината)</span>` : ''}</h3>
      ${now ? html`<p class="s02-tag">Последно отворена</p>` : ''}
      <p class="s02-intro">${s.intro}</p>
      ${(s.blocks || []).map(b => (b.role === 'note' ? note(b) : html`<p class="s02-intro">${b.text}</p>`))}
      <div class="s02-actions">
        <a class="btn btn-primary" href="${s.screen.href}" data-s02-step="${n}">Отвори<span class="sr-only"> „${s.screen.label}“</span>${icon('arrowRight', { size: 16 })}</a>
        ${n > 1 ? html`<a class="btn btn-quiet" href="${ctx.href('S02', { step: n - 1 })}">${icon('arrowLeft', { size: 16 })}Назад<span class="sr-only"> към стъпка ${n - 1}</span></a>` : ''}
      </div>
      ${s.next ? html`<p class="s02-next"><span class="s02-next-text">${s.next.text}</span> <a class="s02-next-link" href="${s.next.href}" data-s02-step="${s.next.n}">${s.next.title}</a></p>` : ''}
    </div>
  </li>`;
}

/** the sentence stays verbatim; the quoted name of the screen it mentions becomes a link */
function withLink(text, phrase, href) {
  const i = String(text).indexOf(phrase);
  if (i < 0) return text;
  return html`${text.slice(0, i)}<a href="${href}">${phrase}</a>${text.slice(i + phrase.length)}`;
}

function checks(ctx, c) {
  return html`<section class="s02-checks" aria-labelledby="s02-checks-h" data-gl-scan>
    <h2 id="s02-checks-h">${c.title}</h2>
    <p class="s02-checks-heading">${c.heading}</p>
    <p class="s02-checks-lead">${c.lead}</p>
    <ol class="s02-checks-list">${(c.items || []).map(it => html`<li class="s02-check"><span class="s02-check-n" aria-hidden="true">${it.n}</span><span class="s02-check-short">${it.short}<span class="sr-only">: </span></span><span class="s02-check-text">${it.text}</span></li>`)}</ol>
    <p class="s02-checks-end">${withLink(c.end, 'Откъде са данните?', ctx.href('S24'))}</p>
    ${toggle({ id: 's02-sources', label: 'Покажи източниците', hint: 'Показва откъде е всяко число.', checked: !!ctx.store.get('sources') })}
  </section>`;
}

export function render(ctx) {
  const g = ctx.data.guide;
  const cur = clampStep(ctx.store.get('guide')?.step);
  return html`
    ${resume(ctx, g.steps, cur)}
    <section class="s02-list" aria-labelledby="s02-steps-h">
      <h2 id="s02-steps-h">${g.title}</h2>
      <ol class="s02-steps" data-gl-scan>${g.steps.map(s => stepItem(ctx, s, cur))}</ol>
    </section>
    ${checks(ctx, g.checks)}
    <p class="s02-credit small muted">Текст на пътеводителя: ${g.credit} ${srcTag(g.meta?.source || ['wg'], { asOf: g.meta?.asOf })}</p>`;
}

function focusStep(root, n) {
  const h = root.querySelector(`#s02-step-${n}-h`);
  const li = h && h.closest('li');
  if (!li) return;
  li.scrollIntoView({ block: 'start' });
  h.focus({ preventScroll: true });
  li.classList.remove('hl'); void li.offsetWidth; li.classList.add('hl');
  setTimeout(() => li.classList.remove('hl'), 2600);
}

export function mount(root, ctx) {
  const off = [];
  const on = (el, ev, fn) => { el.addEventListener(ev, fn); off.push(() => el.removeEventListener(ev, fn)); };

  // opening a step's screen (or the „Следва“ link) records the step; the router then navigates as usual
  on(root, 'click', e => {
    const go = e.target.closest('a[data-s02-step]');
    if (go) { ctx.store.set('guide', { step: Number(go.dataset.s02Step) }); return; }
    if (e.target.closest('[data-s02-reset]')) {
      ctx.store.set('guide', { step: 0 });
      ctx.announce('Напредъкът е изчистен.');
      ctx.rerender();                       // the `guide` key does not re-render by itself
    }
  });

  // the „Покажи източниците“ switch mirrors the top-bar toggle
  const sw = root.querySelector('#s02-sources');
  if (sw) {
    on(sw, 'change', () => ctx.store.set('sources', sw.checked));
    off.push(ctx.store.subscribe((k, v) => { if (k === 'sources') sw.checked = !!v; }));
  }

  // #/patevoditel/4: the router has already scrolled to the top; move to the step after its own scroll pass
  const n = Number(ctx.params.step);
  if (n >= 1 && n <= TOTAL && ctx.kind !== 'pop' && ctx.kind !== 'rerender') {
    const f = requestAnimationFrame(() => focusStep(root, n));
    off.push(() => cancelAnimationFrame(f));
  }

  return () => off.forEach(f => f());
}
