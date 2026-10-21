#!/usr/bin/env python3
"""hrefs_v5.py - every in-app address ('#/...') written in the data files and in the JS of site/ (version v5, tag mock-v5) must reach an ACTIVE screen.

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/hrefs_v5.py [--all]

Collects each '#/path?query' found in site/data/**/*.json and site/js/**/*.js (not in comments), then asks the site's own router
(js/routes.js match + js/redirects.js redirectHash, loaded in a browser) where it leads:
  OK          matches an active route directly
  REDIRECT    an old address that the redirect table moves (listed so the data can be rewritten to the new address)
  DEAD        matches no route and no redirect (a broken link)
Exit 1 when a DEAD address exists.
"""
import http.server, json, os, re, socketserver, sys, threading
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # repository root
SITE = ROOT / "site"                                 # the Mock application: run this at the tag mock-v5
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".pw-browsers"))
HREF = re.compile(r"(?<![\w&])#/[A-Za-z0-9_\-/.:%+]*(?:\?[A-Za-z0-9_=&,.%:+\-]*)?")


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


def collect():
    found = defaultdict(set)
    for p in sorted(SITE.rglob("*")):
        if p.suffix not in (".json", ".js") or "vendor" in p.parts:
            continue
        rel = str(p.relative_to(SITE))
        txt = p.read_text(encoding="utf-8")
        if p.suffix == ".js":
            txt = re.sub(r"^\s*//.*$", "", txt, flags=re.M)
        for m in HREF.finditer(txt):
            h = m.group(0).rstrip(".")
            if h in ("#/", "#/:") or len(h) < 3:
                continue
            found[h].add(rel)
    return found


def main():
    from playwright.sync_api import sync_playwright
    show_all = "--all" in sys.argv
    found = collect()
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(service_workers="block").new_page()
        page.goto("http://127.0.0.1:%d/index.html#/" % port)
        res = page.evaluate("""async hs => {
          const R = await import('./js/routes.js'), D = await import('./js/redirects.js');
          return hs.map(h => {
            const to = D.redirectHash(h);
            const s = (to || h).replace(/^#/, ''), qi = s.indexOf('?'), path = qi < 0 ? s : s.slice(0, qi);
            let m = null; try { m = R.match(path.split('/').filter(Boolean).map(decodeURIComponent)); } catch (e) {}
            const home = path.split('/').filter(Boolean).length === 0;
            return { h, to, id: m ? m.route.id : (home ? 'S01' : null) };
          });
        }""", sorted(found))
        b.close()
    srv.shutdown()
    cnt = defaultdict(int)
    for r in res:
        kind = "DEAD" if not r["id"] else ("REDIRECT" if r["to"] else "OK")
        cnt[kind] += 1
        if kind != "OK" or show_all:
            print("%-8s %-46s %s %s" % (kind, r["h"], ("-> %s %s" % (r["to"], r["id"])) if r["to"] else r["id"], sorted(found[r["h"]])[:4]))
    print("hrefs_v5: %d distinct addresses; OK %d, REDIRECT %d, DEAD %d" % (len(res), cnt["OK"], cnt["REDIRECT"], cnt["DEAD"]))
    sys.exit(1 if cnt["DEAD"] else 0)


if __name__ == "__main__":
    main()
