// KPI tile and grid: one headline number with its label, change, scope and status. Never shows a made-up number:
// no value → a dashed „Няма данни“ tile; a mock tile is hatched on its top edge and says so in words.
//   kpi({label, value, unit, d, mln, pctGdp, delta, sub, scope, status, mock, source, asOf, gl, href, id})
//   kpiGrid([kpi(…), kpi(…)], {label, cls})
// `mln` (money in млн. €) goes through view.amountParts, so „% от БВП“, „на човек“ and „и в лева“ apply; `value` is printed as given.
// While „Само официални данни“ is on, a mock tile renders nothing and kpiGrid adds ONE note saying how many tiles are hidden.
import { html, raw, SafeHtml, cx, esc, plain } from '../html.js';
import { store } from '../store.js';
import { num, pct, pp, delta as pctDelta, arrow, NBSP } from '../format.js';
import { amountParts } from '../view.js';
import { scopeChip } from './scope.js';
import { statusPill } from './status.js';
import { sourceBtn } from './source.js';
import { mockHidden } from './states.js';

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
/** what kpi() returns for a hidden mock tile: empty markup, so it is harmless anywhere; kpiGrid counts these */
class KpiHidden extends SafeHtml {
  constructor() {
    super('');
    this.hidden = true;
  }
}

function deltaHtml(dl) {
  if (dl == null) return '';
  const o = typeof dl === 'number' ? { value: dl } : dl;
  if (!ok(o.value)) return '';
  const d = o.d ?? 1,
    unit = o.unit ?? '%';
  const r = Number(Math.abs(o.value).toFixed(d)) * Math.sign(o.value); // direction follows what is printed
  const txt =
    unit === '%'
      ? pctDelta(o.value, d)
      : unit === 'пр.п.'
        ? pp(o.value, d)
        : `${num(o.value, d, { sign: true })}${NBSP}${unit}`;
  const word = r > 0 ? 'Увеличение' : r < 0 ? 'Намаление' : 'Без промяна';
  const tone = o.tone === 'good' || o.tone === 'bad' ? o.tone : null;
  return html`<span class="kpi-delta"${tone ? raw(` data-tone="${tone}"`) : ''}><span aria-hidden="true">${arrow(r)}</span><span class="sr-only">${word}: </span>${txt}${o.label ? html` <span class="kpi-delta-label">${o.label}</span>` : ''}</span>`;
}

export function kpi(o = {}) {
  if (o.label == null || o.label === '') throw new Error('kpi: label is required');
  const mock = o.mock === true || o.status === 'mock';
  if (mock && store.get('onlyReal')) return new KpiHidden();

  // the number
  let v = null,
    u = o.unit || '',
    lev = '';
  if (o.mln !== undefined) {
    if (ok(o.mln)) {
      const p = amountParts(undefined, { mln: o.mln, pctGdp: o.pctGdp, d: o.d });
      if (p.v !== '—') ({ v, u, lev } = p);
    }
  } else if (o.value instanceof SafeHtml) v = o.value;
  else if (ok(o.value)) v = num(o.value, o.d ?? (Number.isInteger(o.value) ? 0 : 1));
  else if (typeof o.value === 'string' && o.value) v = o.value;
  const pending = v === null;

  const label = o.href
    ? html`<a href="${o.href}">${o.label}</a>`
    : o.gl
      ? html`<a class="gl" data-gl="${o.gl}" href="#/rechnik/${o.gl}">${o.label}</a>`
      : o.label;
  const status = mock ? 'mock' : o.status;
  const meta = [
    o.scope
      ? scopeChip(
          typeof o.scope === 'string' ? o.scope : o.scope.key,
          typeof o.scope === 'string' ? {} : o.scope,
        )
      : '',
    status ? statusPill(status) : '',
    o.source ? sourceBtn(o.source, { asOf: o.asOf }) : '',
  ];
  const hasMeta = meta.some((m) => m && m.s);

  return html`<div class="${cx('kpi', o.cls)}"${o.id ? html` id="${o.id}"` : ''}${pending ? raw(' data-status="pending"') : status ? html` data-status="${status}"` : ''}${mock ? raw(' data-kpi-mock="true"') : ''}>
    ${mock ? html`<span class="kpi-strip" data-mock="true" aria-hidden="true"></span>` : ''}
    <p class="kpi-label">${label}</p>
    <p class="kpi-value">${
      pending
        ? html`<span class="kpi-num">Няма данни</span>`
        : html`<span class="kpi-num">${v}</span>${u ? html`<span class="kpi-unit">${u}</span>` : ''}${lev ? html`<span class="kpi-lev">(${lev})</span>` : ''}`
    }</p>
    ${pending ? '' : deltaHtml(o.delta)}
    ${o.sub ? html`<p class="kpi-sub">${o.sub}</p>` : ''}
    ${hasMeta ? html`<div class="kpi-meta">${meta}</div>` : ''}
  </div>`;
}

/** kpiGrid([kpi(), kpi()], {label:'Основни числа', cls}) */
export function kpiGrid(items = [], o = {}) {
  const list = (items || []).filter(Boolean);
  const hidden = list.filter((x) => x instanceof KpiHidden).length;
  const shown = list.filter((x) => !(x instanceof KpiHidden));
  const note = hidden
    ? mockHidden(
        hidden === 1
          ? 'Скрита е 1 плочка с примерни данни.'
          : `Скрити са ${hidden} плочки с примерни данни.`,
      )
    : '';
  const grid = shown.length
    ? html`<div class="${cx('kpi-grid', o.cls)}"${o.label ? html` role="group" aria-label="${plain(o.label)}"` : ''}>${shown}</div>`
    : '';
  return html`${grid}${note}`;
}
