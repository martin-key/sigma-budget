// Progress bar and the thin step strip.
//   progress({id, label, value, max = 100, text, mock})   a labelled bar: „Изпълнение на приходите  52,3% от годишния план“
//   steps({current, total, label})                        the strip of the guide (S02/S04): step `current` (1-based) of `total`
// progress: role="progressbar" with aria-valuenow/-valuetext; no finite `value` → no bar, the text says „Предстои“ and the
// track is hidden from assistive tech (the visible words carry the meaning); `mock` hatches the fill and adds the „Примерни данни“ badge.
import { html, raw, cx, plain } from '../html.js';
import { pct as fmtPct } from '../format.js';
import { mockBadge } from './states.js';

const ok = (v) => typeof v === 'number' && Number.isFinite(v);

export function progress(o = {}) {
  if (!o.id) throw new Error('progress: id is required');
  const max = ok(o.max) && o.max > 0 ? o.max : 100;
  const known = ok(o.value);
  const share = known ? Math.min(100, Math.max(0, (o.value / max) * 100)) : 0;
  const text = o.text ?? (known ? fmtPct(share, 1) : 'Предстои');
  const lid = `${o.id}-l`;
  const mock = o.mock === true;
  const label = o.label
    ? html`<span class="prog-label" id="${lid}">${o.label}</span>`
    : html`<span></span>`;
  const track = known
    ? html`<div class="prog-track" role="progressbar"${o.label ? html` aria-labelledby="${lid}"` : html` aria-label="${plain(text)}"`} aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.min(max, Math.max(0, o.value))}" aria-valuetext="${plain(text)}"><span class="prog-fill"${mock ? raw(' data-mock="true"') : ''} style="width:${Number(share.toFixed(1))}%"></span></div>`
    : html`<div class="prog-track" aria-hidden="true"></div>`;
  return html`<div class="${cx('prog', o.cls)}" id="${o.id}"${known ? '' : raw(' data-st="pending"')}${mock ? raw(' data-mock-fig="true"') : ''}>
    <div class="prog-top">${label}<span class="prog-text">${text}</span></div>${track}${mock ? html`<p class="prog-mock">${mockBadge()}</p>` : ''}
  </div>`;
}

export function steps(o = {}) {
  const total = Number.isInteger(o.total) && o.total > 0 ? o.total : 0;
  if (!total) return html``;
  const cur = Number.isInteger(o.current) ? Math.min(total, Math.max(1, o.current)) : 1;
  const items = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    if (n < cur)
      return html`<li data-done="true"><span class="sr-only">Стъпка ${n} (премината)</span></li>`;
    if (n === cur)
      return html`<li aria-current="step"><span class="sr-only">Стъпка ${n} (текуща)</span></li>`;
    return html`<li><span class="sr-only">Стъпка ${n}</span></li>`;
  });
  return html`<ol class="${cx('steps', o.cls)}" aria-label="${plain(o.label ?? `Стъпка ${cur} от ${total}`)}">${items}</ol>`;
}
