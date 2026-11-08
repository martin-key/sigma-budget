#!/usr/bin/env python3
"""Check retired addresses against current routes, preserving their query context."""


from pathlib import Path as _Path
import http.server, os, socketserver, sys, threading
from pathlib import Path
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parents[2]            # repository root
SITE = __import__("tests.e2e.static_assets", fromlist=["root"]).root()                                 # the site: current site
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / "tmp" / "pw-browsers"))

# old address -> (screen id, final path, query keys with their wanted values (None = any value, but present), keys that must be gone)
CASES = [
    ("#/deystvie?tab=otkrij", "S01", "/", {}, ["tab"]),
    ("#/deystvie?tab=sravni", "S01", "/", {}, ["tab"]),
    ("#/moyat-byudzhet", "S07", "/razhodi", {}, []),
    ("#/moyat-byudzhet?per=2026.law", "S07", "/razhodi", {}, []),
    ("#/razhodi/obrazovanie/deynosti", "S08", "/razhodi/obrazovanie", {}, []),
    ("#/klasacii", "S07", "/razhodi", {}, []),
    ("#/klasacii?tab=godini", "S07", "/razhodi", {}, ["tab"]),
    ("#/proekti", "S10", "/vedomstva", {"tab": "programi"}, []),
    ("#/proekti/pr-01", "S10", "/vedomstva", {"tab": "programi"}, []),
    ("#/plashtania", "S15", "/izpalnenie", {}, []),
    ("#/plashtania/999000012", "S15", "/izpalnenie", {}, []),
    ("#/izpalnenie/pera", "S15", "/izpalnenie", {"pera": "rev,exp"}, []),
    ("#/izpalnenie/sravnenie?g1=2024&g2=2026&mesec=3&obhvat=nat", "S15", "/izpalnenie", {"g1": "2024", "g2": "2026", "mesec": "3", "obhvat": "nat", "rez": "mesec"}, []),
    ("#/izpalnenie?ed=1&prag=2", "S15", "/izpalnenie", {}, ["ed", "prag"]),
    ("#/izpalnenie?pok=saldo", "S15", "/izpalnenie", {"pokazatel": "balance"}, ["pok"]),
    ("#/razhodi?po=vedomstva", "S10", "/vedomstva", {}, ["po"]),
    ("#/razhodi?po=vid", "S07", "/razhodi", {"po": "vid"}, []),
    # the guide (S02) is merged into «Бюджетът за 5 минути»: step N -> the scene of that step; step 8 -> the calculator
    ("#/patevoditel", "S04", "/5-minuti", {}, []),
    ("#/patevoditel/2", "S04", "/5-minuti", {"to": "s04-scene2"}, []),
    ("#/patevoditel/4", "S04", "/5-minuti", {"to": "s04-scene5"}, []),
    ("#/patevoditel/7", "S04", "/5-minuti", {"to": "s04-scene4"}, []),
    ("#/patevoditel/8", "S18", "/danaci", {}, []),
]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


def main():
    from playwright.sync_api import sync_playwright
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    bad = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, service_workers="block", reduced_motion="reduce")
        ctx.add_init_script("window.__HASH_ROUTES__ = true")   # V7: the app opens on paths (/prihodi); this check drives the hash addresses (js/loc.js hash mode)
        for old, sid, path, want, gone in CASES:
            page = ctx.new_page()
            errs = []
            page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append("EXC " + str(e)[:160]))
            page.goto("http://127.0.0.1:%d/index.html%s" % (port, old))
            try:
                page.wait_for_function("(id) => { const a = document.querySelector('#view article.page'); return !!a && a.dataset.route === id && a.dataset.ready === '1'; }", arg=sid, timeout=8000)
                ok_screen = True
            except Exception:
                ok_screen = False
            h = page.evaluate("() => location.hash")
            got_path, _, qs = h[1:].partition("?")
            q = {k: v[0] for k, v in parse_qs(qs).items()}
            why = []
            if not ok_screen:
                why.append("screen is not %s" % sid)
            if got_path != path:
                why.append("path %s != %s" % (got_path, path))
            for k, v in want.items():
                if q.get(k) != v:
                    why.append("?%s=%r, want %r" % (k, q.get(k), v))
            for k in gone:
                if k in q:
                    why.append("?%s should be gone" % k)
            if errs:
                why.append("console: %s" % errs[:2])
            bad += bool(why)
            print("%-4s %-70s -> %s%s" % ("FAIL" if why else "ok", old, h, ("   " + "; ".join(why)) if why else ""))
            page.close()
        b.close()
    srv.shutdown()
    print("redirects: %d case(s), %d problem(s)" % (len(CASES), bad))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
