import type { Period } from '../../lib/legacy';
import type { WebRoute } from '../../lib/routes';
// The HTML of the app shell around a screen: the banner, the header with its section buttons, the phone tab bar and the footer
// (docs/adr/0002-react-router-ssr.md). js/shell.js puts it in the page and keeps it in step with the navigation; the server writes it
// into the first response with the current screen already marked. Nothing here touches the DOM.
import { store } from '../../lib/legacy';
import { ROUTES, byId, href as routeHref } from '../../lib/legacy';

import { icon } from '../Icon';
import { data } from '../../lib/legacy';
import { date } from '../../lib/legacy';
import { serverScope } from '../../lib/legacy';
import { toHref } from '../../../client/loc.js';

export const MARK = (
  <>
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="3" y="18" width="6" height="11" fill="var(--ink)" />
      <rect x="12.5" y="12" width="6" height="17" fill="var(--ink)" />
      <rect x="22" y="6" width="6" height="23" fill="var(--ink)" />
      <rect x="2" y="29.5" width="28" height="1.5" fill="var(--ink)" />
      <circle cx="25" cy="2.6" r="2.4" fill="var(--crimson)" />
    </svg>
  </>
);
export const yearOf = (p: Period) => p.label.split(' · ')[0];
export const statusOf = (p: Period) => p.label.split(' · ')[1] || '';

/* The three main sections of the app. The phone bottom bar shows them as tabs, the desktop band as rows (only the current section lists
   its screens). V6 (25.10): «Моите данъци» (S18) is no longer a permanent masthead button; it lives under «Още» (group «Данъци»), in the phone «Меню» and in the footer. */
const idsOf = (...groups: string[]) =>
  ROUTES.filter((r) => groups.includes(r.group)).map((r) => r.id);
export const SECTIONS = [
  { id: 'home', label: 'Начало', tab: 'Начало', icon: 'home', to: 'S01', routes: ['S01'] },
  {
    id: 'exec',
    label: 'Изпълнение',
    tab: 'Отчет',
    icon: 'gauge',
    to: 'S15',
    routes: idsOf('exec'),
  },
  {
    id: 'money',
    label: 'Бюджет',
    tab: 'Бюджет',
    icon: 'wallet',
    to: 'S07',
    routes: idsOf('budget'),
  },
];
export const TABS = SECTIONS;
/* The five header buttons, the footer groups and the phone «Меню» are ONE list (the real routes of js/routes.js; nav:false screens such as S08/S11/S21 belong to their parents). */
export const NAV_GROUPS: [string, string[]][] = [
  ['Начало', ['S01', 'S04', 'S03']],
  ['Изпълнение', ['S15', 'S16']],
  ['Бюджет', ['S07', 'S06', 'S10', 'S12', 'S13', 'S34', 'S14', 'S20', 'S05']],
  ['Данъци и контекст', ['S18', 'S17', 'S31']],
  ['Данни и проект', ['S24', 'S35', 'S25', 'S26', 'S27']],
];
/* The sister platform (spec §2.2): visible, but after the screens of the site: the last item of «Данни и проект», the phone «Меню» and the footer. */
// the address of the original СИГМА is configuration (docs/approach-specification.md, section 2.2): <meta name="sigma-url"> in the page,
// or the server's SIGMA_URL; only an https address is used
const sigmaHref = () => {
  const v = String(
    serverScope()?.sigmaUrl ??
      (typeof document === 'undefined'
        ? ''
        : document.querySelector<HTMLMetaElement>('meta[name="sigma-url"]')?.content) ??
      '',
  ).trim();
  return /^https:\/\/[^\s"<>]+$/.test(v) ? v : 'https://sigma.midt.bg/';
};
export const SIGMA = {
  label: 'СИГМА — обществени поръчки',
  get href() {
    return sigmaHref();
  },
};
export const sigmaLink = (cls: string) => (
  <>
    <a className={cls} href={SIGMA.href} target="_blank" rel="noopener">
      {SIGMA.label}
      <span className="sr-only"> (друг сайт, в нов раздел)</span>
    </a>
  </>
); // a new tab: also out of an embed frame
const rootId = (r: WebRoute): string => (r.parent ? rootId(byId[r.parent]) : r.id);
export const rootOf = (r: WebRoute) => byId[rootId(r)];
export const groupOf = (route: WebRoute) => {
  const root = rootId(route);
  return NAV_GROUPS.findIndex(([, ids]) => ids.includes(route.id) || ids.includes(root));
};
export const groupItems = (ids: string[]) => ids.map((id) => byId[id]).filter((r) => r && r.nav);
export const navName = (r: WebRoute) => r.short || r.title;
/* A menu link keeps the chosen year when its screen can show it. A plain click always did (router.go adds ?per=); the address itself also covers a new tab and a copied link.
   The dropdowns and the drawer are built when they open; the tab bar and the footer are built once, so js/shell.js syncLinks() follows every navigation. */
export const navHref = (id: string) => {
  const per = store.periodParam(),
    p = byId[id].periods;
  return routeHref(
    id,
    {},
    per && (p === 'all' || (Array.isArray(p) && p.includes(per))) ? { per } : {},
  );
};
/** the tab of the phone bar a screen belongs to */
export const tabOf = (route: WebRoute) => {
  const root = rootOf(route);
  return TABS.find(
    (t) => t.routes.includes(route.id) || (route.parent && t.routes.includes(root.id)),
  );
};

/* ------------------------------------------------------------------ pieces */
export function bannerHtml() {
  return (
    <>
      <span className="hatch-swatch" aria-hidden="true"></span>
      <p>
        <strong>Бета.</strong> Официални данни; примерните стойности са със щриховка.{' '}
        <button type="button" className="link-btn" data-action="legend">
          Легенда
        </button>
      </p>
      <button
        type="button"
        className="x"
        data-action="dismiss-banner"
        aria-label="Скрий съобщението за тази сесия"
      >
        {icon('x', { size: 18 })}
      </button>
    </>
  );
}
export const CTA = 'Бюджет 2027';
/** the header; o.route marks its group, o.periods === 'none' hides the period button (a screen that does not depend on the period) */
export function topbarHtml(
  o: {
    route?: WebRoute;
    periods?: WebRoute['periods'];
  } = {},
) {
  const p = store.period;
  return (
    <>
      <div className="mast-in">
        <a className="brand" href={routeHref('S01')} aria-label="Бюджет на светло, към началото">
          {MARK}
          <span className="brand-name">Бюджет на светло</span>
        </a>
        <span
          className="badge-mock"
          title="Бета версия: официални данни и няколко означени примерни стойности"
        >
          Бета
        </span>
        <div className="topbar-tools">
          <button
            type="button"
            className="tool-btn period-btn"
            id="btn-period"
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-label={'Година и статус на данните: ' + p.label}
            hidden={o.periods === 'none'}
          >
            <span className="p-year">{yearOf(p)}</span>
            <span className="p-status"> · {statusOf(p)}</span>
            {icon('chevronDown', { size: 14 })}
          </button>
          <nav className="sidenav" id="sidenav" aria-label="Основна навигация">
            {navHtml(o.route)}
          </nav>
          <button
            type="button"
            className="menu-btn"
            id="btn-menu"
            aria-haspopup="dialog"
            aria-expanded="false"
          >
            <span className="menu-box" aria-hidden="true">
              <span></span>
              <span></span>
            </span>
            <span>Меню</span>
          </button>
        </div>
      </div>
    </>
  );
}
const NEWS_DOT = (label: string) => (
  <>
    <span className="nav-dot" data-news-dot data-label={label} hidden></span>
  </>
);
export function navHtml(route?: WebRoute) {
  const g = route ? groupOf(route) : -1;
  const rows = NAV_GROUPS.map(([label], i) => (
    <>
      <div className="nav-sec" data-sec={'g' + i} data-current={i === g ? '' : undefined}>
        <button
          type="button"
          className="nav-main"
          data-grp={i}
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-current={i === g ? 'true' : undefined}
        >
          <span>{label}</span>
          {i === 1 ? NEWS_DOT('Изпълнение (има непрочетено)') : ''}
          {icon('chevronDown', { size: 12, cls: 'nav-chev' })}
        </button>
      </div>
    </>
  ));
  const lupa = (
    <>
      <button
        type="button"
        className="nav-search"
        id="btn-search"
        data-action="search"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-keyshortcuts="/ Control+K Meta+K"
        aria-label="Търсене"
        title="Търсене (/)"
      >
        {icon('search', { size: 22 })}
      </button>
    </>
  );
  const cta = route
    ? route.id === 'S34'
      ? 'page'
      : rootId(route) === 'S34'
        ? 'true'
        : undefined
    : undefined;
  return (
    <>
      <div className="nav-in">
        {rows}
        {lupa}
        <a className="nav-cta" href={routeHref('S34')} data-nav="S34" aria-current={cta}>
          {CTA}
        </a>
      </div>
    </>
  );
}
export function tabbarHtml(route?: WebRoute) {
  const tab = route ? tabOf(route) : null;
  return (
    <>
      {TABS.map((t) => (
        <>
          <a
            href={navHref(t.to)}
            data-route={t.to}
            data-tab={t.id}
            aria-current={tab && tab.id === t.id ? 'page' : undefined}
          >
            {icon(t.icon, { size: 20 })}
            <span>{t.tab}</span>
          </a>
        </>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ theme (docs/approach-specification.md, section 9.3) */
// '' follows the system (prefers-color-scheme), 'light' and 'dark' are the visitor's choice (localStorage bns.theme, read by js/theme-boot.js)
export const THEME_KEY = 'bns.theme';
export const THEMES = [
  ['', 'системна'],
  ['light', 'светла'],
  ['dark', 'тъмна'],
];
export const themePicker = (now: string) => (
  <>
    <span className="theme-pick" role="group" aria-label="Тема на сайта">
      Тема:
      {THEMES.map(([v, label]) => (
        <>
          {' '}
          <button type="button" className="link-btn" data-theme-pick={v} aria-pressed={now === v}>
            {label}
          </button>
        </>
      ))}
    </span>
  </>
);

/* V6 footer: every screen of the menu, grouped (the ids are the real routes of js/routes.js; nav:false screens like S08/S11/S21 are children of listed ones).
   Phones: one collapsible group per heading (native <details>, keyboard-operable); wide screens: all groups open side by side (js/shell.js syncFooter).
   o.wide opens every group, o.cur is the id of the current screen, o.theme the visitor's theme ('' = the system's), o.from the path the
   feedback link names */
export function footerHtml(
  o: { wide?: boolean; cur?: string; theme?: string; from?: string } = {},
) {
  const core = data.get('core');
  const b = core && core.build;
  const kfp =
    b && b.kfpLatest
      ? /^\d{4}-\d{2}-\d{2}/.test(b.kfpLatest)
        ? date(b.kfpLatest)
        : b.kfpLatest
      : '';
  const cur = o.cur;
  const groups = NAV_GROUPS.map(([label, ids]) => {
    const items = groupItems(ids);
    return (
      <>
        <details className="foot-grp" open={o.wide}>
          <summary tabIndex={o.wide ? -1 : undefined}>{label}</summary>
          <ul>
            {items.map((r) => (
              <>
                <li>
                  <a
                    href={
                      r.id === 'S27' && o.from != null
                        ? toHref(`/vrazka?type=greshka&from=${encodeURIComponent(o.from)}`)
                        : navHref(r.id)
                    }
                    data-route={r.id}
                    data-feedback-link={r.id === 'S27' ? '' : undefined}
                    aria-current={cur === r.id ? 'page' : undefined}
                  >
                    {navName(r)}
                  </a>
                </li>
              </>
            ))}
          </ul>
        </details>
      </>
    );
  });
  return (
    <>
      <div className="footer-in">
        <nav className="foot-nav" aria-label="Всички страници">
          {groups}
        </nav>
        <div className="fine">
          {kfp ? (
            <>
              <span>
                Данните: КФП към {kfp}
                {b?.kfpPublished ? <> (обн. {date(b.kfpPublished)})</> : ''}
              </span>
            </>
          ) : (
            ''
          )}
          {b && b.dataVersion ? (
            <>
              <span>Версия на данните: {b.dataVersion}</span>
            </>
          ) : (
            ''
          )}
          <span>Бета версия: няколко стойности са примерни и са означени със щриховка.</span>
          <span>Лиценз на данните: предстои решение.</span>
          <span>{sigmaLink('sister-link')}</span>
          <button type="button" className="link-btn" data-action="legend">
            Легенда: какво означават белезите
          </button>
          {themePicker(o.theme || '')}
        </div>
        <p className="small muted">Работна група „Бюджет на светло“</p>
      </div>
    </>
  );
}
