// App shell: mock banner, top bar, left nav (>=900 px), bottom bar (<900 px), footer, offline banner.
// Built once at boot from the route table. It follows the store (period, user type, theme, sources) and the router
// (current item, period switch hidden on screens that do not depend on a period). Page workers never edit this file.
import { store, safe } from './store.js';
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
const MARK = html`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="var(--data)"/><rect x="6.5" y="19" width="4.6" height="6" rx="1.2" fill="var(--on-data)"/><rect x="13.7" y="15" width="4.6" height="10" rx="1.2" fill="var(--on-data)"/><rect x="20.9" y="11" width="4.6" height="14" rx="1.2" fill="var(--on-data)"/><circle cx="23.2" cy="6.4" r="3" fill="var(--accent)"/></svg>`;
const yearOf = p => p.label.split(' · ')[0];
const statusOf = p => p.label.split(' · ')[1] || '';
const NEWS_KEY = 'bns.news.seen';

/* the covered routes of each bottom-bar tab; every other route lights „Още“ */
const TABS = [
  { id: 'home', label: 'Начало', icon: 'home', to: 'S01', routes: ['S01'] },
  { id: 'money', label: 'Парите', icon: 'wallet', to: 'S05', routes: ROUTES.filter(r => r.group === 'budget').map(r => r.id) },
  { id: 'exec', label: 'Изпълнение', icon: 'gauge', to: 'S15', routes: ['S15', 'S16'] },
  { id: 'tax', label: 'Данъци', icon: 'percent', to: 'S18', routes: ['S18'] }
];

const openSearch = el => import('./search.js').then(m => m.openPalette(el)).catch(e => { console.error(e); });

/* ------------------------------------------------------------------ settings controls (shared by the ⋯ menu and the phone „Още“ sheet) */
function userTypeRadios(name) {
  return html`<fieldset class="opt-list"><legend class="opt-legend">Изглед за</legend>${store.USER_TYPES.map(t => html`<label class="opt"><input type="radio" name="${name}" value="${t.id}" data-pref="userType"${t.id === store.get('userType') ? html` checked` : ''}><span class="opt-main"><span class="opt-label">${t.label}</span><span class="opt-desc">${t.hint}</span></span></label>`)}</fieldset>`;
}
function themeRadios(name) {
  const T = [['auto', 'Автоматична', 'monitor'], ['light', 'Светла', 'sun'], ['dark', 'Тъмна', 'moon']];
  return html`<fieldset class="opt-list opt-row"><legend class="opt-legend">Тема</legend>${T.map(([v, l, ic]) => html`<label class="opt opt-chip"><input type="radio" name="${name}" value="${v}" data-pref="theme"${v === store.get('theme') ? html` checked` : ''}><span class="opt-main">${icon(ic, { size: 18 })}<span class="opt-label">${l}</span></span></label>`)}</fieldset>`;
}
function toggles(withSources) {
  return html`<div class="toggle-list">
    ${withSources ? toggle({ id: nextId('t'), label: 'Източници до числата', hint: 'Показва откъде е всяко число.', checked: store.get('sources'), attrs: attrs({ 'data-pref': 'sources' }) }) : ''}
    ${toggle({ id: nextId('t'), label: 'Само реални данни', hint: 'Скрива примерните (щрихованите) блокове.', checked: store.get('onlyReal'), attrs: attrs({ 'data-pref': 'onlyReal' }) })}
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
function openUser(btn) {
  const name = nextId('utype');
  const body = html`<div class="stack">${userTypeRadios(name)}<p class="small muted">Сменя какво показваме първо и в какъв ред. Всичко остава достъпно на всеки изглед.</p></div>`;
  const pop = popover.open(btn, { title: 'Изглед за', body, label: 'Изглед за', align: 'start' });
  bindPrefs(pop.el);
  pop.el.addEventListener('change', e => { if (e.target?.dataset?.pref === 'userType') pop.close(); });
  pop.el.querySelector('input:checked')?.focus({ preventScroll: true });
}
function openMore(btn) {
  const body = html`<div class="stack">${toggles(false)}<p class="small"><button type="button" class="link-btn" data-action="legend">Легенда: какво означават белезите</button></p></div>`;
  const pop = popover.open(btn, { title: 'Настройки на изгледа', body, label: 'Настройки на изгледа', align: 'end' });
  bindPrefs(pop.el);
}
function openMoreSheet(btn) {
  const nav = GROUPS.filter(g => g.id !== 'util').map(g => {
    const items = ROUTES.filter(r => r.group === g.id && r.nav);
    if (!items.length) return '';
    return html`<section class="more-grp"><h3>${g.label}</h3><ul class="more-list">${items.map(r => html`<li><a href="${routeHref(r.id)}"${router.current?.route?.id === r.id ? html` aria-current="page"` : ''}>${icon(r.icon, { size: 18 })}<span>${r.title}</span>${r.phase === 2 ? html`<span class="nav-tag">фаза 2</span>` : ''}</a></li>`)}</ul></section>`;
  });
  const body = html`<div class="more-sheet">
    <nav aria-label="Всички раздели">${nav}</nav>
    <section class="more-set" aria-labelledby="more-set-h"><h3 id="more-set-h">Настройки</h3>
      <div class="stack">${userTypeRadios(nextId('utype'))}${themeRadios(nextId('theme'))}${toggles(true)}
      <p class="small"><button type="button" class="link-btn" data-action="legend">Легенда: какво означават белезите</button></p></div>
    </section></div>`;
  const s = sheet.open({ title: 'Още', body, returnFocus: btn });
  bindPrefs(s.el);
  s.el.addEventListener('click', e => { if (e.target.closest('a[href^="#/"]')) s.close(); });
}

/* ------------------------------------------------------------------ pieces */
function bannerHtml() {
  return html`<span class="hatch-swatch" aria-hidden="true"></span>
    <p><strong>Mock прототип:</strong> реални данни, където ги има; примерните са със щриховка. <button type="button" class="link-btn" data-action="legend">Легенда</button></p>
    <button type="button" class="x" data-action="dismiss-banner" aria-label="Скрий съобщението за тази сесия">${icon('x', { size: 18 })}</button>`;
}
function topbarHtml() {
  const p = store.period, ut = store.userTypeInfo;
  return html`<a class="brand" href="#/" aria-label="Бюджет на светло, към началото">${MARK}<span class="brand-name">Бюджет на светло</span></a>
    <span class="badge-mock" title="Прототип с реални и примерни данни">Mock</span>
    <div class="topbar-tools">
      <button type="button" class="tool-btn period-btn" id="btn-period" aria-haspopup="dialog" aria-expanded="false" aria-label="Година и статус на данните: ${p.label}"><span class="p-year">${yearOf(p)}</span><span class="p-status"> · ${statusOf(p)}</span>${icon('chevronDown', { size: 16 })}</button>
      <button type="button" class="tool-btn searchbtn" id="btn-search" aria-haspopup="dialog" aria-keyshortcuts="/ Control+K Meta+K" aria-label="Търси: ДДС, МВР, Пловдив…">${icon('search', { size: 18 })}<span class="ph">Търси: ДДС, МВР, Пловдив…</span><kbd aria-hidden="true">/</kbd></button>
      <button type="button" class="tool-btn only-wide" id="btn-user" aria-haspopup="dialog" aria-expanded="false"><span class="lbl-muted">Изглед за:</span> <span id="user-label">${ut.label}</span>${icon('chevronDown', { size: 16 })}</button>
      <button type="button" class="tool-btn only-wide" id="btn-sources" aria-pressed="${store.get('sources') ? 'true' : 'false'}">${icon('link', { size: 16 })}<span>Източници</span></button>
      <div class="theme-switch only-wide" role="group" aria-label="Тема">
        ${[['auto', 'Автоматична тема', 'monitor'], ['light', 'Светла тема', 'sun'], ['dark', 'Тъмна тема', 'moon']].map(([v, l, ic]) => html`<button type="button" data-theme-set="${v}" aria-pressed="${store.get('theme') === v ? 'true' : 'false'}" aria-label="${l}" title="${l}">${icon(ic, { size: 16 })}</button>`)}
      </div>
      <button type="button" class="icon-btn only-wide" id="btn-more" aria-haspopup="dialog" aria-expanded="false" aria-label="Още настройки" title="Още настройки">${icon('more', { size: 20 })}</button>
    </div>`;
}
function navHtml() {
  return html`${GROUPS.filter(g => g.id !== 'util').map(g => {
    const items = ROUTES.filter(r => r.group === g.id && r.nav);
    if (!items.length) return '';
    return html`<h2 id="nav-${g.id}">${g.label}</h2><ul aria-labelledby="nav-${g.id}">${items.map(r => html`<li><a href="${routeHref(r.id)}" data-nav="${r.id}">${icon(r.icon, { size: 18 })}<span>${r.title}</span>${r.phase === 2 ? html`<span class="nav-tag">фаза 2</span>` : ''}${r.id === 'S16' ? html`<span class="nav-dot" data-news-dot hidden></span>` : ''}</a></li>`)}</ul>`;
  })}`;
}
function tabbarHtml() {
  return html`${TABS.map(t => html`<a href="${routeHref(t.to)}" data-tab="${t.id}">${icon(t.icon, { size: 22 })}<span>${t.label}</span></a>`)}<button type="button" data-tab="more" aria-haspopup="dialog" id="btn-tab-more">${icon('menu', { size: 22 })}<span>Още</span></button>`;
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
  const tab = TABS.find(t => t.routes.includes(route.id));
  document.querySelectorAll('#tabbar [data-tab]').forEach(el => {
    const mine = tab ? el.dataset.tab === tab.id : el.dataset.tab === 'more';
    if (mine) el.setAttribute('aria-current', tab ? 'page' : 'true'); else el.removeAttribute('aria-current');
  });
}
function refreshPeriod() {
  const p = store.period, b = $('btn-period');
  if (!b) return;
  b.querySelector('.p-year').textContent = yearOf(p);
  b.querySelector('.p-status').textContent = ' · ' + statusOf(p);
  b.setAttribute('aria-label', `Година и статус на данните: ${p.label}`);
}
function applyTheme() {
  const t = store.get('theme'), root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === t ? 'true' : 'false'));
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
    const dot = document.querySelector('[data-news-dot]');
    if (dot && (!seen || seen < latest)) { dot.hidden = false; dot.dataset.latest = latest; dot.parentElement.setAttribute('aria-label', 'Какво ново (има непрочетено)'); }
  } catch { /* no feed yet: no dot */ }
}
function markNewsSeen() {
  const dot = document.querySelector('[data-news-dot]');
  if (!dot || dot.hidden) return;
  if (dot.dataset.latest) safe.set('localStorage', NEWS_KEY, dot.dataset.latest);
  dot.hidden = true;
  dot.parentElement.removeAttribute('aria-label');
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
    applyTheme(); applySources();

    $('btn-period').addEventListener('click', e => openPeriod(e.currentTarget));
    $('btn-search').addEventListener('click', e => openSearch(e.currentTarget));
    $('btn-user').addEventListener('click', e => openUser(e.currentTarget));
    $('btn-more').addEventListener('click', e => openMore(e.currentTarget));
    $('btn-tab-more').addEventListener('click', e => openMoreSheet(e.currentTarget));
    $('btn-sources').addEventListener('click', () => store.set('sources', !store.get('sources')));
    $('topbar').addEventListener('click', e => { const b = e.target.closest('[data-theme-set]'); if (b) store.set('theme', b.dataset.themeSet); });

    store.subscribe(k => {
      if (k === 'period') refreshPeriod();
      else if (k === 'userType') { const l = $('user-label'); if (l) l.textContent = store.userTypeInfo.label; }
      else if (k === 'theme') applyTheme();
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
