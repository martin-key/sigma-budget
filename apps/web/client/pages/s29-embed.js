import { selectPeriod } from '../periods.js';
// S29 · Вграден изглед (#/embed/<routeKey>.<chartId>[?per=…&<host params>]): ONE chart on a bare page (no top bar, no menu) for an <iframe> on another site.
// How the chart is found: the part before the first dot is a route key (routes.js), the rest is a chart id that screen exports:
//   export const embeds = { 'my-chart-id': ctx => ({ chart: <chart spec>, source: ['kfp'], asOf: '2026-07-31', status: 'real' }) }
// The host screen's own `needs` are loaded with router.prepare() and the builder receives that screen's ctx (data, core, period, store, query).
// Parameters of the host screen (:code, :fn …) travel as query parameters of the same name (share.embedHash adds them from spec.embedParams);
// ?per=<period> is the period, as everywhere. `selftest` (no dot) opens the official spending chart: it lets a site owner check that
// the frame loads using the official spending data.
// Inside the frame nothing navigates the frame itself: the source and the „СИГМА Бюджет →“ links are absolute and open a new tab.
import { html } from '../html.js';
import { absolute } from '../loc.js';
import { icon } from '../icons.js';
import { data } from '../data.js';
import { date } from '../format.js';
import { byKey, href as routeHref } from '../routes.js';
import { prepare, NotFound } from '../router.js';
import { chart, isMockSpec } from '../ui/chart.js';
import { emptyState, errorState, pendingState } from '../ui/states.js';
import { statusPill } from '../ui/status.js';
import { srcShort } from '../ui/source.js';

export const needs = ['core?']; // source names and links; the host screen loads its own data
export const styles = ['s29-embed'];

/** the host screen's params from same-named query params; null when a required one is missing */
function paramsOf(host, query) {
  const out = {};
  for (const m of host.pattern.matchAll(/:(\w+)(\([^)]*\))?(\?)?/g)) {
    const v = query[m[1]];
    if (v != null && v !== '') out[m[1]] = String(v);
    else if (!m[3]) return null;
  }
  return out;
}

/** -> {ok:true, e, host, params} | {ok:false, kind:'unknown'|'pending'|'error'} */
async function load(ctx) {
  const requested = String(ctx.params.chart ?? '');
  const addr = requested === 'selftest' ? 'prognoza.s13-rev-exp' : requested;
  const dot = addr.indexOf('.');
  const key = dot < 0 ? addr : addr.slice(0, dot),
    id = dot < 0 ? '' : addr.slice(dot + 1);
  const host = Object.hasOwn(byKey, key) ? byKey[key] : null; // byKey is a plain object: „constructor“ must not match
  if (!host || !host.pattern || host.bare || !id) return { ok: false, kind: 'unknown' };
  const params = paramsOf(host, ctx.query);
  if (!params) return { ok: false, kind: 'unknown' };

  let prep;
  try {
    prep = await prepare(host, params, ctx.query, { signal: ctx.signal, kind: 'embed' });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.error(err);
    return { ok: false, kind: 'error' };
  }
  const { mod, ctx: hctx, fail } = prep;
  const primary = { S06: 'revenue', S07: 'expenditure', S08: 'expenditure', S13: 'outlook' }[
    host.id
  ];
  if (primary && hctx.annualRaw?.[primary]) {
    const period = selectPeriod(hctx.annualRaw[primary], hctx.period.key);
    const field =
      host.id === 'S06'
        ? 'groups'
        : id === 's07-fn'
          ? 'functions'
          : id === 's07-vid'
            ? 'economicDetails'
            : null;
    if (!period.available || (field && period.gaps?.[field]))
      return { ok: false, kind: 'pending', reason: period.reason || period.gaps[field] };
  }

  if (fail) return { ok: false, kind: fail.kind }; // the host's required data is pending / failed
  if (!Object.hasOwn(mod.embeds || {}, id) || typeof mod.embeds[id] !== 'function')
    return { ok: false, kind: 'unknown' };
  let e;
  try {
    e = await mod.embeds[id](hctx);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (err instanceof NotFound) return { ok: false, kind: 'unknown' };
    console.error(err);
    return { ok: false, kind: 'error' };
  }
  return e && e.chart ? { ok: true, e, host, params } : { ok: false, kind: 'pending' };
}

/** absolute address of a screen of the site (the frame is on someone else's page: a relative link would stay inside the frame) */

const comma = (list) => list.flatMap((x, i) => (i ? [', ', x] : [x]));
function sourcesOf(keys) {
  const ks = []
    .concat(keys || [])
    .map(String)
    .filter(Boolean);
  if (!ks.length) return '';
  const items = ks.map((k) => {
    const url = data.source(k).url || '',
      label = srcShort(k);
    return /^https?:\/\//i.test(url)
      ? html`<a class="ext" href="${url}" target="_blank" rel="noopener noreferrer">${label}<span class="sr-only"> (в нов раздел)</span></a>`
      : html`<span>${label}</span>`;
  });
  return html`Източник: ${comma(items)}`;
}

// no status pill for mock: the figure above already carries the badge and the watermark
function foot(e, link) {
  const status = e ? e.status || (isMockSpec(e.chart) ? 'mock' : 'real') : null;
  const src = e ? sourcesOf(e.source) : '';
  return html`<div class="s29-foot">
    <p class="s29-src">${src}${e?.asOf ? html`${src ? ' · ' : ''}данни към ${date(e.asOf)}` : ''}</p>
    ${status && status !== 'mock' ? statusPill(status) : ''}
    <a class="s29-brand" href="${link}" target="_blank" rel="noopener noreferrer">СИГМА Бюджет ${icon('arrowRight', { size: 16 })}<span class="sr-only"> (отваря се в нов раздел)</span></a>
  </div>`;
}

const FAIL = {
  unknown: () =>
    emptyState({
      icon: 'search',
      title: 'Графиката не е намерена',
      text: 'Адресът не води до графика от „СИГМА Бюджет“. Провери кода за вграждане.',
    }),
  pending: (reason) =>
    pendingState({
      title: 'Няма графика за избрания период',
      text: 'Няма данни за тази графика в избрания период.',
    }),
  error: () => errorState({ link: false, title: 'Графиката не се зареди.' }),
};

export async function render(ctx) {
  const r = await load(ctx);
  if (!r.ok)
    return {
      body: html`<div class="s29-embed">${FAIL[r.kind](r.reason)}${foot(null, absolute('#/'))}</div>`,
    };
  const { e, host, params } = r;
  // the title is the page heading; `label` still names the figure for assistive tech. A host that declares status 'mock' gets the hatch and the badge too.
  const spec = {
    ...e.chart,
    title: '',
    label: e.chart.title,
    ...(e.status === 'mock' ? { mock: true } : {}),
  };
  const mock = isMockSpec(e.chart) || e.status === 'mock';
  const link = absolute(
    host ? routeHref(host.id, params, { per: ctx.period.key, unit: ctx.store.get('unit') }) : '#/',
  );
  return {
    title: e.chart.title || 'Графика',
    body: html`<div class="s29-embed">
      <div class="s29-plot"><div class="s29-scroll">${chart(spec)}</div>${mock ? html`<div class="s29-wm" aria-hidden="true"><span>Примерни данни</span></div>` : ''}</div>
      ${foot(e, link)}
    </div>`,
  };
}
