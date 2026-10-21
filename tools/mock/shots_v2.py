#!/usr/bin/env python3
"""Screenshots of a site folder for the visual comparison (BEFORE = the tag mock-v1, AFTER = the tag mock-v2, each extracted into tmp/versions/).

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/shots_v2.py \
      --site tmp/versions/site-v1 --tag before [--routes S01,S02] [--cells 1440-light,400-dark] [--full S01,S06]

Serves the folder from a throw-away local http.server (no network), opens every route at 1440x900 and 400x850, light and dark,
waits for the page to be ready (data-ready=1, charts drawn) and saves <tag>-<route>-<width>-<scheme>.png into tmp/shots-v2/ (--out).
Animations are off (reduced motion) so no chart is caught half-way. --full lists the routes that also get a full-page shot.
"""
import argparse
import functools
import http.server
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parents[2] / 'tmp' / 'shots-v2'     # default output folder (gitignored)
ROUTES = {'S01': '#/', 'S02': '#/patevoditel', 'S05': '#/pari', 'S06': '#/prihodi', 'S13': '#/prognoza', 'S31': '#/bvp', 'S32': '#/moyat-byudzhet'}
CELLS = {
    '1440-light': dict(w=1440, h=900, scheme='light'), '1440-dark': dict(w=1440, h=900, scheme='dark'),
    '400-light': dict(w=400, h=850, scheme='light'), '400-dark': dict(w=400, h=850, scheme='dark'),
}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', required=True)
    ap.add_argument('--tag', required=True)
    ap.add_argument('--routes', default=','.join(ROUTES))
    ap.add_argument('--cells', default=','.join(CELLS))
    ap.add_argument('--full', default='')
    ap.add_argument('--out', default=str(HERE))
    a = ap.parse_args()
    site = Path(a.site).resolve()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(Quiet, directory=str(site))
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}/'
    full = {x for x in a.full.split(',') if x}
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for cell in a.cells.split(','):
            c = CELLS[cell]
            ctx = b.new_context(viewport={'width': c['w'], 'height': c['h']}, color_scheme=c['scheme'], reduced_motion='reduce', service_workers='block')
            pg = ctx.new_page()
            pg.on('console', lambda m: errors.append(f'{cell} console {m.type}: {m.text}') if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'{cell} pageerror: {e}'))
            for r in a.routes.split(','):
                pg.goto(base + ROUTES[r])
                pg.reload()
                try:
                    pg.wait_for_selector('.page[data-ready="1"]', timeout=12000)
                except Exception:
                    errors.append(f'{cell} {r}: page never became ready')
                pg.wait_for_timeout(700)
                pg.screenshot(path=str(out / f'{a.tag}-{r}-{cell}.png'))
                if r in full:
                    pg.screenshot(path=str(out / f'{a.tag}-{r}-{cell}-full.png'), full_page=True)
            ctx.close()
        b.close()
    srv.shutdown()
    for e in errors:
        print('!!', e)
    print('done', a.tag, len(errors), 'problems')


if __name__ == '__main__':
    main()
