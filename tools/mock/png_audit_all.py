#!/usr/bin/env python3
"""Controller audit: export every shareable block (menu 'Изтегли PNG') on every route's first sample page of a Mock site (every sample with ALL_SAMPLES=1). Sandbox off.
usage: png_audit_all.py BASE OUTDIR [WIDTH] [ROUTE_IDS comma list]"""
import os, sys, json, functools
print = functools.partial(print, flush=True)
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/') + '/'
OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1280
ONLY = set(sys.argv[4].split(',')) if len(sys.argv) > 4 and sys.argv[4] else None

READY = "() => { const a = document.querySelector('#view article.page'); return a && a.dataset.ready === '1'; }"
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': W, 'height': 900}, service_workers='block', accept_downloads=True)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)[:120]))
    pg.on('console', lambda m: errs.append('CONSOLE ' + m.text[:160]) if m.type == 'error' else None)
    pg.goto(BASE)
    pg.wait_for_function(READY, timeout=25000)
    routes = pg.evaluate("() => (window.__ROUTES__ || []).map(r => ({id: r.id, key: r.key, pattern: r.pattern, samples: r.samples || []}))")
    print('routes', len(routes))
    rows = []
    for r in routes:
        if ONLY and r['id'] not in ONLY:
            continue
        if not r.get('pattern') and not r['samples']:
            continue
        samples = r['samples'] or ['#' + r['pattern']]
        for si, hsh in enumerate(samples if os.environ.get('ALL_SAMPLES') else samples[:1]):
          if ':' in hsh:
            print('SKIP', r['id'], hsh); continue
          pg.evaluate("h => { location.hash = h; }", hsh)
          try:
            pg.wait_for_function(READY, timeout=25000)
          except Exception as e:
            print('NOT READY', r['id'], hsh); continue
          pg.wait_for_timeout(1300)
          ids = pg.eval_on_selector_all('#view [data-share]', 'els => els.map(e => e.dataset.share)')
          print('==', r['id'], hsh, len(ids), 'blocks')
          for i, bid in enumerate(ids):
            sel = '#view [data-share="%s"]' % bid
            try:
                loc = pg.locator(sel).first
                if not loc.is_visible():                       # the block sits in an inactive tab: another sample page shows it
                    print('   hidden:', bid); continue
                loc.scroll_into_view_if_needed(); loc.click()
                pg.wait_for_selector('.share-menu', timeout=5000)
                png = pg.locator('.share-menu [data-act="png"]')
                if png.count() == 0:
                    print('   no png:', bid); pg.keyboard.press('Escape'); continue
                with pg.expect_download(timeout=30000) as dl:
                    png.first.click()
                f = OUT / ('%s%s_%02d_%s.png' % (r['id'], '' if si == 0 else chr(96 + si), i, ''.join(c if c.isalnum() or c in '-_' else '-' for c in bid)[:40]))
                dl.value.save_as(str(f))
                rows.append((r['id'], bid, f.name, f.stat().st_size))
            except Exception as e:
                print('   FAIL', bid, str(e)[:90])
                try: pg.keyboard.press('Escape')
                except Exception: pass
            pg.wait_for_timeout(250)
    (OUT / 'index.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    print('saved', len(rows), 'errors', errs[:5], flush=True)
    ctx.close(); b.close()
