// The HTML of the app shell around a screen: the banner, the header with its section buttons, the phone tab bar and the footer
// (docs/adr/0002-react-router-ssr.md). js/shell.js puts it in the page and keeps it in step with the navigation; the server writes it
// into the first response with the current screen already marked. Nothing here touches the DOM.
import { store } from './store.js';
import { ROUTES, byId, href as routeHref } from './routes.js';
import { html } from './html.js';
import { icon } from './icons.js';
import { data } from './data.js';
import { date } from './format.js';
import { serverScope } from './env.js';
import { toHref } from './loc.js';

export const MARK = html`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3" y="18" width="6" height="11" fill="var(--ink)"/><rect x="12.5" y="12" width="6" height="17" fill="var(--ink)"/><rect x="22" y="6" width="6" height="23" fill="var(--ink)"/><rect x="2" y="29.5" width="28" height="1.5" fill="var(--ink)"/><circle cx="25" cy="2.6" r="2.4" fill="var(--crimson)"/></svg>`;
export const yearOf = p => p.label.split(' · ')[0];
export const statusOf = p => p.label.split(' · ')[1] || '';

/* The three main sections of the app. The phone bottom bar shows them as tabs, the desktop band as rows (only the current section lists
   its screens). V6 (25.10): «Моите данъци» (S18) is no longer a permanent masthead button; it lives under «Още» (group «Данъци»), in the phone «Меню» and in the footer. */
const idsOf = (...groups) => ROUTES.filter(r => groups.includes(r.group)).map(r => r.id);
export const SECTIONS = [
  { id: 'home', label: 'Начало', tab: 'Начало', icon: 'home', to: 'S01', routes: ['S01'] },
  { id: 'exec', label: 'Изпълнение', tab: 'Отчет', icon: 'gauge', to: 'S15', routes: idsOf('exec') },
  { id: 'money', label: 'Бюджет', tab: 'Бюджет', icon: 'wallet', to: 'S07', routes: idsOf('budget') }
];
export const TABS = SECTIONS;
/* The five header buttons, the footer groups and the phone «Меню» are ONE list (the real routes of js/routes.js; nav:false screens such as S08/S11/S21 belong to their parents). */
export const NAV_GROUPS = [
  ['Начало', ['S01', 'S04', 'S03']],
  ['Изпълнение', ['S15', 'S16']],
  ['Бюджет', ['S07', 'S06', 'S10', 'S12', 'S13', 'S34', 'S14', 'S20', 'S05']],
  ['Данъци и контекст', ['S18', 'S17', 'S31']],
  ['Данни и проект', ['S24', 'S35', 'S25', 'S26', 'S27']]
];
/* The sister platform (spec §2.2): visible, but after the screens of the site: the last item of «Данни и проект», the phone «Меню» and the footer. */
// the address of the original СИГМА is configuration (docs/approach-specification.md, section 2.2): <meta name="sigma-url"> in the page,
// or the server's SIGMA_URL; only an https address is used
const sigmaHref = () => {
  const v = String(serverScope()?.sigmaUrl ?? (typeof document === 'undefined' ? '' : document.querySelector('meta[name="sigma-url"]')?.content) ?? '').trim();
  return /^https:\/\/[^\s"<>]+$/.test(v) ? v : 'https://sigma.midt.bg/';
};
export const SIGMA = { label: 'СИГМА — обществени поръчки', get href() { return sigmaHref(); } };
export const sigmaLink = cls => html`<a class="${cls}" href="${SIGMA.href}" target="_blank" rel="noopener">${SIGMA.label}<span class="sr-only"> (друг сайт, в нов раздел)</span></a>`;   // a new tab: also out of an embed frame
const rootId = r => (r.parent ? rootId(byId[r.parent]) : r.id);
export const rootOf = r => byId[rootId(r)];
export const groupOf = route => { const root = rootId(route); return NAV_GROUPS.findIndex(([, ids]) => ids.includes(route.id) || ids.includes(root)); };
export const groupItems = ids => ids.map(id => byId[id]).filter(r => r && r.nav);
export const navName = r => r.short || r.title;
/* A menu link keeps the chosen year when its screen can show it. A plain click always did (router.go adds ?per=); the address itself also covers a new tab and a copied link.
   The dropdowns and the drawer are built when they open; the tab bar and the footer are built once, so js/shell.js syncLinks() follows every navigation. */
export const navHref = id => {
  const per = store.periodParam(), p = byId[id].periods;
  return routeHref(id, {}, per && (p === 'all' || (Array.isArray(p) && p.includes(per))) ? { per } : {});
};
/** the tab of the phone bar a screen belongs to */
export const tabOf = route => { const root = rootOf(route); return TABS.find(t => t.routes.includes(route.id) || (route.parent && t.routes.includes(root.id))); };

/* ------------------------------------------------------------------ pieces */
export function bannerHtml() {
  return html``;
}
export const CTA = 'Бюджет 2027';
/** the header; o.route marks its group, o.periods === 'none' hides the period button (a screen that does not depend on the period) */
export function topbarHtml(o = {}) {
  const p = store.period;
  return html`<div class="mast-in"><a class="brand" href="${routeHref('S01')}" aria-label="СИГМА Бюджет, към началото">${MARK}<span class="brand-name">СИГМА Бюджет</span></a>
    <span class="badge-mock" title="Бета версия с данни от официални източници">Бета</span>
    <div class="topbar-tools">
      <button type="button" class="tool-btn period-btn" id="btn-period" aria-haspopup="dialog" aria-expanded="false" aria-label="Година и статус на данните: ${p.label}"${o.periods === 'none' ? html` hidden` : ''}><span class="p-year">${yearOf(p)}</span><span class="p-status"> · ${statusOf(p)}</span>${icon('chevronDown', { size: 14 })}</button>
      <nav class="sidenav" id="sidenav" aria-label="Основна навигация">${navHtml(o.route)}</nav>
      <button type="button" class="menu-btn" id="btn-menu" aria-haspopup="dialog" aria-expanded="false"><span class="menu-box" aria-hidden="true"><span></span><span></span></span><span>Меню</span></button>
    </div></div>`;
}
const NEWS_DOT = label => html`<span class="nav-dot" data-news-dot data-label="${label}" hidden></span>`;
export function navHtml(route) {
  const g = route ? groupOf(route) : -1;
  const rows = NAV_GROUPS.map(([label], i) => html`<div class="nav-sec" data-sec="g${i}"${i === g ? html` data-current` : ''}><button type="button" class="nav-main" data-grp="${i}" aria-haspopup="dialog" aria-expanded="false"${i === g ? html` aria-current="true"` : ''}><span>${label}</span>${i === 1 ? NEWS_DOT('Изпълнение (има непрочетено)') : ''}${icon('chevronDown', { size: 12, cls: 'nav-chev' })}</button></div>`);
  const lupa = html`<button type="button" class="nav-search" id="btn-search" data-action="search" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="/ Control+K Meta+K" aria-label="Търсене" title="Търсене (/)">${icon('search', { size: 22 })}</button>`;
  const cta = route ? (route.id === 'S34' ? html` aria-current="page"` : rootId(route) === 'S34' ? html` aria-current="true"` : '') : '';
  return html`<div class="nav-in">${rows}${lupa}<a class="nav-cta" href="${routeHref('S34')}" data-nav="S34"${cta}>${CTA}</a></div>`;
}
export function tabbarHtml(route) {
  const tab = route ? tabOf(route) : null;
  return html`${TABS.map(t => html`<a href="${navHref(t.to)}" data-route="${t.to}" data-tab="${t.id}"${tab && tab.id === t.id ? html` aria-current="page"` : ''}>${icon(t.icon, { size: 20 })}<span>${t.tab}</span></a>`)}`;
}

/* V6 footer: every screen of the menu, grouped (the ids are the real routes of js/routes.js; nav:false screens like S08/S11/S21 are children of listed ones).
   Phones: one collapsible group per heading (native <details>, keyboard-operable); wide screens: all groups open side by side (js/shell.js syncFooter).
   o.wide opens every group, o.cur is the id of the current screen, o.from the path the
   feedback link names */
export function footerHtml(o = {}) {
  const core = data.get('core');
  const b = core && core.build;
  const kfp = b && b.kfpLatest ? (/^\d{4}-\d{2}-\d{2}/.test(b.kfpLatest) ? date(b.kfpLatest) : b.kfpLatest) : '';
  const cur = o.cur;
  const groups = NAV_GROUPS.map(([label, ids]) => {
    const items = groupItems(ids);
    return html`<details class="foot-grp"${o.wide ? html` open` : ''}><summary${o.wide ? html` tabindex="-1"` : ''}>${label}</summary><ul>${items.map(r => html`<li><a href="${r.id === 'S27' && o.from != null ? toHref(`/vrazka?type=greshka&from=${encodeURIComponent(o.from)}`) : navHref(r.id)}" data-route="${r.id}"${r.id === 'S27' ? html` data-feedback-link` : ''}${cur === r.id ? html` aria-current="page"` : ''}>${navName(r)}</a></li>`)}</ul></details>`;
  });
  return html`<div class="footer-in">
    <nav class="foot-nav" aria-label="Всички страници">${groups}</nav>
    <div class="fine">
      ${kfp ? html`<span>Данните: КФП към ${kfp}${b.kfpPublished ? html` (обн. ${date(b.kfpPublished)})` : ''}</span>` : ''}
      ${b && b.dataVersion ? html`<span>Версия на данните: ${b.dataVersion}</span>` : ''}
      <span>Данни от официални източници. Законопроектите, прогнозите и отчетите са обозначени.</span>
      <span>Лиценз на данните: предстои решение.</span>
      <span>${sigmaLink('sister-link')}</span>
      <button type="button" class="link-btn" data-action="legend">Легенда: какво означават белезите</button>
    </div>
    <p class="small muted">Работна група „Бюджет на светло“</p>
  </div>`;
}
