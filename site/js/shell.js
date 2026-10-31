// App shell: mock banner, masthead, section band (>=961 px), «Меню» drawer + bottom bar (<=960 px), footer, offline banner.
// V6 (26.10, working-group feedback): ONE header row: the serif wordmark at the left; at the right the period button, the five group buttons «Начало · Изпълнение · Бюджет · Данъци и контекст · Данни и проект»
// (each opens a dropdown of its screens, js/ui/sheet.js popover) and the red «Бюджет 2027» button. The search field moved into the page, under the plan block (js/ui/plan.js); «Източници» and the ⋯ button are gone
// (V6 later the same day: the search is a magnifier button #btn-search in the button bar; it opens the search panel (js/search.js) under the header, on every width). The section band of V5 (#sidenav as a second row) no longer exists: #sidenav is the button bar inside the header.
// V5 (СИГМА visual language): the masthead carried the serif wordmark, the search and the period button; #sidenav is a
// mono-uppercase band with the three main sections «Начало · Изпълнение · Бюджет» (the current one underlined) and the current section's
// screens on a second line; «Още» (data and methodology, glossary, learning path, project) opens as a dropdown there. The phone bar has
// three tabs «Начало · Отчет · Бюджет»; everything else is under «Меню».
// Light only: no theme switch (СИГМА has no dark theme). Built once at boot from the route table. It follows the store (period, user type, sources) and the router
// (current item, period switch hidden on screens that do not depend on a period). Page workers never edit this file.
import { store, safe } from './store.js';
import { ROUTES, GROUPS, byId, href as routeHref } from './routes.js';
import { html, nextId } from './html.js';
import { icon } from './icons.js';
import { popover, sheet } from './ui/sheet.js';
import { openLegend } from './ui/status.js';
import { data } from './data.js';
import { date } from './format.js';
import { router } from './router.js';
import { here, parts as addrParts, toHref, isAppLink } from './loc.js';

const $ = id => document.getElementById(id);
const MARK = html`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3" y="18" width="6" height="11" fill="var(--ink)"/><rect x="12.5" y="12" width="6" height="17" fill="var(--ink)"/><rect x="22" y="6" width="6" height="23" fill="var(--ink)"/><rect x="2" y="29.5" width="28" height="1.5" fill="var(--ink)"/><circle cx="25" cy="2.6" r="2.4" fill="var(--crimson)"/></svg>`;
const yearOf = p => p.label.split(' · ')[0];
const statusOf = p => p.label.split(' · ')[1] || '';
const NEWS_KEY = 'bns.news.seen';

/* The three main sections of the app. The phone bottom bar shows them as tabs, the desktop band as rows (only the current section lists
   its screens). V6 (25.10): «Моите данъци» (S18) is no longer a permanent masthead button; it lives under «Още» (group «Данъци»), in the phone «Меню» and in the footer. */
const idsOf = (...groups) => ROUTES.filter(r => groups.includes(r.group)).map(r => r.id);
const SECTIONS = [
  { id: 'home', label: 'Начало', tab: 'Начало', icon: 'home', to: 'S01', routes: ['S01'] },
  { id: 'exec', label: 'Изпълнение', tab: 'Отчет', icon: 'gauge', to: 'S15', routes: idsOf('exec') },
  { id: 'money', label: 'Бюджет', tab: 'Бюджет', icon: 'wallet', to: 'S07', routes: idsOf('budget') }
];
const TABS = SECTIONS;
/* The five header buttons, the footer groups and the phone «Меню» are ONE list (the real routes of js/routes.js; nav:false screens such as S08/S11/S21 belong to their parents). */
const NAV_GROUPS = [
  ['Начало', ['S01', 'S04', 'S03']],
  ['Изпълнение', ['S15', 'S16']],
  ['Бюджет', ['S07', 'S06', 'S10', 'S12', 'S13', 'S34', 'S14', 'S20', 'S05']],
  ['Данъци и контекст', ['S18', 'S17', 'S31']],
  ['Данни и проект', ['S24', 'S25', 'S26', 'S27']]
];
/* The sister platform (spec §2.2): visible, but after the screens of the site: the last item of «Данни и проект», the phone «Меню» and the footer. */
const SIGMA = { label: 'СИГМА — обществени поръчки', href: 'https://sigma.midt.bg/' };
const sigmaLink = cls => html`<a class="${cls}" href="${SIGMA.href}" target="_blank" rel="noopener">${SIGMA.label}<span class="sr-only"> (друг сайт, в нов раздел)</span></a>`;   // a new tab: also out of an embed frame
const rootId = r => (r.parent ? rootId(byId[r.parent]) : r.id);
const groupOf = route => { const root = rootId(route); return NAV_GROUPS.findIndex(([, ids]) => ids.includes(route.id) || ids.includes(root)); };
const groupItems = ids => ids.map(id => byId[id]).filter(r => r && r.nav);
const navName = r => r.short || r.title;
/* A menu link keeps the chosen year when its screen can show it. A plain click always did (router.go adds ?per=); the address itself also covers a new tab and a copied link.
   The dropdowns and the drawer are built when they open; the tab bar and the footer are built once, so syncLinks() follows every navigation. */
const navHref = id => {
  const per = store.periodParam(), p = byId[id].periods;
  return routeHref(id, {}, per && (p === 'all' || (Array.isArray(p) && p.includes(per))) ? { per } : {});
};
const syncLinks = () => document.querySelectorAll('#tabbar a[data-route], #footer a[data-route]').forEach(a => a.setAttribute('href', navHref(a.dataset.route)));

const openSearch = el => import('./search.js').then(m => m.openPalette(el)).catch(e => { console.error(e); });

/* ------------------------------------------------------------------ popovers */
function openPeriod(btn) {
  const sup = router.periods;
  const allowed = k => !Array.isArray(sup) || sup.includes(k);
  const name = nextId('per');
  const body = html`<fieldset class="opt-list"><legend class="sr-only">Година и статус на данните</legend>${store.PERIODS.map(p => {
    const ok = allowed(p.key);
    return html`<label class="opt${ok ? '' : ' opt-off'}"><input type="radio" name="${name}" value="${p.key}"${p.key === store.get('period') ? html` checked` : ''}${ok ? '' : html` disabled`}><span class="opt-main"><span class="opt-label">${p.label}</span><span class="opt-desc">${p.desc}${ok ? '' : ' · не се показва на този екран'}</span></span></label>`;
  })}</fieldset>`;
  const pop = popover.open(btn, { title: 'Година и статус', body, label: 'Година и статус на данните' });
  pop.el.addEventListener('change', e => {
    const t = e.target;
    if (!t || t.name !== name) return;
    store.set('period', t.value);
    pop.close();
  });
  pop.el.querySelector('input:checked')?.focus({ preventScroll: true });
}
function openMoreSheet(btn) {
  const nav = NAV_GROUPS.map(([label, ids]) => html`<section class="more-grp"><h3>${label}</h3><ul class="more-list">${groupItems(ids).map(r => html`<li><a href="${navHref(r.id)}"${router.current?.route?.id === r.id ? html` aria-current="page"` : ''}>${icon(r.icon, { size: 18 })}<span>${navName(r)}</span></a></li>`)}</ul></section>`);
  const body = html`<div class="more-sheet">
    <p class="more-cta"><a class="nav-cta" href="${routeHref('S34')}">${CTA}</a></p>
    <nav aria-label="Всички раздели">${nav}</nav>
    <p class="more-sister">${sigmaLink('sister-link')}</p>
  </div>`;
  const s = sheet.open({ title: 'Меню', body, returnFocus: btn, cls: 'sheet-drawer' });
  s.el.addEventListener('click', e => { if (isAppLink(e.target.closest('a[href]'))) s.close(); });
}

/** a dropdown of the wide header: the screens of one group (the popover closes on Esc, on a click outside and on navigation; focus goes back to the button) */
function openNavGroup(btn, i) {
  const [label, ids] = NAV_GROUPS[i];
  const cur = router.current?.route;
  const items = groupItems(ids).map(r => html`<li><a href="${navHref(r.id)}"${cur && (cur.id === r.id) ? html` aria-current="page"` : ''}><span>${navName(r)}</span></a></li>`);
  if (i === NAV_GROUPS.length - 1) items.push(html`<li class="nav-sister">${sigmaLink('sister-link')}</li>`);
  popover.open(btn, { body: html`<nav class="nav-pop" aria-label="${label}"><ul class="more-list">${items}</ul></nav>`, label, align: 'start' });
}

/* ------------------------------------------------------------------ pieces */
function bannerHtml() {
  return html`<span class="hatch-swatch" aria-hidden="true"></span>
    <p><strong>Бета.</strong> Официални данни; примерните стойности са със щриховка. <button type="button" class="link-btn" data-action="legend">Легенда</button></p>
    <button type="button" class="x" data-action="dismiss-banner" aria-label="Скрий съобщението за тази сесия">${icon('x', { size: 18 })}</button>`;
}
const CTA = 'Бюджет 2027';
function topbarHtml() {
  const p = store.period;
  return html`<div class="mast-in"><a class="brand" href="${routeHref('S01')}" aria-label="Бюджет на светло, към началото">${MARK}<span class="brand-name">Бюджет на светло</span></a>
    <span class="badge-mock" title="Бета версия: официални данни и няколко означени примерни стойности">Бета</span>
    <div class="topbar-tools">
      <button type="button" class="tool-btn period-btn" id="btn-period" aria-haspopup="dialog" aria-expanded="false" aria-label="Година и статус на данните: ${p.label}"><span class="p-year">${yearOf(p)}</span><span class="p-status"> · ${statusOf(p)}</span>${icon('chevronDown', { size: 14 })}</button>
      <nav class="sidenav" id="sidenav" aria-label="Основна навигация">${navHtml()}</nav>
      <button type="button" class="menu-btn" id="btn-menu" aria-haspopup="dialog" aria-expanded="false"><span class="menu-box" aria-hidden="true"><span></span><span></span></span><span>Меню</span></button>
    </div></div>`;
}
const NEWS_DOT = label => html`<span class="nav-dot" data-news-dot data-label="${label}" hidden></span>`;
function navHtml() {
  const rows = NAV_GROUPS.map(([label], i) => html`<div class="nav-sec" data-sec="g${i}"><button type="button" class="nav-main" data-grp="${i}" aria-haspopup="dialog" aria-expanded="false"><span>${label}</span>${i === 1 ? NEWS_DOT('Изпълнение (има непрочетено)') : ''}${icon('chevronDown', { size: 12, cls: 'nav-chev' })}</button></div>`);
  const lupa = html`<button type="button" class="nav-search" id="btn-search" data-action="search" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="/ Control+K Meta+K" aria-label="Търсене" title="Търсене (/)">${icon('search', { size: 22 })}</button>`;
  return html`<div class="nav-in">${rows}${lupa}<a class="nav-cta" href="${routeHref('S34')}" data-nav="S34">${CTA}</a></div>`;
}
function tabbarHtml() {
  return html`${TABS.map(t => html`<a href="${navHref(t.to)}" data-route="${t.to}" data-tab="${t.id}">${icon(t.icon, { size: 20 })}<span>${t.tab}</span></a>`)}`;
}
/* V6 footer: every screen of the menu, grouped (the ids are the real routes of js/routes.js; nav:false screens like S08/S11/S21 are children of listed ones).
   Phones: one collapsible group per heading (native <details>, keyboard-operable); wide screens: all groups open side by side (syncFooter below). */
const WIDE = '(min-width: 961px)';
function footerHtml() {
  const core = data.get('core');
  const b = core && core.build;
  const kfp = b && b.kfpLatest ? (/^\d{4}-\d{2}-\d{2}/.test(b.kfpLatest) ? date(b.kfpLatest) : b.kfpLatest) : '';
  const wide = window.matchMedia && window.matchMedia(WIDE).matches;
  const cur = router.current?.route?.id;
  const groups = NAV_GROUPS.map(([label, ids]) => {
    const items = groupItems(ids);
    return html`<details class="foot-grp"${wide ? html` open` : ''}><summary>${label}</summary><ul>${items.map(r => html`<li><a href="${navHref(r.id)}" data-route="${r.id}"${r.id === 'S27' ? html` data-feedback-link` : ''}${cur === r.id ? html` aria-current="page"` : ''}>${navName(r)}</a></li>`)}</ul></details>`;
  });
  return html`<div class="footer-in">
    <nav class="foot-nav" aria-label="Всички страници">${groups}</nav>
    <div class="fine">
      ${kfp ? html`<span>Данните: КФП към ${kfp}${b.kfpPublished ? html` (обн. ${date(b.kfpPublished)})` : ''}</span>` : ''}
      ${b && b.dataVersion ? html`<span>Версия на данните: ${b.dataVersion}</span>` : ''}
      <span>Бета версия: няколко стойности са примерни и са означени със щриховка.</span>
      <span>Лиценз на данните: предстои решение.</span>
      <span>${sigmaLink('sister-link')}</span>
      <button type="button" class="link-btn" data-action="legend">Легенда: какво означават белезите</button>
    </div>
    <p class="small muted">Работна група „Бюджет на светло“</p>
  </div>`;
}
/** wide screens show every footer group open (the summary is then a plain heading, out of the tab order); narrow screens keep what the visitor opened */
function syncFooter() {
  const f = $('footer');
  if (!f) return;
  const wide = window.matchMedia(WIDE).matches;
  f.querySelectorAll('details.foot-grp').forEach(d => {
    const sm = d.firstElementChild;
    if (wide) { d.open = true; sm.setAttribute('tabindex', '-1'); } else sm.removeAttribute('tabindex');
  });
}
function footClick(e) {
  const sm = e.target.closest && e.target.closest('details.foot-grp > summary');
  if (sm && window.matchMedia(WIDE).matches) e.preventDefault();
}

/* ------------------------------------------------------------------ dynamic state */
function setCurrent(route) {
  const root = route.parent ? (function top(r) { return r.parent ? top(byId[r.parent]) : r; })(route) : route;
  document.querySelectorAll('#sidenav a[data-nav]').forEach(a => {
    if (a.dataset.nav === route.id) a.setAttribute('aria-current', 'page');
    else if (a.dataset.nav === root.id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('#footer a[href]').forEach(a => {      // the footer marks the current screen too
    if (a.getAttribute('href').split('?')[0] === routeHref(route.id)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const tab = TABS.find(t => t.routes.includes(route.id) || (route.parent && t.routes.includes(root.id)));
  document.querySelectorAll('#tabbar [data-tab]').forEach(el => {
    if (tab && el.dataset.tab === tab.id) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  const g = groupOf(route);                                  // the header button of the group the screen belongs to is underlined (aria-current="true" for screen readers)
  document.querySelectorAll('#sidenav .nav-sec').forEach(el => {
    const cur = el.dataset.sec === 'g' + g;
    el.toggleAttribute('data-current', cur);
    const b = el.querySelector('.nav-main');
    if (b) { if (cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
  });
}
function refreshPeriod() {
  const p = store.period, b = $('btn-period');
  if (!b) return;
  b.querySelector('.p-year').textContent = yearOf(p);
  b.querySelector('.p-status').textContent = ' · ' + statusOf(p);
  b.setAttribute('aria-label', `Година и статус на данните: ${p.label}`);
}
function applySources() {
  const on = store.get('sources'), root = document.documentElement;
  if (on) root.setAttribute('data-sources', '1'); else root.removeAttribute('data-sources');
}
function updateOffline(demo) {
  const el = $('offline');
  if (!el) return;
  const off = demo === 'offline' || navigator.onLine === false;
  if (!off) { el.hidden = true; el.removeAttribute('data-state'); el.textContent = ''; return; }
  const v = data.get('core')?.build?.dataVersion;
  const when = v && /^\d{4}-\d{2}-\d{2}/.test(v) ? ` от ${date(v)}` : '';
  el.setAttribute('data-state', 'offline');
  el.innerHTML = `${icon('wifiOff', { size: 18 })}<span>Няма връзка — показваме запазеното${when}.</span>`;
  el.hidden = false;
}
async function checkNews() {
  try {
    const feed = await data.load('feed');
    const latest = (feed.events || []).map(e => e.date).filter(Boolean).sort().pop();
    if (!latest) return;
    const seen = safe.get('localStorage', NEWS_KEY);
    if (seen && seen >= latest) return;
    document.querySelectorAll('[data-news-dot]').forEach(dot => { dot.hidden = false; dot.dataset.latest = latest; dot.parentElement.setAttribute('aria-label', dot.dataset.label); });
  } catch { /* no feed yet: no dot */ }
}
function markNewsSeen() {
  const dots = [...document.querySelectorAll('[data-news-dot]')].filter(d => !d.hidden);
  if (!dots.length) return;
  if (dots[0].dataset.latest) safe.set('localStorage', NEWS_KEY, dots[0].dataset.latest);
  dots.forEach(dot => { dot.hidden = true; dot.parentElement.removeAttribute('aria-label'); });
}

/* ------------------------------------------------------------------ boot */
export const shell = {
  init() {
    const bar = $('mockbar');
    if (bar) { bar.innerHTML = bannerHtml().toString(); bar.hidden = store.bannerDismissed(); }
    $('topbar').innerHTML = topbarHtml().toString();
    $('tabbar').innerHTML = tabbarHtml().toString();
    shell.refreshFooter();
    $('footer')?.addEventListener('click', footClick);
    window.matchMedia(WIDE).addEventListener?.('change', syncFooter);
    applySources();

    $('btn-period').addEventListener('click', e => openPeriod(e.currentTarget));
    $('sidenav').addEventListener('click', e => { const b = e.target.closest('.nav-main'); if (b) openNavGroup(b, Number(b.dataset.grp)); });
    $('btn-menu').addEventListener('click', e => {
      const b = e.currentTarget;
      b.setAttribute('aria-expanded', 'true');
      openMoreSheet(b);
      const d = document.querySelector('dialog.sheet-drawer');
      if (d) d.addEventListener('close', () => b.setAttribute('aria-expanded', 'false'), { once: true }); else b.setAttribute('aria-expanded', 'false');
    });

    store.subscribe(k => {
      if (k === 'period') refreshPeriod();
      else if (k === 'sources') applySources();
    });
    router.onNavigate(({ route, demo }) => {
      setCurrent(route);
      syncLinks();
      const per = router.periods;
      const b = $('btn-period');
      if (b) b.hidden = per === 'none';
      updateOffline(demo);
      if (route.id === 'S16') markNewsSeen();
      const fb = document.querySelector('[data-feedback-link]');
      if (fb) fb.setAttribute('href', toHref(`/vrazka?type=greshka&from=${encodeURIComponent(addrParts(here()).path.replace(/^\//, ''))}`));
    });
    window.addEventListener('online', () => updateOffline(router.current?.vm?.demo));
    window.addEventListener('offline', () => updateOffline(router.current?.vm?.demo));
    updateOffline(new URLSearchParams(addrParts(here()).query).get('demo'));
    checkNews();
  },
  refreshFooter() { const f = $('footer'); if (f) { f.innerHTML = footerHtml().toString(); syncFooter(); } },
  dismissBanner() {
    store.dismissBanner();
    const b = $('mockbar');
    const had = !!b && b.contains(document.activeElement);       // the button that was pressed disappears: the focus must not fall to <body>
    if (b) b.hidden = true;
    if (had) (document.querySelector('#view h1') || $('main'))?.focus({ preventScroll: true });
    announceBanner();
  }
};
function announceBanner() { router.announce('Съобщението е скрито за тази сесия'); }
export { openMoreSheet, openPeriod, openSearch };
