// App shell: mock banner, masthead, section band (>=961 px), «Меню» drawer + bottom bar (<=960 px), footer, offline banner.
// V5 (СИГМА visual language): the masthead carries the serif wordmark, the search and the permanent «Моите данъци» entry; #sidenav is a
// mono-uppercase band with the three main sections «Начало · Изпълнение · Бюджет» (the current one underlined) and the current section's
// screens on a second line; «Още» (data and methodology, glossary, learning path, project) opens as a dropdown there. The phone bar has
// three tabs «Начало · Отчет · Бюджет»; everything else is under «Меню».
// Light only: no theme switch (СИГМА has no dark theme). Built once at boot from the route table. It follows the store (period, user type, sources) and the router
// (current item, period switch hidden on screens that do not depend on a period). Page workers never edit this file.
import { store, safe, ROLE_SELECTOR } from './store.js';
import { ROUTES, GROUPS, byId, href as routeHref } from './routes.js';
import { html, attrs, nextId } from './html.js';
import { icon } from './icons.js';
import { popover, sheet } from './ui/sheet.js';
import { openLegend } from './ui/status.js';
import { toggle } from './ui/forms.js';
import { data } from './data.js';
import { date } from './format.js';
import { router } from './router.js';

const $ = id => document.getElementById(id);
const MARK = html`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3" y="18" width="6" height="11" fill="var(--ink)"/><rect x="12.5" y="12" width="6" height="17" fill="var(--ink)"/><rect x="22" y="6" width="6" height="23" fill="var(--ink)"/><rect x="2" y="29.5" width="28" height="1.5" fill="var(--ink)"/><circle cx="25" cy="2.6" r="2.4" fill="var(--crimson)"/></svg>`;
const yearOf = p => p.label.split(' · ')[0];
const statusOf = p => p.label.split(' · ')[1] || '';
const NEWS_KEY = 'bns.news.seen';

/* The three main sections of the app. The phone bottom bar shows them as tabs, the desktop band as rows (only the current section lists
   its screens). «Моите данъци» (S18) is not a section: it is a permanent entry of the masthead. Every other route lives under «Още». */
const idsOf = (...groups) => ROUTES.filter(r => groups.includes(r.group)).map(r => r.id);
const SECTIONS = [
  { id: 'home', label: 'Начало', tab: 'Начало', icon: 'home', to: 'S01', routes: ['S01'] },
  { id: 'exec', label: 'Изпълнение', tab: 'Отчет', icon: 'gauge', to: 'S15', routes: idsOf('exec') },
  { id: 'money', label: 'Бюджет', tab: 'Бюджет', icon: 'wallet', to: 'S07', routes: idsOf('budget'), order: ['S07', 'S06', 'S10', 'S12', 'S13', 'S14', 'S20', 'S05'] }
];
const TABS = SECTIONS;
const MORE_GROUPS = [['learn', 'Научи повече'], ['debt', 'Контекст и сравнения'], ['ref', 'Данни и проект']];
const MORE_ROUTES = idsOf(...MORE_GROUPS.map(g => g[0]));
const navName = r => r.short || r.title;

const openSearch = el => import('./search.js').then(m => m.openPalette(el)).catch(e => { console.error(e); });

/* ------------------------------------------------------------------ settings controls (shared by the ⋯ menu and the phone „Още“ sheet) */
function userTypeRadios(name) {
  if (!ROLE_SELECTOR) return '';                   // V5: no role selector in the main flow (flag in js/store.js)
  return html`<fieldset class="opt-list"><legend class="opt-legend">Изглед за</legend>${store.USER_TYPES.map(t => html`<label class="opt"><input type="radio" name="${name}" value="${t.id}" data-pref="userType"${t.id === store.get('userType') ? html` checked` : ''}><span class="opt-main"><span class="opt-label">${t.label}</span><span class="opt-desc">${t.hint}</span></span></label>`)}</fieldset>`;
}
function toggles(withSources) {
  return html`<div class="toggle-list">
    ${withSources ? toggle({ id: nextId('t'), label: 'Източници до числата', hint: 'Показва откъде е всяко число.', checked: store.get('sources'), attrs: attrs({ 'data-pref': 'sources' }) }) : ''}
    ${toggle({ id: nextId('t'), label: 'Само официални данни', hint: 'Скрива примерните (щрихованите) блокове.', checked: store.get('onlyReal'), attrs: attrs({ 'data-pref': 'onlyReal' }) })}
    ${toggle({ id: nextId('t'), label: 'На човек', hint: 'Сумите в евро на жител, където има смисъл.', checked: store.get('perPerson'), attrs: attrs({ 'data-pref': 'perPerson' }) })}
    ${toggle({ id: nextId('t'), label: 'Сумите и в лева', hint: 'До еврото показва и лева (1 € = 1,95583 лв.).', checked: store.get('leva'), attrs: attrs({ 'data-pref': 'leva' }) })}
  </div>`;
}
function bindPrefs(el) {
  el.addEventListener('change', e => {
    const t = e.target;
    const k = t && t.dataset && t.dataset.pref;
    if (!k) return;
    store.set(k, t.type === 'checkbox' ? t.checked : t.value);
  });
}

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
function openMore(btn) {
  const body = html`<div class="stack">${userTypeRadios(nextId('utype'))}${toggles(false)}<p class="small"><button type="button" class="link-btn" data-action="legend">Легенда: какво означават белезите</button></p></div>`;
  const pop = popover.open(btn, { title: 'Настройки на изгледа', body, label: 'Настройки на изгледа', align: 'end' });
  bindPrefs(pop.el);
}
function openMoreSheet(btn) {
  const nav = GROUPS.filter(g => g.id !== 'util').map(g => {
    const items = ROUTES.filter(r => r.group === g.id && r.nav);
    if (!items.length) return '';
    return html`<section class="more-grp"><h3>${g.label}</h3><ul class="more-list">${items.map(r => html`<li><a href="${routeHref(r.id)}"${router.current?.route?.id === r.id ? html` aria-current="page"` : ''}>${icon(r.icon, { size: 18 })}<span>${navName(r)}</span></a></li>`)}</ul></section>`;
  });
  const body = html`<div class="more-sheet">
    <nav aria-label="Всички раздели">${nav}</nav>
    <section class="more-set" aria-labelledby="more-set-h"><h3 id="more-set-h">Настройки</h3>
      <div class="stack">${userTypeRadios(nextId('utype'))}${toggles(true)}
      <p class="small"><button type="button" class="link-btn" data-action="legend">Легенда: какво означават белезите</button></p></div>
    </section></div>`;
  const s = sheet.open({ title: btn && btn.id === 'btn-menu' ? 'Меню' : 'Още', body, returnFocus: btn, cls: 'sheet-drawer' });
  bindPrefs(s.el);
  s.el.addEventListener('click', e => { if (e.target.closest('a[href^="#/"]')) s.close(); });
}

/** the «Още» dropdown of the wide section band: the same links as the band's hidden «Още» list (the popover closes on navigation) */
function openNavMore(btn) {
  const groups = MORE_GROUPS.map(([g, label]) => {
    const items = ROUTES.filter(r => r.group === g && r.nav && MORE_ROUTES.includes(r.id));
    return html`<section class="more-grp"><h3>${label || GROUPS.find(x => x.id === g).label}</h3><ul class="more-list">${items.map(r => html`<li><a href="${routeHref(r.id)}"${router.current?.route?.id === r.id ? html` aria-current="page"` : ''}><span>${navName(r)}</span></a></li>`)}</ul></section>`;
  });
  popover.open(btn, { title: 'Още', body: html`<nav class="nav-pop" aria-label="Още раздели">${groups}</nav>`, label: 'Още раздели', align: 'start' });
}

/* ------------------------------------------------------------------ pieces */
function bannerHtml() {
  return html`<span class="hatch-swatch" aria-hidden="true"></span>
    <p><strong>Mock прототип:</strong> официални данни, където ги има; примерните са със щриховка. <button type="button" class="link-btn" data-action="legend">Легенда</button></p>
    <button type="button" class="x" data-action="dismiss-banner" aria-label="Скрий съобщението за тази сесия">${icon('x', { size: 18 })}</button>`;
}
function topbarHtml() {
  const p = store.period;
  return html`<div class="mast-in"><a class="brand" href="#/" aria-label="Бюджет на светло, към началото">${MARK}<span class="brand-name">Бюджет на светло</span></a>
    <span class="badge-mock" title="Прототип с официални и примерни данни">Mock</span>
    <div class="topbar-tools">
      <button type="button" class="tool-btn searchbtn" id="btn-search" aria-haspopup="dialog" aria-keyshortcuts="/ Control+K Meta+K" aria-label="Търси: ДДС, МВР, Пловдив…"><span class="prompt" aria-hidden="true">›</span>${icon('search', { size: 20 })}<span class="ph">Търси: ДДС, МВР, Пловдив…</span><kbd aria-hidden="true">/</kbd></button>
      <a class="tool-btn tax-link" id="link-tax" href="${routeHref('S18')}" data-nav-tax><span>Моите данъци</span></a>
      <button type="button" class="tool-btn period-btn" id="btn-period" aria-haspopup="dialog" aria-expanded="false" aria-label="Година и статус на данните: ${p.label}"><span class="p-year">${yearOf(p)}</span><span class="p-status"> · ${statusOf(p)}</span>${icon('chevronDown', { size: 14 })}</button>
      <button type="button" class="tool-btn only-wide" id="btn-sources" aria-pressed="${store.get('sources') ? 'true' : 'false'}"><span>Източници</span></button>
      <button type="button" class="icon-btn only-wide" id="btn-more" aria-haspopup="dialog" aria-expanded="false" aria-label="Още настройки" title="Още настройки">${icon('more', { size: 20 })}</button>
      <button type="button" class="menu-btn" id="btn-menu" aria-haspopup="dialog" aria-expanded="false"><span class="menu-box" aria-hidden="true"><span></span><span></span></span><span>Меню</span></button>
    </div></div>`;
}
const NEWS_DOT = label => html`<span class="nav-dot" data-news-dot data-label="${label}" hidden></span>`;
const subLink = r => html`<li><a href="${routeHref(r.id)}" data-nav="${r.id}"><span>${navName(r)}</span>${r.id === 'S16' ? NEWS_DOT('Какво ново (има непрочетено)') : ''}</a></li>`;
function navHtml() {
  const rows = SECTIONS.map(s => {
    const own = ROUTES.filter(r => s.routes.includes(r.id) && r.nav);
    const subs = s.order ? s.order.map(id => own.find(r => r.id === id)).filter(Boolean) : own;       // the section's own screens, the main one included (the band shows the whole line)
    return html`<div class="nav-sec" data-sec="${s.id}"><a class="nav-main" href="${routeHref(s.to)}" data-nav="${subs.some(x => x.id === s.to) ? '' : s.to}"><span>${s.label}</span>${s.id === 'exec' ? NEWS_DOT('Изпълнение (има непрочетено)') : ''}</a>${subs.length > 1 ? html`<ul class="nav-sub">${subs.map(subLink)}</ul>` : ''}</div>`;
  });
  const more = MORE_GROUPS.map(([g, label]) => {
    const items = ROUTES.filter(r => r.group === g && r.nav && MORE_ROUTES.includes(r.id));
    return html`<h3 class="nav-sub-h">${label || GROUPS.find(x => x.id === g).label}</h3><ul class="nav-sub">${items.map(subLink)}</ul>`;
  });
  return html`<div class="nav-in">${rows}<div class="nav-sec" data-sec="more"><button type="button" class="nav-main" id="nav-more" aria-haspopup="dialog" aria-expanded="false"><span>Още</span>${icon('chevronDown', { size: 12, cls: 'nav-chev' })}</button><div class="nav-more-list" id="nav-more-list">${more}</div></div>
    </div>`;
}
function tabbarHtml() {
  return html`${TABS.map(t => html`<a href="${routeHref(t.to)}" data-tab="${t.id}">${icon(t.icon, { size: 20 })}<span>${t.tab}</span></a>`)}`;
}
function footerHtml() {
  const core = data.get('core');
  const b = core && core.build;
  const kfp = b && b.kfpLatest ? (/^\d{4}-\d{2}-\d{2}/.test(b.kfpLatest) ? date(b.kfpLatest) : b.kfpLatest) : '';
  return html`<div class="footer-in">
    <ul class="links"><li><a href="#/danni">Данни и методика</a></li><li><a href="#/rechnik">Речник</a></li><li><a href="#/api">API</a></li><li><a href="#/vrazka" data-feedback-link>Намерих грешка</a></li><li><a href="#/za-proekta">За проекта</a></li></ul>
    <div class="fine">
      ${kfp ? html`<span>Данните: КФП към ${kfp}${b.kfpPublished ? html` (обн. ${date(b.kfpPublished)})` : ''}</span>` : ''}
      ${b && b.dataVersion ? html`<span>Версия на данните: ${b.dataVersion}</span>` : ''}
      <span>Mock прототип: част от данните са примерни и са със щриховка.</span>
      <span>Лиценз на данните: предстои решение.</span>
    </div>
    <p class="small muted">Работна група „Бюджет на светло“</p>
  </div>`;
}

/* ------------------------------------------------------------------ dynamic state */
function setCurrent(route) {
  const root = route.parent ? (function top(r) { return r.parent ? top(byId[r.parent]) : r; })(route) : route;
  document.querySelectorAll('#sidenav a[data-nav]').forEach(a => {
    if (a.dataset.nav === route.id) a.setAttribute('aria-current', 'page');
    else if (a.dataset.nav === root.id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  const tab = TABS.find(t => t.routes.includes(route.id) || (route.parent && t.routes.includes(root.id)));
  document.querySelectorAll('#tabbar [data-tab]').forEach(el => {
    if (tab && el.dataset.tab === tab.id) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  const tx = $('link-tax');                                  // the permanent «Моите данъци» entry of the masthead
  if (tx) { if (route.id === 'S18') tx.setAttribute('aria-current', 'page'); else tx.removeAttribute('aria-current'); }
  const sec = tab ? tab.id : MORE_ROUTES.includes(route.id) ? 'more' : '';
  document.querySelectorAll('#sidenav .nav-sec').forEach(el => setSection(el, el.dataset.sec === sec));
}
/* the current section is underlined in the band and lists its screens on the band's second line */
function setSection(el, cur) {
  el.toggleAttribute('data-current', cur);
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
  $('btn-sources')?.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    $('sidenav').innerHTML = navHtml().toString();
    $('tabbar').innerHTML = tabbarHtml().toString();
    shell.refreshFooter();
    applySources();

    $('btn-period').addEventListener('click', e => openPeriod(e.currentTarget));
    $('btn-search').addEventListener('click', e => openSearch(e.currentTarget));
    $('btn-more').addEventListener('click', e => openMore(e.currentTarget));
    $('btn-menu').addEventListener('click', e => {
      const b = e.currentTarget;
      b.setAttribute('aria-expanded', 'true');
      openMoreSheet(b);
      const d = document.querySelector('dialog.sheet-drawer');
      if (d) d.addEventListener('close', () => b.setAttribute('aria-expanded', 'false'), { once: true }); else b.setAttribute('aria-expanded', 'false');
    });
    $('btn-sources').addEventListener('click', () => store.set('sources', !store.get('sources')));
    $('nav-more').addEventListener('click', e => openNavMore(e.currentTarget));

    store.subscribe(k => {
      if (k === 'period') refreshPeriod();
      else if (k === 'sources') applySources();
    });
    router.onNavigate(({ route, demo }) => {
      setCurrent(route);
      const per = router.periods;
      const b = $('btn-period');
      if (b) b.hidden = per === 'none';
      updateOffline(demo);
      if (route.id === 'S16') markNewsSeen();
      const fb = document.querySelector('[data-feedback-link]');
      if (fb) fb.setAttribute('href', `#/vrazka?type=greshka&from=${encodeURIComponent(location.hash.replace(/^#\/?/, '').split('?')[0])}`);
    });
    window.addEventListener('online', () => updateOffline(router.current?.vm?.demo));
    window.addEventListener('offline', () => updateOffline(router.current?.vm?.demo));
    updateOffline(new URLSearchParams(location.hash.split('?')[1] || '').get('demo'));
    checkNews();
  },
  refreshFooter() { const f = $('footer'); if (f) f.innerHTML = footerHtml().toString(); },
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
