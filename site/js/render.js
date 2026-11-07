// The view of one screen, without a browser (docs/adr/0002-react-router-ssr.md). js/router.js paints it in the page; the server
// (app/, workers/app.ts) draws the same screen for the first response. Nothing here touches document, window or history: the
// address, the period and the data of a server request come from js/env.js.
//
//   resolve(address)            the screen of an address: an old address redirected (js/redirects.js), the route, its params, the
//                               canonical query and the canonical address (`want`) that the address bar should show
//   prepare(route, params, …)   the page module, its data (`needs`) and the ctx it renders with
//   build(route, params, …)     the view model {route, view, title, eyebrow, lede, context, body, crumbs, next, …}
//   frameHtml(vm), docTitle(vm) the article of the screen and the document title
import { NOT_FOUND, byId, match, href as routeHref, chainOf, GROUPS, screenQuery } from './routes.js';
import { store, DEFAULT_PERIOD } from './store.js';
import { data, PendingError } from './data.js';
import { html, SafeHtml } from './html.js';
import { parseQuery, buildQuery } from './format.js';
import { breadcrumbs } from './ui/breadcrumbs.js';
import { nextCard } from './ui/next.js';
import { pageSkeleton, emptyState, errorState, pendingState } from './ui/states.js';
import { redirect } from './redirects.js';
import { toHref } from './loc.js';

export class NotFound extends Error { constructor(msg) { super(msg || 'not found'); this.name = 'NotFound'; } }

export const SITE = 'Бюджет на светло';
export const DEMOS = ['loading', 'empty', 'error', 'pending', 'offline'];
export const groupLabel = id => GROUPS.find(g => g.id === id)?.label || '';
const aborted = () => new DOMException('Aborted', 'AbortError');

/* ------------------------------------------------------------------ addresses */
export function parseHash(h) {
  let s = String(h || '').replace(/^#/, '');
  if (/^%2F/i.test(s)) { try { s = decodeURIComponent(s); } catch { /* keep */ } }
  const qi = s.indexOf('?');
  const path = qi < 0 ? s : s.slice(0, qi);
  const query = parseQuery(qi < 0 ? '' : s.slice(qi + 1));
  const segs = path.split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  return { segs, query };
}
export const canonHash = (canon, q) => toHref('/' + canon.map(encodeURIComponent).join('/') + buildQuery(q));
export function canonQuery(q) {
  const o = { ...q };
  if (o.per && (!store.periodByKey(o.per) || o.per === DEFAULT_PERIOD)) delete o.per;
  if (o.demo && !DEMOS.includes(o.demo)) delete o.demo;
  return o;
}
/** the screen of an address ('/x?y' or '#/x?y'): {route, params, query, canon, want, screen, found, segs}. `screen` is the address of
 *  what the server draws for it: the canonical one with only the query of the screen (js/routes.js screenQuery) */
export function resolve(address) {
  const raw = parseHash(address);
  const red = redirect(raw.segs, raw.query);           // an old address → the matching new screen, context kept (js/redirects.js)
  if (red) { raw.segs = red.segs; raw.query = red.query; }
  const m = match(raw.segs);
  const route = m ? m.route : NOT_FOUND;
  const params = m ? m.params : { path: raw.segs.join('/') };
  const query = canonQuery(raw.query);
  const canon = m ? m.canon : raw.segs;
  return { route, params, query, canon, want: canonHash(canon, query), screen: canonHash(canon, screenQuery(route, query)), found: !!m, segs: raw.segs };
}

/* ------------------------------------------------------------------ page module + data */
function parseNeeds(mod, ctx) {
  const n = typeof mod.needs === 'function' ? mod.needs(ctx) : mod.needs;
  return (n || []).map(s => { const opt = String(s).endsWith('?'); return { name: opt ? String(s).slice(0, -1) : String(s), opt }; });
}
const noop = () => {};
function makeCtx(route, params, query, o) {
  const a = o.actions || {};
  return {
    route, params, query, data: {}, missing: [], failed: [], period: store.period, store,
    get core() { return data.get('core'); },
    signal: o.signal, demo: o.demo || null, kind: o.kind || 'link',
    setQuery: a.setQuery || noop, rerender: a.rerender || noop, announce: a.announce || noop, go: a.go || noop, href: routeHref,
    notFound() { throw new NotFound(); }
  };
}
/** load module + css + data for a route. Used by the router, by S29 (embed) and by the server. Throws AbortError when superseded.
 *  o.loadStyle(name): the browser loads the page's CSS before it paints (the server writes the <link>s itself). */
export async function prepare(route, params, query, o = {}) {
  const mod = await import(`./pages/${route.file}.js`);
  if (o.loadStyle) await Promise.all((mod.styles || []).map(o.loadStyle));
  const ctx = makeCtx(route, params, query, o);
  const needs = parseNeeds(mod, ctx);
  const results = await Promise.allSettled(needs.map(n => data.load(n.name, { signal: o.signal })));
  let fail = null;
  needs.forEach((n, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') { ctx.data[n.name] = r.value; return; }
    const e = r.reason;
    if (e && e.name === 'AbortError') throw e;
    ctx.missing.push(n.name);
    const kind = e instanceof PendingError ? 'pending' : 'error';
    if (kind === 'error') ctx.failed.push(n.name);             // could not be read now (not „Предстои“): an optional file says so itself
    if (n.opt) return;
    if (!fail || (kind === 'error' && fail.kind === 'pending')) fail = { kind, err: e, file: n.name };
  });
  return { mod, ctx, fail };
}

/* ------------------------------------------------------------------ view model */
export const periodsFor = (route, mod) => mod?.periods ?? route.periods;
function supportsPeriod(route, mod) {
  const p = periodsFor(route, mod);
  return p === 'all' || p === 'none' || !Array.isArray(p) || p.includes(store.get('period'));
}
function nextTarget(id) {
  const r = byId[id];
  if (!r) return null;
  if (r.id === 'S01') return { kicker: 'Начало', title: 'Към началото', text: '', href: routeHref('S01') };
  return { kicker: groupLabel(r.group), title: r.title, text: r.desc, href: routeHref(r.id) };
}
function buildNext(route, mod, ctx) {
  if (route.bare) return '';
  let items;
  try { items = mod?.next ? mod.next(ctx) : route.next; } catch (e) { console.error(e); items = route.next; }
  if (!items || !items.length) return '';
  const cards = items.map(it => (typeof it === 'string' ? nextTarget(it) : it)).filter(Boolean);
  if (!cards.length) return '';
  const [first, ...more] = cards;
  return nextCard({ ...first, more: more.map(m => ({ label: m.title, href: m.href })) });
}
export function defaultCrumbs(route, title) {
  if (route.id === 'S01') return [];
  return [{ label: 'Начало', href: routeHref('S01') }, ...chainOf(route).map(r => ({ label: r.title, href: routeHref(r.id) })), { label: title }];
}
export function eyebrowFor(route) {
  if (route.bare) return '';
  return route.group === 'util' ? '' : groupLabel(route.group);
}
function contextFor(route, ctx, extra, own) {
  if (route.bare) return '';
  const parts = [];
  if (route.periods !== 'none' && !own) parts.push(html`<span class="ctx-period"><strong>${ctx.period.label}</strong> <span class="muted">· ${ctx.period.desc}</span></span>`);
  if (extra) parts.push(extra);
  if (!parts.length) return '';
  return html`<div class="context">${parts.map(p => html`<span class="ctx-part">${p}</span>`)}</div>`;   // v4: the divider between parts is drawn by CSS and is clipped at the start of a wrapped line, so it never dangles
}
const toHtml = v => (v instanceof SafeHtml ? v : html`${v}`);
const safeCall = (fn, ctx, fallback) => { try { const v = fn(ctx); return v ?? fallback; } catch (e) { if (e instanceof NotFound) throw e; console.error(e); return fallback; } };

/** the frame of a state that is not the screen itself (loading, an error) */
export function frameVm(route, params, query, view, body, extra = {}) {
  const ctxLite = { period: store.period };
  return {
    route, params, query, demo: null, view, body, title: route.title, eyebrow: eyebrowFor(route), lede: route.desc,
    context: contextFor(route, ctxLite), crumbs: defaultCrumbs(route, route.title), next: buildNext(route, null, ctxLite), mod: null, ctx: null, ...extra
  };
}
export const loadingVm = (route, params, query) => ({ route, params, query, view: 'loading', title: route.title, eyebrow: eyebrowFor(route), lede: route.desc,
  body: pageSkeleton(), crumbs: defaultCrumbs(route, route.title), context: '', next: '' });
export const errorVm = (route, params, query) => ({ route, params, query, demo: null, view: 'error', title: route.title, eyebrow: eyebrowFor(route), lede: '',
  body: errorState(), crumbs: defaultCrumbs(route, route.title), context: '', next: '', mod: null, ctx: null });

/** build the view model {route, view, title, eyebrow, lede, context, body, crumbs, next, mod, ctx} for a location.
 *  o.stale(): true when a newer navigation has superseded this one (the router), o.path: the address of a screen that is not found */
export async function build(route, params, query, o = {}) {
  const demo = DEMOS.includes(query.demo) ? query.demo : null;
  const base = { route, params, query, demo };
  const frame = (view, body, extra = {}) => ({ ...frameVm(route, params, query, view, body), ...base, ...extra });

  if (demo === 'loading') return frame('loading', pageSkeleton());
  if (demo === 'empty') return frame('empty', emptyState({ title: 'Няма какво да покажем тук', text: 'Опитай с друга година или друг изглед.' }));
  if (demo === 'error') return frame('error', errorState());
  if (demo === 'pending') return frame('pending', pendingState({ title: route.title, text: 'Данните съществуват при издателя, още не са извлечени.' }));

  const { mod, ctx, fail } = await prepare(route, params, query, { ...o, demo });
  if (o.stale?.()) throw aborted();

  if (!supportsPeriod(route, mod)) {
    const sup = periodsFor(route, mod).map(k => store.periodByKey(k)).filter(Boolean);
    return frame('empty', emptyState({
      title: `Няма данни за ${ctx.period.label} на този екран`,
      text: `Този екран показва ${sup.map(p => p.label).join(' и ')}.`,
      actions: sup.map((p, i) => ({ label: `Покажи ${p.label}`, action: 'set-period', value: p.key, primary: i === 0 }))
    }), { ctx, mod });
  }
  if (fail) {
    return frame(fail.kind, fail.kind === 'pending'
      ? pendingState({ title: 'Тези данни още не са включени', text: 'Данните съществуват при издателя, още не са извлечени.' })
      : errorState(), { ctx, mod });
  }

  let out;
  try {
    if (typeof mod.render !== 'function') throw new Error(`pages/${route.file}.js has no render()`);
    out = await mod.render(ctx);
  } catch (e) {
    if (e instanceof NotFound && route !== NOT_FOUND) return build(NOT_FOUND, { path: o.path || '' }, query, o);
    throw e;
  }
  if (o.stale?.()) throw aborted();
  const parts = out && typeof out === 'object' && !(out instanceof SafeHtml) && !Array.isArray(out) ? out : { body: out };
  const title = parts.title ?? safeCall(mod.title || (() => route.title), ctx, route.title);
  const pageCrumbs = mod.crumbs ? safeCall(mod.crumbs, ctx, null) : null;
  return {
    ...base, view: 'ready', mod, ctx, title,
    eyebrow: parts.eyebrow ?? eyebrowFor(route), accent: parts.accent,
    lede: parts.lede ?? (mod.lede ? safeCall(mod.lede, ctx, route.desc) : route.desc),
    // for search and answer engines (js/seo.js): the screen's question and its short answer, both as they read on the screen; a more specific
    // document title where one heading serves several addresses (/prihodi/dds); the screen's own JSON-LD nodes
    question: parts.question ?? (mod.question ? safeCall(typeof mod.question === 'function' ? mod.question : () => mod.question, ctx, '') : ''),
    answer: parts.answer ?? (mod.answer ? safeCall(mod.answer, ctx, '') : ''),
    docTitle: parts.docTitle ?? (mod.docTitle ? safeCall(mod.docTitle, ctx, null) : null),
    schema: parts.schema ?? (mod.schema ? safeCall(mod.schema, ctx, []) : []),
    context: contextFor(route, ctx, parts.context, parts.ownContext),
    body: toHtml(parts.body),
    crumbs: pageCrumbs ? [{ label: 'Начало', href: routeHref('S01') }, ...pageCrumbs] : defaultCrumbs(route, title),
    next: buildNext(route, mod, ctx)
  };
}

/* v4 (СИГМА): one italic crimson word in the heading, as СИГМА's „Къде отиват <em>парите</em> на държавата?“. Only for the route's own static
   title and only where it reads naturally (the list below); a title a page sets itself stays plain, and document.title is always plain. */
const ACCENT = { S01: 'бюджет', S04: 'минути', S06: 'парите', S07: 'парите', S10: 'харчи', S12: 'бюджета', S13: 'вървим',
  S31: 'икономиката', S14: 'бюджетът', S15: 'отчети', S16: 'ново', S17: 'дължим', S18: 'данъци', S20: 'община',
  S24: 'данните', S25: 'данни', S26: 'проекта', S27: 'връзка', S30: 'страница' };
function titleHtml(vm) {
  const t = vm.title, w = vm.accent || (t === vm.route.title ? ACCENT[vm.route.id] : '');       // a page may name its own accent word (parts.accent)
  if (typeof t !== 'string' || !w) return t;
  const i = t.lastIndexOf(w);
  return i < 0 ? t : html`${t.slice(0, i)}<em>${w}</em>${t.slice(i + w.length)}`;
}
export function frameHtml(vm) {
  const { route } = vm;
  return html`<article class="page${route.bare ? ' page-bare' : ''}" data-route="${route.id}" data-key="${route.key}" data-view="${vm.view}" data-ready="0" aria-labelledby="page-title">
    ${route.bare ? '' : breadcrumbs(vm.crumbs || [])}
    ${vm.eyebrow ? html`<p class="eyebrow">${vm.eyebrow}</p>` : ''}
    <h1 class="page-title" id="page-title" tabindex="-1">${titleHtml(vm)}</h1>
    ${vm.lede && !route.bare ? html`<p class="lede">${vm.lede}</p>` : ''}
    ${vm.context || ''}
    <div class="page-body" data-fk="body">${vm.body}</div>
    ${vm.next || ''}
  </article>`;
}
export const docTitle = vm => (vm.route.id === 'S01' ? `${SITE} · ${vm.title}` : `${vm.docTitle || vm.title} · ${SITE}`);
