#!/usr/bin/env python3
"""diff_routes_v5_v6.py - rendered-text diff of every existing route: v5 against v6 (v6 = site/, v5 = tmp/versions/site-v5: extract the tag mock-v5 there).

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/diff_routes_v5_v6.py [OUTDIR]     (default OUTDIR = tmp/rt)

For every route of the route table (all `samples`, and the first sample of each route in every period that the route supports, and the first
sample again at 400 px) the page is opened in a fresh browser context in BOTH sites, and these are compared once the screen has settled:
  view   the text of #view as rendered (innerText) and as it stands in the DOM (textContent, so closed <details> and table twins count)
  links  every href inside #view
  frame  the text of the frame around it (top bar, side menu, tab bar, footer)
The new route S34 is left out (it does not exist in v5). Texts are written to OUTDIR/v5/NNN.txt and OUTDIR/v6/NNN.txt.
The summary says which URLs are IDENTICAL, which differ only in the one new menu entry (frame), and which differ in #view (listed with the diff).
"""
import difflib
import http.server
import json
import os
import re
import socketserver
import sys
import threading
from pathlib import Path

W = Path(__file__).resolve().parents[2]       # repository root
V5 = W / 'tmp' / 'versions' / 'site-v5'        # the older tree to compare with (not in the repository)
V6 = W / 'site'                                # the current Mock application
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', str(W / '.pw-browsers'))
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
SAVED = '--saved' in sys.argv           # compare the texts of an earlier run (no browser)
OUT = Path(ARGS[0]) if ARGS else W / 'tmp' / 'rt'

SETTLE = """() => {
  const v = document.getElementById('view');
  if (!v || v.getAttribute('aria-busy') === 'true') return false;
  const a = v.querySelector('article.page');
  if (!a || a.dataset.ready !== '1') return false;
  const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  for (const c of v.querySelectorAll('.chart')) { if (vis(c) && c.dataset.ready !== '1' && c.dataset.ready !== 'err') return false; }
  if (document.fonts && document.fonts.status === 'loading') return false;
  for (const i of v.querySelectorAll('img')) if (!i.complete) return false;
  return true;
}"""

EXTRACT = """() => {
  const norm = s => (s || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+/g, ' ').replace(/\\n\\s*\\n+/g, '\\n').trim();
  const v = document.getElementById('view');
  const frame = ['topbar', 'sidenav', 'tabbar', 'footer'].map(i => { const e = document.getElementById(i); return e ? norm(e.textContent) : ''; });
  return {
    title: document.title,
    h1: (v.querySelector('h1') || {}).textContent || '',
    inner: norm(v.innerText),
    text: norm(v.textContent),
    links: [...v.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
    frame: [...document.querySelectorAll('#topbar a, #sidenav a, #tabbar a, #footer a')].map(a => norm(a.textContent) + ' -> ' + a.getAttribute('href')),
    frameText: frame.join('\\n')
  };
}"""


def serve(site):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(site), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-cache')
            super().end_headers()
    s = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    s.daemon_threads = True
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def norm_host(r):
    """The two sites run on different local ports; absolute addresses that the page builds from its own origin must not count as a difference."""
    h = lambda x: re.sub(r'127\.0\.0\.1:\d+', 'HOST', x)
    return {k: (h(v) if isinstance(v, str) else [h(x) for x in v] if isinstance(v, list) and k != 'errors' else v) for k, v in r.items()}


def grab(browser, base, url, width):
    ctx = browser.new_context(viewport={'width': width, 'height': 900}, locale='bg-BG')
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(base + url)
    pg.wait_for_function(SETTLE, timeout=30000)
    pg.wait_for_timeout(350)
    r = pg.evaluate(EXTRACT)
    r = norm_host(r)
    r['errors'] = errs
    ctx.close()
    return r


def load_saved():
    """Rebuild jobs and results from OUTDIR/v5|v6/NNN.txt written by an earlier run."""
    jobs, res = [], {}
    for f in sorted((OUT / 'v5').glob('*.txt')):
        n = int(f.stem)
        for tag in ('v5', 'v6'):
            t = (OUT / tag / f.name).read_text(encoding='utf-8')
            head, rest = t.split('\n', 1)
            m = re.match(r'# (\S+) (\S+) @(\d+)', head)
            if tag == 'v5':
                jobs.append((m.group(1), m.group(2), int(m.group(3))))
            inner, rest = rest.split('\n\n=== textContent\n', 1)
            text, rest = rest.split('\n\n=== links\n', 1)
            links, frame = rest.split('\n\n=== frame\n', 1)
            res[(tag, n)] = norm_host({'title': '', 'inner': inner, 'text': text, 'links': links.split('\n') if links else [],
                                      'frame': frame.strip('\n').split('\n') if frame.strip() else [], 'frameText': '', 'errors': []})
    return jobs, res


def main():
    if not SAVED:
        from playwright.sync_api import sync_playwright
    jobs = []
    res = {}
    if SAVED:
        jobs, res = load_saved()
        print('compared from saved texts:', len(jobs))
    else:
        s5, s6 = serve(V5), serve(V6)
        b5, b6 = 'http://127.0.0.1:%d/' % s5.server_address[1], 'http://127.0.0.1:%d/' % s6.server_address[1]
    with (sync_playwright() if not SAVED else __import__('contextlib').nullcontext()) as pw:
      if not SAVED:
        br = pw.chromium.launch()
        pg = br.new_page()
        pg.goto(b5)
        pg.wait_for_function('() => !!window.__ROUTES__')
        routes5 = pg.evaluate('window.__ROUTES__')
        periods = pg.evaluate("import('/js/store.js').then(m => m.PERIODS.map(p => p.key))")
        pg.goto(b6)
        pg.wait_for_function('() => !!window.__ROUTES__')
        routes6 = pg.evaluate('window.__ROUTES__')
        pg.close()
        ids5 = {r['id'] for r in routes5}
        ids6 = {r['id'] for r in routes6}
        print('routes: v5 %d, v6 %d; only in v6: %s; only in v5: %s' % (len(ids5), len(ids6), sorted(ids6 - ids5), sorted(ids5 - ids6)))
        for r in routes5:
            sam = r.get('samples') or []
            for u in sam:
                jobs.append((r['id'], u, 1280))
            if sam:
                jobs.append((r['id'], sam[0], 400))
                if r.get('periods') not in ('none',):
                    for per in periods:
                        sep = '&' if '?' in sam[0] else '?'
                        jobs.append((r['id'], '%s%sper=%s' % (sam[0], sep, per), 1280))
        # the same addresses, once, in order
        seen, uniq = set(), []
        for j in jobs:
            if (j[1], j[2]) not in seen:
                seen.add((j[1], j[2]))
                uniq.append(j)
        jobs = uniq
        print('addresses to compare:', len(jobs))
        res = {}
        for tag, base in (('v5', b5), ('v6', b6)):
            (OUT / tag).mkdir(parents=True, exist_ok=True)
            for n, (rid, url, w) in enumerate(jobs):
                try:
                    r = grab(br, base, url, w)
                except Exception as e:           # a timeout is reported, not hidden
                    r = {'title': '', 'h1': '', 'inner': 'ERROR %s' % str(e).split('\n')[0], 'text': '', 'links': [], 'frame': [], 'frameText': '', 'errors': []}
                res[(tag, n)] = r
                (OUT / tag / ('%03d.txt' % n)).write_text('# %s %s @%d\n%s\n\n=== textContent\n%s\n\n=== links\n%s\n\n=== frame\n%s\n'
                                                          % (rid, url, w, r['inner'], r['text'], '\n'.join(r['links']), '\n'.join(r['frame'])), encoding='utf-8')
            print(tag, 'done')
        br.close()
    ident, frame_only, view_diff, errs = 0, [], [], []
    frame_added = {}
    for n, (rid, url, w) in enumerate(jobs):
        a, b = res[('v5', n)], res[('v6', n)]
        if b['errors'] or a['errors']:
            errs.append((rid, url, a['errors'], b['errors']))
        view_same = a['inner'] == b['inner'] and a['text'] == b['text'] and a['links'] == b['links'] and a['title'] == b['title']
        frame_same = a['frame'] == b['frame'] and a['frameText'] == b['frameText']
        if view_same and frame_same:
            ident += 1
            continue
        if view_same:
            fa = [x for x in b['frame'] if x not in a['frame']]
            fr = [x for x in a['frame'] if x not in b['frame']]
            key = (tuple(fa), tuple(fr))
            frame_added.setdefault(key, []).append((rid, url, w))
            frame_only.append((rid, url, w))
            continue
        d = list(difflib.unified_diff(a['text'].split('\n'), b['text'].split('\n'), 'v5', 'v6', lineterm='', n=0))
        dl = list(difflib.unified_diff(a['links'], b['links'], 'v5', 'v6', lineterm='', n=0))
        view_diff.append((rid, url, w, d[2:12], dl[2:8], a['title'] != b['title']))
    print()
    print('SUMMARY  addresses %d: identical %d, differ only in the frame (menu) %d, differ in #view %d, with page errors %d'
          % (len(jobs), ident, len(frame_only), len(view_diff), len(errs)))
    for (fa, fr), lst in frame_added.items():
        print('  frame difference on %d addresses: added %s, removed %s' % (len(lst), list(fa), list(fr)))
    for rid, url, w, d, dl, t in view_diff:
        print('  VIEW DIFF %s %s @%d%s' % (rid, url, w, '  (document title differs)' if t else ''))
        for x in d:
            print('      ' + x[:230])
        for x in dl:
            print('      link ' + x[:230])
    for e in errs:
        print('  PAGE ERROR', e)
    by_route = {}
    for rid, url, w, *_ in view_diff:
        by_route.setdefault(rid, 0)
        by_route[rid] += 1
    print('routes with a #view difference:', by_route or 'none')
    return 0


if __name__ == '__main__':
    sys.exit(main())
