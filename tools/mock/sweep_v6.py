#!/usr/bin/env python3
"""sweep_v5.py - open many hashes of site/ (version v6, tag mock-v6) and print only the problems (console errors, failed requests, h1 missing, overflow).

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/sweep_v6.py WIDTH FILE_OR_HASH...
  A FILE has one hash per line ('#/izpalnenie'); lines starting with '=' print all rows. Exit code 1 when a problem was found.
"""
import http.server, os, socketserver, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # repository root
SITE = ROOT / "site"                                 # the Mock application: run this at the tag mock-v6
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".pw-browsers"))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


def main():
    from playwright.sync_api import sync_playwright
    w = int(sys.argv[1])
    hashes = []
    for a in sys.argv[2:]:
        if a.startswith("#"):
            hashes.append(a)
        else:
            hashes += [l.strip() for l in open(a, encoding="utf8") if l.strip().startswith("#")]
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    problems = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": w, "height": 900}, service_workers="block", reduced_motion="reduce")
        for h in hashes:
            page = ctx.new_page()
            errs, bad = [], []
            page.on("console", lambda m: errs.append(m.text[:140]) if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append("EXC " + str(e)[:140]))
            page.on("requestfailed", lambda r: bad.append(r.url[-50:]))
            page.on("response", lambda r: bad.append("%s %s" % (r.status, r.url[-50:])) if r.status >= 400 else None)
            page.goto("http://127.0.0.1:%d/index.html%s" % (port, h))
            try:
                page.wait_for_selector("h1", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(500)
            info = page.evaluate("""() => ({h1: (document.querySelector('h1')||{}).textContent || '',
              ov: document.documentElement.scrollWidth - document.documentElement.clientWidth, loc: location.hash})""")
            flag = bool(errs or bad or not info["h1"] or info["ov"] > 1)
            if flag:
                problems += 1
            if flag or "-v" in os.environ.get("SWEEP", ""):
                print("%-44s -> %-34s h1=%r ov=%s errs=%s bad=%s" % (h, info["loc"][:34], info["h1"][:40], info["ov"], errs[:2], bad[:2]))
            page.close()
        b.close()
    srv.shutdown()
    print("checked %d, with problems %d (width %d)" % (len(hashes), problems, w))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
