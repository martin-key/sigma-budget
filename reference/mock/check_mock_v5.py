#!/usr/bin/env python3
"""check_mock_v5.py (copy of check_mock_v4.py for the version v5, the redesigned СИГМА-style prototype) - end-to-end checks for the Mock prototype of "Бюджет на светло".

  v4 AMENDMENTS against check_mock_v3.py (kept): SITE -> site/ (version v4); light only (the dark cells and the `theme` family are dropped); the settings
    popover and the phone sheet carry no theme option; "wide" for the layout audit is innerWidth >= 961.

  v5 AMENDMENTS against check_mock_v4.py (each one follows a deliberate v5 change from docs/plan.md; nothing else is weakened):
    1. SITE -> site/ (version v5), SHOT_DIR -> render-check-v5.
    2. Bottom bar: three buttons (Начало · Отчет · Бюджет), was five; the old «Още» tab became the «Меню» button of the top bar (#btn-menu, opens the
       drawer). On a screen under «Още» / «Моите данъци» no tab is current (the tab-bar rule of `tour` accepts 0 current items there).
    3. Role selector: ROLE_SELECTOR=false in js/store.js (PDF recommendation, restorable) - the settings popover / drawer must list 0 view-for options
       (was 3); a stored userType is therefore ignored (v5 `user` family expects 'citizen' while ROLE_SELECTOR is false).
    3c. Tour: a link inside a live map on a touch screen is tapped twice (the map previews on the first tap by design); the S21 step landed on a
        'click' step after S09/S19/S22/S23 were removed.
    3b. The `theme` planner returns no jobs (light only, as v4 intended: FAMILIES has no 'theme'); the full run no longer drives the dropped theme matrix.
    4. The start screen has no period button (periods:'none'): the period steps of the chrome family (popover, phone sheet, theme-chrome job) begin
       on #/razhodi, where the button exists.
    5. Share menu: «Изтегли изображение» + «Копирай връзка» (+ the table file as an expert option); copy-text, embed code and the native share sheet
       are no longer menu items (the UI test of the link copy remains; the code stays in js/share.js). The embed UI-entry test was dropped for that
       reason; every embed address (S29) is still loaded by the `embed` family.
    6. The PNG button says «Изображение» (was «PNG»); the downloaded file name check follows.
    7. VALUE_CHECKS: the concrete numbers are the acceptance values of BRIEF §6 (Jan–Aug 2025/2026 КФП, млрд. €) instead of the old July/plan values.
    8. Removed screens (S02, S09, S19, S22, S23, S33; S02 and S32 are removed too; the page files of S02 and S32 are deleted) are no longer in the route list; their old addresses are tested by tools/redirects_v5.py.
    9. working-group feedback (09.10): the guide is merged into «Бюджетът за 5 минути» (S02 gone, six scenes), so the store has no `guide` key any more
       (the bad-preferences test asserts the key stays out); /patevoditel[/N] addresses are redirect cases of tools/redirects_v5.py.


It serves site/ from a throw-away local http.server, drives headless Chromium (Playwright) through every route in
`window.__ROUTES__` at 1280 px and 400 px, in the light and the dark theme, and prints what is wrong. Exit code 0 only when
there is no failure (warnings never fail the run, unless --strict); 1 = failures; 2 = the checker itself could not run.

  Run (always with the project venv; the chromium build lives in .pw-browsers in the repository root, which this script picks up by itself):
    PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/check_mock.py [options]

  Options
    --quick            the final gate, about a minute: the first sample of every route at 1280 px and at 400 px in the light
                       theme, no deep pass, the demo states of S01/S06/S28/S30 and reduced versions of the other families
                       (the theme family is left out; a concrete value that is not on the first sample is only a warning).
                       The default run (no options) covers everything.
    --route S06,S28    only these routes (id or key, repeatable, comma list). Route-less families (chrome, tour, ...)
                       still run unless --only/--skip says otherwise.
    --cells 400-dark   only these viewport/theme cells (comma list of 1280-light 1280-dark 400-light 400-dark).
    --only a,b         run only these families.     --skip a,b   leave these families out.   (see FAMILIES below)
    --shots            save one screenshot per base load into tmp/render-check-v5/<route>-<cell>.png (reused names).
    --url URL          test an already running site (e.g. a deployed copy) instead of the local server.
    --jobs N           parallel browser processes (default: 5, fewer when the machine is busy).
    --axe FILE|URL     inject axe-core (fetched here, never by the page) and fail on serious/critical violations.
    --strict           warnings fail the run too (stub screens count as a failure then).
    --no-values        skip the concrete-value checks (S01 / S15 August values of BRIEF §6, S18 salary example).
    -v                 list every warning and every cell/URL of every finding.
    --timeout MS       per-step timeout (default 15000).     --list   print the plan and exit.

  Families (what runs, in plain words)
    base      every sample URL of every route x cell: no console error / exception / failed or external request / cookie / CSP
              violation; one h1; document.title set; the shell layout of the viewport; no horizontal page scroll (except inside
              .table-wrap); no NaN / undefined / Infinity / null / [object Object] in text or attributes; accessible names,
              duplicate ids, dangling aria references, contrast, tap-target size; charts ready; "Следва" card and every internal link
              resolves; source keys, pending ids, glossary terms and share ids exist. A deep pass then opens every <details>
              and visits every tab (charts in hidden panels must draw) and audits again.
    demo      ?demo=loading|empty|error|pending (the state component replaces the body) and ?demo=offline (real screen + banner).
    period    every period a screen supports (?per=...); an unsupported one must show the "no data for this period" state.
    user      the three user types (citizen / journalist / expert) from stored preferences.
    prefs     unit=pct, per-person, leva, "only real data" (no mock block/figure/KPI/table may stay visible) from stored prefs.
    tour      one page, SPA navigation through all routes (links, hash, Back/Forward): title changes, focus on h1, scroll reset,
              no stale article, aria-current, no leaked overlays / DOM growth.
    to        ?to=<id> deep links into a hidden tab panel and a closed <details>: revealed, focused, in view.
    chrome    skip link, search palette (button, "/", Ctrl-K, Escape + focus return), period / user / more popovers, phone "Още"
              sheet, theme switch, banner dismissal, focus-visible ring, reduced motion.
    share     the share menu (copy text/link, PNG, CSV, embed code) and the watermark pixel diff of mock charts.
    embed     every embed address found by `share` loads at 720x440 in the bare layout: chart ready, source line, brand link.
    gloss     glossary popover (open, Escape, focus return) and the term screen.
    tabs      tab keyboard model, ?tab= mirrored in the URL and restored on reload.
    png       (FB3) every statistic has a PNG button; a click downloads a real, wide, non-blank bns-<screen>-<block>.png.
    views     (FB3) the view switch of charts and treemap-lists (bars / pie / line / table): switches in place, draws inside its box, keyboard.
    theme     the colour themes: the three dark token blocks agree, the dark theme differs from the light one and stays readable
              (contrast), no flash of the wrong theme on first paint, a pinned theme beats the OS and "auto" follows it, corrupt or
              blocked storage is survived, the pressed state of the theme buttons, charts repaint on a switch (also the ones in
              hidden tabs) and keep their legend choice, the screen is not re-rendered, scrolled or overflowing by a switch, chart
              labels and placeholders are readable, fields have a boundary (warning), and in forced-colours mode a marked state
              (pressed / selected / checked) can still be told from an unmarked one (warning).
    selftest  the checker checks itself: it plants known defects into a page and fails when one of them is no longer detected.

  Not built (dropped when the scope was frozen): the offline-banner events, S28 with / without the search index, unknown-address
  cases, 320 px reflow, first-load budget, link crawl, real service worker, static file checks.

  Conventions the page workers can rely on
    - Missing /data/... files are a WARNING ("pending data file"), not a failure: the data side may not have landed them yet.
    - A stub screen (still the generic "предстои да бъде изграден" text) gets the generic checks only.
    - Text that must show a literal NaN/null/undefined (e.g. an API sample) goes in <code>/<pre> or under [data-allow-tokens].
    - The checker never touches site/data, prototype/ or anything outside tmp/ (it only writes screenshots with --shots).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import dataclasses
import functools
import gzip
import hashlib
import http.server
import json
import multiprocessing
import os
import re
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # repository root (this file is tools/mock/check_mock_v5.py)
P_ROOT = ROOT                                         # older name of ROOT
SITE = ROOT / 'site'                                  # the Mock application  (version v5: run at the tag mock-v5)
SHOT_DIR = ROOT / 'tmp' / 'render-check-v5'                 # screenshots (gitignored)
PROTO_SUMS = ROOT / 'tools' / 'mock' / 'prototype.sha256'
if 'PLAYWRIGHT_BROWSERS_PATH' not in os.environ and (P_ROOT / '.pw-browsers').is_dir():
    os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(P_ROOT / '.pw-browsers')

# --------------------------------------------------------------------------------------------------------------- constants
CELLS = {
    '1280-light': dict(w=1280, h=900, scheme='light', touch=False),
    '400-light': dict(w=400, h=800, scheme='light', touch=True),
}
QUICK_CELLS = ['1280-light', '400-light']
DEMOS = ['loading', 'empty', 'error', 'pending']                     # the body is replaced by a state component
OFFLINE_DEMO = 'offline'                                             # the real screen + the offline banner
FAMILIES = ['base', 'demo', 'period', 'user', 'prefs', 'tour', 'to', 'chrome', 'share', 'embed', 'gloss', 'tabs', 'png', 'views', 'selftest']   # v4: no 'theme' (light only)
DEFAULT_OFF = set()                                                  # families that run only when asked for (none now)
STUB_TEXT = 'Този екран предстои да бъде изграден в прототипа'
PREFS_KEY = 'bns.prefs.v1'
THEME_SUFFIX = ' · Бюджет на светло'
# console / network noise that is expected and not a defect of the site
IGNORE_CONSOLE = [
    re.compile(r'Service Worker|serviceWorker', re.I),                # contexts run with service_workers="block"
    re.compile(r'^Failed to load resource', re.I),                    # the HTTP status is reported through the response events
    re.compile(r'preloaded using link preload but not used', re.I),   # three font preloads; a screen may not use them within seconds
]
NEGATIVE_URLS = ['#/nyama-takava', '#/patevoditel/9', '#/prihodi/dds/x', '#/embed', '#/obshtina', '#/razhodi/a/b/c']

# ------------------------------------------------------------------------------------------------------- findings (data)
@dataclass
class Finding:
    level: str                  # 'fail' | 'warn'
    code: str
    msg: str
    route: str = ''
    cell: str = ''
    url: str = ''


def fail(code, msg, **kw):
    return Finding('fail', code, str(msg), **kw)


def warn(code, msg, **kw):
    return Finding('warn', code, str(msg), **kw)


# ---------------------------------------------------------------------------------------------- JS run inside the page
# Installed before any page script (context.add_init_script): records what the page itself cannot report to Playwright.
INIT_JS = r"""
(() => {
  const k = window.__chk = { csp: [], rej: [] };
  document.addEventListener('securitypolicyviolation', e => k.csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  window.addEventListener('unhandledrejection', e => k.rej.push(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 300)));
})();
"""

# true when the screen is built, no spinner is up, every visible chart has drawn (or failed), fonts and images are in
SETTLE_JS = r"""
() => {
  const v = document.getElementById('view');
  if (!v || v.getAttribute('aria-busy') === 'true') return false;
  const a = v.querySelector('article.page');
  if (!a || a.dataset.ready !== '1') return false;
  const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  for (const c of v.querySelectorAll('.chart')) { if (vis(c) && c.dataset.ready !== '1' && c.dataset.ready !== 'err') return false; }
  if (document.fonts && document.fonts.status === 'loading') return false;
  for (const i of v.querySelectorAll('img')) if (!i.complete) return false;
  return true;
}
"""

# opens every <details>, visits every tab (so charts in hidden panels draw), scrolls through the page once
DEEP_JS = r"""
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const v = document.getElementById('view');
  const waitCharts = async () => {
    for (let i = 0; i < 60; i++) {
      const pend = [...v.querySelectorAll('.chart')].filter(c => (c.offsetWidth || c.offsetHeight) && c.dataset.ready !== '1' && c.dataset.ready !== 'err');
      if (!pend.length) return;
      await sleep(100);
    }
  };
  let opened = 0, visited = 0;
  for (let round = 0; round < 3; round++) {                               // opening a <details> may reveal another one
    let n = 0;
    for (const d of v.querySelectorAll('details:not([open])')) { d.open = true; n++; }
    opened += n;
    if (!n) break;
    await sleep(60);
  }
  for (const list of v.querySelectorAll('[role="tablist"]')) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const first = tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0];
    for (const t of tabs) {
      if (t.getAttribute('aria-selected') === 'true') continue;
      t.click(); visited++;
      await sleep(80);
      await waitCharts();
      for (let round = 0; round < 3; round++) { let n = 0; for (const d of v.querySelectorAll('details:not([open])')) { d.open = true; n++; opened++; } if (!n) break; await sleep(50); }
    }
    if (first) { first.click(); await sleep(60); }
  }
  await waitCharts();
  return { opened, visited };
}
"""

# the generic audit of one rendered screen; o = {expect: route id|null, deep: bool, stub: bool}
AUDIT_JS = r"""
async (o) => {
  const P = [], info = {};
  const add = (c, l, m) => P.push({ c, l, m: String(m).slice(0, 700) });
  const view = document.getElementById('view');
  const isVis = el => { const r = el.getBoundingClientRect(); if (!(r.width || r.height)) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const path = el => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 4; e = e.parentElement) {
      let s = e.localName;
      if (e.id) { parts.unshift(s + '#' + e.id); break; }
      const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      if (c) s += '.' + c;
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const take = (arr, n) => arr.slice(0, n).join('; ') + (arr.length > n ? ` (+${arr.length - n} more)` : '');
  const routes = await import('./js/routes.js');
  const resolves = h => { const p = String(h).split('?')[0].replace(/^#\/?/, '').split('/').filter(Boolean); try { return !!routes.match(p.map(decodeURIComponent)); } catch { return false; } };
  const SKIP = 'code,pre,kbd,samp,textarea,script,style,template,noscript,[data-allow-tokens]';

  // ---- frame, title, landmarks
  const arts = view.querySelectorAll('article.page');
  if (arts.length !== 1) add('frame', 'fail', `${arts.length} article.page elements in #view (expected 1)`);
  const art = arts[0];
  const rid = art ? art.dataset.route : null;
  info.route = rid; info.view = art ? art.dataset.view : null; info.title = document.title;
  if (art && o.expect && rid !== o.expect) add('route', 'fail', `expected screen ${o.expect}, got ${rid}`);
  if (art && art.dataset.ready !== '1') add('frame', 'fail', 'article.page never got data-ready=1');
  const h1s = document.querySelectorAll('h1');
  if (h1s.length !== 1) add('h1', 'fail', `${h1s.length} h1 elements (expected exactly 1)`);
  else if (!h1s[0].textContent.trim()) add('h1', 'fail', 'the h1 is empty');
  else if (!view.contains(h1s[0])) add('h1', 'fail', 'the h1 is outside #view');
  info.h1 = h1s[0] ? h1s[0].textContent.trim().slice(0, 80) : '';
  if (!document.title || document.title === 'Бюджет на светло' || !document.title.includes(' · ')) add('title', 'fail', `document.title is not set for the screen: "${document.title}"`);
  if (document.documentElement.lang !== 'bg') add('lang', 'fail', `<html lang> is "${document.documentElement.lang}", expected bg`);
  const mains = document.querySelectorAll('main, [role="main"]');
  if (mains.length !== 1) add('landmark', 'fail', `${mains.length} main landmarks (expected 1)`);
  for (const n of document.querySelectorAll('nav')) if (!(n.getAttribute('aria-label') || n.getAttribute('aria-labelledby'))) add('landmark', 'warn', `nav without a label: ${path(n)}`);
  if (document.body.firstElementChild && !document.body.firstElementChild.matches('a.skip-link')) add('landmark', 'warn', 'the skip link is not the first element of the body');
  { // heading order inside the screen
    let last = 1; const jumps = [];
    for (const h of view.querySelectorAll('h2,h3,h4,h5,h6')) {
      if (!isVis(h)) continue;
      const lv = +h.localName[1];
      if (lv > last + 1) jumps.push(`h${last} -> h${lv} "${h.textContent.trim().slice(0, 30)}"`);
      last = lv;
    }
    if (jumps.length) add('heading-order', 'warn', `skipped heading level: ${take(jumps, 3)}`);
  }

  // ---- shell layout of this viewport
  const bare = document.body.classList.contains('bare');
  info.bare = bare;
  const shown = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
  const wide = window.innerWidth >= 961;   // v4: the section band collapses into the «Меню» drawer at <=960 px
  if (bare) { for (const id of ['topbar', 'sidenav', 'tabbar', 'footer', 'mockbar']) if (shown(id)) add('layout', 'fail', `#${id} is visible in the bare (embed) layout`); }
  else {
    if (!shown('topbar')) add('layout', 'fail', 'the top bar is not visible');
    if (wide && !shown('sidenav')) add('layout', 'fail', 'wide screen without the left navigation');
    if (wide && shown('tabbar')) add('layout', 'fail', 'wide screen shows the bottom bar');
    if (!wide && shown('sidenav')) add('layout', 'fail', 'narrow screen shows the left navigation');
    if (!wide && !shown('tabbar')) add('layout', 'fail', 'narrow screen without the bottom bar');
    const sb = document.getElementById('btn-search');
    if (!sb || !isVis(sb)) add('layout', 'fail', 'the search button is not visible');
    if (!shown('footer')) add('layout', 'fail', 'the footer is not visible');
  }
  const bodyFs = parseFloat(getComputedStyle(document.body).fontSize);
  if (bodyFs < 15) add('font-size', 'warn', `body font size is ${bodyFs}px`);

  // ---- stub?
  info.stub = (view.textContent || '').includes(%STUB%);

  // ---- broken values in text and attributes
  const BADTXT = /(^|[^\p{L}\p{N}_.])(NaN|undefined|Infinity|null)(?![\p{L}\p{N}_])|\[object Object\]/u;
  const badTxt = [];
  { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue;
      if (!t || t.length < 3 || !BADTXT.test(t)) continue;
      const pe = n.parentElement;
      if (!pe || pe.closest(SKIP)) continue;
      badTxt.push(`"${t.trim().slice(0, 50)}" in ${path(pe)}`);
    } }
  if (badTxt.length) add('tokens', 'fail', `broken value in the text: ${take(badTxt, 4)}`);
  const badAttr = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('[data-allow-tokens]') || el.closest('script,style,template')) continue;
    for (const a of el.attributes) {
      const v = a.value;
      if (v.length < 3) continue;
      if (v === 'null' || /\bNaN\b|\bundefined\b|\[object Object\]|Infinity/.test(v)) badAttr.push(`${a.name}="${v.slice(0, 40)}" on ${path(el)}`);
    }
  }
  if (badAttr.length) add('tokens', 'fail', `broken value in an attribute: ${take(badAttr, 4)}`);
  { const t = document.title; if (BADTXT.test(t)) add('tokens', 'fail', `broken value in document.title: ${t}`); }
  const txt = view.innerText || '';
  if (/lorem ipsum|\bTODO\b|\bFIXME\b|\bTBD\b|\bXXX\b|\?\?\?/i.test(txt)) add('placeholder', 'fail', 'placeholder text on the screen (lorem / TODO / FIXME / TBD / ???)');
  if (/[ÃÂÐÑ][\u0080-¿]|â€|�/.test(txt)) add('encoding', 'fail', 'broken character encoding on the screen');
  if (%LEAK%.test(document.body.innerText || '')) add('public-leak', 'fail', 'the public screen mentions a private channel');
  { const en = [];
    const w = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue; if (!t || t.length < 12) continue;
      const m = /(^|[^\p{L}])([a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,})(?![\p{L}])/u.exec(t);
      if (m && n.parentElement && !n.parentElement.closest(SKIP + ',[lang]:not(html)')) en.push(`"${m[2]}"`);
    }
    if (en.length) add('english-text', 'warn', `English-looking text in the UI: ${take(en, 3)}`); }

  // ---- no horizontal page scroll (except inside .table-wrap and other scrollers)
  const de = document.documentElement, iw = de.clientWidth;
  const sw = Math.max(de.scrollWidth, document.body.scrollWidth);
  info.sw = sw; info.iw = iw;
  if (sw > iw + 1) {
    const off = [];
    const scroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.getBoundingClientRect().width <= iw + 1) return true; } return false; };
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('svg') && el.localName !== 'svg') continue;
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      if (r.right <= iw + 1 && r.left >= -1) continue;
      const s = getComputedStyle(el); if (s.position === 'fixed' || s.visibility === 'hidden') continue;
      if (scroller(el)) continue;
      off.push(`${path(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      if (off.length >= 6) break;
    }
    add('scroll-x', 'fail', `the page scrolls horizontally (${sw}px content in a ${iw}px viewport)${off.length ? ': ' + off.join('; ') : ''}`);
  }

  // ---- accessibility
  const name = el => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim(); if (t) return t; }
    if (el.localName === 'input' && ['button', 'submit', 'reset'].includes(el.type) && el.value) return el.value;
    if (el.labels && el.labels.length) { const t = [...el.labels].map(l => l.textContent).join(' ').trim(); if (t) return t; }
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (t) return t;
    const im = el.querySelector('img[alt]:not([alt=""])'); if (im) return im.alt;
    const st = el.querySelector('svg title'); if (st && st.textContent.trim()) return st.textContent.trim();
    return (el.getAttribute('title') || '').trim();
  };
  const live = sel => [...document.querySelectorAll(sel)].filter(e => !e.closest('[hidden],template'));
  const un = [];
  for (const b of live('button, [role="button"]')) if (!name(b)) un.push(path(b));
  if (un.length) add('a11y-name', 'fail', `${un.length} button(s) without an accessible name: ${take(un, 3)}`);
  const ul = [];
  for (const a of live('a[href]')) if (!name(a)) ul.push(path(a));
  if (ul.length) add('a11y-name', 'fail', `${ul.length} link(s) without an accessible name: ${take(ul, 3)}`);
  const ui = [];
  for (const i of live('input:not([type="hidden"]), select, textarea')) if (!name(i)) ui.push(path(i));
  if (ui.length) add('a11y-label', 'fail', `${ui.length} form control(s) without a label: ${take(ui, 3)}`);
  const ni = [...document.querySelectorAll('img:not([alt])')].map(path);
  if (ni.length) add('a11y-alt', 'fail', `${ni.length} image(s) without alt: ${take(ni, 3)}`);
  const ns = live('svg[role="img"], [role="img"]').filter(e => !name(e)).map(path);
  if (ns.length) add('a11y-name', 'fail', `${ns.length} role=img element(s) without a name: ${take(ns, 3)}`);
  const nf = live('iframe').filter(e => !(e.title || '').trim()).map(path);
  if (nf.length) add('a11y-name', 'fail', `iframe without a title: ${take(nf, 3)}`);
  const nd = live('dialog').filter(e => !name(e)).map(path);
  if (nd.length) add('a11y-name', 'fail', `dialog without a name: ${take(nd, 3)}`);
  { const ids = new Map(), dup = [];
    for (const e of document.querySelectorAll('[id]')) { if (ids.has(e.id)) dup.push(e.id); else ids.set(e.id, 1); }
    if (dup.length) add('dup-id', 'fail', `duplicate id: ${take([...new Set(dup)], 5)}`); }
  { const miss = [];
    for (const e of document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls],[aria-owns],label[for]')) {
      for (const [at, lvl] of [['aria-labelledby', 'fail'], ['aria-describedby', 'fail'], ['aria-controls', 'warn'], ['aria-owns', 'warn'], ['for', 'fail']]) {
        const v = e.getAttribute(at); if (!v) continue;
        for (const id of v.split(/\s+/)) if (id && !document.getElementById(id)) miss.push(`${at}="${id}" on ${path(e)} [${lvl}]`);
      }
    }
    const f = miss.filter(x => x.endsWith('[fail]')), w = miss.filter(x => x.endsWith('[warn]'));
    if (f.length) add('aria-ref', 'fail', `reference to a missing id: ${take(f.map(x => x.slice(0, -7)), 4)}`);
    if (w.length) add('aria-ref', 'warn', `reference to a missing id: ${take(w.map(x => x.slice(0, -7)), 4)}`); }
  { const bad = [...document.querySelectorAll('[aria-hidden="true"] a[href], [aria-hidden="true"] button:not([disabled]), [aria-hidden="true"] input:not([disabled]):not([type="hidden"]), [aria-hidden="true"] select, [aria-hidden="true"] textarea, [aria-hidden="true"] [tabindex]:not([tabindex="-1"])')].filter(e => !e.closest('[hidden]')).map(path);
    if (bad.length) add('aria-hidden-focus', 'fail', `focusable element inside aria-hidden: ${take(bad, 3)}`); }
  { const bad = [...document.querySelectorAll('[tabindex]')].filter(e => +e.getAttribute('tabindex') > 0).map(path);
    if (bad.length) add('tabindex', 'warn', `positive tabindex: ${take(bad, 3)}`); }
  { const bad = live('details').filter(d => !d.querySelector(':scope > summary')).map(path);
    if (bad.length) add('a11y-structure', 'fail', `<details> without <summary>: ${take(bad, 3)}`); }
  { const bad = [...document.querySelectorAll('[onclick],[onchange],[oninput],[onload],[onerror],[onsubmit],[onkeydown]')].map(path);
    if (bad.length) add('inline-handler', 'fail', `inline event handler attribute (CSP): ${take(bad, 3)}`); }
  { const ROLES = new Set('alert alertdialog article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document figure form grid gridcell group heading img link list listbox listitem main marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem generic meter paragraph caption mark'.split(' '));
    const bad = [...document.querySelectorAll('[role]')].filter(e => !e.getAttribute('role').split(/\s+/).some(r => ROLES.has(r))).map(e => `${path(e)} role="${e.getAttribute('role')}"`);
    if (bad.length) add('a11y-role', 'warn', `unknown ARIA role: ${take(bad, 3)}`); }
  { const bad = live('a[target="_blank"]').filter(a => !/noopener/.test(a.rel || '')).map(a => a.getAttribute('href'));
    if (bad.length) add('rel-noopener', 'warn', `target=_blank without rel=noopener: ${take(bad, 3)}`); }
  { const bad = live('a[href]').filter(a => { const h = a.getAttribute('href'); return h === '' || h === '#'; }).map(path);
    if (bad.length) add('dead-link', 'warn', `link with an empty target: ${take(bad, 3)}`); }
  { const bad = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map(i => i.getAttribute('src'));
    if (bad.length) add('img-broken', 'fail', `image did not load: ${take(bad, 3)}`); }
  { const tl = [];
    for (const l of document.querySelectorAll('[role="tablist"]')) {
      const tabs = [...l.querySelectorAll('[role="tab"]')];
      const sel = tabs.filter(t => t.getAttribute('aria-selected') === 'true');
      const tab0 = tabs.filter(t => t.tabIndex === 0);
      if (tabs.length && sel.length !== 1) tl.push(`${sel.length} selected tabs in ${path(l)}`);
      if (tabs.length && tab0.length !== 1) tl.push(`${tab0.length} tabs in the Tab order in ${path(l)}`);
      for (const t of tabs) { const p = document.getElementById(t.getAttribute('aria-controls') || ''); if (!p || p.getAttribute('role') !== 'tabpanel') tl.push(`tab without a tabpanel in ${path(l)}`); else if ((t.getAttribute('aria-selected') === 'true') === p.hidden) tl.push(`panel state does not match its tab in ${path(l)}`); }
    }
    if (tl.length) add('tabs', 'fail', take(tl, 3)); }
  { // tap targets (WCAG 2.5.8: 24 x 24 css px; exempt: inline links in running text, and a target whose 24 x 24 square touches no other target)
    const cands = [];
    for (const e of document.body.querySelectorAll('a[href], button, [role="tab"], [role="button"], select, summary, input:not([type="hidden"])')) {
      if (e.closest('[hidden],svg') || e.disabled) continue;
      const r = e.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || getComputedStyle(e).visibility === 'hidden') continue;
      cands.push({ e, r });
    }
    const small = [];
    for (const { e, r } of cands) {
      if (r.width >= 24 && r.height >= 24) continue;
      if (e.localName === 'a' && getComputedStyle(e).display === 'inline') continue;
      if (e.localName === 'input' && (e.type === 'checkbox' || e.type === 'radio') && e.labels && e.labels[0]) { const lr = e.labels[0].getBoundingClientRect(); if (lr.width >= 24 && lr.height >= 24) continue; }
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const clash = cands.some(o => o.e !== e && !e.contains(o.e) && !o.e.contains(e) && o.r.left < cx + 12 && o.r.right > cx - 12 && o.r.top < cy + 12 && o.r.bottom > cy - 12);
      if (!clash) continue;
      small.push(`${path(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    if (small.length) add('target-size', 'warn', `${small.length} tap target(s) smaller than 24x24 with another target next to them: ${take(small, 3)}`); }

  // ---- contrast of rendered text (colour against the first opaque background; gradients / images are skipped)
  { const parse = s => {
      let m = /rgba?\(([^)]+)\)/.exec(s);
      if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
      m = /color\(srgb ([\d. ]+?)(?: \/ ([\d.]+))?\)/.exec(s);
      if (m) { const p = m[1].trim().split(/\s+/).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: m[2] != null ? +m[2] : 1 }; }
      return null; };
    const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    const memo = new WeakMap();
    const bgOf = el => {
      if (memo.has(el)) return memo.get(el);
      const layers = []; let base = null, unknown = false;
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage && s.backgroundImage !== 'none') { unknown = true; break; }
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) { if (c.a >= 0.999) { base = c; break; } layers.push(c); }
      }
      let out = null;
      if (!unknown) { out = base || { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out); }
      memo.set(el, out); return out;
    };
    const opacityOf = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
    const bad = new Map(), low = new Map();
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('svg,option,script,style,template,[hidden]') || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      { let decor = false; for (let e = el; e && !decor; e = e.parentElement) decor = e.getAttribute('aria-hidden') === 'true' && getComputedStyle(e).pointerEvents === 'none'; if (decor) continue; }   // watermark-style overlays
      let has = false;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim().length > 1) { has = true; break; }
      if (!has) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden') continue;
      const bg = bgOf(el), fg0 = parse(s.color);
      if (!bg || !fg0) continue;
      const op = opacityOf(el);
      if (op < 0.05) continue;
      const fg = over({ ...fg0, a: fg0.a * op }, bg);
      const l1 = lum(fg), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const fs = parseFloat(s.fontSize), large = fs >= 24 || (fs >= 18.66 && +s.fontWeight >= 700);
      const need = large ? 3 : 4.5;
      if (ratio >= need) continue;
      const key = `${hex(fg)} on ${hex(bg)}${large ? ' (large)' : ''}`;
      const tgt = ratio < 3 ? bad : low;
      const cur = tgt.get(key) || { n: 0, ratio, ex: `"${(el.textContent || '').trim().slice(0, 24)}" ${path(el)}` };
      cur.n++; tgt.set(key, cur);
    }
    const fmt = m => [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([k, v]) => `${k} ratio ${v.ratio.toFixed(2)} x${v.n}, e.g. ${v.ex}`).join('; ');
    if (bad.size) add('contrast', 'fail', `text below 3:1 contrast: ${fmt(bad)}`);
    if (low.size) add('contrast', 'warn', `text below the AA contrast (4.5:1 / 3:1 large): ${fmt(low)}`);
  }
  { const tiny = [];
    for (const el of view.querySelectorAll('*')) {
      if (el.closest('svg,[hidden]')) continue;
      let has = false; for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim().length > 1) { has = true; break; }
      if (!has) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11 && isVis(el)) tiny.push(`${fs}px ${path(el)}`);
    }
    if (tiny.length) add('tiny-text', 'warn', `${tiny.length} element(s) with text below 11px: ${take(tiny, 3)}`); }

  // ---- contracts of the shared components
  const core = (await import('./js/data.js')).data.get('core');
  { const badKeys = [];
    for (const e of document.querySelectorAll('[data-src]')) for (const k of e.dataset.src.split(',').map(s => s.trim()).filter(Boolean)) if (core && core.sources && !Object.hasOwn(core.sources, k)) badKeys.push(`"${k}" on ${path(e)}`);
    if (badKeys.length) add('src-key', 'fail', `source key is not in core.sources: ${take(badKeys, 4)}`);
    const badP = [];
    for (const e of document.querySelectorAll('[data-pending-id]')) if (core && core.pending && !Object.hasOwn(core.pending, e.dataset.pendingId)) badP.push(`"${e.dataset.pendingId}"`);
    if (badP.length) add('pending-id', 'fail', `pending id is not in core.pending: ${take(badP, 4)}`); }
  { const g = await import('./js/glossary.js');
    const links = [...document.querySelectorAll('a[data-gl]')];
    info.gl = links.length;
    if (links.length) { try { await g.ready(); const bad = links.filter(a => !g.termOf(a.dataset.gl)).map(a => a.dataset.gl); if (bad.length) add('gl-term', 'fail', `glossary term does not exist: ${take([...new Set(bad)], 5)}`); } catch (e) { add('gl-term', 'warn', `glossary data is not available: ${e.message}`); } } }
  { const sh = await import('./js/share.js');
    const bad = [...document.querySelectorAll('[data-share]')].filter(b => !sh.get(b.dataset.share)).map(b => b.dataset.share);
    if (bad.length) add('share-id', 'fail', `share button without a registered spec: ${take(bad, 4)}`);
    info.share = [];
    for (const [id, s] of sh.all()) { let emb = null; try { emb = s.embed ? sh.embedHash(s) : null; } catch { emb = null; } info.share.push({ id, mock: !!sh.isMock(s), embed: emb }); } }
  { const figs = [...view.querySelectorAll('figure.fig')];
    const noTable = figs.filter(f => !f.querySelector('details.fig-table, table')).map(path);
    if (noTable.length) add('fig-table', 'warn', `chart without a data table alternative: ${take(noTable, 3)}`);
    const mockNoBadge = figs.filter(f => f.dataset.mockFig === 'true' && !f.querySelector('.mock-badge')).map(path);
    if (mockNoBadge.length) add('mock-marker', 'fail', `mock figure without the mock badge: ${take(mockNoBadge, 3)}`);
    const blocks = [...view.querySelectorAll('section.block')];
    const noSt = blocks.filter(b => !b.dataset.blockStatus).map(path);
    if (noSt.length) add('block-status', 'warn', `block without data-block-status: ${take(noSt, 3)}`);
    info.blocks = blocks.length; info.mockBlocks = blocks.filter(b => b.dataset.blockMock === 'true').length; }
  const charts = [...document.querySelectorAll('.chart')];
  info.charts = charts.length;
  for (const c of charts) {
    const r = c.dataset.ready, v = isVis(c);
    if (r === 'err') add('chart', 'fail', `a chart failed to draw: ${path(c)}`);
    else if (v && r !== '1') add('chart', 'fail', `a visible chart never became ready (data-ready=${r}): ${path(c)}`);
    else if (!v && r !== '1' && o.deep) add('chart', 'warn', `a chart never drew, even after opening every tab and <details>: ${path(c)}`);
    else if (v) { const n = c.querySelectorAll('svg path, svg rect, svg circle, svg line, svg polygon').length; if (n < 2) add('chart', 'warn', `a chart is empty: ${path(c)}`); }
    if (c.getAttribute('role') === 'img' && !(c.getAttribute('aria-label') || '').trim()) add('a11y-name', 'fail', `chart without an aria-label: ${path(c)}`);
  }
  info.tabs = [...document.querySelectorAll('.tabs')].map(t => ({ id: t.id, qkey: t.dataset.qkey || '', keys: [...t.querySelectorAll(':scope > .tab-list [role="tab"]')].map(x => x.dataset.key) }));
  info.hasDetails = document.querySelectorAll('details').length;

  // ---- "Следва" card and every internal link
  const meta = (window.__ROUTES__ || []).find(r => r.id === rid);
  const nx = view.querySelector('article.page aside.next');
  if (nx) {
    const ls = [...nx.querySelectorAll('a[href]')];
    if (!ls.length) add('next', 'fail', 'the „Следва“ card has no link');
    for (const a of ls) if (!resolves(a.getAttribute('href'))) add('next', 'fail', `the „Следва“ link does not lead to a screen: ${a.getAttribute('href')}`);
    if (meta && !meta.next.length) add('next', 'warn', 'a „Следва“ card on a screen that declares none');
  } else if (meta && meta.next.length && info.view === 'ready') add('next', 'warn', 'no „Следва“ card on a screen that declares one');
  const hashes = new Set(), ext = new Set(), rel = new Set(), badLinks = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (h.startsWith('#/')) { hashes.add(h); if (!resolves(h)) badLinks.push(`${h} (${path(a)})`); }
    else if (/^https?:/i.test(h)) ext.add(h);
    else if (/^(javascript|data):/i.test(h)) badLinks.push(`${h.slice(0, 40)} (${path(a)})`);
    else if (!h.startsWith('#') && !/^(mailto|tel):/i.test(h)) rel.add(h);
  }
  if (badLinks.length) add('link-route', 'fail', `internal link to no screen: ${take(badLinks, 4)}`);
  info.links = [...hashes]; info.ext = [...ext]; info.rel = [...rel];
  const k = window.__chk || { csp: [], rej: [] };
  if (k.csp.length) add('csp', 'fail', `CSP violation: ${take(k.csp, 3)}`);
  if (k.rej.length) add('rejection', 'fail', `unhandled promise rejection: ${take(k.rej, 2)}`);
  info.nodes = document.querySelectorAll('*').length;
  return { problems: P, info };
}
""".replace('%STUB%', json.dumps(STUB_TEXT)).replace('%LEAK%', '/private channel|частен канал/i')
# AUDIT_JS-END (the Python side follows)

# ===================================================================================================== local web server
import traceback
import urllib.parse


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class _Httpd(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 256

    def handle_error(self, request, client_address):          # an aborted request (the browser navigated away) is not news
        pass


class Server:
    def __init__(self):
        self.httpd = _Httpd(('127.0.0.1', 0), _Quiet)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def base(self):
        return f'http://127.0.0.1:{self.port}/'

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        try:
            self.httpd.shutdown()
            self.httpd.server_close()
        except Exception:
            pass


# ============================================================================================ what the browser reports
class Probe:
    """Collects console / network / dialog events of one page. Items are (level, code, msg) tuples."""

    def __init__(self, page, origin):
        self.origin = origin
        self.items = []
        self.urls = []
        page.on('console', self._console)
        page.on('pageerror', self._pageerror)
        page.on('response', self._response)
        page.on('request', self._request)
        page.on('requestfailed', self._failed)
        page.on('dialog', self._dialog)
        page.on('crash', lambda *_: self.items.append(('fail', 'crash', 'the page crashed')))

    def reset(self):
        self.items = []
        self.urls = []

    def drain(self):
        out, self.items = self.items, []
        return out

    def _console(self, m):
        t = m.type
        if t not in ('error', 'warning'):
            return
        text = m.text or ''
        if any(rx.search(text) for rx in IGNORE_CONSOLE):
            return
        loc = m.location or {}
        where = f" ({loc.get('url', '').replace(self.origin, '')}:{loc.get('lineNumber', '')})" if loc.get('url') else ''
        self.items.append(('fail' if t == 'error' else 'warn', 'console' if t == 'error' else 'console-warn', text[:400] + where))

    def _pageerror(self, e):
        s = str(getattr(e, 'stack', '') or e)
        self.items.append(('fail', 'exception', ' | '.join(s.strip().splitlines()[:3])[:500]))

    def _response(self, r):
        self.urls.append(r.url)
        if r.status < 400:
            return
        path = r.url.replace(self.origin, '')
        if r.url.startswith(self.origin) and path.startswith('/data/'):
            self.items.append(('warn', 'pending-data', f'{path} -> {r.status} (data file not there yet)'))
        else:
            self.items.append(('fail', f'http-{r.status}', f'{path or r.url} -> {r.status}'))

    def _request(self, r):
        u = r.url
        if u.startswith(('data:', 'blob:', 'about:')):
            return
        if not u.startswith(self.origin) and re.match(r'(https?|wss?|ftp)://', u):
            self.items.append(('fail', 'external', f'request to another origin: {u[:160]}'))

    def _failed(self, r):
        err = (r.failure or '') if isinstance(r.failure, str) else str(r.failure)
        if 'ERR_ABORTED' in err:
            return
        self.items.append(('fail', 'request-failed', f'{r.url.replace(self.origin, "")[:160]}: {err[:80]}'))

    def _dialog(self, d):
        self.items.append(('fail', 'dialog', f'{d.type}() dialog: {d.message[:80]}'))
        try:
            d.dismiss()
        except Exception:
            pass


CLEAR_JS = "(kv) => { try { localStorage.clear(); sessionStorage.clear(); for (const [k, v] of Object.entries(kv || {})) localStorage.setItem(k, v); } catch (e) {} }"
DIAG_JS = """() => {
  const v = document.getElementById('view'), a = v && v.querySelector('article.page');
  return a ? `view=${a.dataset.view} ready=${a.dataset.ready} route=${a.dataset.route}` : 'no article.page; #view text: ' + ((v && v.textContent) || '').trim().slice(0, 140);
}"""


@dataclass
class Opened:
    page: object
    ctx: object
    probe: Probe
    ok: bool
    why: str = ''


# ========================================================================================== one browser per worker process
class Worker:
    def __init__(self, base, opts):
        from playwright.sync_api import sync_playwright
        self.base = base
        self.opts = opts
        self.origin = '{0.scheme}://{0.netloc}'.format(urllib.parse.urlsplit(base))
        self.pw = sync_playwright().start()
        self.browser = None
        self.cells = {}
        self._launch()

    def _launch(self):
        self.browser = self.pw.chromium.launch(args=['--disable-dev-shm-usage'])
        self.cells = {}

    def cell(self, name, **extra):
        key = name + ('|' + json.dumps(extra, sort_keys=True) if extra else '')
        if key in self.cells:
            return self.cells[key]
        c = CELLS[name]
        o = dict(viewport={'width': extra.get('w', c['w']), 'height': extra.get('h', c['h'])}, color_scheme=c['scheme'],
                 has_touch=c['touch'], locale='bg-BG', timezone_id='Europe/Sofia', service_workers=extra.get('sw', 'block'),
                 accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
        if extra.get('reduced_motion'):
            o['reduced_motion'] = 'reduce'
        ctx = self.browser.new_context(**o)
        ctx.add_init_script(INIT_JS)
        page = ctx.new_page()
        page.set_default_timeout(self.opts['timeout'])
        page.set_default_navigation_timeout(self.opts['timeout'] + 5000)
        self.cells[key] = (ctx, page, Probe(page, self.origin))
        return self.cells[key]

    def recycle(self, name=None):
        """Drop the contexts (a crashed page); relaunch the browser when it is gone."""
        for k in list(self.cells):
            try:
                self.cells[k][0].close()
            except Exception:
                pass
        self.cells = {}
        try:
            if not self.browser.is_connected():
                self._launch()
        except Exception:
            self._launch()

    def reset(self, name, prefs=None, **extra):
        ctx, page, probe = self.cell(name, **extra)
        try:
            page.goto(self.base + 'robots.txt', wait_until='commit')
        except Exception:
            pass
        page.evaluate(CLEAR_JS, prefs or {})
        ctx.clear_cookies()
        probe.reset()
        return ctx, page, probe

    def open(self, name, hash_='#/', prefs=None, wait=True, settle=True, **extra):
        """Fresh state, full page load of base + hash_, wait until the screen is built and has settled."""
        ctx, page, probe = self.reset(name, prefs, **extra)
        page.goto(self.base + hash_, wait_until='domcontentloaded')
        if not wait:
            return Opened(page, ctx, probe, True)
        ok, why = self.ready(page, settle)
        return Opened(page, ctx, probe, ok, why)

    def ready(self, page, settle=True):
        from playwright.sync_api import TimeoutError as PWTimeout
        try:
            page.wait_for_selector('article.page[data-ready="1"]', state='attached')
            if settle:
                page.wait_for_function(SETTLE_JS)
                page.wait_for_timeout(120)                      # the glossary scan runs un-awaited after the mount
            return True, ''
        except PWTimeout:
            try:
                d = page.evaluate(DIAG_JS)
            except Exception as e:
                d = f'(no diagnostics: {e})'
            return False, f'the screen did not become ready within {self.opts["timeout"]} ms - {d}'

    def close(self):
        try:
            self.browser.close()
        except Exception:
            pass
        try:
            self.pw.stop()
        except Exception:
            pass


# =========================================================================================== job registry and execution
JOBS = {}
_W = None


FAMILY_PLANNERS = []          # each family registers fn(args, discovered, routes, cells) -> [job dicts]


def job(kind):
    def deco(fn):
        JOBS[kind] = fn
        return fn
    return deco


def planner(fn):
    FAMILY_PLANNERS.append(fn)
    return fn


_INIT_ERR = ''


def _worker_init(base, opts):
    global _W, _INIT_ERR
    try:
        _W = Worker(base, opts)
    except Exception as e:                                       # noqa: BLE001 - reported by run_job instead of breaking the pool
        _INIT_ERR = f'{type(e).__name__}: {str(e)[:300]}'


def run_job(j):
    """Runs in a worker process. Returns plain data only (dicts / lists / str): it is pickled back to the parent."""
    if _W is None:
        return _crash_result(j, 'infrastructure', f'the browser could not be started: {_INIT_ERR}')
    t0 = time.time()
    findings, extra = [], {}
    for attempt in (1, 2):
        try:
            findings, extra = JOBS[j['kind']](_W, j)
            break
        except Exception as e:                                   # noqa: BLE001
            text = f'{type(e).__name__}: {e}'
            if attempt == 1 and re.search(r'closed|crash|disconnected|Target page', text, re.I):
                try:
                    _W.recycle()
                except Exception:
                    pass
                continue
            findings = [fail('checker-error', f'{j["kind"]}: {text[:300]} (a problem of the checker or of the browser, not necessarily of the site)',
                             route=j.get('route', ''), cell=j.get('cell', ''), url=j.get('hash', ''))]
            extra = {'trace': traceback.format_exc()[-900:]}
            break
    return {'job': {k: v for k, v in j.items() if k in ('kind', 'route', 'cell', 'hash', 'tag')}, 'dur': time.time() - t0,
            'findings': [dataclasses.asdict(f) for f in findings], 'extra': extra}


def probe_findings(items, route='', cell='', url=''):
    return [Finding(l, c, m, route=route, cell=cell, url=url) for (l, c, m) in items]


def collect(o, route='', cell='', url=''):
    """Everything the browser reported while this page was open (console, exceptions, network, dialogs) + cookies."""
    fs = probe_findings(o.probe.drain(), route, cell, url)
    try:
        ck = o.ctx.cookies()
    except Exception:
        ck = []
    if ck:
        fs.append(fail('cookie', f'the site set cookie(s): {", ".join(c["name"] for c in ck)[:120]}', route=route, cell=cell, url=url))
    return fs


# ================================================================================================== discover (route table)
DISCOVER_JS = """async () => {
  const s = await import('./js/store.js');
  return { routes: window.__ROUTES__ || null, periods: s.PERIODS.map(p => p.key), users: s.USER_TYPES.map(u => u.id), defaultPeriod: s.DEFAULT_PERIOD };
}"""


@job('discover')
def job_discover(w, j):
    o = w.open('1280-light', '#/')
    fs = probe_findings(o.probe.drain(), cell='1280-light', url='#/')
    if not o.ok:
        return fs + [fail('discover', o.why, cell='1280-light', url='#/')], {}
    d = o.page.evaluate(DISCOVER_JS)
    if not d.get('routes'):
        fs.append(fail('discover', 'window.__ROUTES__ is missing or empty (routes.js must expose the route table)', url='#/'))
    return fs, d

# ==== PART2A-END ====

# ================================================================================================ audit helpers and jobs
def problems_to_findings(problems, route, cell, url):
    return [Finding('fail' if p['l'] == 'fail' else 'warn', p['c'], p['m'], route=route, cell=cell, url=url) for p in problems]


def merge_audits(a, b):
    """Union of two audits of the same screen (before / after the deep pass)."""
    seen, probs = set(), []
    for p in b['problems'] + a['problems']:
        k = (p['c'], p['m'])
        if k not in seen:
            seen.add(k)
            probs.append(p)
    ia, ib = a['info'], dict(b['info'])
    for k in ('links', 'ext', 'rel'):
        ib[k] = sorted(set(ia.get(k, [])) | set(ib.get(k, [])))
    ids = {s['id'] for s in ib.get('share', [])}
    ib['share'] = ib.get('share', []) + [s for s in ia.get('share', []) if s['id'] not in ids]
    return {'problems': probs, 'info': ib}


def slim(info):
    keep = ('route', 'view', 'title', 'h1', 'stub', 'bare', 'links', 'ext', 'rel', 'share', 'tabs', 'charts', 'nodes', 'gl', 'blocks',
            'mockBlocks', 'hasDetails')
    return {k: info.get(k) for k in keep}


def settle(page, ms=150):
    page.wait_for_function(SETTLE_JS)
    page.wait_for_timeout(ms)


def deep_pass(page):
    page.evaluate(DEEP_JS)
    settle(page)


# concrete numbers the plan fixes for the finished screens (checked only on screens that are no longer stubs)
VALUE_CHECKS = {
    # v5 (working-group feedback, 10.10): the start page is the v4 opening again: h1, the one button, the plan block (three bars, КФП Jan–Aug 2026 against the annual plan, млрд. €) and the eight question cards;
    # the monthly table (BRIEF §6 values 26,93 / 30,12 / … ) lives in S15 only
    'S01': dict(all=['Държавният бюджет на достъпен език', 'Разгледай бюджета за 5 минути', 'Изпълнение на плана за 2026 г.',
                     'Приходи', 'Разходи с вноската в ЕС', 'Капиталови разходи', '60,7% от плана', '58,4% от плана', '43,2% от плана',
                     '30,12 млрд. € от 49,62 млрд. €', '33,19 млрд. € от 56,81 млрд. €', '4,04 млрд. € от 9,36 млрд. €',
                     'Откъде идват парите?', 'За какво се харчат?', 'Изпълнява ли се планът?', 'Колко плащам аз?',
                     'Кой харчи парите?', 'Колко е държавният дълг?', 'Какво се променя?', 'Накъде върви бюджетът?']),
    'S15': dict(all=['26,93', '30,12', '+3,19', '29,59', '33,19', '+3,60', '−2,67', '−3,08', 'дефицит']),
    'S18': dict(all=['1 500'], needs='rates.json'),
}


def view_text(page):
    txt = page.evaluate("() => (document.getElementById('view') || document.body).textContent || ''")
    return re.sub('[\u00a0\u2007\u2009\u202f]', ' ', txt)                  # NBSP, figure / thin / narrow no-break spaces -> plain space


def value_scan(page, route, pending_files, did_deep=False):
    """Which of the plan's fixed values does this load show? (the verdict is per route over all its samples, see value_findings)"""
    spec = VALUE_CHECKS.get(route)
    if not spec or (spec.get('needs') and spec['needs'] in pending_files):
        return None
    found = [v for v in spec['all'] if v in view_text(page)]
    if len(found) < len(spec['all']) and not did_deep:           # tabs may render on demand: open everything once, then look again
        deep_pass(page)
        found = [v for v in spec['all'] if v in view_text(page)]
    return {'want': list(spec['all']), 'found': found}


def value_findings(extras, quick=False):
    by = defaultdict(lambda: {'want': set(), 'found': set(), 'n': 0})
    for j, e in extras:
        v = (e or {}).get('vals')
        if v and j.get('kind') == 'base':
            g = by[j['route']]
            g['want'] |= set(v['want'])
            g['found'] |= set(v['found'])
            g['n'] += 1
    mk = warn if quick else fail                     # --quick loads one sample per route: a value that lives on another sample is no failure there
    return [mk('value', f'no sample of the screen shows the expected value(s): {", ".join(sorted(g["want"] - g["found"]))} (looked in {g["n"]} loads)', route=r)
            for r, g in sorted(by.items(), key=lambda kv: route_key(kv[0])) if g['want'] - g['found']]


def pending_of(items):
    return {m.split(' -> ')[0].rsplit('/', 1)[-1] for (l, c, m) in items if c == 'pending-data'}


@job('base')
def job_base(w, j):
    cell, route, h = j['cell'], j['route'], j['hash']
    o = w.open(cell, h, prefs=j.get('prefs'))
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
    a = o.page.evaluate(AUDIT_JS, {'expect': route, 'deep': False})
    if j.get('shot'):
        SHOT_DIR.mkdir(parents=True, exist_ok=True)
        o.page.screenshot(path=str(SHOT_DIR / f'{j["shot"]}.png'))
    stub = bool(a['info'].get('stub'))
    if j.get('deep'):
        deep_pass(o.page)
        a = merge_audits(a, o.page.evaluate(AUDIT_JS, {'expect': route, 'deep': True}))
    fs = collect(o, route, cell, h)
    items = [(f.level, f.code, f.msg) for f in fs]
    fs += problems_to_findings(a['problems'], route, cell, h)
    if w.opts.get('axe'):
        fs += axe_findings(o.page, w.opts['axe'], route, cell, h)
    if stub:
        fs.append(warn('stub', 'still a stub screen: generic checks only', route=route, cell=cell, url=h))
    vals = None
    if not stub and a['info'].get('view') == 'ready' and not j.get('no_values'):
        vals = value_scan(o.page, route, pending_of(items), did_deep=bool(j.get('deep')))
    return fs, {'info': slim(a['info']), 'vals': vals}


STATE_WANT = {                                   # demo -> (selector that must be visible in #view, human name)
    'loading': ('[data-state="loading"]', 'loading skeleton'),
    'empty': ('.state-empty[data-state="empty"]', 'empty state'),
    'error': ('.state-error[data-state="error"]', 'error state'),
    'pending': ('.state-pending[data-state="pending"]', 'pending state'),
}


@job('demo')
def job_demo(w, j):
    cell, route, h, demo = j['cell'], j['route'], j['hash'], j['demo']
    o = w.open(cell, h)
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
    a = o.page.evaluate(AUDIT_JS, {'expect': route, 'deep': False})
    fs = collect(o, route, cell, h) + problems_to_findings(a['problems'], route, cell, h)
    F = lambda code, msg: fs.append(fail(code, msg, route=route, cell=cell, url=h))      # noqa: E731
    if demo == OFFLINE_DEMO:
        st = o.page.evaluate("""() => { const e = document.getElementById('offline'); if (!e) return null;
            const r = e.getBoundingClientRect(); return { vis: !e.hidden && r.height > 0, state: e.dataset.state || '', text: e.textContent.trim().slice(0, 80) }; }""")
        if not st or not st['vis']:
            F('demo-offline', 'demo=offline did not show the offline banner (#offline)')
        elif st['state'] != 'offline' or not st['text']:
            F('demo-offline', f'the offline banner lacks data-state="offline" or text: {st}')
        if a['info'].get('view') not in ('ready', 'empty', 'pending'):
            F('demo-offline', f'demo=offline must keep the real screen, got view={a["info"].get("view")}')
        return fs, {}
    want, label = STATE_WANT[demo]
    view = a['info'].get('view')
    if view != demo:
        F('demo-state', f'demo={demo}: article.page[data-view] is "{view}", expected "{demo}"')
    n = o.page.evaluate("(sel) => [...document.querySelectorAll('#view ' + sel)].filter(e => e.getBoundingClientRect().height > 0).length", want)
    if not n:
        F('demo-state', f'demo={demo}: no visible {label} ({want}) in the screen')
    elif demo == 'loading':
        if not o.page.evaluate("() => !!document.querySelector('#view [data-state=\"loading\"][role=\"status\"]')"):
            F('demo-state', 'the loading skeleton lacks role="status"')
    elif demo == 'error':
        if not o.page.evaluate("() => !!document.querySelector('#view .state-error[role=\"alert\"] button[data-action=\"retry\"]')"):
            F('demo-state', 'the error state needs role="alert" and a [data-action="retry"] button')
    if j.get('next') and not o.page.evaluate("() => !!document.querySelector('#view aside.next')"):
        fs.append(warn('demo-next', f'demo={demo}: the „Следва“ card is missing from the frame', route=route, cell=cell, url=h))
    return fs, {}

# ==== PART2B-END ====

# ======================================================================================================== self-test family
# A checker that silently stops detecting is worse than none: plant known defects into a live page, expect every code.
SELFTEST_JS = r"""() => {
  const host = document.querySelector('#view article.page') || document.body;
  const add = h => { const d = document.createElement('div'); d.innerHTML = h; host.appendChild(d); };
  add('<p>NaN</p>');
  add('<div data-x="null"></div>');
  add('<div style="width:3000px;height:4px"></div>');
  add('<button></button>');
  add('<a href="#/nema-takava-stranica-xyz">nowhere</a>');
  add('<i id="dupx"></i><i id="dupx"></i>');
  add('<p style="color:#cccccc;background:#ffffff">low contrast text here</p>');
  add('<div class="chart" role="img" aria-label="x" data-ready="0" style="width:200px;height:100px"></div>');
  add('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">');
  add('<span data-src="no-such-source-key">s</span>');
  add('<a data-gl="no-such-term-xyz" href="#/rechnik">t</a>');
  add('<h1>second heading</h1>');
  add('<p>lorem ipsum dolor</p>');
  add('<input type="text">');
  add('<p>private channel</p>');
  add('<p>this is certainly english text</p>');
  add('<p style="font-size:9px">tiny text sample</p>');
  add('<button aria-label="a" style="width:10px;height:10px;display:inline-block;padding:0"></button><button aria-label="b" style="width:10px;height:10px;display:inline-block;padding:0"></button>');
  console.error('selftest console error');
  setTimeout(() => { throw new Error('selftest exception'); }, 0);
  setTimeout(() => { alert('selftest dialog'); }, 0);
  fetch('/selftest-missing.txt').catch(() => {});
  fetch('/data/selftest-missing.json').catch(() => {});
  fetch('http://selftest.invalid/x').catch(() => {});
  document.cookie = 'selftest=1';
}"""
SELFTEST_AUDIT = {'tokens', 'scroll-x', 'a11y-name', 'link-route', 'dup-id', 'contrast', 'chart', 'a11y-alt', 'src-key', 'gl-term', 'h1',
                  'placeholder', 'a11y-label', 'public-leak', 'english-text', 'tiny-text', 'target-size', 'csp'}
SELFTEST_PROBE = {'console', 'exception', 'dialog', 'http-404', 'pending-data', 'cookie'}      # 'external' cannot be provoked: the page's own CSP blocks it before a request exists


@job('selftest')
def job_selftest(w, j):
    cell = j['cell']
    o = w.open(cell, '#/')
    if not o.ok:
        return [fail('selftest', f'the home screen does not load, the self-test cannot run: {o.why}', cell=cell)], {}
    o.probe.reset()
    o.page.evaluate(SELFTEST_JS)
    o.page.wait_for_timeout(600)
    a = o.page.evaluate(AUDIT_JS, {'expect': 'S01', 'deep': False})
    got = {p['c'] for p in a['problems']} | {f.code for f in collect(o)}
    miss = sorted((SELFTEST_AUDIT | SELFTEST_PROBE) - got)
    return ([fail('selftest', f'the checker no longer detects: {", ".join(miss)}', cell=cell)] if miss else []), {}


@planner
def plan_selftest(args, d, routes, cells):
    return [dict(kind='selftest', route='', cell='1280-light', hash='#/')] if wants(args, 'selftest') else []


# ============================================================================== variant loads: period / user type / prefs
# One load with another URL or stored preferences, the generic audit, and one family-specific assertion (VARIANT_CHECKS).
def pref_blob(**kw):
    return {PREFS_KEY: json.dumps(kw)}


ONLY_REAL_JS = r"""() => {
  const vis = e => { const r = e.getBoundingClientRect(); return (r.width || r.height) && getComputedStyle(e).visibility !== 'hidden'; };
  const out = [];
  for (const sel of ['section.block[data-block-mock="true"]', '.kpi[data-kpi-mock="true"]', 'figure[data-mock-fig="true"]', '.table-wrap[data-mock-table="true"]'])
    for (const e of document.querySelectorAll('#view ' + sel)) if (!e.closest('[hidden]') && vis(e)) out.push(sel.replace(/\[.*$/, '') + (e.id ? '#' + e.id : ''));
  const other = [...document.querySelectorAll('#view [data-mock="true"]')].filter(e => vis(e) && !e.closest('[data-block-hidden="true"],[hidden]')).length;
  return { out, other, prefs: !!document.querySelector('html') };
}"""


def vc_period(page, info, j):
    view, key, sup = info.get('view'), j['per'], j['supported']
    F = lambda code, m: [fail(code, m, route=j['route'], cell=j['cell'], url=j['hash'])]       # noqa: E731
    if sup:
        if view == 'error':
            return F('period', f'period {key} (declared supported) ends in the error state')
        if view == 'empty':
            return [warn('period-empty', f'period {key} is declared supported but the screen shows the empty state', route=j['route'], cell=j['cell'], url=j['hash'])]
        return []
    if view != 'empty':
        return F('period', f'period {key} is not supported by this screen (periods: {j["periods"]}) but it shows view="{view}" instead of the empty state')
    n = page.evaluate("() => document.querySelectorAll('#view [data-state=\"empty\"] [data-action=\"set-period\"]').length")
    return [] if n else F('period', 'the "no data for this period" state offers no [data-action="set-period"] button')


def vc_user(page, info, j):
    # v5: with ROLE_SELECTOR=false the store ignores a stored userType on purpose (the role selector is off): the screen must stay on 'citizen'
    got, roles = page.evaluate("async () => { const s = await import('./js/store.js'); return [s.store.get('userType'), s.ROLE_SELECTOR]; }")
    want = j['user'] if roles else 'citizen'
    return [] if got == want else [fail('user', f'stored userType "{j["user"]}" gave "{got}", expected "{want}" (role selector {"on" if roles else "off"})', route=j['route'], cell=j['cell'], url=j['hash'])]


def vc_prefs(page, info, j):
    snap = page.evaluate("async () => (await import('./js/store.js')).store.snapshot()")
    bad = [f'{k}={v!r} (store: {snap.get(k)!r})' for k, v in j['want'].items() if snap.get(k) != v]
    fs = [fail('prefs', f'stored preference not applied: {", ".join(bad)}', route=j['route'], cell=j['cell'], url=j['hash'])] if bad else []
    if j['want'].get('onlyReal') and not j.get('bare'):          # the embed (bare layout) shows the one figure it was asked for, whatever the visitor's preferences
        r = page.evaluate(ONLY_REAL_JS)
        if r['out']:
            fs.append(fail('only-real', f'"only real data" is on but mock content is still visible: {", ".join(r["out"][:5])}', route=j['route'], cell=j['cell'], url=j['hash']))
        if r['other']:
            fs.append(warn('only-real-other', f'{r["other"]} [data-mock] element(s) stay visible with "only real data" on (hand-made mock content must check store.get("onlyReal"))',
                           route=j['route'], cell=j['cell'], url=j['hash']))
    return fs


VARIANT_CHECKS = {'period': vc_period, 'user': vc_user, 'prefs': vc_prefs}


@job('variant')
def job_variant(w, j):
    cell, route, h = j['cell'], j['route'], j['hash']
    o = w.open(cell, h, prefs=j.get('prefs'))
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
    a = o.page.evaluate(AUDIT_JS, {'expect': route, 'deep': False})
    fs = collect(o, route, cell, h) + problems_to_findings(a['problems'], route, cell, h)
    fs += VARIANT_CHECKS[j['check']](o.page, a['info'], j)
    return fs, {}


def pick_cell(cells, k):
    return cells[k % len(cells)]


@planner
def plan_period(args, d, routes, cells):
    if not wants(args, 'period'):
        return []
    jobs, k = [], 0
    for r in routes:
        if r['periods'] == 'none':
            continue
        sup = d['periods'] if r['periods'] == 'all' else [x for x in d['periods'] if x in r['periods']]
        for per in (d['periods'][:1] + d['periods'][-1:] + d['periods'][2:4] if args.quick else d['periods']):
            k += 1
            jobs.append(dict(kind='variant', check='period', route=r['id'], cell=pick_cell(cells, k), hash=with_query(r['samples'][0], per=per),
                             per=per, supported=per in sup, periods=r['periods']))
    return jobs


@planner
def plan_user(args, d, routes, cells):
    if not wants(args, 'user') or args.quick:
        return []
    jobs, k = [], 0
    for r in routes:
        for u in d['users']:
            k += 1
            jobs.append(dict(kind='variant', check='user', route=r['id'], cell=pick_cell(cells, k), hash=r['samples'][0], user=u, prefs=pref_blob(userType=u)))
    return jobs


PREF_SETS = [dict(unit='pct'), dict(perPerson=True, leva=True), dict(unit='pct', perPerson=True, leva=True), dict(onlyReal=True)]


@planner
def plan_prefs(args, d, routes, cells):
    if not wants(args, 'prefs'):
        return []
    jobs, k = [], 0
    for r in routes:
        for want in (PREF_SETS[-1:] if args.quick else PREF_SETS):
            k += 1
            jobs.append(dict(kind='variant', check='prefs', route=r['id'], cell=pick_cell(cells, k), hash=r['samples'][0], want=want, bare=bool(r.get('bare')), prefs=pref_blob(**want)))
    return jobs


# ================================================================================================ tour: SPA navigation in one page
# One browser page walks through the whole route table (hash assignment, link clicks, Back / Forward). What a full load never shows:
# a stale article, lost focus, kept scroll, a leaked popover, a growing DOM, a nav marker that does not follow.
NAV_STATE_JS = r"""() => {
  const v = document.getElementById('view');
  const arts = v ? v.querySelectorAll('article.page') : [];
  const a = arts[0] || null, h1 = a ? a.querySelector('h1') : null, ae = document.activeElement;
  const cur = sel => [...document.querySelectorAll(sel)].filter(e => e.hasAttribute('aria-current')).map(e => e.getAttribute('aria-current') + ':' + (e.dataset.nav || e.dataset.tab || ''));
  const pb = document.getElementById('btn-period');
  const name = ae && ae !== document.body ? ae.tagName.toLowerCase() + (ae.id ? '#' + ae.id : '') + (typeof ae.className === 'string' && ae.className ? '.' + ae.className.trim().split(/\s+/)[0] : '') : 'body';
  return {
    n: arts.length, route: a ? a.dataset.route : '', view: a ? a.dataset.view : '', h1: h1 ? h1.textContent.trim() : '', h1n: v ? v.querySelectorAll('h1').length : 0,
    title: document.title, hash: location.hash, y: Math.round(window.scrollY), focus: ae && ae === h1 ? 'h1' : name,
    bare: document.body.classList.contains('bare'), busy: v ? v.getAttribute('aria-busy') : 'no-view',
    side: cur('#sidenav a[data-nav]').concat(cur('#link-tax').map(x => x.split(':')[0] + ':S18')), tab: cur('#tabbar > *'), overlays: document.querySelectorAll('dialog[open], .popover, #gl-pop').length,
    section: document.querySelectorAll('#sidenav .nav-sec[data-current]:not([data-sec="more"])').length, periodHidden: pb ? !!pb.hidden : null, nodes: document.getElementsByTagName('*').length, old: v ? v.querySelectorAll('[data-chk-old]').length : 0
  };
}"""
MARK_OLD_JS = """() => { document.querySelectorAll('#view article.page').forEach(a => a.setAttribute('data-chk-old', '1'));
  window.scrollTo(0, Math.min(700, Math.max(0, document.documentElement.scrollHeight - window.innerHeight))); }"""
NEW_SCREEN_JS = """() => { const a = document.querySelector('#view article.page'); return !!a && !a.hasAttribute('data-chk-old') && a.dataset.ready === '1'; }"""


def tour_move(page, how, target=None):
    """Leave the current screen and wait for the next one to be built. how: 'hash' | 'click' | 'back' | 'forward'. Returns (state, note)."""
    note = ''
    page.evaluate(MARK_OLD_JS)
    page.wait_for_timeout(60)
    if how == 'click':
        loc = page.locator(f'a[href="{target}"]:visible').first
        try:
            if loc.count():
                loc.click(timeout=4000)
                # v5: a map region on a touch screen previews on the first tap and opens on the second (js/ui/map.js, deliberate); removing four
                # routes moved S21 onto a 'click' step of the tour, so a link inside a live map is tapped again when the address did not change
                if page.evaluate("t => !!document.querySelector('figure.map a[href=\"' + t + '\"]') && location.hash !== t", target):
                    page.wait_for_timeout(150)
                    loc.click(timeout=4000)
            else:
                how = 'hash'
        except Exception as e:                                           # noqa: BLE001 - a covered / unclickable link is a finding in itself
            note = f'link {target} could not be clicked ({str(e).splitlines()[0][:110]}); used the address bar instead'
            how = 'hash'
    if how == 'hash':
        page.evaluate("h => { location.hash = h; }", target)
    elif how == 'back':
        page.evaluate("() => history.back()")
    elif how == 'forward':
        page.evaluate("() => history.forward()")
    page.wait_for_function(NEW_SCREEN_JS)
    settle(page, 80)
    return page.evaluate(NAV_STATE_JS), note


def tour_verify(st, step, prev_title, cell, how):
    r, h = step['id'], step['hash']
    out = []
    F = lambda code, m: out.append(fail(code, m, route=r, cell=cell, url=h))             # noqa: E731
    W = lambda code, m: out.append(warn(code, m, route=r, cell=cell, url=h))             # noqa: E731
    if st['n'] != 1:
        F('tour-article', f'{st["n"]} article.page elements in #view after {how} navigation (the old screen must be replaced, not kept)')
    if st['old']:
        F('tour-article', 'the previous screen is still in the DOM')
    if st['route'] != r:
        F('tour-route', f'{how} navigation to {h} ended on screen {st["route"] or "(none)"} (hash is now {st["hash"]})')
    if st['h1n'] != 1:
        F('tour-h1', f'{st["h1n"]} h1 elements after {how} navigation')
    ok_title = st['title'].startswith('Бюджет на светло · ') if r == 'S01' else st['title'].endswith(THEME_SUFFIX)
    if not ok_title:
        F('tour-title', f'document.title after {how} navigation is "{st["title"]}" (expected "<screen> · Бюджет на светло")')
    elif prev_title and st['title'] == prev_title:
        F('tour-title', f'document.title did not change after {how} navigation ("{st["title"]}")')
    if st['focus'] != 'h1':
        F('tour-focus', f'after {how} navigation the focus is on {st["focus"]}, not on the heading (screen readers would not announce the new screen)')
    if st['y'] > 2:
        F('tour-scroll', f'the page is scrolled to {st["y"]}px after {how} navigation (a new screen must start at the top)')
    if st['bare'] != bool(step['bare']):
        F('tour-bare', f'body.bare is {st["bare"]} on this screen (the route table says bare={bool(step["bare"])})')
    if st['busy'] is not None:
        F('tour-busy', f'#view keeps aria-busy="{st["busy"]}" after the screen is built')
    if st['overlays']:
        F('tour-overlay', f'{st["overlays"]} dialog/popover element(s) are still open after {how} navigation')
    if not step['bare']:
        pages = [x for x in st['side'] if x.startswith('page:')]
        if step['nav'] and pages != [f'page:{r}']:
            F('tour-nav', f'#sidenav aria-current is {st["side"]} (expected only page:{r})')
        if not step['nav'] and pages:
            F('tour-nav', f'#sidenav marks {pages} as the current page for a screen that is not in the menu')
        if len(st['tab']) > 1 or (len(st['tab']) == 0 and st.get('section')):                  # v5: a screen under «Още» / «Моите данъци» marks no tab
            F('tour-nav', f'#tabbar has {len(st["tab"])} aria-current items (expected one on a screen of the three sections, none elsewhere): {st["tab"]}')
        if st['periodHidden'] is not None and st['periodHidden'] != (step['periods'] == 'none'):
            F('tour-period', f'the period button is {"hidden" if st["periodHidden"] else "shown"} on a screen with periods={step["periods"]}')
    return out


@job('tour')
def job_tour(w, j):
    cell, steps = j['cell'], j['steps']
    o = w.open(cell, '#/')
    page = o.page
    if not o.ok:
        return collect(o, '', cell, '#/') + [fail('timeout', o.why, cell=cell, url='#/')], {}
    fs, seen, titles = [], [], {}
    first = page.evaluate(NAV_STATE_JS)
    seen.append(dict(first, id='S01', how='load'))
    prev = first['title']
    fs += probe_findings(o.probe.drain(), 'S01', cell, '#/')
    for i, st in enumerate(steps):
        how = 'click' if i % 2 == 0 else 'hash'
        try:
            state, note = tour_move(page, how, st['hash'])
        except Exception as e:                                           # noqa: BLE001
            fs.append(fail('tour', f'navigation to {st["hash"]} ({how}) never finished: {str(e).splitlines()[0][:160]}; the tour stops here', route=st['id'], cell=cell, url=st['hash']))
            break
        fs += probe_findings(o.probe.drain(), st['id'], cell, st['hash'])
        if note:
            fs.append(warn('tour-click', note, route=st['id'], cell=cell, url=st['hash']))
        fs += tour_verify(state, st, prev, cell, how)
        if state['title'] in titles and titles[state['title']] != st['id']:
            fs.append(warn('title-dup', f'document.title "{state["title"]}" is also used by {titles[state["title"]]}', route=st['id'], cell=cell, url=st['hash']))
        titles.setdefault(state['title'], st['id'])
        prev = state['title']
        seen.append(dict(state, id=st['id'], how=how))
    # Back / Forward through the last screens: the address, the screen and the focus must agree
    back = min(3, len(seen) - 1)
    walk = [('back', len(seen) - 2 - k) for k in range(back)] + [('forward', len(seen) - 1 - back + k + 1) for k in range(min(2, back))]
    for how, idx in walk:
        if idx < 0 or idx >= len(seen):
            continue
        want = seen[idx]
        step = next((x for x in steps if x['id'] == want['id']), dict(id=want['id'], hash=want['hash'], bare=False, nav=True, periods='all'))
        try:
            state, _ = tour_move(page, how)
        except Exception as e:                                           # noqa: BLE001
            fs.append(fail('tour-history', f'{how} to {want["hash"]} never produced the screen: {str(e).splitlines()[0][:140]}', route=want['id'], cell=cell, url=want['hash']))
            break
        fs += probe_findings(o.probe.drain(), want['id'], cell, want['hash'])
        if state['hash'] != want['hash']:
            fs.append(fail('tour-history', f'{how}: the address is {state["hash"]}, expected {want["hash"]}', route=want['id'], cell=cell, url=want['hash']))
        if state['title'] != want['title']:
            fs.append(fail('tour-history', f'{how}: document.title is "{state["title"]}", expected "{want["title"]}"', route=want['id'], cell=cell, url=want['hash']))
        fs += [f for f in tour_verify(state, step, None, cell, how) if f.code not in ('tour-scroll', 'tour-title')]
    # back home: the DOM must not have grown with every screen that was opened and closed
    try:
        home, _ = tour_move(page, 'hash', '#/')
        if home['nodes'] > first['nodes'] * 1.25 + 150:
            fs.append(fail('tour-leak', f'the DOM holds {home["nodes"]} elements on the home screen after the tour against {first["nodes"]} at the start (something is not cleaned up on navigation)', route='S01', cell=cell, url='#/'))
    except Exception as e:                                               # noqa: BLE001
        fs.append(fail('tour', f'could not return to the home screen: {str(e).splitlines()[0][:140]}', route='S01', cell=cell, url='#/'))
    fs += collect(o, '', cell, '#/')
    return fs, {}


@planner
def plan_tour(args, d, routes, cells):
    if not wants(args, 'tour'):
        return []
    steps = [dict(id=r['id'], hash=r['samples'][0], bare=bool(r.get('bare')), nav=bool(r.get('nav')), periods=r['periods']) for r in routes if r['id'] != 'S01' or args.route]
    use = cells[:1] if args.quick else sorted({cells[0], cells[-1]}, key=cells.index)
    return [dict(kind='tour', route='', cell=c, hash='#/', steps=steps) for c in use]


# ======================================================================================================= ?to= deep links
# ?to=<id> must reveal the target (tab panel, closed <details>), scroll it below the sticky bar and focus it - in-page and on a fresh load.
TO_FIND_JS = r"""() => {
  const v = document.getElementById('view'), out = { panel: [], details: [], block: [] };
  const ok = e => e.id && !/^(page-title|main)$/.test(e.id) && !e.closest('[data-block-hidden="true"]');
  for (const e of v.querySelectorAll('[id]')) {
    if (!ok(e)) continue;
    const closed = e.closest('details:not([open])') && e.tagName !== 'SUMMARY';
    if (e.closest('[role="tabpanel"][hidden]') && !closed) { if (out.panel.length < 3 && e.getAttribute('role') !== 'tabpanel') out.panel.push(e.id); }
    else if (closed) { if (out.details.length < 2) out.details.push(e.id); }
    else if (e.matches('section.block[id], figure[id], .kpi[id]') && e.getBoundingClientRect().height > 0 && out.block.length < 1) out.block.push(e.id);
  }
  if (!out.panel.length) for (const e of v.querySelectorAll('[role="tabpanel"][hidden][id]')) { if (out.panel.length < 1 && ok(e)) out.panel.push(e.id); }
  return out;
}"""
TO_STATE_JS = r"""(id) => {
  const el = document.getElementById(id);
  if (!el) return { gone: true };
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  let closedDet = false;
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open) closedDet = true;
  const tb = document.getElementById('topbar');
  const sticky = tb && ['sticky', 'fixed'].includes(getComputedStyle(tb).position);
  return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), vh: window.innerHeight,
    hiddenAnc: !!el.closest('[hidden]'), closedDet, vis: cs.visibility !== 'hidden' && cs.display !== 'none',
    active: document.activeElement === el || el.contains(document.activeElement), tbb: sticky ? Math.round(tb.getBoundingClientRect().bottom) : 0,
    tab: (() => { const p = el.closest('[role="tabpanel"]'); if (!p) return null; const t = document.querySelector('[role="tab"][aria-controls="' + p.id + '"]'); return t ? t.getAttribute('aria-selected') : 'no-tab'; })() };
}"""


def to_verify(st, tid, how, route, cell, url):
    out = []
    F = lambda code, m: out.append(fail(code, m, route=route, cell=cell, url=url))                  # noqa: E731
    if st.get('gone'):
        F('to-gone', f'?to={tid} ({how}): the target element disappeared from the page')
        return out
    if st['hiddenAnc'] or st['closedDet'] or not st['vis'] or st['w'] * st['h'] <= 0:
        F('to-hidden', f'?to={tid} ({how}): the target is still hidden (hidden ancestor: {st["hiddenAnc"]}, closed <details>: {st["closedDet"]}, visible: {st["vis"]}, size {st["w"]}x{st["h"]})')
        return out
    if st['tab'] not in (None, 'true'):
        F('to-tab', f'?to={tid} ({how}): the panel is shown but its tab says aria-selected="{st["tab"]}"')
    if not st['active']:
        F('to-focus', f'?to={tid} ({how}): the target did not receive the focus')
    if st['top'] < st['tbb'] - 2 or st['top'] > st['vh'] - 24:
        F('to-scroll', f'?to={tid} ({how}): the target is not scrolled into view (top {st["top"]}px, viewport {st["vh"]}px, sticky bar ends at {st["tbb"]}px)')
    return out


def strip_to(h):
    base, _, q = h.partition('?')
    rest = [x for x in q.split('&') if x and not x.startswith('to=')]
    return base + ('?' + '&'.join(rest) if rest else '')


@job('to')
def job_to(w, j):
    cell, route, h = j['cell'], j['route'], j['hash']
    o = w.open(cell, h)
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
    page, fs = o.page, []
    cand = page.evaluate(TO_FIND_JS)
    ids = (cand['panel'] + cand['details'] + cand['block'])[:5]
    base = strip_to(page.evaluate('() => location.hash'))
    for tid in ids:
        page.evaluate("h => { location.hash = h; }", with_query(base, to=tid))
        page.wait_for_timeout(260)
        fs += to_verify(page.evaluate(TO_STATE_JS, tid), tid, 'in the open page', route, cell, h)
    fs += probe_findings(o.probe.drain(), route, cell, h)
    if ids:                                                          # the same address typed into a fresh tab
        h2 = with_query(base, to=ids[0])
        o2 = w.open(cell, h2)
        if not o2.ok:
            fs.append(fail('to-load', f'a fresh load of {h2} never became ready: {o2.why}', route=route, cell=cell, url=h2))
        else:
            fs += to_verify(o2.page.evaluate(TO_STATE_JS, ids[0]), ids[0], 'fresh load', route, cell, h2)
        fs += collect(o2, route, cell, h2)
    return fs, {'to': len(ids)}


@planner
def plan_to(args, d, routes, cells):
    if not wants(args, 'to'):
        return []
    return [dict(kind='to', route=r['id'], cell=pick_cell(cells, k), hash=r['samples'][0]) for k, r in enumerate(routes) if not r.get('bare') and r['id'] != 'S30']


# ============================================================================================ chrome: the shell's own controls
# One job per (cell, step); every step starts from a fresh load of the home screen, so a failing step cannot disturb the next one.
ACTIVE_JS = r"""() => {
  const a = document.activeElement, same = a === window.__cmPrev;
  window.__cmPrev = a;
  if (!a || a === document.body || a === document.documentElement) return { body: true, sig: 'body' };
  const r = a.getBoundingClientRect(), cs = getComputedStyle(a), cls = typeof a.className === 'string' ? a.className.trim() : '';
  const tb = document.getElementById('topbar'), sticky = tb && ['sticky', 'fixed'].includes(getComputedStyle(tb).position);
  return { body: false, same, id: a.id, tag: a.tagName.toLowerCase(), cls, skip: a.classList.contains('skip-link'),
    sig: a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (cls ? '.' + cls.split(/\s+/)[0] : ''),
    kind: a.tagName.toLowerCase() + '.' + (cls.split(/\s+/)[0] || '') + (a.getAttribute('role') ? '[' + a.getAttribute('role') + ']' : ''),
    text: (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
    tbb: sticky ? Math.round(tb.getBoundingClientRect().bottom) : 0, inMain: !!a.closest('#main, #footer'),
    vis: cs.visibility !== 'hidden' && cs.display !== 'none' && (r.width > 0 || r.height > 0) && parseFloat(cs.opacity) > 0.05,
    fv: a.matches(':focus-visible'), ol: cs.outlineStyle, olw: parseFloat(cs.outlineWidth) || 0, bs: cs.boxShadow };
}"""
BLUR_JS = "() => { window.__cmPrev = null; if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); window.scrollTo(0, 0); }"
PREFS_JS = "() => { try { return JSON.parse(localStorage.getItem('bns.prefs.v1') || '{}'); } catch (e) { return { _err: String(e) }; } }"


def act(page):
    return page.evaluate(ACTIVE_JS)


def is_active(page, sel):
    return page.evaluate("(s) => { const a = document.activeElement; return !!a && a.matches(s); }", sel)


def wait_for(page, js, arg=None, timeout=2500):
    try:
        page.wait_for_function(js, arg=arg, timeout=timeout)
        return True
    except Exception:                                                    # noqa: BLE001 - a timeout is the answer "no"
        return False


def present(page, sel):
    return page.evaluate("(s) => !!document.querySelector(s)", sel)


def wait_gone(page, sel, timeout=2500):
    return wait_for(page, "(s) => !document.querySelector(s)", sel, timeout)


def wait_there(page, sel, timeout=2500):
    return wait_for(page, "(s) => { const e = document.querySelector(s); return !!e && (e.getBoundingClientRect().height > 0); }", sel, timeout)


def begin(w, cell, h, outs, **kw):
    o = w.open(cell, h, **kw)
    outs.append(o)
    return o if o.ok else None


def is_wide(cell):
    return CELLS[cell]['w'] >= 900


def ch_skip(w, cell, F, W, j, outs):
    o = begin(w, cell, '#/', outs)
    if not o:
        return
    page = o.page
    page.evaluate(BLUR_JS)
    page.keyboard.press('Tab')
    a = act(page)
    if not a.get('skip'):
        F('skip-link', f'the first Tab stop is {a["sig"]}, not the skip link "Към съдържанието" (it must be the first focusable element)')
        return
    if a['x'] < -1 or a['y'] < -1 or a['x'] + a['w'] > a['vw'] + 1 or a['w'] < 40 or a['h'] < 20:
        F('skip-link', f'the skip link does not become visible when it has the focus (box {a["x"]},{a["y"]} {a["w"]}x{a["h"]} in a {a["vw"]}px viewport)')
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    r = page.evaluate("() => { const m = document.getElementById('main'); return { id: document.activeElement && document.activeElement.id, hash: location.hash, ti: m ? m.getAttribute('tabindex') : 'no #main' }; }")
    if r['id'] != 'main':
        F('skip-link', f'Enter on the skip link leaves the focus on {r["id"] or "another element"}, not on #main (tabindex={r["ti"]})')
    if r['hash'] != '#/':
        F('skip-link', f'the skip link changed the address to {r["hash"]} (a hash router must keep the route)')
    page.keyboard.press('Tab')
    b = act(page)
    if b['body'] or not b['inMain']:
        W('skip-link', f'the Tab after the skip link goes to {b["sig"]}, not into the page content')


def ch_focus(w, cell, F, W, j, outs):
    """Tab through the first 45 stops: every stop is visible, none traps the focus, each shows a focus ring (WCAG 2.4.7 / 2.4.11)."""
    o = begin(w, cell, '#/', outs)
    if not o:
        return
    page = o.page
    page.evaluate(BLUR_JS)
    kinds, stops = {}, 0
    for _ in range(45):
        page.keyboard.press('Tab')
        a = act(page)
        if a['body']:
            break
        stops += 1
        if a['same']:
            F('focus-trap', f'Tab does not move on from {a["sig"]} ("{a["text"]}") - a keyboard trap')
            break
        if not a['vis'] and not a['skip']:
            F('focus-hidden', f'the keyboard focus lands on {a["sig"]} ("{a["text"]}"), which is not visible')
        if a['inMain'] and a['tbb'] and a['y'] < a['tbb'] - 2 < a['y'] + a['h'] and a['h'] < 400:
            W('focus-obscured', f'{a["sig"]} ("{a["text"]}") is focused but hidden behind the sticky top bar (top {a["y"]}px, bar ends at {a["tbb"]}px)')
        if a['kind'] not in kinds:
            kinds[a['kind']] = a
    for k, a in kinds.items():
        if not a['fv']:
            W('focus-visible', f'{a["sig"]} ("{a["text"]}") does not match :focus-visible after a Tab key press')
        if a['ol'] == 'none' or a['olw'] < 2:
            if a['bs'] in ('none', ''):
                F('focus-ring', f'{a["sig"]} ("{a["text"]}") shows no focus ring with the keyboard (outline {a["ol"]} {a["olw"]}px, no box-shadow); WCAG 2.4.7 / 2.4.11')
            else:
                W('focus-ring', f'{a["sig"]} ("{a["text"]}") relies on a box-shadow as focus ring (outline {a["ol"]} {a["olw"]}px); it vanishes in forced-colors mode')
    if stops < 5:
        F('focus-order', f'only {stops} Tab stops reached before the focus left the document (expected the whole top bar and the menu)')


def ch_palette(w, cell, F, W, j, outs):
    o = begin(w, cell, '#/', outs)
    if not o:
        return
    page = o.page
    DLG = 'dialog#palette[open]'
    st_js = """() => { const d = document.getElementById('palette'); if (!d) return null; const i = d.querySelector('input'); const r = d.getBoundingClientRect();
        return { open: d.open, inputFocus: document.activeElement === i, role: i && i.getAttribute('role'), label: i && (i.getAttribute('aria-label') || ''), lab: d.getAttribute('aria-labelledby'),
          labText: (document.getElementById(d.getAttribute('aria-labelledby') || '') || {}).textContent || '', modal: document.documentElement.classList.contains('has-modal'),
          fs: i ? parseFloat(getComputedStyle(i).fontSize) : 0, l: Math.round(r.left), r: Math.round(r.right), vw: innerWidth, sw: document.documentElement.scrollWidth, count: document.querySelectorAll('dialog#palette').length }; }"""

    def opened(how):
        if not wait_there(page, DLG):
            F('palette', f'{how} does not open the search palette (dialog#palette)')
            return None
        s = page.evaluate(st_js)
        if not s or not s['inputFocus']:
            F('palette', f'{how}: the search field of the palette does not have the focus')
        return s

    def closed(how, back='btn-search'):
        if not wait_gone(page, 'dialog#palette'):
            F('palette', f'{how} does not close the palette')
            return
        if page.evaluate("() => document.documentElement.classList.contains('has-modal')"):
            F('palette', f'{how}: html.has-modal stays set after the palette closed (the page would keep its scroll lock)')
        if back and not is_active(page, f'#{back}'):
            F('palette-focus', f'{how}: the focus does not return to #{back} (it is on {act(page)["sig"]})')

    # 1) the top-bar button
    page.click('#btn-search')
    s = opened('the search button')
    if s:
        if s['role'] != 'combobox' or not s['label'] or not s['labText'].strip():
            F('palette', f'the palette lacks the combobox role / an accessible name (role={s["role"]!r}, label={s["label"]!r}, title={s["labText"]!r})')
        if not s['modal']:
            W('palette', 'html.has-modal is not set while the palette is open (the page behind may scroll)')
        if s['l'] < 0 or s['r'] > s['vw'] + 1 or s['sw'] > s['vw'] + 1:
            F('palette', f'the palette does not fit the {s["vw"]}px viewport (box {s["l"]}..{s["r"]}, page scrollWidth {s["sw"]})')
        if not is_wide(cell) and s['fs'] < 16:
            W('palette-zoom', f'the palette field has font-size {s["fs"]}px; iOS zooms the page for fields under 16px')
        page.keyboard.press('Escape')
        closed('Escape')
    # 2) "/" from the page
    page.evaluate(BLUR_JS)
    page.keyboard.press('/')
    s = opened('the "/" key')
    if s:
        page.keyboard.press('Escape')
        closed('Escape after "/"')
    # 3) Ctrl-K, twice (idempotent), then type, move, follow
    page.evaluate(BLUR_JS)
    page.keyboard.press('Control+k')
    s = opened('Ctrl-K')
    if not s:
        return
    page.keyboard.press('Control+k')
    page.wait_for_timeout(120)
    s2 = page.evaluate(st_js)
    if not s2 or s2['count'] != 1 or not s2['inputFocus']:
        F('palette', f'a second Ctrl-K must keep one palette with the focus in the field (palettes: {s2 and s2["count"]}, field focused: {s2 and s2["inputFocus"]})')
    page.keyboard.type('a/b', delay=15)
    v = page.evaluate("() => document.querySelector('dialog#palette input').value")
    if v != 'a/b':
        F('palette', f'typing "a/b" in the palette field gives "{v}" ("/" must be an ordinary character inside a field)')
    page.fill('dialog#palette input', '')
    page.keyboard.type('ДДС', delay=25)
    got = wait_for(page, "() => document.querySelectorAll('dialog#palette [role=\"option\"]').length > 0", timeout=4000)
    if not got:
        W('palette-results', 'typing "ДДС" gives no result option in the palette (the index may not be there yet)')
        page.keyboard.press('Escape')
        return
    ao = page.evaluate("""() => { const i = document.querySelector('dialog#palette input'), os = [...document.querySelectorAll('dialog#palette [role="option"]')];
        const sel = os.filter(o => o.getAttribute('aria-selected') === 'true'); return { n: os.length, exp: i.getAttribute('aria-expanded'), ad: i.getAttribute('aria-activedescendant'),
          selId: sel[0] ? sel[0].id : null, nSel: sel.length, list: !!document.querySelector('dialog#palette [role="listbox"]'), ctl: i.getAttribute('aria-controls'), ctlOk: !!document.getElementById(i.getAttribute('aria-controls') || '') }; }""")
    if ao['exp'] != 'true' or not ao['list'] or not ao['ctlOk']:
        F('palette', f'results are shown but the combobox says aria-expanded={ao["exp"]}, listbox present={ao["list"]}, aria-controls target present={ao["ctlOk"]}')
    if ao['nSel'] != 1 or ao['ad'] != ao['selId']:
        F('palette', f'the active option and aria-activedescendant disagree (selected options: {ao["nSel"]}, activedescendant={ao["ad"]}, selected id={ao["selId"]})')
    if ao['n'] >= 2:
        page.keyboard.press('ArrowDown')
        ad2 = page.evaluate("() => document.querySelector('dialog#palette input').getAttribute('aria-activedescendant')")
        if ad2 == ao['ad']:
            F('palette', 'ArrowDown does not move the active option')
        page.keyboard.press('ArrowUp')
        ad3 = page.evaluate("() => document.querySelector('dialog#palette input').getAttribute('aria-activedescendant')")
        if ad3 != ao['ad']:
            F('palette', 'ArrowUp does not move the active option back')
    href = page.evaluate("() => { const o = document.querySelector('dialog#palette [role=\"option\"][aria-selected=\"true\"]'); return o ? o.getAttribute('href') : null; }")
    page.evaluate(MARK_OLD_JS)
    page.keyboard.press('Enter')
    if not wait_for(page, NEW_SCREEN_JS, timeout=6000):
        F('palette', f'Enter on the first result ({href}) does not lead to a new screen')
        return
    settle(page, 80)
    n = page.evaluate(NAV_STATE_JS)
    if href and href.startswith('#/') and n['hash'].split('?')[0] != href.split('?')[0]:
        F('palette', f'Enter followed {n["hash"]}, but the active option points to {href}')
    if n['overlays'] or present(page, 'dialog#palette') or page.evaluate("() => document.documentElement.classList.contains('has-modal')"):
        F('palette', 'the palette (or html.has-modal) is still there after a result was followed')
    if n['focus'] != 'h1':
        F('palette-focus', f'after following a result the focus is on {n["focus"]}, not on the new screen\'s heading')
    # 4) the address changes while it is open: it goes away with the screen
    page.click('#btn-search')
    if wait_there(page, DLG):
        page.evaluate(MARK_OLD_JS)
        page.evaluate("() => { location.hash = '#/rechnik'; }")
        wait_for(page, NEW_SCREEN_JS, timeout=6000)
        settle(page, 80)
        n = page.evaluate(NAV_STATE_JS)
        if present(page, 'dialog#palette') or page.evaluate("() => document.documentElement.classList.contains('has-modal')"):
            F('palette', 'a change of the address leaves the palette (or html.has-modal) behind')
        if n['focus'] != 'h1':
            F('palette-focus', f'after the address changed under the open palette the focus is on {n["focus"]}, not on the heading')
    # 5) a click on the backdrop closes it
    page.click('#btn-search')
    if wait_there(page, DLG):
        page.mouse.click(3, 3)
        closed('a click on the backdrop')


def ch_popovers(w, cell, F, W, j, outs):
    o = begin(w, cell, '#/razhodi', outs)                                   # v5: the start screen has no period button (periods:'none'), the expenditure screen has
    if not o:
        return
    page = o.page
    POP = '.popover[role="dialog"]'
    meta = page.evaluate("async () => { const s = await import('./js/store.js'); return { periods: s.PERIODS, users: s.USER_TYPES, dflt: s.DEFAULT_PERIOD, user0: s.store.get('userType'), roles: s.ROLE_SELECTOR }; }")
    per, users = meta['periods'], meta['users']

    def open_pop(btn, name):
        page.click(btn)
        if not wait_there(page, POP):
            F('popover', f'{btn} ({name}) opens nothing (.popover[role="dialog"])')
            return None
        return page.evaluate("""(b) => { const p = document.querySelector('.popover[role="dialog"]'), a = document.querySelector(b), x = p.getBoundingClientRect();
            return { exp: a.getAttribute('aria-expanded'), inPop: p.contains(document.activeElement), name: p.getAttribute('aria-label') || '', l: Math.round(x.left), r: Math.round(x.right), t: Math.round(x.top), b: Math.round(x.bottom), vw: innerWidth, vh: innerHeight,
              radios: [...p.querySelectorAll('input[type="radio"]')].map(r => ({ v: r.value, c: r.checked, d: r.disabled })), boxes: [...p.querySelectorAll('input[type="checkbox"]')].map(r => r.dataset.pref || '?') }; }""", btn)

    def esc_close(btn, name):
        page.keyboard.press('Escape')
        if not wait_gone(page, POP):
            F('popover', f'Escape does not close the {name} popover')
            return
        if not is_active(page, btn):
            F('popover-focus', f'after Escape the focus is on {act(page)["sig"]}, not back on {btn} ({name})')
        if page.evaluate("(b) => document.querySelector(b).getAttribute('aria-expanded')", btn) != 'false':
            F('popover', f'{btn} keeps aria-expanded="true" after the {name} popover closed')

    def sane(s, name):
        if s['exp'] != 'true':
            F('popover', f'the button of the {name} popover has aria-expanded="{s["exp"]}" while it is open')
        if not s['inPop']:
            F('popover-focus', f'the keyboard focus is not inside the {name} popover after it opened')
        if s['l'] < 0 or s['r'] > s['vw'] or s['b'] > s['vh'] + 1:
            F('popover', f'the {name} popover leaves the viewport (box {s["l"]},{s["t"]} - {s["r"]},{s["b"]} in {s["vw"]}x{s["vh"]})')

    # ---- period
    s = open_pop('#btn-period', 'period')
    if s:
        sane(s, 'period')
        if len(s['radios']) != len(per):
            F('popover', f'the period popover lists {len(s["radios"])} options, the store has {len(per)} periods')
        ch = [r['v'] for r in s['radios'] if r['c']]
        if ch != [meta['dflt']]:
            F('popover', f'the period popover shows {ch} as selected, expected [{meta["dflt"]}]')
        esc_close('#btn-period', 'period')
        s = open_pop('#btn-period', 'period')
        if s:
            want = next(p for p in per if p['key'] != meta['dflt'] and p['key'].endswith('report'))
            page.click(f'{POP} label:has(input[value="{want["key"]}"])')
            if not wait_gone(page, POP):
                F('popover', 'choosing a period does not close the popover')
            if not wait_for(page, "(k) => location.hash.includes('per=' + k)", want['key']):
                F('period-url', f'choosing {want["key"]} did not put per={want["key"]} into the address (now {page.evaluate("() => location.hash")})')
            lab = page.evaluate("() => document.getElementById('btn-period').getAttribute('aria-label') || ''")
            if want['label'] not in lab:
                F('period-label', f'the period button says "{lab}" after choosing "{want["label"]}"')
            if not is_active(page, '#btn-period'):
                F('popover-focus', f'after choosing a period the focus is on {act(page)["sig"]}, not back on #btn-period')
            ok = wait_for(page, "(l) => { const e = document.querySelector('#view .ctx-period strong'); return !e || e.textContent.trim() === l; }", want['label'], timeout=4000)
            if not ok:
                F('period-context', f'the screen\'s period line does not follow the choice "{want["label"]}": "{page.evaluate("() => (document.querySelector(\'#view .ctx-period strong\') || {}).textContent")}"')
            prefs = page.evaluate(PREFS_JS)
            if prefs.get('period') not in (None, want['key']):
                W('period-pref', f'the stored preference says period={prefs.get("period")}')
    # a screen that supports only some periods: the others are disabled in the popover
    if j.get('arr'):
        page.evaluate("(h) => { location.hash = h; }", j['arr'])
        wait_for(page, "() => { const a = document.querySelector('#view article.page'); return !!a && a.dataset.ready === '1'; }", timeout=6000)
        settle(page, 80)
        s = open_pop('#btn-period', 'period (restricted screen)')
        if s:
            dis = [r['v'] for r in s['radios'] if r['d']]
            if not dis:
                F('popover', f'{j["arr"]} supports only some periods, but the period popover disables none of them')
            esc_close('#btn-period', 'period (restricted screen)')
        page.evaluate("() => { location.hash = '#/razhodi'; }")
        wait_for(page, "() => { const a = document.querySelector('#view article.page'); return !!a && a.dataset.route === 'S07' && a.dataset.ready === '1'; }", timeout=6000)
    # ---- settings popover (FB4: the view-for and the theme choices moved from the top bar into «Още настройки»; the popover stays open after a choice)
    PREF_N = "(k) => document.querySelectorAll('.popover[role=\"dialog\"] input[data-pref=\"' + k + '\"]').length"
    s = open_pop('#btn-more', 'settings')
    if s:
        sane(s, 'settings')
        for need in ('onlyReal', 'perPerson', 'leva'):
            if need not in s['boxes']:
                F('popover', f'the settings popover has no toggle for "{need}" (found: {s["boxes"]})')
        nu, nt = page.evaluate(PREF_N, 'userType'), page.evaluate(PREF_N, 'theme')
        if nu != (len(users) if meta['roles'] else 0):
            F('popover', f'the settings popover lists {nu} view-for options, expected {len(users) if meta["roles"] else 0} (v5: the role selector is off unless ROLE_SELECTOR is true in js/store.js)')
        if nt != 0:
            F('popover', f'the settings popover has {nt} theme options, expected none (v4 is light only)')
        if page.evaluate("() => document.querySelectorAll('#topbar [data-theme-set], #topbar #btn-user').length"):
            F('topbar', 'the top bar still carries the view-for / theme controls (FB4 moves them into «Още настройки»)')
        # user type (v5: only when the role selector is switched on)
        want = users[1]
        if meta['roles']:
            page.click(f'{POP} label:has(input[data-pref="userType"][value="{want["id"]}"])')
            page.wait_for_timeout(150)
            if page.evaluate("async () => (await import('./js/store.js')).store.get('userType')") != want['id']:
                F('prefs', f'choosing the view "{want["label"]}" did not set userType in the store')
            if page.evaluate(PREFS_JS).get('userType') != want['id']:
                F('prefs-persist', f'the user type "{want["id"]}" is not stored in localStorage (bns.prefs.v1: {page.evaluate(PREFS_JS)})')
            if not present(page, POP):
                W('popover', 'the settings popover closed itself after a view-for choice (it should stay open for the next one)')
        # theme: v4 is light only (СИГМА has no dark theme), so there is nothing to switch
        # toggles
        if not present(page, POP):
            s = open_pop('#btn-more', 'settings')
        if present(page, POP):
            page.click(f'{POP} label:has(input[data-pref="onlyReal"])')
            page.wait_for_timeout(150)
            on = page.evaluate("async () => (await import('./js/store.js')).store.get('onlyReal')")
            if on is not True:
                F('prefs', f'the "Само официални данни" toggle did not set onlyReal (store says {on!r})')
            if page.evaluate(PREFS_JS).get('onlyReal') is not True:
                F('prefs-persist', 'onlyReal is not stored in localStorage after the toggle')
            if not present(page, POP):
                W('popover', 'the settings popover closed itself after a toggle (it should stay open for the next one)')
            else:
                page.click(f'{POP} [data-action="legend"]')
                if wait_there(page, 'dialog.sheet[open]'):
                    page.keyboard.press('Escape')
                    if not wait_gone(page, 'dialog.sheet'):
                        F('legend', 'Escape does not close the legend sheet')
                else:
                    F('legend', 'the "Легенда" button in the settings popover opens nothing')
                if present(page, POP):
                    page.keyboard.press('Escape')
                    wait_gone(page, POP)
                    if not is_active(page, '#btn-more'):
                        F('popover-focus', f'after Escape the focus is on {act(page)["sig"]}, not back on #btn-more (settings)')
    # ---- sources
    b = page.evaluate("() => document.getElementById('btn-sources').getAttribute('aria-pressed')")
    page.click('#btn-sources')
    page.wait_for_timeout(100)
    st = page.evaluate("() => ({ p: document.getElementById('btn-sources').getAttribute('aria-pressed'), d: document.documentElement.getAttribute('data-sources') })")
    if st['p'] == b or (st['p'] == 'true') != (st['d'] == '1'):
        F('sources', f'the "Източници" switch is inconsistent: aria-pressed {b} -> {st["p"]}, html[data-sources]={st["d"]}')
    if page.evaluate(PREFS_JS).get('sources') is None:
        F('prefs-persist', 'the "Източници" switch is not stored in localStorage')
    # ---- a reload keeps the view-for choice; v4 stays light (no data-theme, colour scheme light)
    page.reload(wait_until='domcontentloaded')
    w.ready(page)
    st = page.evaluate("() => ({ th: document.documentElement.getAttribute('data-theme'), cs: getComputedStyle(document.documentElement).colorScheme })")
    if st['th'] is not None or 'dark' in (st['cs'] or ''):
        F('theme-switch', f'v4 is light only, but after a reload html[data-theme]={st["th"]!r} and color-scheme is {st["cs"]!r}')
    s = open_pop('#btn-more', 'settings (after the reload)')
    if s:
        kept = page.evaluate("() => [...document.querySelectorAll('.popover[role=\"dialog\"] input[data-pref=\"userType\"]:checked')].map(r => r.value)")
        if meta['roles'] and kept != [users[1]['id']]:
            F('prefs-persist', f'after a reload the settings popover shows the view {kept} as chosen, expected [{users[1]["id"]!r}]')
        page.keyboard.press('Escape')
        wait_gone(page, POP)


def ch_phone(w, cell, F, W, j, outs):
    o = begin(w, cell, '#/razhodi', outs)                                   # v5: a screen with a period button (the start screen has none)
    if not o:
        return
    page = o.page
    if not page.evaluate("() => matchMedia('(pointer:coarse)').matches"):
        W('touch-emulation', 'the narrow cells should emulate a coarse pointer, but (pointer:coarse) does not match; touch-only CSS is not exercised')
    # the bottom bar: three targets (v5: Начало · Отчет · Бюджет), each at least 44px
    bar = page.evaluate("""() => [...document.querySelectorAll('#tabbar > *')].map(e => { const r = e.getBoundingClientRect(); return { n: (e.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && r.height > 0 }; })""")
    if len(bar) != 3 or not all(b['vis'] for b in bar):
        F('tabbar', f'the bottom bar must show 3 buttons (Начало · Отчет · Бюджет), found {[b["n"] for b in bar if b["vis"]]}')
    for b in bar:
        if b['vis'] and (b['w'] < 44 or b['h'] < 44):
            F('tabbar', f'bottom-bar button "{b["n"]}" is {b["w"]}x{b["h"]}px (minimum 44x44 on a phone)')
    # «Меню» (v5; the old «Още» tab): the whole menu + settings in a drawer
    SH = 'dialog.sheet[open]'
    page.click('#btn-menu')
    if not wait_there(page, SH):
        F('sheet', 'the "Още" button opens no sheet (dialog.sheet)')
        return
    st = page.evaluate("""() => { const d = document.querySelector('dialog.sheet[open]'); const r = d.getBoundingClientRect();
        return { title: (d.querySelector('.sheet-title') || {}).textContent, links: d.querySelectorAll('.more-list a').length, users: d.querySelectorAll('input[data-pref="userType"]').length, themes: d.querySelectorAll('input[data-pref="theme"]').length,
          boxes: [...d.querySelectorAll('input[type="checkbox"][data-pref]')].map(i => i.dataset.pref), foc: d.contains(document.activeElement), l: Math.round(r.left), r: Math.round(r.right), vw: innerWidth, sw: document.documentElement.scrollWidth,
          modal: document.documentElement.classList.contains('has-modal'), exp: document.getElementById('btn-menu').getAttribute('aria-haspopup') }; }""")
    if st['links'] < 15:
        F('sheet', f'the "Още" sheet lists only {st["links"]} screens (expected the whole menu)')
    if st['users'] != 0 or st['themes'] != 0 or sorted(st['boxes']) != sorted(['sources', 'onlyReal', 'perPerson', 'leva']):
        F('sheet', f'the "Още" sheet settings are incomplete (user types {st["users"]}, themes {st["themes"]}, toggles {st["boxes"]})')
    if not st['foc']:
        F('sheet-focus', 'the focus is not inside the "Още" sheet after it opened')
    if st['l'] < 0 or st['r'] > st['vw'] + 1 or st['sw'] > st['vw'] + 1:
        F('sheet', f'the "Още" sheet does not fit the {st["vw"]}px viewport (box {st["l"]}..{st["r"]}, page scrollWidth {st["sw"]})')
    page.keyboard.press('Escape')
    if not wait_gone(page, 'dialog.sheet'):
        F('sheet', 'Escape does not close the "Още" sheet')
    elif not is_active(page, '#btn-menu'):
        F('sheet-focus', f'after Escape the focus is on {act(page)["sig"]}, not back on #btn-menu')
    page.click('#btn-menu')
    if wait_there(page, SH):
        href = page.evaluate("() => { const a = [...document.querySelectorAll('dialog.sheet[open] .more-list a')].find(a => !a.hasAttribute('aria-current') && a.getAttribute('href') !== '#/'); return a ? a.getAttribute('href') : null; }")
        page.evaluate(MARK_OLD_JS)
        page.click(f'dialog.sheet[open] a[href="{href}"]')
        if not wait_for(page, NEW_SCREEN_JS, timeout=6000):
            F('sheet', f'a link in the "Още" sheet ({href}) does not lead to a new screen')
        else:
            settle(page, 80)
            n = page.evaluate(NAV_STATE_JS)
            if n['overlays'] or present(page, 'dialog.sheet') or page.evaluate("() => document.documentElement.classList.contains('has-modal')"):
                F('sheet', 'the "Още" sheet (or html.has-modal) is still there after a link was followed')
            if n['focus'] != 'h1':
                F('sheet-focus', f'after a link in the "Още" sheet the focus is on {n["focus"]}, not on the heading')
    # the period switch is a sheet on a phone (v5: on a screen that has the button; the start screen has none)
    page.evaluate("() => { location.hash = '#/razhodi'; }")
    wait_for(page, "() => { const a = document.querySelector('#view article.page'); return !!a && a.dataset.route === 'S07' && a.dataset.ready === '1'; }", timeout=6000)
    settle(page, 80)
    page.click('#btn-period')
    if wait_there(page, SH):
        want = page.evaluate("async () => { const s = await import('./js/store.js'); return s.PERIODS.find(p => p.key !== s.DEFAULT_PERIOD && p.key.endsWith('report')); }")
        page.click(f'dialog.sheet[open] label:has(input[value="{want["key"]}"])')
        if not wait_gone(page, 'dialog.sheet'):
            F('sheet', 'choosing a period does not close the period sheet')
        if not wait_for(page, "(k) => location.hash.includes('per=' + k)", want['key']):
            F('period-url', f'choosing {want["key"]} in the period sheet did not put it into the address')
        if not is_active(page, '#btn-period'):
            F('sheet-focus', f'after choosing a period the focus is on {act(page)["sig"]}, not back on #btn-period')
    else:
        F('sheet', 'the period button opens nothing on a phone')


def ch_mockbar(w, cell, F, W, j, outs):
    o = begin(w, cell, '#/', outs)
    if not o:
        return
    page = o.page
    st = page.evaluate("() => { const b = document.getElementById('mockbar'), r = b.getBoundingClientRect(); return { hidden: b.hidden, h: Math.round(r.height), t: (b.textContent || '').trim().slice(0, 60), legend: !!b.querySelector('[data-action=\"legend\"]'), x: !!b.querySelector('[data-action=\"dismiss-banner\"]') }; }")
    if st['hidden'] or st['h'] < 10 or 'Mock' not in st['t']:
        F('mockbar', f'the Mock banner is not visible on a fresh visit (hidden={st["hidden"]}, height {st["h"]}px, text "{st["t"]}")')
        return
    if not st['legend'] or not st['x']:
        F('mockbar', 'the Mock banner needs a "Легенда" button and a dismiss button')
        return
    page.click('#mockbar [data-action="legend"]')
    if wait_there(page, 'dialog.sheet[open]'):
        page.keyboard.press('Escape')
        wait_gone(page, 'dialog.sheet')
        if not is_active(page, '#mockbar [data-action="legend"]'):
            F('sheet-focus', f'after closing the legend the focus is on {act(page)["sig"]}, not back on the banner\'s "Легенда" button')
    else:
        F('legend', 'the banner\'s "Легенда" button opens nothing')
    page.focus('#mockbar [data-action="dismiss-banner"]')
    page.keyboard.press('Enter')
    page.wait_for_timeout(500)
    st = page.evaluate("() => { let ss = null; try { ss = sessionStorage.getItem('bns.banner'); } catch (e) { ss = 'err'; } return { hidden: document.getElementById('mockbar').hidden, ss, live: document.getElementById('live').textContent.trim(), ls: Object.keys(localStorage).filter(k => /banner/i.test(k)) }; }")
    if not st['hidden']:
        F('mockbar', 'the dismiss button does not hide the Mock banner')
    if st['ss'] != '1':
        F('mockbar', f'the dismissal is not kept in sessionStorage "bns.banner" (value {st["ss"]!r})')
    if st['ls']:
        F('mockbar', f'the banner dismissal must last only for the session, but localStorage has {st["ls"]}')
    if not st['live']:
        W('mockbar-live', 'dismissing the banner is not announced in the live region (#live)')
    a = act(page)
    if a['body']:
        F('banner-focus', 'after the banner is dismissed with the keyboard the focus is lost to the page (the dismiss button disappeared); move it to the main heading')
    page.reload(wait_until='domcontentloaded')
    w.ready(page)
    if not page.evaluate("() => document.getElementById('mockbar').hidden"):
        F('mockbar', 'the banner comes back after a reload in the same session (it must stay dismissed)')
    page.evaluate("() => { location.hash = '#/prihodi'; }")
    wait_for(page, "() => { const a = document.querySelector('#view article.page'); return !!a && a.dataset.route === 'S06' && a.dataset.ready === '1'; }", timeout=6000)
    if not page.evaluate("() => document.getElementById('mockbar').hidden"):
        F('mockbar', 'the banner comes back after navigating to another screen')


def ch_motion(w, cell, F, W, j, outs):
    o = begin(w, cell, with_query('#/', demo='loading'), outs, reduced_motion=True)
    if not o:
        return
    page = o.page
    page.wait_for_timeout(400)
    st = page.evaluate("""() => ({ rm: matchMedia('(prefers-reduced-motion: reduce)').matches, sb: getComputedStyle(document.documentElement).scrollBehavior,
        inf: document.getAnimations().filter(a => a.playState === 'running').map(a => { const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}; const tg = a.effect && a.effect.target;
          return { name: a.animationName || a.transitionProperty || '?', inf: t.iterations === Infinity, dur: typeof t.duration === 'number' ? t.duration : 0,
                   tgt: tg ? tg.localName + (typeof tg.className === 'string' && tg.className.trim() ? '.' + tg.className.trim().split(/\\s+/)[0] : '') : '?' }; }).filter(a => a.inf && a.dur > 50),
        skeleton: !!document.querySelector('#view [data-state="loading"]') })""")
    if not st['rm']:
        W('motion', 'the checker could not turn on prefers-reduced-motion (the check is void)')
        return
    if not st['skeleton']:
        W('motion', 'the loading state did not show, so no animation could be inspected')
    for a in st['inf'][:4]:
        F('motion', f'{a["tgt"]} runs an endless animation "{a["name"]}" ({a["dur"]:.0f} ms) although the visitor prefers reduced motion')
    if st['sb'] == 'smooth':
        F('motion', 'the page scrolls smoothly although the visitor prefers reduced motion (scroll-behavior: smooth)')


CHROME_STEPS = {'skip': (ch_skip, 'both'), 'focus': (ch_focus, 'both'), 'palette': (ch_palette, 'both'), 'popovers': (ch_popovers, 'wide'),
                'phone': (ch_phone, 'narrow'), 'mockbar': (ch_mockbar, 'both'), 'motion': (ch_motion, 'both')}


@job('chrome')
def job_chrome(w, j):
    cell, step, h = j['cell'], j['step'], j['hash']
    fs, outs = [], []
    F = lambda code, m: fs.append(fail(code, m, cell=cell, url=h))                  # noqa: E731
    W = lambda code, m: fs.append(warn(code, m, cell=cell, url=h))                  # noqa: E731
    try:
        CHROME_STEPS[step][0](w, cell, F, W, j, outs)
    finally:
        for o in outs:
            if not o.ok:
                fs.append(fail('timeout', o.why, cell=cell, url=h))
            fs += collect(o, '', cell, h)
    return fs, {}


@planner
def plan_chrome(args, d, routes, cells):
    if not wants(args, 'chrome'):
        return []
    arr = next((r for r in routes if isinstance(r['periods'], list) and r['samples']), None)
    jobs = []
    for c in cells:
        for step, (_, where) in CHROME_STEPS.items():
            if (where == 'wide' and not is_wide(c)) or (where == 'narrow' and is_wide(c)):
                continue
            jobs.append(dict(kind='chrome', step=step, route='', cell=c, hash='#/', tag=step, arr=(arr['samples'][0] if arr else '')))
    return jobs


# ============================================================================================ share: the „Сподели“ menu and the embed code
SHARE_LIST_JS = r"""async () => {
  const sh = await import('./js/share.js'), st = await import('./js/ui/status.js');
  const out = [];
  for (const [id, s] of sh.all()) {
    const el = document.getElementById(id);
    const btn = [...document.querySelectorAll('[data-share]')].find(b => b.dataset.share === id);
    let ce = null;
    if (s.chart !== false) ce = s.chart ? document.getElementById(s.chart) : (el ? [...el.querySelectorAll('.chart[data-ready="1"]')].find(c => c.offsetParent !== null) : null);
    const hasChart = !!(ce && window.echarts && window.echarts.getInstanceByDom(ce));
    const hasStat = !!(el && sh.statNodes && sh.statNodes(el).length);          // FB3: ui/png.js also draws rankings, KPI tiles, progress bars, maps and strips
    let csv = '', csvErr = '', text = '', link = '', embed = '', embedHash = '', textErr = '';
    try { csv = sh.csvFor(s); } catch (e) { csvErr = String(e); }
    try { text = sh.textFor(s); link = sh.linkFor(s); embed = sh.embedFor(s); embedHash = sh.embedHash(s); } catch (e) { textErr = String(e); }
    out.push({ id, route: s.route || '', title: s.title || '', source: [].concat(s.source || []).filter(Boolean), status: s.status || '', mock: sh.isMock(s),
      el: !!el, btn: !!btn, btnVisible: !!btn && btn.getClientRects().length > 0, hasChart, hasStat, report: s.report || '', csv: csv.slice(0, 80000), csvErr, text, link, embed, embedHash, textErr });
  }
  return { specs: out, orphans: [...new Set([...document.querySelectorAll('[data-share]')].map(b => b.dataset.share).filter(id => !sh.get(id)))],
           labels: Object.values(st.STATUS).map(x => x.label) };
}"""

SHARE_PNG_JS = r"""async (id) => {
  const sh = await import('./js/share.js');
  const s = sh.get(id);
  if (!s) return { err: 'no spec' };
  const px = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;          // exactly one readback per canvas (more make Chrome warn about willReadFrequently)
  const diff = (a, b, ca, cb) => { if (ca.width !== cb.width || ca.height !== cb.height) return -1; let n = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  try {
    const def = await sh.renderPng(s, { pixelRatio: 1 }), on = await sh.renderPng(s, { watermark: true, pixelRatio: 1 }), off = await sh.renderPng(s, { watermark: false, pixelRatio: 1 });
    const d = px(def), a = px(on), b = px(off), bg = [d[0], d[1], d[2]];
    let non = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) non++;
    return { mock: sh.isMock(s), w: def.width, h: def.height, non, tot: d.length / 4, dOn: diff(d, a, def, on), dOff: diff(d, b, def, off), dWm: diff(a, b, on, off) };
  } catch (e) { return { err: String(e && e.message || e) }; }
}"""

SHARE_MENU_JS = r"""(id) => {
  const m = document.querySelector('.share-menu'), b = [...document.querySelectorAll('[data-share]')].find(x => x.dataset.share === id);
  if (!m) return null;
  const host = m.closest('.popover, dialog.sheet') || m, r = host.getBoundingClientRect();
  const lab = host.getAttribute('aria-labelledby');
  const name = (host.getAttribute('aria-label') || (lab ? lab.split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ') : '')).trim();
  return { acts: [...m.querySelectorAll('[data-act]')].map(x => x.dataset.act), inside: host.contains(document.activeElement), exp: b ? b.getAttribute('aria-expanded') : null,
    name, modal: host.tagName === 'DIALOG', l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight,
    items: [...m.querySelectorAll('.share-item')].map(x => Math.round(x.getBoundingClientRect().height)), note: !!m.parentElement.querySelector('.share-note') };
}"""

# no finite animation or transition is still running (a bottom sheet slides in: its box is only final afterwards)
ANIM_IDLE_JS = r"""() => document.getAnimations().every(a => a.playState !== 'running' || (a.effect && a.effect.getComputedTiming().iterations === Infinity))"""

SHARE_BAD = re.compile(r'\b(NaN|undefined|Infinity)\b|\[object|(?<![\w-])null(?![\w-])')


def share_pure(s, labels, F, W):
    """What can be said about a registered spec without a browser click: the text, the link, the CSV and the embed code it would produce."""
    import csv
    import io
    sid = s['id']
    if not s['title'].strip():
        F('share-spec', f'block {sid} is registered for sharing without a title')
    if s['textErr']:
        F('share-spec', f'block {sid}: building the share text / link / embed code threw: {s["textErr"][:140]}')
        return
    lines = s['text'].split('\n')
    if lines[-1] != s['link']:
        F('share-text', f'{sid}: the copied text does not end with the link to the block')
    if not re.search(r'[?&]to=' + re.escape(sid) + r'(&|$)', s['link']) or '#/' not in s['link']:
        F('share-link', f'{sid}: the link {s["link"]} does not point at its screen with ?to={sid}')
    if s['title'] not in lines:
        F('share-text', f'{sid}: the copied text does not contain the block title "{s["title"][:50]}"')
    if s['mock'] and not lines[0].startswith('ПРИМЕРНИ ДАННИ'):
        F('share-mock', f'{sid} is a mock block, but its copied text does not start with the „ПРИМЕРНИ ДАННИ“ line')
    if not s['mock'] and any(x.startswith('ПРИМЕРНИ ДАННИ') for x in lines):
        F('share-mock', f'{sid} is not a mock block, but its copied text says „ПРИМЕРНИ ДАННИ“')
    if s['source']:
        if not any(x.startswith('Източник:') for x in lines):
            F('share-source', f'{sid}: the copied text has no „Източник:“ line although the block names sources {s["source"]}')
    else:
        W('share-source', f'{sid}: a block that can be shared names no source, so the copied text carries none')
    m = SHARE_BAD.search(s['text'])
    if m:
        F('share-text', f'{sid}: the copied text contains "{m.group(0)}"')
    if bool(s['embed']) != bool(s['embedHash']):
        F('share-embed', f'{sid}: embedFor() and embedHash() disagree (code: {bool(s["embed"])}, hash: {bool(s["embedHash"])})')
    if s['embed']:
        if not re.match(r'<iframe src="https?://[^"]+#/embed/[A-Za-z0-9_.-]+(\?[^"]*)?" title="[^"]+" width="\d+" height="\d+"', s['embed']):
            F('share-embed', f'{sid}: the embed code is not the expected iframe tag: {s["embed"][:160]}')
        if 'referrerpolicy="no-referrer"' not in s['embed'] or 'javascript:' in s['embed'].lower():
            F('share-embed', f'{sid}: the embed code lacks referrerpolicy="no-referrer" (or contains a javascript: URL)')
    if s['csvErr']:
        F('share-csv', f'{sid}: building the CSV threw: {s["csvErr"][:140]}')
    elif s['csv']:
        raw = s['csv']
        if not raw.startswith('\ufeff'):
            F('share-csv', f'{sid}: the CSV has no UTF-8 byte-order mark (Excel would show broken Cyrillic)')
        if re.search(r'(?<!\r)\n', re.sub(r'"(?:[^"]|"")*"', '""', raw)):
            F('share-csv', f'{sid}: the CSV uses bare LF line ends (expected CRLF)')
        rows = [r for r in csv.reader(io.StringIO(raw.lstrip('\ufeff')), delimiter=';') if r]
        hdr = rows[0]
        if any(re.search(r'[\r\n]', c) for r in rows for c in r):
            F('share-csv', f'{sid}: a CSV cell contains a line break (a cell must be one line: row-by-row tools break on it)')
        if hdr[-2:] != ['статус', 'източник']:
            F('share-csv', f'{sid}: the last two CSV columns are {hdr[-2:]}, expected „статус“ and „източник“')
        bad = [i for i, r in enumerate(rows) if len(r) != len(hdr)]
        if bad:
            F('share-csv', f'{sid}: CSV rows {bad[:5]} have another number of cells than the header ({len(hdr)})')
        body = [r for r in rows[1:] if len(r) == len(hdr)]
        if not body:
            W('share-csv', f'{sid}: the CSV has a header and no rows')
        sts = {r[-2] for r in body}
        if sts - set(labels):
            F('share-csv', f'{sid}: unknown status label(s) in the CSV: {sorted(sts - set(labels))}')
        if s['mock'] and 'Официални данни' in sts:
            F('share-mock', f'{sid} is a mock block, but its CSV labels rows „Официални данни“')
        if s['source'] and any(not r[-1].strip() for r in body):
            F('share-csv', f'{sid}: CSV rows without a source although the block names sources')
        dec = [c for r in body for c in r[:-2] if re.fullmatch(r'-?\d+\.\d+', c)]
        if dec:
            W('share-csv', f'{sid}: decimal point instead of a comma in cells such as {dec[:3]} (Excel with a Bulgarian locale reads them as text)')
        m = SHARE_BAD.search(raw)
        if m:
            F('share-csv', f'{sid}: the CSV contains "{m.group(0)}"')


def share_menu(page, sid, F):
    """Open the menu of block `sid` with a real click; returns the state of the open menu or None."""
    btn = page.locator(f'[data-share="{sid}"]:visible').first
    try:
        btn.click(timeout=5000)
    except Exception as e:                                                # noqa: BLE001
        F('share-click', f'{sid}: the „Сподели“ button cannot be clicked: {str(e).splitlines()[0][:140]}')
        return None
    if not wait_there(page, '.share-menu'):
        F('share-menu', f'{sid}: the „Сподели“ button opens no menu')
        return None
    try:
        page.wait_for_function(ANIM_IDLE_JS, timeout=3000)
    except Exception:                                                     # noqa: BLE001
        pass
    return page.evaluate(SHARE_MENU_JS, sid)


def expected_acts(s):
    acts = []                                                               # v5: the image and the link are the menu; the table file is an expert option
    if s['hasChart'] or s['csv'] or s.get('hasStat'):
        acts.append('png')
    acts.append('copy-link')
    if s['csv']:
        acts.append('csv')
    if s.get('report'):                                                     # FB4 point 8: «Намерих грешка» is the last item of the block menu
        acts.append('report')
    return acts


def menu_sane(info, s, cell, F, W):
    sid = s['id']
    got = [a for a in info['acts'] if a != 'share']
    if got != expected_acts(s):
        F('share-menu', f'{sid}: the menu offers {got}, expected {expected_acts(s)} (chart drawn: {s["hasChart"]}, table: {bool(s["csv"])}, statistic: {bool(s.get("hasStat"))}, embed: {bool(s["embed"])})')
    if not info['inside']:
        F('share-focus', f'{sid}: the keyboard focus is not inside the share menu after it opened')
    if not info['modal'] and info['exp'] != 'true':                         # a modal sheet makes the page behind inert: only a popover must keep its button's state in sync
        F('share-menu', f'{sid}: the share button says aria-expanded="{info["exp"]}" while its menu is open')
    if not info['name']:
        F('share-menu', f'{sid}: the share menu has no accessible name')
    if info['l'] < 0 or info['r'] > info['vw'] or info['b'] > info['vh'] + 1:
        F('share-menu', f'{sid}: the share menu leaves the viewport (box {info["l"]},{info["t"]} - {info["r"]},{info["b"]} in {info["vw"]}x{info["vh"]})')
    if info['modal'] != (not is_wide(cell)) and info['vw'] <= 600:
        F('share-menu', f'{sid}: at {info["vw"]}px the menu should be a bottom sheet (modal: {info["modal"]})')
    if CELLS[cell]['touch'] and any(h < 44 for h in info['items']):
        W('share-tap', f'{sid}: share menu items are only {min(info["items"])}px high on a touch screen (44px recommended)')
    if s['mock'] and not info['note']:
        W('share-mock', f'{sid}: the menu of a mock block does not say that what is shared says „примерни данни“')


def share_close(page, sid, F, how='Escape'):
    page.keyboard.press('Escape')
    if not wait_gone(page, '.share-menu'):
        F('share-menu', f'{sid}: Escape does not close the share menu')
        return
    if not is_active(page, f'[data-share="{sid}"]'):
        F('share-focus', f'{sid}: after Escape the focus is on {act(page)["sig"]}, not back on the share button')


def clip_read(page):
    return page.evaluate("async () => { try { return await navigator.clipboard.readText(); } catch (e) { return '\\u0000' + String(e); } }")


def toast_text(page):
    return page.evaluate("() => (document.getElementById('toasts') || {}).textContent || ''")


def download_via(page, sel):
    try:
        with page.expect_download(timeout=20000) as dl:
            page.click(sel)
        d = dl.value
        p = d.path()
        return d.suggested_filename, (Path(p).read_bytes() if p else b''), ''
    except Exception as e:                                                # noqa: BLE001
        return '', b'', str(e).splitlines()[0][:160]


def share_ui_copy(page, s, F, W):
    """copy text + copy link through the menu; what lands on the clipboard must be what the builders promise."""
    sid = s['id']
    for act_, want, toast_word in (('copy-link', s['link'], 'копирана'),):
        info = share_menu(page, sid, F)
        if not info:
            return
        page.click(f'.share-menu [data-act="{act_}"]')
        wait_gone(page, '.share-menu')
        page.wait_for_timeout(150)
        if present(page, 'dialog.sheet textarea.sheet-text'):
            F('share-copy', f'{sid}: {act_} fell back to the "copy by hand" sheet although the page may use the clipboard')
            page.keyboard.press('Escape')
            wait_gone(page, 'dialog.sheet')
            continue
        got = clip_read(page)
        if got.startswith('\x00'):
            W('share-copy', f'{sid}: the clipboard cannot be read back in this browser ({got[1:90]}); {act_} not verified')
        elif got != want:
            F('share-copy', f'{sid}: {act_} put "{got[:90]}" on the clipboard, expected "{want[:90]}"')
        tt = toast_text(page)
        if toast_word not in tt:
            F('share-toast', f'{sid}: after {act_} no confirmation is shown (toasts say "{tt[:80]}")')
        if not is_active(page, f'[data-share="{sid}"]'):
            W('share-focus', f'{sid}: after {act_} the focus is on {act(page)["sig"]}, not on the share button')


def share_ui_png(page, s, F, W):
    import struct
    sid = s['id']
    info = share_menu(page, sid, F)
    if not info:
        return
    name, data_, err = download_via(page, '.share-menu [data-act="png"]')
    if err:
        F('share-png', f'{sid}: „Изтегли PNG“ produced no download ({err}); toasts: "{toast_text(page)[:80]}"')
        return
    if not re.fullmatch(r'bns-[a-z0-9._-]+\.png', name):
        F('share-png', f'{sid}: the PNG file is called "{name}" (expected bns-<screen>-<block>.png)')
    if data_[:8] != b'\x89PNG\r\n\x1a\n':
        F('share-png', f'{sid}: the downloaded "{name}" is not a PNG file (first bytes {data_[:8]!r})')
        return
    w_, h_ = struct.unpack('>II', data_[16:24])
    if w_ < 300 or h_ < 120 or len(data_) < 3000:
        F('share-png', f'{sid}: the PNG is {w_}x{h_} px and {len(data_)} bytes: too small to hold a title, a chart and a source line')
    if 'Не успяхме' in toast_text(page):
        F('share-png', f'{sid}: the app reported that making the PNG failed')


def share_ui_csv(page, s, F, W):
    sid = s['id']
    info = share_menu(page, sid, F)
    if not info:
        return
    name, data_, err = download_via(page, '.share-menu [data-act="csv"]')
    if err:
        F('share-csv', f'{sid}: „Изтегли CSV“ produced no download ({err})')
        return
    if not re.fullmatch(r'bns-[a-z0-9._-]+\.csv', name):
        F('share-csv', f'{sid}: the CSV file is called "{name}" (expected bns-<screen>-<block>.csv)')
    try:
        txt = data_.decode('utf-8')
    except UnicodeDecodeError:
        F('share-csv', f'{sid}: the downloaded CSV is not valid UTF-8')
        return
    if len(s['csv']) < 80000 and txt != s['csv']:
        F('share-csv', f'{sid}: the downloaded CSV differs from csvFor(spec) ({len(txt)} against {len(s["csv"])} characters)')


def share_ui_embed(page, s, cell, F, W):
    sid = s['id']
    info = share_menu(page, sid, F)
    if not info:
        return
    page.click('.share-menu [data-act="embed"]')
    if not wait_there(page, 'dialog.sheet[open] textarea[data-embed-code]'):
        F('share-embed', f'{sid}: „Код за вграждане“ opens no dialog with the code')
        return
    st = page.evaluate("""() => { const d = document.querySelector('dialog.sheet[open]'), t = d.querySelector('textarea[data-embed-code]'), a = d.querySelector('a[href^="#/embed/"]');
        return { code: t.value, ro: t.readOnly, inside: d.contains(document.activeElement), link: a ? a.getAttribute('href') : null, copy: !!d.querySelector('[data-copy-embed]') }; }""")
    if st['code'] != s['embed']:
        F('share-embed', f'{sid}: the dialog shows another code than embedFor(spec)')
    if not st['ro']:
        W('share-embed', f'{sid}: the embed code field is editable (it should be read-only)')
    if not st['inside']:
        F('share-focus', f'{sid}: the focus is not inside the embed dialog')
    if not st['link'] or st['link'] != s['embedHash']:
        F('share-embed', f'{sid}: the "Виж вградения изглед" link ({st["link"]}) is not the embed hash ({s["embedHash"]})')
    if st['copy']:
        page.click('dialog.sheet[open] [data-copy-embed]')
        page.wait_for_timeout(200)
        got = clip_read(page)
        if not got.startswith('\x00') and got != s['embed']:
            F('share-copy', f'{sid}: „Копирай кода“ put "{got[:80]}" on the clipboard')
    else:
        F('share-embed', f'{sid}: the embed dialog has no „Копирай кода“ button')
    page.keyboard.press('Escape')
    if not wait_gone(page, 'dialog.sheet'):
        F('share-embed', f'{sid}: Escape does not close the embed dialog')
    elif not is_active(page, f'[data-share="{sid}"]'):
        F('share-focus', f'{sid}: after closing the embed dialog the focus is on {act(page)["sig"]}, not on the share button')


@job('share')
def job_share(w, j):
    cell, route, h = j['cell'], j['route'], j['hash']
    o = w.open(cell, h)
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
    page, fs = o.page, []
    F = lambda code, m: fs.append(fail(code, m, route=route, cell=cell, url=h))               # noqa: E731
    W = lambda code, m: fs.append(warn(code, m, route=route, cell=cell, url=h))               # noqa: E731
    L = page.evaluate(SHARE_LIST_JS)
    specs, labels = L['specs'], L['labels']
    for oid in L['orphans']:
        F('share-orphan', f'the „Сподели“ button of "{oid}" has no registered spec (a click only says „Този блок не може да се споделя“)')
    seen_png = seen_stat = 0
    for s in specs:
        share_pure(s, labels, F, W)
        if not s['el']:
            F('share-no-element', f'{s["id"]} is registered for sharing, but no element with that id is on the screen (its ?to= link would lead nowhere)')
        elif not s['btn']:
            W('share-no-button', f'{s["id"]} is registered for sharing, but has no „Сподели“ button on the screen')
        stat_only = bool(s.get('hasStat')) and not (s['hasChart'] or s['csv'])                  # FB3: a ranking / KPI / strip block is drawn by ui/png.js too
        if ((s['hasChart'] or s['csv']) and seen_png < 6) or (stat_only and seen_stat < 2):
            seen_png, seen_stat = seen_png + (0 if stat_only else 1), seen_stat + (1 if stat_only else 0)
            r = page.evaluate(SHARE_PNG_JS, s['id'])
            if r.get('err'):
                F('share-png', f'{s["id"]}: building the PNG failed: {r["err"][:140]}')
                continue
            if r['w'] < 300 or r['h'] < 120 or r['non'] / max(1, r['tot']) < 0.004:
                F('share-png', f'{s["id"]}: the PNG is {r["w"]}x{r["h"]} px with {r["non"]} non-background pixels - it is blank')
            if r['dWm'] < 200:
                F('share-png', f'{s["id"]}: drawing the watermark changes only {r["dWm"]} pixels (the „ПРИМЕРНИ ДАННИ“ tiles do not show)')
            if r['mock'] and r['dOn'] != 0:
                F('share-mock', f'{s["id"]} is a mock block, but its PNG carries no „ПРИМЕРНИ ДАННИ“ watermark ({r["dOn"]} pixels differ from the watermarked image)')
            if not r['mock'] and r['dOff'] != 0:
                F('share-mock', f'{s["id"]} is not a mock block, but its PNG carries the mock watermark ({r["dOff"]} pixels differ from the plain image)')
    clickable = [s for s in specs if s['btnVisible']]
    ui = 0
    if clickable:
        s0 = clickable[0]
        info = share_menu(page, s0['id'], F)
        if info:
            ui += 1
            menu_sane(info, s0, cell, F, W)
            share_close(page, s0['id'], F)
        share_ui_copy(page, s0, F, W)
        ui += 1
        for key, fn in (('png', lambda s: share_ui_png(page, s, F, W)), ('csv', lambda s: share_ui_csv(page, s, F, W))):
            pick = next((s for s in clickable if (key in expected_acts(s))), None)
            if pick:
                fn(pick)
                ui += 1
                if pick is not s0:
                    pass
    fs += collect(o, route, cell, h)
    return fs, {'share': len(specs), 'ui': ui, 'png': seen_png, 'embedSpecs': sum(1 for s in specs if s['embed'])}


@planner
def plan_share(args, d, routes, cells):
    if not wants(args, 'share'):
        return []
    return [dict(kind='share', route=r['id'], cell=pick_cell(cells, k), hash=r['samples'][0]) for k, r in enumerate(routes) if not r.get('bare') and r['id'] != 'S30' and r['samples']]


# ============================================================================================ embed: the iframe code, run for real
EMBED_STATE_JS = r"""() => {
  const q = s => document.querySelector(s), art = q('article.page');
  const ch = q('.s29-embed .chart'), inst = ch && window.echarts && window.echarts.getInstanceByDom(ch), r = ch ? ch.getBoundingClientRect() : { width: 0, height: 0 };
  const foot = q('.s29-foot'), fr = foot ? foot.getBoundingClientRect() : null, brand = q('.s29-brand'), root = document.documentElement, src = q('.s29-src');
  return { route: art ? art.dataset.route : null, bare: document.body.classList.contains('bare'), chart: !!ch, ready: !!ch && ch.dataset.ready === '1', inst: !!inst,
    cw: Math.round(r.width), chh: Math.round(r.height), sw: root.scrollWidth, sh: root.scrollHeight, vw: innerWidth, vh: innerHeight, footBottom: fr ? Math.round(fr.bottom) : 0,
    src: src ? src.textContent.trim() : '', wm: !!q('.s29-wm'), brandHref: brand ? brand.getAttribute('href') : null, brandTarget: brand ? brand.getAttribute('target') : null,
    brandRel: brand ? brand.getAttribute('rel') : null, h1: document.querySelectorAll('h1').length, chrome: ['#topbar', '#sidenav', '#tabbar', '#footer', '#mockbar'].filter(s => { const e = q(s); return e && !e.hidden && getComputedStyle(e).display !== 'none'; }),
    ext: [...document.querySelectorAll('a[href^="http"]')].filter(a => a.target !== '_blank').map(a => a.getAttribute('href')).slice(0, 3),
    text: (q('#view') || document.body).innerText.slice(0, 800), title: document.title };
}"""


def embed_one(page, s, cell, route, h, fs):
    F = lambda code, m: fs.append(fail(code, m, route=route, cell=cell, url=s['embedHash']))          # noqa: E731
    W = lambda code, m: fs.append(warn(code, m, route=route, cell=cell, url=s['embedHash']))          # noqa: E731
    page.evaluate("(code) => { const d = document.createElement('div'); d.id = 'cm-frame-host'; d.innerHTML = code; document.body.appendChild(d); }", s['embed'])
    try:
        el = page.query_selector('#cm-frame-host iframe')
        if not el:
            F('embed-frame', f'{s["id"]}: the embed code does not produce an <iframe>')
            return
        el.scroll_into_view_if_needed()                                   # loading="lazy" frames start when they come near the viewport
        fr = el.content_frame()
        if not fr:
            F('embed-frame', f'{s["id"]}: the iframe has no content frame')
            return
        try:
            fr.wait_for_selector('article.page[data-ready="1"]', state='attached', timeout=12000)
            fr.wait_for_function(SETTLE_JS, timeout=8000)
        except Exception as e:                                           # noqa: BLE001
            F('embed-frame', f'{s["id"]}: the embedded screen never became ready ({str(e).splitlines()[0][:120]})')
            return
        st = fr.evaluate(EMBED_STATE_JS)
        box = el.bounding_box() or {}
        if st['route'] != 'S29' or not st['bare']:
            F('embed-frame', f'{s["id"]}: the frame shows route {st["route"]} (bare: {st["bare"]}), expected the bare embed view S29: "{st["text"][:100]}"')
            return
        if not st['chart'] or not st['ready'] or not st['inst']:
            F('embed-chart', f'{s["id"]}: the frame shows no drawn chart (chart: {st["chart"]}, ready: {st["ready"]}, ECharts: {st["inst"]}): "{st["text"][:120]}"')
        elif st['cw'] < 200 or st['chh'] < 120:                              # S29 gives a chart at least 140 px; anything lower means the layout broke
            F('embed-chart', f'{s["id"]}: the embedded chart is only {st["cw"]}x{st["chh"]} px in a {st["vw"]}x{st["vh"]} frame')
        if st['sw'] > st['vw'] + 1:
            F('embed-scroll', f'{s["id"]}: the frame scrolls sideways (scrollWidth {st["sw"]} in {st["vw"]}px)')
        if st['footBottom'] > st['vh'] + 1 or st['sh'] > st['vh'] + 4:
            F('embed-clipped', f'{s["id"]}: the source line does not fit the {st["vw"]}x{st["vh"]} frame (content {st["sh"]}px high, footer ends at {st["footBottom"]}px)')
        if st['chrome']:
            F('embed-chrome', f'{s["id"]}: the embed view shows site chrome ({st["chrome"]})')
        if s['source'] and not st['src'].startswith('Източник:'):
            F('embed-source', f'{s["id"]}: the embedded chart shows no „Източник:“ line (found "{st["src"][:60]}")')
        if not st['brandHref'] or not st['brandHref'].startswith('http') or st['brandTarget'] != '_blank' or 'noopener' not in (st['brandRel'] or ''):
            F('embed-link', f'{s["id"]}: the „Бюджет на светло“ link must be absolute and open a new tab with rel=noopener (href {st["brandHref"]}, target {st["brandTarget"]}, rel {st["brandRel"]})')
        if st['ext']:
            F('embed-link', f'{s["id"]}: links inside the frame that would navigate the frame itself: {st["ext"]}')
        if st['h1'] != 1:
            F('embed-heading', f'{s["id"]}: the embed view has {st["h1"]} <h1> elements')
        if s['mock'] and not st['wm']:
            F('embed-mock', f'{s["id"]} is a mock block, but its embedded chart has no „Примерни данни“ watermark')
        if not s['mock'] and st['wm']:
            W('embed-mock', f'{s["id"]} is not a mock block, but its embedded chart carries the mock watermark')
        m = SHARE_BAD.search(st['text'])
        if m:
            F('embed-text', f'{s["id"]}: the embedded view contains "{m.group(0)}"')
        if box and box.get('width', 0) > CELLS[cell]['w'] + 1:
            F('embed-scroll', f'{s["id"]}: the iframe is {box["width"]:.0f}px wide in a {CELLS[cell]["w"]}px page (max-width:100% in the code is not working)')
    finally:
        page.evaluate("() => { const d = document.getElementById('cm-frame-host'); if (d) d.remove(); }")


@job('embed')
def job_embed(w, j):
    cell, route, h = j['cell'], j['route'], j['hash']
    o = w.open(cell, h)
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
    page, fs = o.page, []
    L = page.evaluate(SHARE_LIST_JS)
    emb = [s for s in L['specs'] if s['embed']][:3]
    for s in emb:
        embed_one(page, s, cell, route, h, fs)
    fs += collect(o, route, cell, h)
    return fs, {'embed': len(emb)}


@planner
def plan_embed(args, d, routes, cells):
    if not wants(args, 'embed'):
        return []
    return [dict(kind='embed', route=r['id'], cell=pick_cell(cells, k + 1), hash=r['samples'][0]) for k, r in enumerate(routes) if not r.get('bare') and r['id'] != 'S30' and r['samples']]


# ============================================================================================ gloss: term links, the term popover, the scanner
# Three kinds of job. `gloss` (one per screen): the term links of that screen open a popover (phones: a bottom sheet), Escape closes it and gives the focus
# back, related terms swap the content in place, "Пълно обяснение" navigates, a second click on the word closes. `gloss-terms` (wide + phone): every term of
# data/glossary.json opens a popover that shows exactly the data. `gloss-scan`: the scanner's rules (PLAN 6.3) on a fixture, so they hold whatever the pages say.
GL_POP_SEL = {'wide': '.popover[role="dialog"]#gl-pop', 'narrow': 'dialog.sheet#gl-pop[open]'}

GLOSS_PAGE_JS = r"""async () => {
  const gl = await import('./js/glossary.js');
  let g = null;
  try { g = await gl.ready(); } catch (e) { g = null; }
  const art = document.querySelector('#view article.page');
  if (!art) return { none: true };
  const hosts = art.querySelectorAll('[data-gl-scan]').length;
  if (hosts) await gl.scan(art);                       // idempotent: the router has run it already; this only makes sure it is done
  const vis = e => { const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden], details:not([open])'); };
  const links = [...art.querySelectorAll('a[data-gl]')];
  const BOX = 'p, li, dd, blockquote, figcaption', per = new Map(), seen = new Map(), nested = [], placed = [], cand = [], unknown = [], took = new Set();
  links.forEach((a, i) => {
    const s = a.dataset.gl, b = a.closest(BOX) || a.parentElement;
    seen.set(s, (seen.get(s) || 0) + 1);
    per.set(b, (per.get(b) || 0) + 1);
    const inner = a.parentElement && a.parentElement.closest('a, button, summary');
    if (inner) nested.push(s);
    else if (a.closest('h1, h2, h3, h4, h5, h6, table')) placed.push(s);
    const t = g && g.by.get(s);
    if (g && !t) unknown.push(s);
    if (!inner && t && !took.has(s) && vis(a)) { took.add(s); cand.push({ i, s, rel: (t.related || []).filter(r => g.by.has(r.slug)).length }); }
  });
  return { hosts, n: links.length, ok: !!g, dup: [...seen].filter(([, c]) => c > 1).map(([s, c]) => s + ' x' + c), unknown: [...new Set(unknown)],
    dense: [...per].filter(([, c]) => c > 3).length, nested, placed, cand: cand.slice(0, 40) };
}"""
GL_TERM_JS = r"""async (slug) => {
  const gl = await import('./js/glossary.js'), g = await gl.ready(), t = g.by.get(slug);
  if (!t) return null;
  const rel = (t.related || []).map(r => g.by.get(r.slug)).filter(Boolean);
  return { slug, title: gl.titleOf(t), def: t.def || '', example: t.example || '', rel: rel.map(r => ({ slug: r.slug, title: gl.titleOf(r) })) };
}"""
GL_STATE_JS = r"""([sel, mark]) => {
  const p = document.querySelector(sel), a = mark ? document.querySelector('[data-chk-gl="' + mark + '"]') : null;
  if (!p) return null;
  const r = p.getBoundingClientRect(), box = p.querySelector('.gl-pop'), def = p.querySelector('.gl-def'), ttl = p.querySelector('.pop-head strong, .sheet-title');
  const desc = p.getAttribute('aria-describedby'), ae = document.activeElement, lb = p.getAttribute('aria-labelledby');
  const full = p.querySelector('a.gl-full');
  return { tag: p.tagName.toLowerCase(), role: p.getAttribute('role') || '',
    name: p.getAttribute('aria-label') || (lb && document.getElementById(lb) ? document.getElementById(lb).textContent : ''),
    title: ttl ? ttl.textContent : '', def: def ? def.textContent : '', desc: desc || '', descOk: desc ? !!document.getElementById(desc) : false,
    exp: a ? a.getAttribute('aria-expanded') : null, inside: p.contains(ae), onBox: ae === box, full: full ? full.getAttribute('href') : null,
    rel: [...p.querySelectorAll('a[data-gl-rel]')].map(x => x.dataset.glRel), back: !!p.querySelector('[data-gl-back]'),
    l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight,
    modal: document.documentElement.classList.contains('has-modal'), open: p.tagName === 'DIALOG' ? p.open : null, hash: location.hash, sx: p.scrollWidth - p.clientWidth };
}"""
GL_TITLE_IS_JS = r"""([sel, t]) => { const p = document.querySelector(sel), x = p && p.querySelector('.pop-head strong, .sheet-title'); return !!x && x.textContent.replace(/\s+/g, ' ').trim() === t; }"""


def _norm(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def click_try(page, sel, F, code, msg, timeout=2500):
    """A click that can fail (covered, hidden, detached) is a finding, not a 30-second wait."""
    try:
        page.click(sel, timeout=timeout)
        return True
    except Exception as e:                                               # noqa: BLE001
        F(code, f'{msg} ({str(e).strip().splitlines()[0][:110]})')
        return False


def gloss_verify(st, term, hash0, phone, F, W, who):
    if _norm(st['title']) != _norm(term['title']):
        F('gloss-title', f'{who}: the popover is titled "{_norm(st["title"])}", the glossary says "{term["title"]}"')
    if _norm(st['def']) != _norm(term['def']):
        F('gloss-def', f'{who}: the definition in the popover differs from data/glossary.json ("{_norm(st["def"])[:70]}...")')
    if not _norm(st['name']):
        F('gloss-name', f'{who}: the popover has no accessible name (aria-label / aria-labelledby)')
    if phone:
        if st['tag'] != 'dialog' or not st['open']:
            F('gloss-sheet', f'{who}: on a phone a term opens in a modal bottom sheet (<dialog open>), got <{st["tag"]}>')
        if not st['modal']:
            F('gloss-sheet', f'{who}: html.has-modal is not set while the term sheet is open')
        if st['r'] > st['vw'] + 1 or st['l'] < -1:
            F('gloss-box', f'{who}: the term sheet is wider than the screen (box {st["l"]} - {st["r"]} in {st["vw"]}px)')
    else:
        if st['role'] != 'dialog':
            F('gloss-name', f'{who}: the popover has role="{st["role"]}", expected dialog')
        if st['exp'] != 'true':
            F('gloss-aria', f'{who}: the word has aria-expanded="{st["exp"]}" while its popover is open')
        if not (st['desc'] and st['descOk']):
            W('gloss-aria', f'{who}: the popover is not described by its definition (no aria-describedby, or it points to nothing)')
        if st['l'] < 0 or st['r'] > st['vw'] or st['t'] < 0 or st['b'] > st['vh'] + 1:
            F('gloss-box', f'{who}: the popover leaves the viewport (box {st["l"]},{st["t"]} - {st["r"]},{st["b"]} in {st["vw"]}x{st["vh"]})')
    if not st['inside']:
        F('gloss-focus', f'{who}: the keyboard focus is not inside the popover after it opened')
    elif not st['onBox']:
        W('gloss-focus', f'{who}: the focus is on a control, not on the popover itself (the definition is not read out first)')
    if st['full'] != f'#/rechnik/{term["slug"]}':
        F('gloss-full', f'{who}: the "Пълно обяснение" link goes to {st["full"]!r}, expected #/rechnik/{term["slug"]}')
    want = [r['slug'] for r in term['rel']]
    if st['rel'] != want:
        F('gloss-rel', f'{who}: the related terms in the popover {st["rel"]} differ from the data {want}')
    if st['hash'] != hash0:
        F('gloss-nav', f'{who}: the address changed to {st["hash"]} while the popover opened')
    if st['sx'] > 1:
        W('gloss-box', f'{who}: the popover scrolls sideways ({st["sx"]}px of overflow)')


def gloss_one(page, cell, mark, term, flows, F, W):
    phone = CELLS[cell]['w'] <= 600
    sel = GL_POP_SEL['narrow' if phone else 'wide']
    anchor = f'[data-chk-gl="{mark}"]'
    slug = term['slug']
    who = f'the term link "{slug}"'
    hash0 = page.evaluate('() => location.hash')

    def open_it():
        if not click_try(page, anchor, F, 'gloss-open', f'{who} cannot be clicked'):
            return None
        if not wait_there(page, sel):
            now = page.evaluate('() => location.hash')
            F('gloss-open', f'{who}: the click ' + (f'goes to {now} instead of opening' if now != hash0 else 'does not open') + ' the term popover although the glossary data is loaded')
            return None
        return page.evaluate(GL_STATE_JS, [sel, mark])

    def close_esc(label='Escape'):
        page.keyboard.press('Escape')
        if not wait_gone(page, '#gl-pop'):
            F('gloss-close', f'{who}: {label} does not close the popover')
            return False
        if not is_active(page, anchor):
            F('gloss-focus', f'{who}: after {label} the focus is on {act(page)["sig"]}, not back on the word')
        if not phone and page.evaluate("(a) => (document.querySelector(a) || { getAttribute: () => 'gone' }).getAttribute('aria-expanded')", anchor) != 'false':
            F('gloss-aria', f'{who}: the word keeps aria-expanded="true" after the popover closed')
        if page.evaluate("() => document.documentElement.classList.contains('has-modal')"):
            F('gloss-modal', f'{who}: html.has-modal is still set after the popover closed (the page stays locked)')
        if page.evaluate('() => location.hash') != hash0:
            F('gloss-nav', f'{who}: {label} changed the address')
        return True

    try:
        st = open_it()
        if not st:
            return
        gloss_verify(st, term, hash0, phone, F, W, who)
        if not close_esc():
            return
        if 'second' in flows and not phone and open_it():                    # on a phone the sheet is modal: the word cannot be clicked
            if click_try(page, anchor, F, 'gloss-toggle', f'{who}: the word cannot be clicked again while its popover is open (does the popover cover it?)'):
                if not wait_gone(page, '#gl-pop'):
                    F('gloss-toggle', f'{who}: a second click on the same word does not close its popover')
            if present(page, '#gl-pop'):
                page.keyboard.press('Escape')
                wait_gone(page, '#gl-pop')
        if 'swap' in flows and term['rel'] and open_it():
            r0 = term['rel'][0]
            if click_try(page, f'{sel} a[data-gl-rel="{r0["slug"]}"]', F, 'gloss-rel', f'{who}: the related term "{r0["slug"]}" cannot be clicked'):
                if not wait_for(page, GL_TITLE_IS_JS, [sel, _norm(r0['title'])]):
                    F('gloss-rel', f'{who}: clicking the related term "{r0["slug"]}" does not swap the popover to it')
                else:
                    s2 = page.evaluate(GL_STATE_JS, [sel, mark]) or {}
                    if s2.get('hash') != hash0:
                        F('gloss-nav', f'{who}: a related term in the popover changed the address to {s2.get("hash")} (it swaps the content in place)')
                    if not s2.get('back'):
                        F('gloss-back', f'{who}: after following a related term the popover has no "back" button')
                    if not s2.get('inside'):
                        F('gloss-focus', f'{who}: after following a related term the focus left the popover')
                    if not phone and s2.get('exp') != 'true':
                        F('gloss-aria', f'{who}: after following a related term the word has aria-expanded="{s2.get("exp")}"')
                    if s2.get('back') and click_try(page, f'{sel} [data-gl-back]', F, 'gloss-back', f'{who}: the "back" button cannot be clicked'):
                        if not wait_for(page, GL_TITLE_IS_JS, [sel, _norm(term['title'])]):
                            F('gloss-back', f'{who}: the "back" button does not return to "{term["title"]}"')
                        elif (page.evaluate(GL_STATE_JS, [sel, mark]) or {}).get('back'):
                            F('gloss-back', f'{who}: the first term still shows a "back" button')
            close_esc('Escape after a related term')                             # the focus belongs to the word the visitor started from
        if 'key' in flows:
            page.focus(anchor)
            page.keyboard.press('Enter')
            if not wait_there(page, sel):
                F('gloss-key', f'{who}: Enter on the focused word does not open the popover')
            elif phone:
                for _ in range(8):                                           # a native modal dialog hands the focus to the browser (body) after its last control, never to the page behind
                    page.keyboard.press('Tab')
                    a = act(page)
                    if not a['body'] and not is_active(page, f'{sel} *'):
                        F('gloss-key', f'{who}: Tab moves the focus out of the open term sheet to the page behind it ({a["sig"]}); a modal sheet keeps it inside')
                        break
                close_esc()
            else:
                gone = False
                for _ in range(16):
                    page.keyboard.press('Tab')
                    if not present(page, '#gl-pop'):
                        gone = True
                        break
                if not gone:
                    F('gloss-key', f'{who}: Tab never leaves the popover (16 presses): a keyboard trap')
                    page.keyboard.press('Escape')
                    wait_gone(page, '#gl-pop')
                elif act(page)['body']:
                    F('gloss-focus', f'{who}: the focus is lost (document body) after Tab left the popover')
        if 'full' in flows and open_it():
            if click_try(page, f'{sel} a.gl-full', F, 'gloss-full', f'{who}: the link to the full entry cannot be clicked'):
                if not wait_for(page, "(s) => location.hash.split('?')[0] === '#/rechnik/' + s", slug, timeout=4000):
                    F('gloss-full', f'{who}: "Пълно обяснение в речника" does not go to #/rechnik/{slug} (the address is {page.evaluate("() => location.hash")})')
                else:
                    if not wait_gone(page, '#gl-pop'):
                        F('gloss-close', f'{who}: the popover stays open after the link to the full entry was followed')
                    if not wait_for(page, "() => { const a = document.querySelector('#view article.page'); return !!a && a.dataset.route === 'S03' && a.dataset.ready === '1'; }", timeout=6000):
                        F('gloss-full', f'{who}: the link to the full entry does not lead to the glossary screen (S03)')
                    elif not wait_for(page, "() => document.activeElement === document.querySelector('#view h1')", timeout=1500):
                        W('gloss-full', f'{who}: after the link to the full entry the focus is on {act(page)["sig"]}, not on the new screen\'s h1')
    except Exception as e:                                                   # noqa: BLE001 - a stuck control is a finding, not a crash of the check
        F('gloss-flow', f'{who}: the check stopped: {str(e).strip().splitlines()[0][:160]}')


@job('gloss')
def job_gloss(w, j):
    cell, route, h = j['cell'], j['route'], j['hash']
    o = w.open(cell, h)
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
    page, fs = o.page, []
    F = lambda code, m: fs.append(fail(code, m, route=route, cell=cell, url=h))                  # noqa: E731
    W = lambda code, m: fs.append(warn(code, m, route=route, cell=cell, url=h))                  # noqa: E731
    info = page.evaluate(GLOSS_PAGE_JS)
    tried = 0
    if not info.get('none'):
        if info['hosts'] and not info['n']:
            W('gloss-none', 'the screen opts in to term links (data-gl-scan) but not a single term got linked')
        if info['nested']:
            F('gloss-nested', f'term link(s) inside another link, button or summary (interactive content must not nest): {", ".join(info["nested"][:5])}')
        if info['placed']:
            W('gloss-place', f'term link(s) inside a heading or a table (PLAN 6.3 keeps them out of both): {", ".join(info["placed"][:5])}')
        if info['dup']:
            W('gloss-repeat', f'a term is linked more than once on the screen (only its first mention is): {", ".join(info["dup"][:5])}')
        if info['dense']:
            W('gloss-dense', f'{info["dense"]} paragraph(s) with more than 3 term links (PLAN 6.3: at most 3)')
        if info['unknown']:
            F('gloss-unknown', f'term link(s) to a slug that is not in data/glossary.json: {", ".join(info["unknown"][:5])} (the click can only navigate to a missing entry)')
        cands = info['cand']
        rich = next((c for c in cands if c['rel']), cands[0] if cands else None)         # the full flow needs a term with related terms (swap / back)
        order = [c for c in cands if c is not rich][:5] + ([rich] if rich else [])        # the rich flow goes last: its last step leaves the screen
        for k, c in enumerate(order):
            term = page.evaluate(GL_TERM_JS, c['s'])
            if not term:
                continue
            mark = f'c{k}'
            page.evaluate("([i, m]) => { const a = [...document.querySelectorAll('#view article.page a[data-gl]')][i]; if (a) { a.setAttribute('data-chk-gl', m); a.scrollIntoView({ block: 'center' }); } }", [c['i'], mark])
            last = k == len(order) - 1
            gloss_one(page, cell, mark, term, ({'second', 'key', 'swap', 'full'} if term['rel'] else {'second', 'key', 'full'}) if last else set(), F, W)
            tried += 1
    fs += collect(o, route, cell, h)
    return fs, {'gloss': tried, 'glossLinks': info.get('n', 0)}


GLOSS_TERMS_JS = r"""async (phone) => {
  const gl = await import('./js/glossary.js'), routes = await import('./js/routes.js');
  const g = await gl.ready();
  const resolves = h => { const p = String(h).split('?')[0].replace(/^#\/?/, '').split('/').filter(Boolean); try { return !!routes.match(p.map(decodeURIComponent)); } catch { return false; } };
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const sel = phone ? 'dialog.sheet#gl-pop[open]' : '.popover[role="dialog"]#gl-pop';
  const tick = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (fn, ms = 900) => { const t0 = performance.now(); for (;;) { const v = fn(); if (v || performance.now() - t0 > ms) return v; await tick(16); } };
  const host = document.createElement('p');
  host.style.cssText = 'position:fixed;left:16px;top:150px;margin:0;z-index:1';
  const a = document.createElement('a');
  a.className = 'gl'; a.setAttribute('aria-haspopup', 'dialog'); a.textContent = 'термин';
  host.appendChild(a);
  document.body.appendChild(host);
  const bad = [];
  const add = (slug, m) => bad.push(slug + ': ' + m);
  for (const t of g.terms) {
    a.dataset.gl = t.slug; a.href = '#/rechnik/' + t.slug;
    a.click();
    const p = await wait(() => document.querySelector(sel));
    if (!p) { add(t.slug, 'the click opens no popover'); continue; }
    const def = p.querySelector('.gl-def'), ttl = p.querySelector('.pop-head strong, .sheet-title');
    if (!ttl || norm(ttl.textContent) !== norm(gl.titleOf(t))) add(t.slug, 'the popover title is "' + norm(ttl && ttl.textContent) + '", expected "' + norm(gl.titleOf(t)) + '"');
    if (!def || !norm(def.textContent)) add(t.slug, 'no definition in the popover');
    else if (norm(def.textContent) !== norm(t.def)) add(t.slug, 'the definition differs from the data');
    const ex = p.querySelector('.gl-ex p');
    if (t.example && (!ex || norm(ex.textContent) !== norm(t.example))) add(t.slug, 'the example is missing or differs from the data');
    if (!t.example && p.querySelector('.gl-ex')) add(t.slug, 'an "Пример" box without an example in the data');
    const miss = (t.related || []).filter(r => !g.by.has(r.slug)).map(r => r.slug);
    if (miss.length) add(t.slug, 'related terms that are not in the glossary: ' + miss.join(', '));
    const rel = [...p.querySelectorAll('a[data-gl-rel]')].map(x => x.dataset.glRel), want = (t.related || []).filter(r => g.by.has(r.slug)).map(r => r.slug);
    if (rel.join() !== want.join()) add(t.slug, 'related terms ' + rel.join(',') + ' differ from the data ' + want.join(','));
    for (const l of p.querySelectorAll('a.gl-see, a.gl-full, a[data-gl-rel]')) if (!resolves(l.getAttribute('href'))) add(t.slug, 'link to no screen: ' + l.getAttribute('href'));
    const full = p.querySelector('a.gl-full');
    if (!full || full.getAttribute('href') !== '#/rechnik/' + t.slug) add(t.slug, 'the full-entry link is missing or wrong');
    const r = p.getBoundingClientRect();
    if (!phone && (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight + 1)) add(t.slug, 'the popover leaves the viewport (' + Math.round(r.left) + ',' + Math.round(r.top) + ' - ' + Math.round(r.right) + ',' + Math.round(r.bottom) + ')');
    if (phone && r.right > innerWidth + 1) add(t.slug, 'the sheet is wider than the screen');
    if (p.scrollWidth - p.clientWidth > 1) add(t.slug, 'the popover scrolls sideways');
    const body = p.querySelector('.pop-body, .sheet-body');
    if (body && body.scrollWidth - body.clientWidth > 1) add(t.slug, 'the popover body scrolls sideways');
    if (phone) { const x = p.querySelector('[data-close]'); if (x) x.click(); } else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    if (!await wait(() => !document.getElementById('gl-pop'))) { add(t.slug, 'the popover does not close'); break; }
  }
  host.remove();
  return { n: g.terms.length, bad };
}"""


@job('gloss-terms')
def job_gloss_terms(w, j):
    cell, h = j['cell'], j['hash']
    o = w.open(cell, h)
    if not o.ok:
        return collect(o, '', cell, h) + [fail('timeout', o.why, cell=cell, url=h)], {}
    r = o.page.evaluate(GLOSS_TERMS_JS, CELLS[cell]['w'] <= 600)
    fs = [fail('gloss-term', m, cell=cell, url=h) for m in r['bad'][:30]]
    if len(r['bad']) > 30:
        fs.append(fail('gloss-term', f'... and {len(r["bad"]) - 30} more problems in the term popovers', cell=cell, url=h))
    if r['n'] < 50:
        fs.append(warn('gloss-terms', f'data/glossary.json has {r["n"]} terms (the plan has 64)', cell=cell, url=h))
    fs += collect(o, '', cell, h)
    return fs, {'glossTerms': r['n']}


GLOSS_SCAN_JS = r"""async () => {
  const gl = await import('./js/glossary.js');
  const bad = [];
  const add = m => bad.push(m);
  const fx = document.createElement('article');
  fx.className = 'page';
  fx.innerHTML = `<div data-gl-scan>
    <h2 id="f-h">Дефицит и ДДС в заглавие</h2>
    <details><summary id="f-s">Какво е лихва?</summary><p id="f-hid">Рефинансиране е нов заем срещу стар. Лихвата е цената на парите.</p></details>
    <p id="f-1">Дефицитът е разликата между приходи и разходи. Дефицит отново. Лихвите и инфлацията растат.</p>
    <p id="f-2">ДДС се плаща при покупка. Акцизът е друг данък, субсидията е помощ, а трансферът е пренос.</p>
    <p id="f-3">Дефицитът достигна 5,7% от БВП, а не друго.</p>
    <table><tbody><tr><td id="f-t">Главница и рефинансиране</td></tr></tbody></table>
    <p id="f-4"><button type="button">Главница</button> <a href="#/x">Главницата</a> <code>Главницата</code> <span class="sr-only">Главницата</span></p>
    <p id="f-5"><a class="gl" data-chk-hand="1" data-gl="inflatsiya" href="#/rechnik/inflatsiya" aria-haspopup="dialog">инфлация</a> и още инфлация.</p>
    <ul><li id="f-6">Рефинансирането е нов заем срещу стар.</li></ul>
    <p id="f-7">Трансферите към общините и главницата са пример.</p>
    <p id="f-8">Общината има дълг към банката.</p>
    <p id="f-9">Над 70 млн. евро дълг е много.</p>
    <p id="f-10">Държавният дълг расте.</p>
  </div><p id="f-out">Главницата извън контейнера.</p>`;
  const text0 = fx.textContent;
  const n1 = await gl.scan(fx);
  const all = [...fx.querySelectorAll('a[data-gl]')];
  const inP = id => [...fx.querySelectorAll('#' + id + ' a[data-gl]')].map(a => a.dataset.gl);
  const eq = (id, want, why) => { const got = inP(id).sort().join(','), w = want.slice().sort().join(','); if (got !== w) add('#' + id + ' (' + why + '): linked [' + got + '], expected [' + w + ']'); };
  if (fx.textContent !== text0) add('the scanner changed the text of the screen (before ' + text0.length + ' characters, after ' + fx.textContent.length + ')');
  const made = all.filter(a => !a.hasAttribute('data-chk-hand')).length;
  if (n1 !== made) add('scan() returned ' + n1 + ' but it created ' + made + ' link(s) (one more is hand-made)');
  eq('f-h', [], 'a heading is never linked');
  eq('f-s', [], 'a summary is never linked');
  eq('f-1', ['byudzheten-defitsit', 'lihva'], 'first mention only; inflation is linked by hand further down');
  eq('f-2', ['dds', 'aktsiz', 'subsidiya'], 'at most 3 per paragraph, the 3 earliest; the fourth term (transfer) waits');
  eq('f-3', [], 'a repeated term, and a number before „от БВП“, are not linked');
  eq('f-t', [], 'a table is never linked');
  eq('f-4', [], 'a button, a link, code and sr-only text are never linked');
  eq('f-5', ['inflatsiya'], 'a hand-made link counts as done');
  eq('f-6', ['refinansirane'], 'the visible mention is linked before the one in folded text');
  eq('f-hid', [], 'folded text waits for the visible mention');
  eq('f-7', ['byudzheten-transfer', 'glavnitsa'], 'the term left over by the 3-per-paragraph limit gets its next mention; a table, a button, a link and code did not use up the principal');
  eq('f-8', [], 'a bare „дълг“ in a sentence about a municipality is not state debt');
  eq('f-9', [], 'a number before the word makes it a quantity, not a lesson');
  eq('f-10', ['darzhaven-dalg'], 'a „държавен дълг“ is linked');
  eq('f-out', [], 'text outside [data-gl-scan] is never linked');
  const slugs = all.map(a => a.dataset.gl);
  const dups = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dups.length) add('the same term is linked twice on one screen: ' + [...new Set(dups)].join(', '));
  for (const a of all) {
    if (a.getAttribute('href') !== '#/rechnik/' + a.dataset.gl) add('link of ' + a.dataset.gl + ' goes to ' + a.getAttribute('href'));
    if (!a.classList.contains('gl')) add('link of ' + a.dataset.gl + ' lacks the class "gl"');
    if (a.getAttribute('aria-haspopup') !== 'dialog') add('link of ' + a.dataset.gl + ' lacks aria-haspopup="dialog"');
    if (a.querySelector('*')) add('link of ' + a.dataset.gl + ' contains markup');
  }
  const html1 = fx.innerHTML;
  const n2 = await gl.scan(fx);
  if (n2 !== 0 || fx.innerHTML !== html1) add('a second scan() is not idempotent (returned ' + n2 + ', the markup changed)');
  const n3 = await gl.scan(document.createElement('div'));
  if (n3 !== 0) add('scan() of a container without [data-gl-scan] linked ' + n3 + ' term(s)');
  return bad;
}"""


@job('gloss-scan')
def job_gloss_scan(w, j):
    cell, h = j['cell'], j['hash']
    o = w.open(cell, h)
    if not o.ok:
        return collect(o, '', cell, h) + [fail('timeout', o.why, cell=cell, url=h)], {}
    fs = [fail('gloss-scan', m, cell=cell, url=h) for m in o.page.evaluate(GLOSS_SCAN_JS)]
    fs += collect(o, '', cell, h)
    return fs, {}


@planner
def plan_gloss(args, d, routes, cells):
    if not wants(args, 'gloss'):
        return []
    jobs = [dict(kind='gloss', route=r['id'], cell=pick_cell(cells, k), hash=r['samples'][0])
            for k, r in enumerate(routes) if not r.get('bare') and r['id'] != 'S30']
    wide = next((c for c in cells if is_wide(c)), cells[0])
    narrow = next((c for c in cells if not is_wide(c)), cells[0])
    for c in dict.fromkeys([wide, narrow]):
        jobs.append(dict(kind='gloss-terms', route='', cell=c, hash='#/', tag='terms'))
    jobs.append(dict(kind='gloss-scan', route='', cell=wide, hash='#/', tag='scanner'))
    return jobs


# ============================================================================================ tabs: the tab sets of the screens
# `.tabs[data-ui=tabs]` (ui/tabs.js, WAI-ARIA tabs pattern). One job per screen; it finds the tab sets on the sample page(s) itself, so a screen without tabs
# costs one page load. Checks: structure and roving tabindex, the keyboard model (arrows wrap, Home/End, the focus moves WITH the selection), a mouse click
# on every tab, `tabs:change`, no re-render and no jump to the top, a chart inside a panel draws when its panel is shown, the choice mirrored into ?qkey=
# (kept after a reload, a garbage value is ignored) or remembered for the screen.
TABS_FIND_JS = r"""() => [...document.querySelectorAll('#view .tabs[data-ui="tabs"]')].map(t => ({
  id: t.id, qkey: t.dataset.qkey || '', n: t.querySelectorAll(':scope > .tab-list > [role="tab"]').length }))"""
TABS_STATE_JS = r"""(id) => {
  const t = document.getElementById(id);
  if (!t) return { gone: true };
  const list = t.querySelector(':scope > .tab-list'), tabs = list ? [...list.querySelectorAll('[role="tab"]')] : [], panels = [...t.querySelectorAll(':scope > [role="tabpanel"]')];
  const vis = p => { const cs = getComputedStyle(p); return cs.display !== 'none' && cs.visibility !== 'hidden'; };      // as laid out: a CSS rule can override the hidden attribute
  const a = document.activeElement;
  const old = document.querySelector('#view article.page'), q = new URLSearchParams(location.hash.split('?')[1] || '');
  const lr = list ? list.getBoundingClientRect() : null;
  return { list: !!list, vis: !!lr && lr.height > 0 && lr.bottom > 0 && lr.top < innerHeight, listRole: list ? list.getAttribute('role') : null, label: list ? (list.getAttribute('aria-label') || list.getAttribute('aria-labelledby') || '') : '',
    keys: tabs.map(x => x.dataset.key), names: tabs.map(x => x.textContent.trim().replace(/\s+/g, ' ')),
    sel: tabs.filter(x => x.getAttribute('aria-selected') === 'true').map(x => x.dataset.key), tabIdx: tabs.map(x => x.tabIndex),
    ctrl: tabs.map(x => { const p = document.getElementById(x.getAttribute('aria-controls')); return !!p && p.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === x.id && t.contains(p); }),
    shown: panels.filter(vis).map(p => p.dataset.key), panelIdx: panels.map(p => p.tabIndex), nPanels: panels.length,
    active: a && tabs.includes(a) ? a.dataset.key : null, inPanel: !!a && panels.some(p => vis(p) && p.contains(a)),
    q: Object.fromEntries(q), y: Math.round(scrollY), redone: !old || !old.hasAttribute('data-chk-old') };
}"""
TABS_CHARTS_JS = r"""(id) => {
  const t = document.getElementById(id), p = t && t.querySelector(':scope > [role="tabpanel"]:not([hidden])');
  if (!p) return [];
  // FB3: a chart inside a view that is switched off (treemap-list list/map/pie, the chart view switch) has no layout box; it is drawn when its view is chosen, so it is not part of "the tab is shown"
  return [...p.querySelectorAll('.chart')].filter(c => c.getClientRects().length > 0).map(c => { const s = c.querySelector('svg'), r = c.getBoundingClientRect(); return { id: c.id, ready: c.dataset.ready, w: Math.round(r.width), sw: s ? Math.round(s.getBoundingClientRect().width) : 0 }; });
}"""
TABS_SETTLED_JS = r"""(id) => { const t = document.getElementById(id), p = t && t.querySelector(':scope > [role="tabpanel"]:not([hidden])'); return !p || [...p.querySelectorAll('.chart')].filter(c => c.getClientRects().length > 0).every(c => c.dataset.ready === '1' || c.dataset.ready === 'err'); }"""


def tabs_check(w, page, cell, route, h, t, F, W):
    tid, qkey = t['id'], t['qkey']
    who = f'tab set #{tid}'
    sel_tab = lambda k: f'[id="{tid}"] > .tab-list > [role="tab"][data-key="{k}"]'                     # noqa: E731
    st = page.evaluate(TABS_STATE_JS, tid)
    if st.get('gone'):
        F('tabs-gone', f'{who} disappeared')
        return
    keys, n = st['keys'], len(st['keys'])
    if n < 2:
        W('tabs-count', f'{who} has {n} tab(s); a tab set needs at least two')
    if st['listRole'] != 'tablist':
        F('tabs-aria', f'{who}: the tab list has role="{st["listRole"]}", expected tablist')
    if not st['label']:
        W('tabs-name', f'{who}: the tab list has no accessible name (aria-label)')
    if len(set(keys)) != n:
        F('tabs-key', f'{who}: duplicate tab keys {keys}')
    if any(not x for x in st['names']):
        F('tabs-name', f'{who}: a tab has no text')
    if len(st['sel']) != 1:
        F('tabs-selected', f'{who}: {len(st["sel"])} tabs have aria-selected="true" (exactly one is expected)')
    if sorted(st['tabIdx']) != [-1] * (n - 1) + [0] or (len(st['sel']) == 1 and st['tabIdx'][keys.index(st['sel'][0])] != 0):
        F('tabs-roving', f'{who}: the tabindex values {st["tabIdx"]} are not "0 on the selected tab only" (roving tabindex)')
    if not all(st['ctrl']):
        F('tabs-aria', f'{who}: a tab has no matching tabpanel (aria-controls / aria-labelledby / role) inside the set')
    if st['nPanels'] != n:
        F('tabs-aria', f'{who}: {n} tabs but {st["nPanels"]} panels')
    if len(st['shown']) != 1 or st['shown'] != st['sel']:
        F('tabs-panel', f'{who}: the visible panel(s) {st["shown"]} are not the panel of the selected tab {st["sel"]}')
    if any(i != 0 for i in st['panelIdx']):
        W('tabs-panel-focus', f'{who}: a panel is not focusable (tabindex={st["panelIdx"]}); keyboard users cannot scroll a long panel')
    if n < 2 or len(st['sel']) != 1 or not all(st['ctrl']):
        return
    page.evaluate("(id) => { const t = document.getElementById(id); t.scrollIntoView({ block: 'center' }); window.__cmTabs = []; t.addEventListener('tabs:change', e => window.__cmTabs.push(e.detail.key)); }", tid)
    page.evaluate(MARK_OLD_JS)
    y0 = page.evaluate('() => Math.round(scrollY)')
    start = st['sel'][0]
    last_chart = []

    def charts_ok(key, how):
        wait_for(page, TABS_SETTLED_JS, tid, timeout=3000)
        for c in page.evaluate(TABS_CHARTS_JS, tid):
            if c['ready'] == 'err':
                F('tabs-chart', f'{who}: the chart {c["id"]} in tab "{key}" failed to draw after the tab was shown ({how})')
            elif c['ready'] != '1' or c['sw'] <= 0 or c['sw'] < c['w'] * 0.6:
                F('tabs-chart', f'{who}: the chart {c["id"]} in tab "{key}" is not drawn properly after the tab was shown ({how}): data-ready={c["ready"]}, svg {c["sw"]}px in a {c["w"]}px box')
        last_chart.append(key)

    def expect(key, how):
        s2 = page.evaluate(TABS_STATE_JS, tid)
        if s2.get('gone'):
            F('tabs-gone', f'{who}: the tab set disappeared after {how}')
            return None
        if s2['sel'] != [key]:
            F('tabs-key', f'{who}: after {how} the selected tab is {s2["sel"]}, expected "{key}"')
        if s2['shown'] != [key]:
            F('tabs-panel', f'{who}: after {how} the visible panel is {s2["shown"]}, expected "{key}"')
        if s2['tabIdx'] != [0 if x == key else -1 for x in keys]:
            F('tabs-roving', f'{who}: after {how} the tabindex values are {s2["tabIdx"]} (0 belongs to the selected tab only)')
        if s2['redone']:
            F('tabs-rerender', f'{who}: {how} re-rendered the whole screen (a tab choice must only show another panel)')
        if not s2['vis']:
            F('tabs-scroll', f'{who}: after {how} the tab list is out of view (the page went from scroll {y0}px to {s2["y"]}px)')
        if qkey and s2['q'].get(qkey) != key:
            F('tabs-url', f'{who}: after {how} the address has {qkey}={s2["q"].get(qkey)!r}, expected {key!r} (the choice is mirrored into the query)')
        return s2

    try:
        i0 = keys.index(start)
        page.focus(sel_tab(start))
        steps = [('ArrowRight', (i0 + 1) % n), ('ArrowLeft', i0), ('End', n - 1), ('ArrowRight', 0), ('ArrowLeft', n - 1), ('Home', 0), ('End', n - 1)]
        for k, (keyname, to) in enumerate(steps):
            page.keyboard.press(keyname)
            s2 = expect(keys[to], f'the {keyname} key')
            if s2 is not None and s2['active'] != keys[to]:
                F('tabs-focus', f'{who}: after the {keyname} key the focus is on {s2["active"]!r}, not on the tab "{keys[to]}" (selection must move the focus)')
            if k in (0, 2, 3, 6):
                charts_ok(keys[to], f'the {keyname} key')
        got = page.evaluate('() => window.__cmTabs')
        want = [keys[to] for _, to in steps]
        want = [x for i, x in enumerate(want) if i == 0 or x != ([keys[i0]] + want)[i]]            # a key that does not change the tab fires no event
        if got != want:
            F('tabs-event', f'{who}: the tabs:change events were {got}, expected {want}')
        page.keyboard.press('Tab')
        s2 = page.evaluate(TABS_STATE_JS, tid)
        if not s2['inPanel']:
            W('tabs-tab-order', f'{who}: the Tab key from the selected tab goes to {act(page)["sig"]}, not into the visible panel')
        # a mouse click on every tab in turn
        for key in keys:
            if page.evaluate(TABS_STATE_JS, tid)['sel'] == [key]:
                continue
            if not click_try(page, sel_tab(key), F, 'tabs-click', f'{who}: the tab "{key}" cannot be clicked'):
                continue
            expect(key, f'a click on the tab "{key}"')
            charts_ok(key, 'a click')
        # the choice survives a reload (query) or is forgotten with it (memory)
        final = keys[-1] if page.evaluate(TABS_STATE_JS, tid)['sel'] != [keys[-1]] else keys[0]
        click_try(page, sel_tab(final), F, 'tabs-click', f'{who}: the tab "{final}" cannot be clicked')
        page.wait_for_timeout(80)
        if qkey:
            page.reload(wait_until='domcontentloaded')
            ok, why = w.ready(page)
            if not ok:
                F('tabs-url', f'{who}: the screen did not come back after a reload ({why[:120]})')
                return
            s3 = page.evaluate(TABS_STATE_JS, tid)
            if s3.get('gone') or s3['sel'] != [final]:
                F('tabs-url', f'{who}: after a reload the tab "{final}" (address {page.evaluate("() => location.hash")}) is not selected, the selection is {s3.get("sel")}')
            h2 = re.sub(r'([?&])' + re.escape(qkey) + r'=[^&]*', r'\1' + qkey + '=zz-no-such-tab', page.evaluate('() => location.hash'))
            page.evaluate("(h) => { location.hash = h; }", h2)
            page.reload(wait_until='domcontentloaded')
            ok, why = w.ready(page)
            if not ok:
                F('tabs-url', f'{who}: an unknown ?{qkey}= value stops the screen from building ({why[:120]})')
                return
            s4 = page.evaluate(TABS_STATE_JS, tid)
            if s4.get('gone') or len(s4['sel']) != 1 or s4['shown'] != s4['sel']:
                F('tabs-url', f'{who}: an unknown ?{qkey}= value breaks the tab set (selected {s4.get("sel")}, visible {s4.get("shown")}); it must fall back to the default tab')
    except Exception as e:                                                   # noqa: BLE001
        F('tabs-flow', f'{who}: the check stopped: {str(e).strip().splitlines()[0][:160]}')


@job('tabs')
def job_tabs(w, j):
    cell, route = j['cell'], j['route']
    fs, sets, seen = [], 0, set()
    for h in j['hashes']:
        o = w.open(cell, h)
        if not o.ok:
            fs += collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)]
            continue
        F = lambda code, m, h=h: fs.append(fail(code, m, route=route, cell=cell, url=h))                  # noqa: E731
        W = lambda code, m, h=h: fs.append(warn(code, m, route=route, cell=cell, url=h))                  # noqa: E731
        for t in o.page.evaluate(TABS_FIND_JS):
            if t['id'] in seen:
                continue
            seen.add(t['id'])
            sets += 1
            tabs_check(w, o.page, cell, route, h, t, F, W)
        fs += collect(o, route, cell, h)
    return fs, {'tabs': sets}


@planner
def plan_tabs(args, d, routes, cells):
    if not wants(args, 'tabs'):
        return []
    return [dict(kind='tabs', route=r['id'], cell=pick_cell(cells, k), hash=r['samples'][0], hashes=r['samples'][:1] if args.quick else r['samples'])
            for k, r in enumerate(routes) if not r.get('bare') and r['id'] != 'S30']


# ======================================================================================= png + views (FB3)
# png    every block that holds a statistic (share.statNodes: chart, ranking, KPI tiles, progress bars, map, data table, the home / revenue strips,
#        the 5-minute scenes) has a „PNG“ button, in its header or in a bar under a loose statistic; the buttons are named in Bulgarian and unique;
#        a click downloads a real, wide, non-blank PNG called bns-<screen>-<block>.png.
# views  every chart with a view switch (figure[data-views]) and every treemap-list with the „Кръгова“ view: the radios switch the picture in place,
#        the chart is drawn inside its box in every view, text inside it does not leave the box, the table view opens the data table, the arrow keys
#        move the choice, and the page never scrolls sideways.
PNG_SCAN_JS = r"""async () => {
  const sh = await import('./js/share.js');
  const art = document.querySelector('#view article.page');
  if (!art) return null;
  const bare = art.classList.contains('page-bare') || art.dataset.key === 'api';          // S25 (reference tables) and the bare embed view carry no buttons
  const nodes = sh.statNodes(art), seen = new Set(), uncovered = [];
  for (const n of nodes) {
    const block = n.closest('section.block');
    let host = block, ok = false;
    if (block) ok = !!block.querySelector(':scope > .block-head .png-btn, :scope > .block-head [data-share]');   // FB4: the block menu «Сподели» carries the PNG item
    else { host = n.closest('[data-png-host]'); ok = !!host && !!(host.querySelector('.png-btn') || (host.nextElementSibling && host.nextElementSibling.querySelector('.png-btn'))); }
    const name = `${n.tagName.toLowerCase()}.${String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className).split(' ')[0]} in ${host ? (host.id || host.tagName.toLowerCase()) : 'no block'}`;
    if (!ok && !seen.has(name)) { seen.add(name); uncovered.push(name); }
  }
  const btns = [...art.querySelectorAll('.png-btn')].map(b => { const r = b.getBoundingClientRect(); return { key: b.dataset.png || '', label: b.getAttribute('aria-label') || '', vis: b.getClientRects().length > 0 && !b.closest('details:not([open])'), type: b.type, txt: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; });
  const keys = btns.map(b => b.key);
  return { bare, nodes: nodes.length, uncovered, btns, dup: [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))] };
}"""

PNG_PIXELS_JS = r"""async (b64) => {
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = 'data:image/png;base64,' + b64; });
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, bg = [d[0], d[1], d[2]];
  let non = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) non++;
  return { w: c.width, h: c.height, non, tot: d.length / 4 };
}"""


@job('png')
def job_png(w, j):
    import base64
    import struct
    cell, route, h = j['cell'], j['route'], j['hash']
    o = w.open(cell, h)
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
    page, fs = o.page, []
    F = lambda code, m: fs.append(fail(code, m, route=route, cell=cell, url=h))                       # noqa: E731
    r = page.evaluate(PNG_SCAN_JS)
    downloads = 0
    if r and not r['bare']:
        if r['uncovered']:
            F('png-missing', f'{len(r["uncovered"])} statistic(s) without a „PNG“ button: {"; ".join(r["uncovered"][:4])}')
        for b in r['btns']:
            if not b['label'].startswith('Изтегли изображение: ') or len(b['label']) < 24:
                F('png-name', f'the image button of "{b["key"]}" is named "{b["label"]}" (expected „Изтегли изображение: <block title>“)')
            if b['type'] != 'button' or b['txt'] != 'Изображение':
                F('png-name', f'the image button of "{b["key"]}" is type "{b["type"]}" with text "{b["txt"]}" (expected a button that says Изображение, a word the accessible name contains)')
        if r['dup']:
            F('png-key', f'two PNG buttons share the block id {r["dup"]}')
        vis = [b for b in r['btns'] if b['vis']]
        for b in ([vis[0], vis[-1]] if len(vis) > 1 else vis):
            sel = f'.png-btn[data-png="{b["key"]}"] >> visible=true'
            name, data_, err = download_via(page, sel)
            downloads += 1
            if err:
                F('png-download', f'{b["key"]}: the „PNG“ button produced no download ({err})')
                continue
            if not re.fullmatch(r'bns-[a-z0-9._-]+\.png', name):
                F('png-download', f'{b["key"]}: the PNG file is called "{name}" (expected bns-<screen>-<block>.png)')
            if data_[:8] != b'\x89PNG\r\n\x1a\n':
                F('png-download', f'{b["key"]}: the downloaded "{name}" is not a PNG file (first bytes {data_[:8]!r})')
                continue
            wpx, hpx = struct.unpack('>II', data_[16:24])
            if wpx < 800 or hpx < 160:
                F('png-download', f'{b["key"]}: the PNG is {wpx}x{hpx} px (expected at least 800 px wide)')
            px = page.evaluate(PNG_PIXELS_JS, base64.b64encode(data_).decode())
            if px['non'] / max(1, px['tot']) < 0.004:
                F('png-blank', f'{b["key"]}: the PNG has {px["non"]} non-background pixels: it is blank')
            if 'Не успяхме' in toast_text(page):
                F('png-download', f'{b["key"]}: the app reported that making the PNG failed')
    fs += collect(o, route, cell, h)
    return fs, {'png': len(r['btns']) if r else 0, 'dl': downloads}


@planner
def plan_png(args, d, routes, cells):
    if not wants(args, 'png'):
        return []
    return [dict(kind='png', route=r['id'], cell=pick_cell(cells, k), hash=r['samples'][0])
            for k, r in enumerate(routes) if not r.get('bare') and r['id'] != 'S30' and r['samples']]


VIEWS_FIND_JS = r"""() => [...document.querySelectorAll('#view figure.fig[data-views], #view .tmap[data-ui="treemap-list"]')]
  .filter(e => e.getClientRects().length > 0 && !e.closest('[hidden]'))
  .map(e => {
    const fig = e.matches('figure'), radios = [...e.querySelectorAll(fig ? '.fig-views input[type="radio"]' : '.tmap-bar input[type="radio"]')];
    const grp = radios[0] && radios[0].closest('[role="radiogroup"]');
    return { id: e.id, kind: fig ? 'fig' : 'tmap', name: radios[0] ? radios[0].name : '', views: radios.map(r => r.value), group: !!(grp && grp.getAttribute('aria-label')),
             labels: radios.map(r => { const l = document.querySelector(`label[for="${r.id}"]`); return l ? l.textContent.trim() : ''; }) };
  })
  .filter(x => x.kind === 'fig' || x.views.includes('pie'))"""

VIEWS_STATE_JS = r"""(a) => {
  const el = document.getElementById(a.id);
  if (!el) return { gone: true };
  const radios = [...el.querySelectorAll(a.kind === 'fig' ? '.fig-views input[type="radio"]' : '.tmap-bar input[type="radio"]')];
  const box = a.kind === 'fig' ? el.querySelector('.chart') : [...el.querySelectorAll('.chart')].find(c => c.getClientRects().length > 0) || null;
  const r = box ? box.getBoundingClientRect() : null, svg = box ? box.querySelector('svg') : null, sr = svg ? svg.getBoundingClientRect() : null;
  const out = [];
  if (box && r && r.width) for (const t of box.querySelectorAll('svg text')) { const b = t.getBoundingClientRect(); if (b.width && (b.left < r.left - 2 || b.right > r.right + 2)) out.push((t.textContent || '').trim().slice(0, 24)); }
  const tbl = el.querySelector('details.fig-table'), lst = el.querySelector('.tmap-list');
  return { view: el.dataset.view || '', listVis: !!lst && lst.getClientRects().length > 0, checked: radios.filter(x => x.checked).map(x => x.value), ready: box ? box.dataset.ready : null, vis: !!box && box.getClientRects().length > 0,
           bw: r ? Math.round(r.width) : 0, sw: sr ? Math.round(sr.width) : 0, out: out.slice(0, 4), tableOpen: tbl ? tbl.open : null,
           sx: document.documentElement.scrollWidth, vw: innerWidth, fx: el.scrollWidth > el.clientWidth + 1 };
}"""


VIEWS_IS_JS = r"""(a) => { const el = document.getElementById(a.id); return !!el && el.dataset.view === a.v; }"""


def views_check(page, f, F, W):
    who = f'{f["kind"] == "fig" and "chart" or "treemap-list"} {f["id"]}'
    if len(f['views']) < 2:
        F('views-count', f'{who}: the view switch offers {f["views"]} (at least two views make a switch)')
        return 0
    if not f['group']:
        F('views-name', f'{who}: the view switch has no accessible name (aria-label on the radio group)')
    if any(not x for x in f['labels']):
        F('views-name', f'{who}: a view option has no visible label ({f["labels"]})')
    done = 0
    for v in f['views']:
        # the radio itself lies over its label (as a real tap does), so the click goes to the input
        page.click(f'input[name="{f["name"]}"][value="{v}"]', timeout=4000)
        if not wait_for(page, VIEWS_IS_JS, {'id': f['id'], 'v': v}, timeout=3000):
            F('views-switch', f'{who}: choosing "{v}" leaves data-view at "{page.evaluate(VIEWS_STATE_JS, f).get("view")}"')
            continue
        if v != 'table':
            wait_for(page, "(a) => { const el = document.getElementById(a.id); const c = a.kind === 'fig' ? el.querySelector('.chart') : [...el.querySelectorAll('.chart')].find(x => x.getClientRects().length > 0); return !!c && (c.dataset.ready === '1' || c.dataset.ready === 'err'); }", f, timeout=3500)
            page.wait_for_timeout(120)
        st = page.evaluate(VIEWS_STATE_JS, f)
        done += 1
        if st.get('gone'):
            F('views-switch', f'{who}: the figure disappeared after choosing "{v}"')
            break
        if st['checked'] != [v]:
            F('views-switch', f'{who}: after choosing "{v}" the checked radio is {st["checked"]}')
        if v == 'table':
            if st['tableOpen'] is False:
                F('views-table', f'{who}: the table view does not open the data table')
        elif f['kind'] == 'tmap' and v == 'list':
            if not st['listVis']:
                F('views-chart', f'{who}: the "list" view shows no list')
        else:
            if st['ready'] == 'err':
                F('views-chart', f'{who}: the "{v}" view failed to draw')
            elif not st['vis'] or st['ready'] != '1' or st['sw'] <= 0 or st['sw'] > st['bw'] + 1:
                F('views-chart', f'{who}: the "{v}" view is not drawn properly (visible: {st["vis"]}, ready: {st["ready"]}, svg {st["sw"]}px in a {st["bw"]}px box)')
            if st['out']:
                F('views-overflow', f'{who}: in the "{v}" view text leaves the chart box: {st["out"]}')
        if st['sx'] > st['vw'] + 1 or st['fx']:
            F('views-overflow', f'{who}: the "{v}" view makes the page scroll sideways (page {st["sx"]}px in {st["vw"]}px, figure overflow: {st["fx"]})')
    # the arrow keys move the choice (native radio behaviour must survive the switch)
    cur = page.evaluate(VIEWS_STATE_JS, f)
    if not cur.get('gone') and cur['checked'] and len(cur['checked']) == 1:
        i = f['views'].index(cur['checked'][0]) if cur['checked'][0] in f['views'] else -1
        if i >= 0:
            nxt = f['views'][(i + 1) % len(f['views'])]
            try:
                page.focus(f'input[name="{f["name"]}"][value="{cur["checked"][0]}"]')
                page.keyboard.press('ArrowRight')
                if not wait_for(page, VIEWS_IS_JS, {'id': f['id'], 'v': nxt}, timeout=3000):
                    F('views-key', f'{who}: the ArrowRight key does not move the view from "{cur["checked"][0]}" to "{nxt}"')
            except Exception as e:                                                                    # noqa: BLE001
                F('views-key', f'{who}: the view switch cannot be reached with the keyboard ({str(e).splitlines()[0][:100]})')
    return done


@job('views')
def job_views(w, j):
    cell, route = j['cell'], j['route']
    fs, switches = [], 0
    for h in j['hashes']:
        o = w.open(cell, h)
        if not o.ok:
            fs += collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)]
            continue
        F = lambda code, m, h=h: fs.append(fail(code, m, route=route, cell=cell, url=h))                  # noqa: E731
        W = lambda code, m, h=h: fs.append(warn(code, m, route=route, cell=cell, url=h))                  # noqa: E731
        found = o.page.evaluate(VIEWS_FIND_JS)
        for f in found[:4]:
            switches += 1
            try:
                views_check(o.page, f, F, W)
            except Exception as e:                                                                    # noqa: BLE001
                F('views-switch', f'{f["id"]}: the view switch could not be driven ({str(e).splitlines()[0][:140]})')
        fs += collect(o, route, cell, h)
    return fs, {'views': switches}


@planner
def plan_views(args, d, routes, cells):
    if not wants(args, 'views'):
        return []
    jobs = []
    for r in routes:
        if r.get('bare') or r['id'] == 'S30' or not r['samples']:
            continue
        hashes = r['samples'][:1] if args.quick else r['samples']
        if args.quick:
            hashes = hashes + [s for s in r['samples'][1:] if 'tab=prosledi' in s]               # the S33 view switch lives on its second area
        for c in cells:
            jobs.append(dict(kind='views', route=r['id'], cell=c, hash=hashes[0], hashes=hashes))
    return jobs


# ================================================================================================= theme: light / dark / auto
# What this family pins. The stored theme x the OS colour scheme decide the colours (matrix, wide topbar switch); the two dark token
# blocks of tokens.css stay identical and every token has a light definition; the very first paint already has the right theme (no flash);
# garbage or blocked storage never breaks the boot; charts repaint on a switch and on an OS change, keep their legend state, and show no
# colour of the other theme; chart text and placeholders stay readable in both themes.
THEME_LIB_JS = r"""
const parse = s => {
  let m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s || '');
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : (m[5] ? +m[4] / 100 : +m[4])];
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(s || '');
  if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
  return null;
};
const col = s => {
  s = (s || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1]; }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16), 1];
  return parse(s);
};
const over = (f, b) => { const a = f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]; };
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = c => '#' + [0, 1, 2].map(i => Math.round(c[i]).toString(16).padStart(2, '0')).join('');
const vis = el => { const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && getComputedStyle(el).visibility !== 'hidden'; };
// background colour under an element: the composited stack of its own and its ancestors' backgrounds (null = a gradient / image is in the way)
const effBg = el => {
  const layers = [];
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const cs = getComputedStyle(e), b = parse(cs.backgroundColor);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    if (b && b[3] > 0) { layers.push(b); if (b[3] >= 0.99) break; }
  }
  let c = [255, 255, 255, 1];
  for (const l of layers.reverse()) c = over(l, c);
  return c;
};
"""

THEME_STATE_JS = (r"""async () => {
  /*LIB*/
  const de = document.documentElement, cs = getComputedStyle(de);
  const names = new Set(), kinds = { light: new Set(), mdark: new Set(), adark: new Set() };
  const walk = (rules, ctx) => {
    for (const r of rules) {
      if (r.media) { walk(r.cssRules, /prefers-color-scheme\s*:\s*dark/.test(r.media.mediaText) ? 'dark' : 'other'); continue; }
      if (!r.selectorText) { if (r.cssRules) walk(r.cssRules, ctx); continue; }
      if (!/:root/.test(r.selectorText) || ctx === 'other') continue;
      const k = /data-theme\s*=\s*["']?dark/.test(r.selectorText) ? 'adark' : (ctx === 'dark' ? 'mdark' : (/data-theme/.test(r.selectorText) ? null : 'light'));
      if (!k) continue;
      for (let i = 0; i < r.style.length; i++) { const n = r.style[i]; if (n.startsWith('--')) { names.add(n); kinds[k].add(n); } }
    }
  };
  for (const s of document.styleSheets) { try { walk(s.cssRules, ''); } catch (e) { /* cross-origin sheet: none expected */ } }
  const tokens = {};
  for (const n of names) tokens[n] = cs.getPropertyValue(n).trim().toLowerCase().replace(/\s+/g, ' ');
  const probe = document.createElement('span'); document.body.appendChild(probe);
  const rgb = n => { probe.style.color = ''; probe.style.color = 'var(' + n + ')'; return getComputedStyle(probe).color; };
  const out = { attr: de.getAttribute('data-theme'), scheme: cs.colorScheme, bodyBg: getComputedStyle(document.body).backgroundColor, bgTok: rgb('--bg'), inkTok: rgb('--ink'),
    pressed: [(await import('./js/store.js')).store.get('theme')], nsw: 3,
    tokens, kinds: { light: [...kinds.light], mdark: [...kinds.mdark], adark: [...kinds.adark] } };
  probe.remove();
  return out;
}""").replace('/*LIB*/', THEME_LIB_JS)

THEME_BRIEF_JS = r"""async () => {
  const de = document.documentElement, cs = getComputedStyle(de);
  return { attr: de.getAttribute('data-theme'), scheme: cs.colorScheme, bodyBg: getComputedStyle(document.body).backgroundColor,
    pressed: [(await import('./js/store.js')).store.get('theme')] };
}"""

THEME_RGB_JS = r"""(names) => {
  const p = document.createElement('span'); document.body.appendChild(p); const o = {};
  for (const n of names) { p.style.color = ''; p.style.color = 'var(' + n + ')'; o[n] = getComputedStyle(p).color; }
  p.remove(); return o;
}"""

# a recorder that is installed before any page script: when did data-theme get which value, relative to the first paint
THEME_REC_INIT_JS = r"""(() => {
  if (window.__threc) return;
  const rec = window.__threc = { seq: [] };
  const val = () => { const e = document.documentElement; return e ? e.getAttribute('data-theme') : null; };
  new MutationObserver(() => rec.seq.push({ t: performance.now(), v: val() })).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
})();"""

THEME_REC_JS = r"""() => {
  const rec = window.__threc;
  if (!rec) return { void: 'the recorder is not installed' };
  const fp = performance.getEntriesByType('paint').find(e => e.name === 'first-paint') || performance.getEntriesByType('paint')[0];
  const before = rec.seq.filter(x => !fp || x.t <= fp.startTime), after = rec.seq.filter(x => fp && x.t > fp.startTime);
  return { fp: fp ? fp.startTime : null, atPaint: before.length ? before[before.length - 1].v : null, later: after.map(x => x.v), cur: document.documentElement.getAttribute('data-theme'), n: rec.seq.length };
}"""

THEME_SNAP_JS = r"""async () => {
  const s = await import('./js/store.js');
  return { snap: s.store.snapshot(), scopes: Object.keys(s.SCOPES), users: s.USER_TYPES.map(u => u.id), periods: s.PERIODS.map(p => p.key),
           h1: document.querySelectorAll('#view h1').length, ready: !!document.querySelector('article.page[data-ready="1"]') };
}"""

# colours that must reach 4.5:1 as text, 3:1 as UI; the series colours are marks (3:1 is the target, below it only a warning: values are also printed)
TH_PAIRS = ([(a, b, 4.5, 'text') for a in ('--ink', '--muted') for b in ('--bg', '--surface', '--sunk')]
            + [('--data', '--surface', 4.5, 'text'), ('--data', '--bg', 4.5, 'text'), ('--data', '--data-soft', 4.5, 'text'), ('--data-hover', '--surface', 4.5, 'text'),
               ('--on-data', '--data', 4.5, 'text'), ('--accent-ink', '--accent-soft', 4.5, 'text'), ('--accent-ink', '--surface', 4.5, 'text'), ('--on-accent', '--accent', 4.5, 'text')]
            + [(k, b, 4.5, 'text') for k in ('ok', 'warn', 'bad') for b in ('surface', k + '-soft')]
            + [('--st-' + k, b, 4.5, 'text') for k in ('real', 'partial', 'pending', 'mock', 'forecast') for b in ('--st-' + k + '-soft', '--surface')]
            + [('--line-strong', '--surface', 3.0, 'ui'), ('--line-strong', '--bg', 3.0, 'ui'), ('--focus', '--surface', 3.0, 'ui'), ('--focus', '--bg', 3.0, 'ui'),
               ('--rev', '--surface', 3.0, 'ui'), ('--exp', '--surface', 3.0, 'ui'), ('--data', '--surface', 3.0, 'ui'), ('--faint', '--surface', 3.0, 'ui')]
            + [('--series-%d' % i, '--surface', 3.0, 'series') for i in range(1, 9)] + [('--series-other', '--surface', 3.0, 'series'), ('--series-other-2', '--surface', 3.0, 'series')])
TH_PAIRS = [(a if a.startswith('--') else '--' + a, b if b.startswith('--') else '--' + b, n, k) for a, b, n, k in TH_PAIRS]
TH_SERIES_FLOOR = 1.8                      # a series colour below this on the surface is an error, between this and 3:1 a (known) warning
TH_BAD_PREFS = [                           # raw localStorage text -> the theme attribute the page must end up with
    ('{"theme":"sepia"}', None), ('{"theme":5}', None), ('{"theme":null}', None), ('{"theme":"Dark"}', None), ('{"theme":"__proto__"}', None),
    ('{"theme":{"toString":1}}', None), ('not json', None), ('[]', None), ('null', None), ('5', None), ('"dark"', None), ('{}', None),
    ('{"theme":"dark","scope":"constructor","unit":7,"guide":{"step":99},"userType":"hacker","perPerson":"yes","sources":1,"onlyReal":null}', 'dark'),
    ('{"scope":"toString","userType":"constructor","unit":"__proto__","guide":[],"theme":"light"}', 'light'),
]


def css_rgb(s):
    """'rgb(1, 2, 3)' | 'rgba(1 2 3 / .5)' | 'color(srgb .1 .2 .3)' -> (r, g, b, a) with r, g, b in 0..255; None when it is not a colour."""
    m = re.match(r'^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$', s or '')
    if m:
        a = 1.0 if m.group(4) is None else (float(m.group(4)) / 100 if m.group(5) else float(m.group(4)))
        return (float(m.group(1)), float(m.group(2)), float(m.group(3)), a)
    m = re.match(r'^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*/\s*([\d.]+))?\s*\)$', s or '')
    if m:
        return (float(m.group(1)) * 255, float(m.group(2)) * 255, float(m.group(3)) * 255, 1.0 if m.group(4) is None else float(m.group(4)))
    return None


def rel_lum(c):
    lin = lambda v: (v / 255 / 12.92) if v / 255 <= 0.03928 else (((v / 255) + 0.055) / 1.055) ** 2.4          # noqa: E731
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def wcag(fg, bg):
    """Contrast ratio of two (r, g, b, a) colours; a translucent foreground is composited over the (opaque) background first."""
    if fg[3] < 1:
        fg = tuple(fg[i] * fg[3] + bg[i] * (1 - fg[3]) for i in range(3)) + (1.0,)
    la, lb = rel_lum(fg), rel_lum(bg)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def th_expect(stored, os_):
    eff = stored if stored in ('light', 'dark') else os_
    return dict(eff=eff, attr=stored if stored in ('light', 'dark') else None, pressed=stored or 'auto')


def th_contrast(rgb, eff, F, W):
    """Token pairs of one effective theme (rgb = token -> computed colour string)."""
    low = []
    for fg, bg, need, kind in TH_PAIRS:
        a, b = css_rgb(rgb.get(fg)), css_rgb(rgb.get(bg))
        if not a or not b:
            F('theme-token', f'{eff} theme: {fg} or {bg} does not resolve to a colour ({rgb.get(fg)!r} / {rgb.get(bg)!r})')
            continue
        r = wcag(a, (b[0], b[1], b[2], 1.0))
        if r + 0.004 >= need:
            continue
        if kind == 'series':
            low.append((fg, r))
            if r < TH_SERIES_FLOOR:
                F('theme-contrast', f'{eff} theme: {fg} on {bg} is {r:.2f}:1 (a data colour below {TH_SERIES_FLOOR}:1 vanishes on the page)')
        else:
            F('theme-contrast', f'{eff} theme: {fg} on {bg} is {r:.2f}:1, needs {need}:1 ({"text" if kind == "text" else "interface part"})')
    if low:
        W('theme-series', f'{eff} theme: series colours under 3:1 against the surface: ' + ', '.join(f'{k[2:]} {r:.2f}' for k, r in low)
          + ' (values are also printed / in the table twin; WCAG 1.4.11 asks 3:1 for marks that are the only carrier)')


def th_group_diff(a, b):
    return sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))


@job('theme')
def job_theme(w, j):
    """The matrix: stored theme (none / auto / light / dark) x OS scheme (light / dark), tokens, boot without a flash, garbage in storage."""
    cell, h = j['cell'], j['hash']
    fs = []
    F = lambda code, m: fs.append(fail(code, m, cell=cell, url=h))                    # noqa: E731
    W = lambda code, m: fs.append(warn(code, m, cell=cell, url=h))                    # noqa: E731
    states, rgbs, extra = {}, {}, {}
    ctx, page, probe = w.cell(cell, tm='matrix')
    try:
        for stored in (None, 'auto', 'light', 'dark'):
            for os_ in ('light', 'dark'):
                page.emulate_media(color_scheme=os_)
                o = w.open(cell, h, prefs=pref_blob(theme=stored) if stored else None, tm='matrix')
                tag = f'stored {stored or "nothing"}, OS {os_}'
                if not o.ok:
                    fs += collect(o, '', cell, h) + [fail('timeout', f'{tag}: {o.why}', cell=cell, url=h)]
                    continue
                st = o.page.evaluate(THEME_STATE_JS)
                states[(stored, os_)] = st
                if stored is None:
                    rgbs[os_] = o.page.evaluate(THEME_RGB_JS, sorted({n for a, b, _, _ in TH_PAIRS for n in (a, b)}))
                ex = th_expect(stored, os_)
                if st['attr'] != ex['attr']:
                    F('theme-attr', f'{tag}: html[data-theme] is {st["attr"]!r}, expected {ex["attr"]!r}')
                if st['scheme'] != ex['eff']:
                    F('theme-scheme', f'{tag}: the computed color-scheme is {st["scheme"]!r}, the page should be {ex["eff"]!r}')
                if st['bodyBg'] != st['bgTok']:
                    F('theme-bg', f'{tag}: the body background is {st["bodyBg"]} but --bg resolves to {st["bgTok"]}')
                if st['nsw'] != 3:
                    F('theme-switch', f'{tag}: the theme switch has {st["nsw"]} options, expected 3 (auto / light / dark)')
                elif st['pressed'] != [ex['pressed']]:
                    F('theme-pressed', f'{tag}: the stored theme choice is {st["pressed"]}, expected [{ex["pressed"]!r}]')
                fs += collect(o, '', cell, h)
        # --- parity: whatever way the dark theme is reached it has the same tokens (the two dark blocks of tokens.css must not drift apart)
        for eff in ('light', 'dark'):
            ref_key = (None, eff)
            if ref_key not in states:
                continue
            ref = states[ref_key]
            for key, st in states.items():
                if th_expect(*key)['eff'] != eff or key == ref_key:
                    continue
                diff = th_group_diff(ref['tokens'], st['tokens'])
                if diff:
                    F('theme-tokens', f'the {eff} theme differs between "stored {ref_key[0] or "nothing"}, OS {ref_key[1]}" and "stored {key[0] or "nothing"}, OS {key[1]}": '
                      + ', '.join(f'{n} {ref["tokens"].get(n)} vs {st["tokens"].get(n)}' for n in diff[:6]) + (' ...' if len(diff) > 6 else '')
                      + ' - the :root[data-theme="dark"] block and the prefers-color-scheme block of tokens.css must stay identical')
        lt, dk = states.get((None, 'light')), states.get((None, 'dark'))
        if lt and dk:
            same = [n for n in ('--bg', '--surface', '--ink', '--muted', '--data', '--line') if lt['tokens'].get(n) == dk['tokens'].get(n)]
            if same:
                F('theme-same', f'light and dark have the same value for {", ".join(same)}: the dark theme does not change the colours')
            k = lt['kinds']
            if not k['light']:
                F('theme-blocks', 'no :root block with the light tokens was found in the style sheets')
            if set(k['mdark']) != set(k['adark']):
                only = sorted(set(k['mdark']) ^ set(k['adark']))
                F('theme-blocks', 'the prefers-color-scheme block and the [data-theme="dark"] block declare different tokens: ' + ', '.join(only[:8]))
            lonely = sorted((set(k['mdark']) | set(k['adark'])) - set(k['light']))
            if lonely:
                F('theme-blocks', 'tokens defined only in a dark block, with no light value (the light theme and print would see them unset): ' + ', '.join(lonely[:8]))
            extra['th_tokens'] = len(lt['tokens'])
        for eff, key in (('light', 'light'), ('dark', 'dark')):
            if key in rgbs:
                th_contrast(rgbs[key], eff, F, W)
        # --- boot: the first paint already has the final theme
        rctx, rpage, rprobe = w.cell(cell, tm='rec')
        if not getattr(rctx, '_cm_rec', False):
            rctx.add_init_script(THEME_REC_INIT_JS)
            rctx._cm_rec = True
        for stored, os_ in ((None, 'light'), (None, 'dark'), ('auto', 'dark'), ('light', 'dark'), ('dark', 'light'), ('dark', 'dark')):
            rpage.emulate_media(color_scheme=os_)
            o = w.open(cell, h, prefs=pref_blob(theme=stored) if stored else None, tm='rec')
            tag = f'stored {stored or "nothing"}, OS {os_}'
            if not o.ok:
                fs += collect(o, '', cell, h) + [fail('timeout', f'{tag}: {o.why}', cell=cell, url=h)]
                continue
            rec = o.page.evaluate(THEME_REC_JS)
            want = th_expect(stored, os_)['attr']
            if rec.get('void'):
                W('theme-flash-void', rec['void'])
            elif rec['fp'] is None:
                W('theme-flash-void', f'{tag}: the browser reported no first-paint entry, the flash check could not run')
            else:
                bad = rec['atPaint'] != want or any(v != rec['atPaint'] for v in rec['later']) or rec['cur'] != want
                if bad:
                    F('theme-flash', f'{tag}: data-theme was {rec["atPaint"]!r} at the first paint, later {rec["later"]}, finally {rec["cur"]!r}; it must be {want!r} before the first paint '
                      '(js/theme-boot.js is a classic script in <head>, before the body; nothing else may set the attribute late)')
                extra['th_boot'] = extra.get('th_boot', 0) + 1
            fs += collect(o, '', cell, h)
        # --- garbage in localStorage: the page boots, the theme is the stored one only when it is valid, no value leaks into the store
        page.emulate_media(color_scheme='light')
        for raw, want in TH_BAD_PREFS:
            o = w.open(cell, h, prefs={PREFS_KEY: raw}, tm='matrix')
            tag = f'stored text {raw[:60]!r}'
            if not o.ok:
                fs += collect(o, '', cell, h) + [fail('timeout', f'{tag}: {o.why}', cell=cell, url=h)]
                continue
            st, snap = o.page.evaluate(THEME_BRIEF_JS), o.page.evaluate(THEME_SNAP_JS)
            s = snap['snap']
            if st['attr'] != want:
                F('theme-bad-attr', f'{tag}: html[data-theme] is {st["attr"]!r}, expected {want!r}')
            problems = []
            if s.get('theme') not in ('auto', 'light', 'dark'):
                problems.append(f'theme={s.get("theme")!r}')
            if s.get('theme') != (want or 'auto'):
                problems.append(f'theme={s.get("theme")!r} (expected {(want or "auto")!r})')
            if not (isinstance(s.get('scope'), str) and s['scope'] in snap['scopes']):
                problems.append(f'scope={s.get("scope")!r}')
            if s.get('unit') not in ('eur', 'pct'):
                problems.append(f'unit={s.get("unit")!r}')
            if s.get('userType') not in snap['users']:
                problems.append(f'userType={s.get("userType")!r}')
            if s.get('period') not in snap['periods']:
                problems.append(f'period={s.get("period")!r}')
            if 'guide' in s:        # v5: the guide run is gone (the guide is merged into «Бюджетът за 5 минути»); an old saved key must not come back into the store
                problems.append(f'guide={s.get("guide")!r} (the key was removed in v5)')
            for k in ('perPerson', 'leva', 'onlyReal', 'sources'):
                if not isinstance(s.get(k), bool):
                    problems.append(f'{k}={s.get(k)!r}')
            if problems:
                F('theme-bad-store', f'{tag}: the store accepted an invalid value: ' + ', '.join(problems))
            if snap['h1'] != 1 or not snap['ready']:
                F('theme-bad-boot', f'{tag}: the screen did not build normally (h1 count {snap["h1"]}, ready {snap["ready"]})')
            fs += collect(o, '', cell, h)
            extra['th_bad'] = extra.get('th_bad', 0) + 1
    finally:
        for p in (page, locals().get('rpage')):
            try:
                if p:
                    p.emulate_media(color_scheme=CELLS[cell]['scheme'])
            except Exception:                                                  # noqa: BLE001
                pass
    extra['th_matrix'] = len(states)
    return fs, extra


# ------------------------------------------------------------------------------------------ storage that throws on access
BLOCK_STORAGE_JS = r"""(() => {
  for (const k of ['localStorage', 'sessionStorage']) {
    try { Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }); } catch (e) { /* not definable */ }
  }
})();"""
STORAGE_BLOCKED_JS = r"""() => { const r = []; for (const k of ['localStorage', 'sessionStorage']) { try { window[k].getItem('x'); r.push(false); } catch (e) { r.push(true); } } return r; }"""
STORE_SET_JS = r"""async ([k, v]) => { const s = await import('./js/store.js'); const r = s.store.set(k, v); return { r, now: s.store.get(k) }; }"""


@job('theme-store')
def job_theme_store(w, j):
    """localStorage / sessionStorage throw (a sandboxed iframe, Safari private mode, blocked site data): the screen still builds, nothing rejects."""
    cell, route, h = j['cell'], j['route'], j['hash']
    fs = []
    F = lambda code, m: fs.append(fail(code, m, route=route, cell=cell, url=h))                       # noqa: E731
    W = lambda code, m: fs.append(warn(code, m, route=route, cell=cell, url=h))                       # noqa: E731
    ctx, page, probe = w.cell(cell, st='blocked')
    if not getattr(ctx, '_cm_blocked', False):
        ctx.add_init_script(BLOCK_STORAGE_JS)
        ctx._cm_blocked = True
    o = w.open(cell, h, st='blocked')
    if not o.ok:
        return collect(o, route, cell, h) + [fail('timeout', 'with blocked storage: ' + o.why, route=route, cell=cell, url=h)], {}
    blocked = o.page.evaluate(STORAGE_BLOCKED_JS)
    if not all(blocked):
        W('theme-store-void', 'the checker could not block storage in this browser; the blocked-storage check did not run')
    rej = o.page.evaluate('() => (window.__chk && window.__chk.rej) || []')
    if rej:
        F('theme-store-rejection', 'unhandled promise rejection with blocked storage: ' + ' | '.join(rej)[:300])
    if route == 'S01':
        r = o.page.evaluate(STORE_SET_JS, ['theme', 'dark'])
        o.page.wait_for_timeout(80)
        st = o.page.evaluate(THEME_BRIEF_JS)
        if not r['r'] or st['attr'] != 'dark':
            F('theme-store-session', f'with blocked storage a theme switch must still apply for the session (store.set -> {r}, html[data-theme]={st["attr"]!r})')
        r = o.page.evaluate(STORE_SET_JS, ['userType', 'journalist'])
        if not r['r'] or r['now'] != 'journalist':
            F('theme-store-session', f'with blocked storage a user-type switch must still apply for the session (store.set -> {r})')
        o.page.wait_for_timeout(250)
        bar = o.page.evaluate("() => { const b = document.getElementById('mockbar'); const btn = b && b.querySelector('[data-action=\"dismiss-banner\"]'); return { has: !!b, shown: !!b && !b.hidden && b.getBoundingClientRect().height > 0, btn: !!btn }; }")
        if bar['has'] and bar['shown'] and bar['btn']:
            o.page.click('#mockbar [data-action="dismiss-banner"]')
            gone = wait_for(o.page, "() => { const b = document.getElementById('mockbar'); return !b || b.hidden || b.getBoundingClientRect().height === 0; }", timeout=2000)
            if not gone:
                F('theme-store-banner', 'with blocked storage the Mock banner cannot be dismissed (the dismissal must at least hold for the current page)')
        o.page.evaluate("() => { location.hash = '#/prihodi'; }")
        ok = wait_for(o.page, "() => { const a = document.querySelector('#view article.page'); return !!a && a.dataset.ready === '1' && a.dataset.route === 'S06'; }", timeout=6000)
        if not ok:
            F('theme-store-nav', 'with blocked storage the navigation to #/prihodi did not build the screen')
    fs += collect(o, route, cell, h)
    return fs, {'th_store': 1}


# ------------------------------------------------------------------------------------------ the theme on a real screen
# Charts, focus, legend, scroll, readable chart text and placeholders, and (forced colours) state markers that must not vanish.
TH_CHART_TOKENS = (['--ink', '--muted', '--faint', '--line', '--line-strong', '--surface', '--sunk', '--bg', '--data', '--on-data', '--st-mock', '--exp', '--rev']
                   + ['--series-%d' % i for i in range(1, 9)] + ['--series-other', '--series-other-2'])

# one record per chart: the colours its SVG paints (text / shapes), its legend, the ECharts legend map, whether it is shown and how wide it painted
TH_CHARTS_JS = r"""() => {
  const norm = f => {
    f = (f || '').trim().toLowerCase();
    let m = /^#([0-9a-f]{3})$/.exec(f); if (m) return '#' + [...m[1]].map(c => c + c).join('');
    m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(f); if (m) return '#' + m[1];
    m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(f);
    return m ? '#' + [1, 2, 3].map(i => Math.round(+m[i]).toString(16).padStart(2, '0')).join('') : null;
  };
  const out = [];
  [...document.querySelectorAll('#view .chart')].forEach((c, i) => {
    const svg = c.querySelector('svg'), text = new Set(), shape = new Set();
    if (svg) {
      for (const t of svg.querySelectorAll('text')) { const k = norm(t.getAttribute('fill')); if (k) text.add(k); }
      for (const s of svg.querySelectorAll('path,rect,circle,ellipse,line,polygon,polyline')) for (const a of ['fill', 'stroke']) { const k = norm(s.getAttribute(a)); if (k) shape.add(k); }
    }
    const fig = c.closest('figure, .fig') || c.parentElement;
    const lg = fig ? [...fig.querySelectorAll('.lg[data-name]')].map(b => [b.dataset.name, b.getAttribute('aria-pressed')]) : [];
    let sel = null;
    try { const inst = window.echarts && window.echarts.getInstanceByDom(c), lo = inst && inst.getOption().legend; sel = lo && lo[0] && lo[0].selected ? lo[0].selected : null; } catch (e) { sel = null; }
    const cs = getComputedStyle(c), cw = c.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    out.push({ i, id: c.id || '', ready: c.dataset.ready || '', vis: !!(c.offsetWidth || c.offsetHeight), text: [...text], shape: [...shape], lg, sel,
               sw: svg ? Math.round(svg.getBoundingClientRect().width) : 0, cw: Math.round(cw) });
  });
  return out;
}"""

# chart text on whatever is behind it (the filled shape under the label, else the card), placeholders, field borders
TH_CONTRAST_JS = (r"""() => {
  /*LIB*/
  const out = { texts: 0, low: [], ph: [], fields: 0, border: [] };
  const charts = [...document.querySelectorAll('#view .chart[data-ready="1"]')].filter(vis);
  charts.forEach((c, ci) => {
    const svg = c.querySelector('svg'); if (!svg) return;
    const surf = effBg(c) || [255, 255, 255, 1];
    const shapes = [...svg.querySelectorAll('path,rect,circle,ellipse,polygon')].filter(s => { const f = (s.getAttribute('fill') || '').toLowerCase(); return f && f !== 'none' && f !== 'transparent' && !f.startsWith('url('); });
    let texts = [...svg.querySelectorAll('text')].filter(t => (t.textContent || '').trim());
    if (texts.length > 70) { const k = Math.ceil(texts.length / 70); texts = texts.filter((_, i) => i % k === 0); }
    for (const t of texts) {
      const fg = col(t.getAttribute('fill')); if (!fg) continue;
      const r = t.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const pt = svg.createSVGPoint(); pt.x = r.left + r.width / 2; pt.y = r.top + r.height / 2;
      let bg = surf;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (!(t.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
        const m = s.getScreenCTM(); if (!m) continue;
        let inside = false;
        try { inside = s.isPointInFill(pt.matrixTransform(m.inverse())); } catch (e) { inside = false; }
        if (!inside) continue;
        const f = col(s.getAttribute('fill')), a = parseFloat(s.getAttribute('fill-opacity') || s.getAttribute('opacity') || '1');
        if (!f || a < 0.3) continue;
        bg = over([f[0], f[1], f[2], f[3] * a], surf); break;
      }
      const cs = getComputedStyle(t), size = parseFloat(cs.fontSize) || 12, bold = parseInt(cs.fontWeight, 10) >= 700 || cs.fontWeight === 'bold';
      const large = size >= 24 || (size >= 18.66 && bold), rt = ratio(over(fg, bg), bg);
      out.texts++;
      if (rt < (large ? 3 : 4.5)) out.low.push({ i: ci, txt: (t.textContent || '').trim().slice(0, 24), fg: hex(fg), bg: hex(bg), ratio: +rt.toFixed(2), size, bold });
    }
  });
  const fields = [...document.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=range]), textarea')].filter(vis);
  for (const el of fields) {
    out.fields++;
    const bg = effBg(el); if (!bg) continue;
    if (el.placeholder) {
      const ps = getComputedStyle(el, '::placeholder'), pc = col(ps.color), op = parseFloat(ps.opacity);
      if (pc) {
        const fg = over([pc[0], pc[1], pc[2], pc[3] * (isNaN(op) ? 1 : op)], bg), rt = ratio(fg, bg);
        if (rt < 4.5) out.ph.push({ who: el.id || el.name || (typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '') || el.tagName.toLowerCase(), ph: el.placeholder.slice(0, 30), fg: hex(fg), bg: hex(bg), ratio: +rt.toFixed(2) });
      }
    }
    // the boundary of a field: its own border (any side) or fill; a borderless field (the palette's search box) borrows the one of its wrapper (up to two levels)
    const edge = n => {
      const st = getComputedStyle(n), par = effBg(n.parentElement || document.body), me = effBg(n);
      let best = par && me ? ratio(me, par) : 1, bw = 0;
      for (const sd of ['Top', 'Right', 'Bottom', 'Left']) {
        const w = parseFloat(st['border' + sd + 'Width']) || 0, c = col(st['border' + sd + 'Color']);
        if (w > 0 && c && par) { bw = Math.max(bw, w); best = Math.max(best, ratio(over(c, par), par)); }
      }
      return { best, bw };
    };
    if (getComputedStyle(el).outlineStyle === 'none') {
      let e = edge(el), best = e.best, bw = e.bw;
      for (let n = el.parentElement, k = 0; n && best < 3 && k < 2 && n !== document.body && !n.matches('dialog, #view, main'); n = n.parentElement, k++) { const w = edge(n); best = Math.max(best, w.best); bw = Math.max(bw, w.bw); }
      if (best < 3) out.border.push({ who: el.id || el.name || el.tagName.toLowerCase(), ratio: +best.toFixed(2), bw });
    }
  }
  return out;
}""").replace('/*LIB*/', THEME_LIB_JS)

# forced colours: a marked state (pressed / selected / checked / current) must look different from its unmarked sibling WITHOUT the colours that
# the mode takes away. Compares the computed style of the marked control and of an unmarked sibling (aria states), or of the carriers of a hidden
# radio / checkbox before and after flipping it. args = [css selectors of the roots, may a lone control be compared with its own flipped state]
TH_FORCED_JS = r"""(args) => {
  const [scopes, lone] = args;
  // under prefers-reduced-motion base.css gives every element a .01ms transition: a style read right after a flip would still show the old value
  const nt = document.createElement('style');
  nt.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  document.head.appendChild(nt);
  try {
  const roots = scopes.flatMap(s => [...document.querySelectorAll(s)]);
  const vis = el => { const r = el.getBoundingClientRect(), c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const first = el => (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '') || '';
  const kind = el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '');
  const label = el => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  const sig = el => {
    const cs = getComputedStyle(el);
    const ps = n => { const q = getComputedStyle(el, n); return q.content && q.content !== 'none' && q.content !== 'normal' ? ['y', q.display, q.backgroundColor, q.color, q.borderTopWidth, q.borderBottomWidth, q.borderLeftWidth, q.borderRightWidth, q.borderTopColor, q.borderBottomColor, q.transform, q.width, q.height, q.left, q.right, q.opacity].join(',') : 'n'; };
    const kids = [...el.querySelectorAll('*')].filter(k => { const r = k.getBoundingClientRect(), c = getComputedStyle(k); return (r.width > 0 || r.height > 0) && c.visibility !== 'hidden' && c.display !== 'none' && parseFloat(c.opacity) > 0.05; }).length;
    return [cs.backgroundColor, cs.color, cs.borderTopStyle, cs.borderTopWidth, cs.borderBottomStyle, cs.borderBottomWidth, cs.borderLeftWidth, cs.borderRightWidth, cs.borderTopColor, cs.borderBottomColor, cs.borderLeftColor,
            cs.borderRightColor, cs.outlineStyle, cs.outlineWidth, cs.textDecorationLine, cs.fontWeight, cs.fontStyle, cs.opacity, cs.transform, kids, ps('::before'), ps('::after')].join('|');
  };
  const ATT = ['aria-pressed', 'aria-selected', 'aria-checked'];
  const isOn = el => ATT.some(a => el.getAttribute(a) === 'true') || ['page', 'step', 'true', 'location', 'date', 'time'].includes(el.getAttribute('aria-current') || '');
  const GROUP = 'ul,ol,nav,[role="tablist"],[role="group"],[role="radiogroup"],[role="listbox"],.seg,.chips,.steps';
  const prev = document.activeElement;
  if (prev && prev !== document.body) prev.blur();
  const out = { n: 0, lone: 0, bad: [] }, seen = new Set();
  for (const root of roots) {
    for (const el of root.querySelectorAll('[aria-pressed],[aria-selected],[aria-checked],[aria-current]')) {
      if (seen.has(el) || !isOn(el) || !vis(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      seen.add(el);
      const scope = el.closest(GROUP) || el.parentElement, role = el.getAttribute('role') || '';
      const off = [...scope.querySelectorAll(el.tagName.toLowerCase())].find(s => s !== el && !isOn(s) && vis(s) && !s.disabled && first(s) === first(el) && (s.getAttribute('role') || '') === role && (s.closest(GROUP) || s.parentElement) === scope);
      if (off) {
        out.n++;
        if (sig(el) === sig(off)) out.bad.push({ kind: kind(el), text: label(el), vs: label(off) });
      } else if (lone) {
        const a = ATT.find(x => el.getAttribute(x) === 'true') || 'aria-current', was = el.getAttribute(a), before = sig(el);
        if (a === 'aria-current') el.removeAttribute(a); else el.setAttribute(a, 'false');
        const after = sig(el);
        el.setAttribute(a, was);
        out.n++;
        if (before === after) out.bad.push({ kind: kind(el), text: label(el), vs: '(the same control with the state removed)' });
      } else out.lone++;
    }
    for (const inp of root.querySelectorAll('input[type="radio"],input[type="checkbox"]')) {
      if (seen.has(inp) || inp.disabled) continue;
      seen.add(inp);
      const cs = getComputedStyle(inp), r = inp.getBoundingClientRect();
      if (cs.appearance !== 'none' && r.width >= 8 && r.height >= 8 && parseFloat(cs.opacity) > 0.1 && cs.clip === 'auto' && cs.visibility !== 'hidden') continue;   // drawn by the browser
      const par = inp.parentElement, lab = inp.id && par ? par.querySelector(':scope > label[for="' + inp.id + '"]') : null;
      const car = [inp.nextElementSibling, par && par.tagName === 'LABEL' ? par : null, lab].filter((e, i, a) => e && vis(e) && a.indexOf(e) === i);
      if (!car.length) continue;
      const group = inp.type === 'radio' && inp.name ? [...document.querySelectorAll('input[type="radio"]')].filter(x => x.name === inp.name && x.form === inp.form) : [inp];
      const snap = group.map(x => [x, x.checked]), before = car.map(sig);
      inp.checked = !inp.checked;
      const after = car.map(sig);
      for (const [x, c] of snap) x.checked = c;
      out.n++;
      if (before.every((s, i) => s === after[i])) out.bad.push({ kind: kind(car[car.length - 1]), text: label(car[car.length - 1]), vs: '(the same control flipped)' });
    }
  }
  if (prev && prev !== document.body && prev.isConnected) { try { prev.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  return out;
  } finally { nt.remove(); }
}"""

TH_ATTR_JS = r"""([a, e]) => { const d = document.documentElement; return d.getAttribute('data-theme') === a && getComputedStyle(d).colorScheme === e; }"""
TH_LEGEND_CLICK_JS = r"""(i) => {
  const c = [...document.querySelectorAll('#view .chart')][i]; if (!c) return null;
  const fig = c.closest('figure, .fig') || c.parentElement, b = fig && [...fig.querySelectorAll('.lg[data-name]')].find(x => x.getAttribute('aria-pressed') === 'true');
  if (!b) return null;
  b.click(); return b.dataset.name;                    // no scrollIntoView: the scroll position is one of the things the job checks
}"""
TH_LEGEND_OFF_JS = r"""([i, n]) => { const c = [...document.querySelectorAll('#view .chart')][i], fig = c && (c.closest('figure, .fig') || c.parentElement);
  const b = fig && [...fig.querySelectorAll('.lg[data-name]')].find(x => x.dataset.name === n); return !!b && b.getAttribute('aria-pressed') === 'false'; }"""
TH_PAGE_JS = r"""() => { const d = document.documentElement; return { old: document.querySelectorAll('#view article.page[data-chk-old]').length, arts: document.querySelectorAll('#view article.page').length,
  sw: d.scrollWidth, cw: d.clientWidth, y: Math.round(window.scrollY), ok: !!document.querySelector('#view article.page[data-ready="1"]') }; }"""


def th_hexes(rgb):
    """token -> computed colour string  ==>  the set of '#rrggbb' strings (alpha dropped)."""
    out = set()
    for v in rgb.values():
        c = css_rgb(v)
        if c:
            out.add('#%02x%02x%02x' % tuple(int(round(x)) for x in c[:3]))
    return out


def th_stale(charts, own, other, visible_only=True):
    """Charts that still paint a colour only the OTHER theme has (white and black are in both themes' charts and never count)."""
    foreign = (set(other) - set(own)) - {'#ffffff', '#000000'}
    bad = []
    for c in charts:
        if c['ready'] != '1' or (visible_only and not c['vis']):
            continue
        hit = sorted((set(c['text']) | set(c['shape'])) & foreign)
        if hit:
            bad.append((c, hit))
    return bad


def th_report_contrast(r, tag, F, W):
    """Chart text, placeholders and field borders from TH_CONTRAST_JS."""
    hard = [t for t in r['low'] if t['ratio'] < 3.0]
    soft = [t for t in r['low'] if t['ratio'] >= 3.0]
    fmt = lambda t: f'"{t["txt"]}" {t["fg"]} on {t["bg"]} = {t["ratio"]}:1 ({t["size"]:g}px{" bold" if t["bold"] else ""})'        # noqa: E731
    if hard:
        F('theme-chart-contrast', f'{tag}: {len(hard)} chart label(s) under 3:1: ' + '; '.join(fmt(t) for t in hard[:3])
          + ' (a label colour must be chosen for the fill it sits on: textOn(fill) in js/charts.js)')
    if soft:
        W('theme-chart-contrast-aa', f'{tag}: {len(soft)} chart label(s) between 3:1 and 4.5:1: ' + '; '.join(fmt(t) for t in soft[:3]))
    if r['ph']:
        F('theme-placeholder', f'{tag}: placeholder text under 4.5:1: ' + '; '.join(f'{p["who"]} "{p["ph"]}" {p["fg"]} on {p["bg"]} = {p["ratio"]}:1' for p in r['ph'][:3])
          + ' (WCAG 1.4.3 applies to placeholders: use --muted, not --faint)')
    if r['border']:
        W('theme-control-border', f'{tag}: a field whose boundary is under 3:1 against its surroundings (WCAG 1.4.11): '
          + '; '.join(f'{b["who"]} {b["ratio"]}:1' for b in r['border'][:3]))


def th_report_forced(r, tag, W):
    uniq = {}
    for b in r['bad']:
        uniq.setdefault(b['kind'], b)
    if uniq:
        W('theme-forced-state', f'{tag}: in forced-colours mode the marked state cannot be told from the unmarked one for: '
          + '; '.join(f'{k} "{b["text"]}" vs {b["vs"]}' for k, b in list(uniq.items())[:5])
          + ' - a state that is carried only by background / border colour disappears; add a @media (forced-colors: active) rule with system colours '
          '(Highlight / HighlightText / CanvasText), a border width, an outline or a text decoration')


@job('theme-view')
def job_theme_view(w, j):
    """One screen through a theme change: auto follows the OS, a pinned theme beats the OS, the charts repaint (no colour of the other theme), the legend
    choice / focus / scroll position / the screen itself survive, chart text and placeholders are readable, and in forced colours the markers of state stay."""
    cell, route, h = j['cell'], j['route'], j['hash']
    fs = []
    F = lambda code, m: fs.append(fail(code, m, route=route, cell=cell, url=h))                       # noqa: E731
    W = lambda code, m: fs.append(warn(code, m, route=route, cell=cell, url=h))                       # noqa: E731
    wide = is_wide(cell)
    S = CELLS[cell]['scheme']
    O = 'dark' if S == 'light' else 'light'
    extra = {'th_view': 1}
    ctx, page, probe = w.cell(cell, tm='view', reduced_motion=True)
    try:
        page.emulate_media(color_scheme=S, forced_colors='none')
        o = w.open(cell, h, tm='view', reduced_motion=True)
        if not o.ok:
            return collect(o, route, cell, h) + [fail('timeout', o.why, route=route, cell=cell, url=h)], {}
        deep_pass(page)

        def tokens():
            return th_hexes(page.evaluate(THEME_RGB_JS, TH_CHART_TOKENS))

        def state(tag, attr, eff):
            wait_for(page, TH_ATTR_JS, [attr, eff], 1500)
            b = page.evaluate(THEME_BRIEF_JS)
            if b['attr'] != attr or b['scheme'] != eff:
                F('theme-view-attr', f'{tag}: html[data-theme] is {b["attr"]!r} and the colour scheme {b["scheme"]!r}, expected {attr!r} / {eff!r}')
                return False
            return True

        def follow(tag, own, other, visible_only=True):
            """Poll until no chart paints a colour that only the other theme has."""
            charts, bad = [], []
            for _ in range(14):
                charts = page.evaluate(TH_CHARTS_JS)
                bad = th_stale(charts, own, other, visible_only)
                if not bad:
                    return charts
                page.wait_for_timeout(120)
            c, hit = bad[0]
            F('theme-chart-stale', f'{tag}: {len(bad)} chart(s) keep painting colours of the other theme, e.g. chart #{c["i"]}{" " + c["id"] if c["id"] else ""} paints {", ".join(hit[:4])} '
              '(ui/chart.js repaints on html[data-theme] and on the OS colour-scheme change)')
            return charts

        POPT = '.popover[role="dialog"]'
        kept_focus = {}

        def pin(x):
            if wide:                           # the keyboard path: a pointer click makes Playwright scroll the page, which would hide a real scroll jump
                page.evaluate("() => document.getElementById('btn-more').focus({ preventScroll: true })")
                page.keyboard.press('Enter')
                wait_there(page, POPT)
                rsel = f'{POPT} input[data-pref="theme"][value="{x}"]'
                page.evaluate("(s) => document.querySelector(s).focus({ preventScroll: true })", rsel)
                page.keyboard.press('Space')
                page.wait_for_timeout(150)
                kept_focus[x] = is_active(page, rsel)
                page.keyboard.press('Escape')
                wait_gone(page, POPT)
            else:
                page.evaluate(STORE_SET_JS, ['theme', x])

        tS = tokens()
        c0 = page.evaluate(TH_CHARTS_JS)
        extra['th_charts'] = sum(1 for c in c0 if c['ready'] == '1')
        th_report_contrast(page.evaluate(TH_CONTRAST_JS), f'{S} theme', F, W)
        # --- forced colours (the content of the screen; the chrome has its own job)
        page.emulate_media(forced_colors='active')
        try:
            page.wait_for_timeout(60)
            fr = page.evaluate(TH_FORCED_JS, [['#view'], False])
        finally:
            page.emulate_media(forced_colors='none')
        extra['th_forced'] = fr['n']
        th_report_forced(fr, 'forced colours', W)
        page.evaluate(MARK_OLD_JS)
        y0 = page.evaluate(TH_PAGE_JS)
        # --- 1. theme "auto" follows the operating system
        page.emulate_media(color_scheme=O)
        good = state(f'theme auto, the OS goes {S} -> {O}', None, O)
        tO = tokens() if good else set()
        usable = good and tO != tS
        if usable:
            bad0 = th_stale(c0, tS, tO)
            if bad0:
                F('theme-chart-stale', f'first paint in the {S} theme: chart #{bad0[0][0]["i"]} already paints colours of the {O} theme ({", ".join(bad0[0][1][:3])})')
            follow(f'OS {S} -> {O} (theme auto)', tO, tS)
        # --- 2. pinning the theme beats the OS (OS stays at O)
        pin(S)
        if state(f'the theme is pinned to {S} while the OS is {O}', S, S) and usable:
            c2 = follow(f'pinned {S} while the OS is {O}', tS, tO)
            if wide and not kept_focus.get(S, True):
                F('theme-focus-lost', f'after choosing the {S} theme in the settings popover the focus is not on the chosen option (a theme change must not rebuild the popover)')
            # --- 3. the legend choice survives a theme change
            li = next((c['i'] for c in c2 if c['vis'] and len(c['lg']) >= 2), None)
            name = page.evaluate(TH_LEGEND_CLICK_JS, li) if li is not None else None
            if name is not None:
                if not wait_for(page, TH_LEGEND_OFF_JS, [li, name], 1500):
                    F('theme-legend', f'a click on the legend entry "{name}" of chart #{li} does not hide the series (aria-pressed stays true)')
                    name = None
                else:
                    page.wait_for_timeout(150)
                    before = next(c for c in page.evaluate(TH_CHARTS_JS) if c['i'] == li)
            if name is not None:
                extra['th_legend'] = 1
                pin(O)
                if state(f'the theme is pinned to {O}', O, O):
                    c3 = follow(f'pinned {O}', tO, tS)
                    after = next((c for c in c3 if c['i'] == li), None)
                    if not after or after['lg'] != before['lg'] or after['sel'] != before['sel']:
                        F('theme-legend-reset', f'chart #{li}: the legend choice is lost by a theme change (before {before["lg"]} / {before["sel"]}, after {after and after["lg"]} / {after and after["sel"]}); '
                          'a repaint must keep which series are hidden')
            else:
                pin(O)
                state(f'the theme is pinned to {O}', O, O)
                follow(f'pinned {O}', tO, tS)
            # --- 4. a pinned theme holds when the OS changes under it
            page.emulate_media(color_scheme=S)
            page.wait_for_timeout(260)
            if state(f'pinned {O}, the OS goes {O} -> {S}', O, O):
                follow(f'pinned {O}, the OS is {S}', tO, tS)
            page.emulate_media(color_scheme=O)
            page.wait_for_timeout(200)
            state(f'pinned {O}, the OS is back at {O}', O, O)
            # --- 5. everything the visitor sees besides the colours is untouched
            p1 = page.evaluate(TH_PAGE_JS)
            if p1['old'] != 1 or p1['arts'] != 1:
                F('theme-rerender', f'a theme change re-rendered the screen ({p1["old"]} old / {p1["arts"]} article.page in #view): the router must not rebuild the page for a colour change')
            if p1['sw'] > p1['cw'] + 1 and y0['sw'] <= y0['cw'] + 1:
                F('theme-overflow', f'the page scrolls sideways after a theme change (scrollWidth {p1["sw"]} > {p1["cw"]})')
            if abs(p1['y'] - y0['y']) > 4:
                W('theme-scroll', f'the scroll position moved from {y0["y"]} to {p1["y"]} px during the theme changes')
            # --- 6. charts of the hidden tabs / closed disclosures: revealed AFTER the changes they must carry the new colours and the right width
            deep_pass(page)
            c4 = follow('after every tab and disclosure was opened', tO, tS, visible_only=False)
            was_err = {c['i'] for c in c0 if c['ready'] == 'err'}
            for c in c4:
                if c['ready'] == 'err' and c['i'] not in was_err:
                    F('theme-chart-err', f'chart #{c["i"]} failed to paint after the theme changes (data-ready="err")')
                elif c['ready'] == '1' and c['vis'] and c['cw'] > 40 and abs(c['sw'] - c['cw']) > 4:
                    F('theme-chart-size', f'chart #{c["i"]}{" " + c["id"] if c["id"] else ""} paints {c["sw"]}px wide in a {c["cw"]}px box after the theme changes '
                      '(a chart repainted while its tab was hidden keeps the stale size: repaint when it is shown)')
            th_report_contrast(page.evaluate(TH_CONTRAST_JS), f'{O} theme', F, W)
        fs += collect(o, route, cell, h)
    finally:
        try:
            page.emulate_media(color_scheme=CELLS[cell]['scheme'], forced_colors='none')
        except Exception:                                                                 # noqa: BLE001
            pass
    return fs, extra


# ------------------------------------------------------------------------------------------ the chrome and its overlays
TH_OVERLAY_SEL = 'dialog[open], .popover'


@job('theme-chrome')
def job_theme_chrome(w, j):
    """The chrome (top bar, left nav, bottom bar, banner, footer) and every overlay that opens from it (palette, popovers, sheets): in both themes the
    placeholders are readable and in forced colours the markers of state stay visible."""
    cell, h = j['cell'], j['hash']
    fs = []
    F = lambda code, m: fs.append(fail(code, m, cell=cell, url=h))                                    # noqa: E731
    W = lambda code, m: fs.append(warn(code, m, cell=cell, url=h))                                    # noqa: E731
    wide = is_wide(cell)
    extra = {'th_chrome': 1}
    ctx, page, probe = w.cell(cell, tm='view', reduced_motion=True)
    openers = ['#btn-search', '#btn-period', '#btn-more'] if wide else ['#btn-search', '#btn-period', '#btn-menu']
    try:
        for scheme in ('light', 'dark'):
            page.emulate_media(color_scheme=scheme, forced_colors='none')
            o = w.open(cell, h, tm='view', reduced_motion=True)
            if not o.ok:
                fs += collect(o, '', cell, h) + [fail('timeout', f'{scheme}: {o.why}', cell=cell, url=h)]
                continue

            def forced(tag, scopes):
                page.emulate_media(forced_colors='active')
                try:
                    page.wait_for_timeout(60)
                    r = page.evaluate(TH_FORCED_JS, [scopes, True])
                finally:
                    page.emulate_media(forced_colors='none')
                extra['th_forced'] = extra.get('th_forced', 0) + r['n']
                th_report_forced(r, tag, W)

            forced(f'the chrome in forced colours ({scheme})', ['#topbar', '#sidenav', '#tabbar', '#mockbar', '#footer'])
            for sel in openers:
                if not page.evaluate("(s) => { const b = document.querySelector(s); if (!b) return false; const r = b.getBoundingClientRect(), c = getComputedStyle(b); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden'; }", sel):
                    continue
                page.click(sel)
                if not wait_there(page, TH_OVERLAY_SEL):
                    W('theme-overlay', f'{sel} opens no overlay; the chrome job could not examine it')
                    continue
                if sel == '#btn-search':
                    page.keyboard.type('бюджет')
                    wait_for(page, "() => !!document.querySelector('.pal-item')", None, 2500)
                tag = f'{sel} overlay ({scheme})'
                th_report_contrast(page.evaluate(TH_CONTRAST_JS), tag, F, W)
                forced(f'the {tag} in forced colours', [TH_OVERLAY_SEL])
                page.keyboard.press('Escape')
                wait_gone(page, TH_OVERLAY_SEL)
                extra['th_overlays'] = extra.get('th_overlays', 0) + 1
            fs += collect(o, '', cell, h)
    finally:
        try:
            page.emulate_media(color_scheme=CELLS[cell]['scheme'], forced_colors='none')
        except Exception:                                                                 # noqa: BLE001
            pass
    return fs, extra


@planner
def plan_theme(args, d, routes, cells):
    if True or not wants(args, 'theme') or args.quick:      # v5 (as v4): light only, the theme family does not exist
        return []
    wide = next((c for c in cells if is_wide(c)), cells[0])
    narrow = next((c for c in cells if not is_wide(c) and CELLS[c]['scheme'] != CELLS[wide]['scheme']), None) or next((c for c in cells if not is_wide(c)), cells[0])
    pair = list(dict.fromkeys([wide, narrow]))
    jobs = []
    if not args.route:                                   # the matrix and the chrome do not depend on a screen
        jobs.append(dict(kind='theme', route='', cell='1280-light', hash='#/nyama-takava', tag='matrix'))
        for c in pair:
            jobs.append(dict(kind='theme-chrome', route='', cell=c, hash='#/razhodi', tag='chrome'))
    for k, r in enumerate(routes):
        jobs.append(dict(kind='theme-store', route=r['id'], cell=pick_cell(cells, k), hash=r['samples'][0], tag='store'))
        if r.get('bare'):                                # the embed view ignores the visitor's preferences
            continue
        for c in ([pick_cell(pair, k)] if args.quick else pair):
            jobs.append(dict(kind='theme-view', route=r['id'], cell=c, hash=r['samples'][0], tag='view'))
    return jobs


# ==== JOBS-END ====  (job families are inserted above this line; the planner, the pool and the report follow)

# =================================================================================================================== CLI
def parse_args(argv=None):
    ap = argparse.ArgumentParser(prog='check_mock.py', description='End-to-end checks for the Mock prototype (see the module docstring).',
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--route', action='append', default=[], metavar='ID|KEY[,..]')
    ap.add_argument('--cells', default='', metavar='CELL[,..]')
    ap.add_argument('--only', default='', metavar='FAMILY[,..]')
    ap.add_argument('--skip', default='', metavar='FAMILY[,..]')
    ap.add_argument('--shots', action='store_true')
    ap.add_argument('--url', default='')
    ap.add_argument('--jobs', type=int, default=0)
    ap.add_argument('--axe', default='', metavar='FILE|URL')
    ap.add_argument('--strict', action='store_true')
    ap.add_argument('--no-values', dest='no_values', action='store_true')
    ap.add_argument('-v', '--verbose', action='store_true')
    ap.add_argument('--timeout', type=int, default=15000)
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args(argv)
    split = lambda s: [x.strip() for x in s.split(',') if x.strip()]                       # noqa: E731
    a.route = [x.strip() for v in a.route for x in v.split(',') if x.strip()]
    a.cells = split(a.cells)
    a.only, a.skip = split(a.only), split(a.skip)
    for c in a.cells:
        if c not in CELLS:
            ap.error(f'unknown cell "{c}" (choose from {", ".join(CELLS)})')
    for f in a.only + a.skip:
        if f not in FAMILIES:
            ap.error(f'unknown family "{f}" (choose from {", ".join(FAMILIES)})')
    return a


def wants(args, fam):
    if args.only:
        return fam in args.only
    if fam in args.skip:
        return False
    if fam in DEFAULT_OFF and not getattr(args, fam, False):
        return False
    return True


def default_jobs():
    cpu = os.cpu_count() or 4
    try:
        busy = os.getloadavg()[0] > cpu * 0.6
    except OSError:
        busy = False
    return max(2, min(3 if busy else 5, cpu // 2))


# ================================================================================================================ planner
def with_query(h, **q):
    sep = '&' if '?' in h else '?'
    return h + sep + '&'.join(f'{k}={v}' for k, v in q.items())


def select_routes(routes, wanted):
    if not wanted:
        return list(routes)
    out, bad = [], []
    for w in wanted:
        hit = [r for r in routes if r['id'].lower() == w.lower() or r['key'].lower() == w.lower()]
        if hit:
            out += [r for r in hit if r not in out]
        else:
            bad.append(w)
    if bad:
        raise SystemExit(f'unknown route(s): {", ".join(bad)} (known: {", ".join(r["id"] + "=" + r["key"] for r in routes)})')
    return out


DEMO_CELL_ROUTES = ['S01', 'S06', 'S28']             # the demo states are also run in the other three cells for these screens
QUICK_DEMO_ROUTES = ['S01', 'S06', 'S28', 'S30']


def plan(args, d):
    routes = select_routes(d['routes'], args.route)
    cells = args.cells or (QUICK_CELLS if args.quick else list(CELLS))
    jobs = []
    for r in routes:
        if not r.get('samples'):                       # S30 has no pattern: any unknown address shows it
            r['samples'] = ['#' + r['pattern']] if r.get('pattern') else [NEGATIVE_URLS[0]]
    if wants(args, 'base'):
        for r in routes:
            for si, h in enumerate(r['samples'][:1] if args.quick else r['samples']):
                for cell in cells:
                    jobs.append(dict(kind='base', route=r['id'], cell=cell, hash=h, deep=not args.quick, no_values=args.no_values,
                                     shot=(f'{r["id"]}-{cell}' if args.shots and si == 0 else None)))
    if wants(args, 'demo'):
        first = cells[0]
        for r in routes:
            if args.quick and r['id'] not in QUICK_DEMO_ROUTES:
                continue
            h = r['samples'][0]
            for demo in DEMOS + [OFFLINE_DEMO]:
                for cell in ([first] if (args.quick or r['id'] not in DEMO_CELL_ROUTES) else cells):
                    jobs.append(dict(kind='demo', route=r['id'], cell=cell, hash=with_query(h, demo=demo), demo=demo, next=bool(r['next'])))
    for fam_plan in FAMILY_PLANNERS:
        jobs += fam_plan(args, d, routes, cells)
    return jobs




# ============================================================================================================ process pool
def _crash_result(j, code, msg):
    return {'job': {k: v for k, v in j.items() if k in ('kind', 'route', 'cell', 'hash', 'tag')}, 'dur': 0.0, 'extra': {},
            'findings': [dataclasses.asdict(fail(code, msg, route=j.get('route', ''), cell=j.get('cell', ''), url=j.get('hash', '')))]}


class Pool:
    def __init__(self, base, opts, n):
        self.base, self.opts, self.n = base, opts, n
        self.ex = None

    def start(self):
        self.ex = cf.ProcessPoolExecutor(max_workers=self.n, mp_context=multiprocessing.get_context('spawn'),
                                         initializer=_worker_init, initargs=(self.base, self.opts))

    def kill(self):
        try:
            for p in list(self.ex._processes.values()):          # noqa: SLF001 - no public way to kill a stuck worker
                p.kill()
        except Exception:
            pass
        try:
            self.ex.shutdown(wait=False, cancel_futures=True)
        except Exception:
            pass

    def stop(self):
        try:
            self.ex.shutdown(wait=True, cancel_futures=True)
        except Exception:
            self.kill()

    def run(self, jobs, on_result, stall=150):
        todo = list(jobs)
        for attempt in (1, 2):
            futs = {self.ex.submit(run_job, j): j for j in todo}
            todo, not_done, broken = [], set(futs), False
            while not_done:
                done, not_done = cf.wait(not_done, timeout=stall, return_when=cf.FIRST_COMPLETED)
                if not done:                                       # nothing finished for `stall` seconds: some page hangs
                    hung = [f for f in not_done if f.running()] or list(not_done)
                    for f in hung:
                        on_result(_crash_result(futs[f], 'hang', f'no result within {stall} s - the page or the checker hangs'))
                    todo += [futs[f] for f in not_done if f not in hung]
                    broken = True
                    break
                for f in done:
                    try:
                        on_result(f.result())
                    except cf.process.BrokenProcessPool:
                        broken = True
                        todo.append(futs[f])
                    except Exception as e:                         # noqa: BLE001
                        on_result(_crash_result(futs[f], 'checker-error', f'{type(e).__name__}: {e}'))
            if not broken:
                return
            self.kill()
            if not todo:
                return
            if attempt == 1:
                self.start()
        for j in todo:
            on_result(_crash_result(j, 'infrastructure', 'the browser process died twice while running this check'))


# ==== PART2C-END ====

# ======================================================================================================== axe-core (hook)
AXE_JS = """async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, t: v.nodes.slice(0, 2).map(n => n.target.join(' ')) }));
}"""


def axe_findings(page, src, route, cell, url):
    if not page.evaluate('() => !!window.axe'):
        page.evaluate(src)                                       # injected from here: the page itself never fetches anything
    return [fail('axe', f'{v["id"]} ({v["impact"]}): {v["help"]} - {v["n"]} node(s), e.g. {"; ".join(v["t"])}', route=route, cell=cell, url=url)
            for v in page.evaluate(AXE_JS)]


def axe_source(spec):
    if re.match(r'https?://', spec):
        with urllib.request.urlopen(spec, timeout=30) as r:       # fetched by this process only
            return r.read().decode('utf-8')
    return Path(spec).read_text(encoding='utf-8')


# ================================================================================================================= report
def merged(fs):
    groups, order = {}, []
    for f in fs:
        k = (f.level, f.code, f.route, f.msg)
        if k not in groups:
            groups[k] = {'f': f, 'cells': [], 'urls': []}
            order.append(k)
        g = groups[k]
        if f.cell and f.cell not in g['cells']:
            g['cells'].append(f.cell)
        if f.url and f.url not in g['urls']:
            g['urls'].append(f.url)
    return [groups[k] for k in order]


def cells_label(cells):
    return 'all cells' if cells and set(cells) == set(CELLS) else ', '.join(cells)


def route_key(r):
    m = re.match(r'S(\d+)$', r or '')
    return (0, int(m.group(1))) if m else (1, 0)


def print_report(findings, args, d, stats):
    titles = {r['id']: r['title'] for r in (d or {}).get('routes', [])}
    fails = merged([f for f in findings if f.level == 'fail'])
    warns = [f for f in findings if f.level == 'warn']
    out = []
    if fails:
        out.append(f'\nFAILURES ({len(fails)})')
        by = defaultdict(list)
        for g in fails:
            by[g['f'].route].append(g)
        for rid in sorted(by, key=route_key):
            out.append(f'  {rid or "general"}  {titles.get(rid, "")}'.rstrip())
            for g in by[rid]:
                f = g['f']
                urls = g['urls'] if args.verbose else g['urls'][:2]
                out.append(f'    [{f.code}] {cells_label(g["cells"])}  {" ".join(urls)}'.rstrip() + (' ...' if len(g['urls']) > len(urls) else ''))
                out.append(f'        {f.msg}')
    stubs = sorted({f.route for f in warns if f.code == 'stub'}, key=route_key)
    rest = [f for f in warns if f.code != 'stub']
    if rest:
        pend = defaultdict(set)
        for f in rest:
            if f.code == 'pending-data':
                pend[f.msg.split(' -> ')[0]].add(f.route)
        out.append(f'\nWARNINGS ({len(merged(rest))})')
        if pend:
            out.append('  [pending-data] data files that are not there yet: ' + ', '.join(f'{p} ({len(r)} screens)' for p, r in sorted(pend.items())))
        by = defaultdict(list)
        for g in merged([f for f in rest if f.code != 'pending-data']):
            by[g['f'].code].append(g)
        for code in sorted(by, key=lambda c: -len(by[c])):
            gs = by[code]
            routes = sorted({g['f'].route for g in gs}, key=route_key)
            out.append(f'  [{code}] x{len(gs)} on {", ".join(r or "general" for r in routes[:12])}{" ..." if len(routes) > 12 else ""}')
            for g in (gs if args.verbose else gs[:2]):
                out.append(f'      {g["f"].route or "general"} {cells_label(g["cells"])}: {g["f"].msg}')
    if stubs:
        out.append(f'\nSTUBS ({len(stubs)}, generic checks only{" - counted as failures with --strict" if args.strict else ""}): ' + ' '.join(stubs))
    print('\n'.join(out))


def run_summary(findings, args, d, stats, t0):
    nf = len(merged([f for f in findings if f.level == 'fail']))
    nw = len(merged([f for f in findings if f.level == 'warn' and f.code != 'stub']))
    ns = len({f.route for f in findings if f.code == 'stub'})
    infra = any(f.code in ('infrastructure', 'discover') for f in findings)
    strict_fail = args.strict and (nw or ns)
    code = 2 if infra else (1 if (nf or strict_fail) else 0)
    nroutes = len({r['id'] for r in (d or {}).get('routes', [])}) if not args.route else len(select_routes(d['routes'], args.route))
    slow = sorted(stats['durs'], reverse=True)[:3]
    print(f'\nroutes {nroutes} · checks {stats["jobs"]} · browsers {stats["n"]} · {time.time() - t0:.0f} s · '
          f'failures {nf} · warnings {nw} · stubs {ns}'
          + (' · slowest ' + ', '.join(f'{k} {v:.1f}s' for v, k in slow) if slow else ''))
    print('RESULT: ' + ('INFRASTRUCTURE ERROR' if infra else ('FAIL' if code else 'PASS')) + f' (exit {code})')
    return code


# ========================================================================================================= orchestrator
def main(argv=None):
    args = parse_args(argv)
    t0 = time.time()
    server = None
    if args.url:
        base = args.url.split('#')[0].split('?')[0]
        if not base.endswith('/'):
            base = base[:base.rfind('/') + 1] if '.' in base.rsplit('/', 1)[-1] else base + '/'
    else:
        if not (SITE / 'index.html').is_file():
            print(f'check_mock: {SITE / "index.html"} does not exist', file=sys.stderr)
            return 2
        server = Server().start()
        base = server.base
    opts = dict(timeout=args.timeout, axe=axe_source(args.axe) if args.axe else '', sw=False)
    n = args.jobs or default_jobs()
    pool = Pool(base, opts, n)
    findings, stats, d = [], dict(jobs=0, n=n, durs=[]), None
    extras = []

    def on_result(r):
        stats['jobs'] += 1
        fs = [Finding(**x) for x in r['findings']]
        findings.extend(fs)
        j = r['job']
        stats['durs'].append((r['dur'], f'{j.get("route", "")}/{j.get("kind")}/{j.get("cell", "")}'.strip('/')))
        extras.append((j, r['extra']))
        ch = 'F' if any(f.level == 'fail' for f in fs) else ('w' if any(f.level == 'warn' and f.code not in ('stub', 'pending-data') for f in fs) else '.')
        sys.stdout.write(ch)
        if stats['jobs'] % 100 == 0:
            sys.stdout.write(f' {stats["jobs"]}\n')
        sys.stdout.flush()

    try:
        pool.start()
        first = []
        pool.run([{'kind': 'discover'}], first.append)
        res = first[0] if first else None
        bad = [Finding(**x) for x in res['findings'] if x['level'] == 'fail'] if res else []
        d = res['extra'] if res and res['extra'].get('routes') else None
        if d is None:
            print('\ncheck_mock: cannot read the route table', file=sys.stderr)
            for f in bad:
                print(f'  [{f.code}] {f.msg}', file=sys.stderr)
            return 2
        findings.extend(Finding(**x) for x in res['findings'])
        print(f'check_mock: {len(d["routes"])} routes · base {base} · {n} browsers' + (' · QUICK' if args.quick else ''))
        jobs = plan(args, d)
        if args.list:
            kinds = defaultdict(int)
            for j in jobs:
                kinds[j['kind']] += 1
            print('plan:', ', '.join(f'{k} {v}' for k, v in sorted(kinds.items())), f'= {len(jobs)} checks')
            return 0
        pool.run(jobs, on_result)
        findings.extend(value_findings(extras, args.quick))
        print()
        print_report(findings, args, d, stats)
        return run_summary(findings, args, d, stats, t0)
    except KeyboardInterrupt:
        print('\ninterrupted', file=sys.stderr)
        return 2
    finally:
        try:
            pool.stop()
        except Exception:
            pass
        if server:
            server.stop()


if __name__ == '__main__':
    sys.exit(main())
