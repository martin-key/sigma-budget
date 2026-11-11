// App shell: mock banner, masthead, section band (>=961 px), «Меню» drawer + bottom bar (<=960 px), footer, offline banner.
// V6 (26.10, working-group feedback): ONE header row: the serif wordmark at the left; at the right the period button, the five group buttons «Начало · Изпълнение · Бюджет · Данъци и контекст · Данни и проект»
// (each opens a dropdown of its screens, js/ui/sheet.js popover) and the red «Бюджет 2027» button. The search field moved into the page, under the plan block (js/ui/plan.js); «Източници» and the ⋯ button are gone
// (V6 later the same day: the search is a magnifier button #btn-search in the button bar; it opens the search panel (js/search.js) under the header, on every width). The section band of V5 (#sidenav as a second row) no longer exists: #sidenav is the button bar inside the header.
// V5 (СИГМА visual language): the masthead carried the serif wordmark, the search and the period button; #sidenav is a
// mono-uppercase band with the three main sections «Начало · Изпълнение · Бюджет» (the current one underlined) and the current section's
// screens on a second line; «Още» (data and methodology, glossary, learning path, project) opens as a dropdown there. The phone bar has
// three tabs «Начало · Отчет · Бюджет»; everything else is under «Меню».
// The shell follows the store (period, user type, sources) and the router
// (current item, period switch hidden on screens that do not depend on a period). Page workers never edit this file.
import { store, safe } from './store.js';
import { byId, href as routeHref } from './routes.js';
import { html, nextId } from './html.js';
import { icon } from './icons.js';
import { popover, sheet } from './ui/sheet.js';
import { openLegend } from './ui/status.js';
import { data } from './data.js';
import { date } from './format.js';
import { router } from './router.js';
import { here, parts as addrParts, toHref, isAppLink } from './loc.js';
import {
  yearOf,
  statusOf,
  TABS,
  NAV_GROUPS,
  sigmaLink,
  groupOf,
  groupItems,
  navName,
  navHref,
  bannerHtml,
  CTA,
  topbarHtml,
  tabbarHtml,
  footerHtml,
  rootOf,
} from './chrome.js';

let reactChrome;
const $ = (id) => document.getElementById(id);
const NEWS_KEY = 'bns.news.seen';
// the pieces of the shell (header, tab bar, footer, banner, the menu lists) are built by js/chrome.js, which the server uses too
const syncLinks = () =>
  reactChrome
    ? reactChrome()
    : document
        .querySelectorAll('#tabbar a[data-route], #footer a[data-route]')
        .forEach((a) => a.setAttribute('href', navHref(a.dataset.route)));

const openSearch = (el) =>
  import('./search.js')
    .then((m) => m.openPalette(el))
    .catch((e) => {
      console.error(e);
    });

/* ------------------------------------------------------------------ popovers */
function openPeriod(btn) {
  const sup = router.periods;
  const allowed = (k) => !Array.isArray(sup) || sup.includes(k);
  const name = nextId('per');
  const body = html`<fieldset class="opt-list"><legend class="sr-only">Година и статус на данните</legend>${[
    ...new Set(store.PERIODS.map((p) => p.year)),
  ].map(
    (year) =>
      html`<fieldset class="period-year"><legend>${year}</legend>${store.PERIODS.filter(
        (p) => p.year === year,
      ).map((p) => {
        const ok = allowed(p.key);
        return html`<label class="opt${ok ? '' : ' opt-off'}"><input type="radio" name="${name}" value="${p.key}"${p.key === store.get('period') ? html` checked` : ''}${ok ? '' : html` disabled`}><span class="opt-main"><span class="opt-label">${p.label}</span><span class="opt-desc">${p.desc}${ok ? '' : ' · не се показва на този екран'}</span></span></label>`;
      })}</fieldset>`,
  )}</fieldset>`;
  const pop = popover.open(btn, {
    title: 'Година и статус',
    body,
    label: 'Година и статус на данните',
  });
  // Clicking an already-selected radio emits no change event, but is still an
  // explicit choice that must take precedence over legacy preferences.
  pop.el.addEventListener('click', (e) => {
    if (e.target?.name === name) router.markPeriodSelection();
  });
  pop.el.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || t.name !== name) return;
    store.set('period', t.value);
    pop.close();
  });
  pop.el.querySelector('input:checked')?.focus({ preventScroll: true });
}
function openMoreSheet(btn) {
  const nav = NAV_GROUPS.map(
    ([label, ids]) =>
      html`<section class="more-grp"><h3>${label}</h3><ul class="more-list">${groupItems(ids).map((r) => html`<li><a href="${navHref(r.id)}"${router.current?.route?.id === r.id ? html` aria-current="page"` : ''}>${icon(r.icon, { size: 18 })}<span>${navName(r)}</span></a></li>`)}</ul></section>`,
  );
  const body = html`<div class="more-sheet">
    <p class="more-cta"><a class="nav-cta" href="${routeHref('S34')}">${CTA}</a></p>
    <nav aria-label="Всички раздели">${nav}</nav>
    <p class="more-sister">${sigmaLink('sister-link')}</p>
  </div>`;
  const s = sheet.open({ title: 'Меню', body, returnFocus: btn, cls: 'sheet-drawer' });
  s.el.addEventListener('click', (e) => {
    if (isAppLink(e.target.closest('a[href]'))) s.close();
  });
}

/** a dropdown of the wide header: the screens of one group (the popover closes on Esc, on a click outside and on navigation; focus goes back to the button) */
function openNavGroup(btn, i) {
  const [label, ids] = NAV_GROUPS[i];
  const cur = router.current?.route;
  const items = groupItems(ids).map(
    (r) =>
      html`<li><a href="${navHref(r.id)}"${cur && cur.id === r.id ? html` aria-current="page"` : ''}><span>${navName(r)}</span></a></li>`,
  );
  if (i === NAV_GROUPS.length - 1)
    items.push(html`<li class="nav-sister">${sigmaLink('sister-link')}</li>`);
  popover.open(btn, {
    body: html`<nav class="nav-pop" aria-label="${label}"><ul class="more-list">${items}</ul></nav>`,
    label,
    align: 'start',
  });
}

const WIDE = '(min-width: 961px)';
/** wide screens show every footer group open (the summary is then a plain heading, out of the tab order); narrow screens keep what the visitor opened */
function syncFooter() {
  if (reactChrome) {
    reactChrome();
    return;
  }
  const f = $('footer');
  if (!f) return;
  const wide = window.matchMedia(WIDE).matches;
  f.querySelectorAll('details.foot-grp').forEach((d) => {
    const sm = d.firstElementChild;
    if (wide) {
      d.open = true;
      sm.setAttribute('tabindex', '-1');
    } else sm.removeAttribute('tabindex');
  });
}
function footClick(e) {
  const sm = e.target.closest && e.target.closest('details.foot-grp > summary');
  if (sm && window.matchMedia(WIDE).matches) e.preventDefault();
}

/* ------------------------------------------------------------------ dynamic state */
function setCurrent(route) {
  if (reactChrome) {
    reactChrome();
    return;
  }
  const root = rootOf(route);
  document.querySelectorAll('#sidenav a[data-nav]').forEach((a) => {
    if (a.dataset.nav === route.id) a.setAttribute('aria-current', 'page');
    else if (a.dataset.nav === root.id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('#footer a[href]').forEach((a) => {
    // the footer marks the current screen too
    if (a.getAttribute('href').split('?')[0] === routeHref(route.id))
      a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const tab = TABS.find(
    (t) => t.routes.includes(route.id) || (route.parent && t.routes.includes(root.id)),
  );
  document.querySelectorAll('#tabbar [data-tab]').forEach((el) => {
    if (tab && el.dataset.tab === tab.id) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  const g = groupOf(route); // the header button of the group the screen belongs to is underlined (aria-current="true" for screen readers)
  document.querySelectorAll('#sidenav .nav-sec').forEach((el) => {
    const cur = el.dataset.sec === 'g' + g;
    el.toggleAttribute('data-current', cur);
    const b = el.querySelector('.nav-main');
    if (b) {
      if (cur) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  });
}
function refreshPeriod() {
  if (reactChrome) {
    reactChrome();
    return;
  }
  const p = store.period,
    b = $('btn-period');
  if (!b) return;
  b.querySelector('.p-year').textContent = yearOf(p);
  b.querySelector('.p-status').textContent = ' · ' + statusOf(p);
  b.setAttribute('aria-label', `Година и статус на данните: ${p.label}`);
}
function applySources() {
  const on = store.get('sources'),
    root = document.documentElement;
  if (on) root.setAttribute('data-sources', '1');
  else root.removeAttribute('data-sources');
}
function updateOffline(demo) {
  const el = $('offline');
  if (!el) return;
  const off = demo === 'offline' || navigator.onLine === false;
  if (!off) {
    el.hidden = true;
    el.removeAttribute('data-state');
    el.textContent = '';
    return;
  }
  const v = data.get('core')?.build?.dataVersion;
  const when = v && /^\d{4}-\d{2}-\d{2}/.test(v) ? ` от ${date(v)}` : '';
  el.setAttribute('data-state', 'offline');
  el.innerHTML = `${icon('wifiOff', { size: 18 })}<span>Няма връзка — показваме запазеното${when}.</span>`;
  el.hidden = false;
}
async function checkNews() {
  try {
    const feed = await data.load('feed');
    const latest = (feed.events || [])
      .map((e) => e.date)
      .filter(Boolean)
      .sort()
      .pop();
    if (!latest) return;
    const seen = safe.get('localStorage', NEWS_KEY);
    if (seen && seen >= latest) return;
    document.querySelectorAll('[data-news-dot]').forEach((dot) => {
      dot.hidden = false;
      dot.dataset.latest = latest;
      dot.parentElement.setAttribute('aria-label', dot.dataset.label);
    });
  } catch {
    /* no feed yet: no dot */
  }
}
function markNewsSeen() {
  const dots = [...document.querySelectorAll('[data-news-dot]')].filter((d) => !d.hidden);
  if (!dots.length) return;
  if (dots[0].dataset.latest) safe.set('localStorage', NEWS_KEY, dots[0].dataset.latest);
  dots.forEach((dot) => {
    dot.hidden = true;
    dot.parentElement.removeAttribute('aria-label');
  });
}

/* ------------------------------------------------------------------ boot */
export const shell = {
  init(adapter) {
    reactChrome = adapter;
    if (reactChrome) reactChrome();
    const bar = $('mockbar');
    if (bar) {
      if (!reactChrome) bar.innerHTML = bannerHtml().toString();
      bar.hidden = true;
    }
    if (!reactChrome) $('topbar').innerHTML = topbarHtml().toString();
    if (!reactChrome) $('tabbar').innerHTML = tabbarHtml().toString();
    shell.refreshFooter();
    $('footer')?.addEventListener('click', footClick);
    window.matchMedia(WIDE).addEventListener?.('change', syncFooter);
    applySources();

    $('topbar').addEventListener('click', (e) => {
      const period = e.target.closest('#btn-period');
      if (period) {
        openPeriod(period);
        return;
      }
      const group = e.target.closest('.nav-main');
      if (group) {
        openNavGroup(group, Number(group.dataset.grp));
        return;
      }
      const b = e.target.closest('#btn-menu');
      if (!b) return;
      b.setAttribute('aria-expanded', 'true');
      openMoreSheet(b);
      const d = document.querySelector('dialog.sheet-drawer');
      if (d)
        d.addEventListener('close', () => b.setAttribute('aria-expanded', 'false'), { once: true });
      else b.setAttribute('aria-expanded', 'false');
    });

    store.subscribe((k) => {
      if (k === 'period') refreshPeriod();
      else if (k === 'sources') applySources();
    });
    router.onNavigate(({ route, demo }) => {
      setCurrent(route);
      syncLinks();
      const per = router.periods;
      const b = $('btn-period');
      if (b && !reactChrome) b.hidden = per === 'none';
      updateOffline(demo);
      if (route.id === 'S16') markNewsSeen();
      const fb = document.querySelector('[data-feedback-link]');
      if (fb)
        fb.setAttribute(
          'href',
          toHref(
            `/vrazka?type=greshka&from=${encodeURIComponent(addrParts(here()).path.replace(/^\//, ''))}`,
          ),
        );
    });
    window.addEventListener('online', () => updateOffline(router.current?.vm?.demo));
    window.addEventListener('offline', () => updateOffline(router.current?.vm?.demo));
    updateOffline(new URLSearchParams(addrParts(here()).query).get('demo'));
    checkNews();
  },
  refreshFooter() {
    if (reactChrome) {
      reactChrome();
      return;
    }
    const f = $('footer');
    if (f) {
      f.innerHTML = footerHtml({
        wide: !!window.matchMedia?.(WIDE).matches,
        cur: router.current?.route?.id,
      }).toString();
      syncFooter();
    }
  },
  dismissBanner() {
    store.dismissBanner();
    const b = $('mockbar');
    const had = !!b && b.contains(document.activeElement); // the button that was pressed disappears: the focus must not fall to <body>
    if (b) b.hidden = true;
    if (had) (document.querySelector('#view h1') || $('main'))?.focus({ preventScroll: true });
    announceBanner();
  },
};
function announceBanner() {
  router.announce('Съобщението е скрито за тази сесия');
}
export { openMoreSheet, openPeriod, openSearch };
