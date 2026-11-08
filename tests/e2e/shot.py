#!/usr/bin/env python3
"""shot.py - serve the current site locally and take screenshots / quick probes (project venv only).

  PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.shot OUTDIR 1280,390 'home=#/' 'izp=#/izpalnenie' [--full] [--zoom 2]
  Each target is name=hash (or just a hash). One PNG per target and width: OUTDIR/<name>-<width>.png.
  Prints per shot: console errors, failed requests, horizontal overflow of the page (px), h1 text.
  --full      full-page screenshot (default: first viewport only, 1280x900 / Wx844)
  --zoom N    browser zoom via CSS zoom on <html> (200% test: width stays, content doubles)
  --eval JS   run JS after load and print its JSON result
"""


from pathlib import Path as _Path
import http.server, json, os, socketserver, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # repository root
SITE = __import__("tests.e2e.static_assets", fromlist=["root"]).root()                                 # the site: current site
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / "tmp" / "pw-browsers"))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


def serve():
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def main():
    from playwright.sync_api import sync_playwright
    args = [a for a in sys.argv[1:]]
    full = "--full" in args
    zoom = None
    ev = None
    if "--zoom" in args:
        i = args.index("--zoom"); zoom = float(args[i + 1]); del args[i:i + 2]
    if "--eval" in args:
        i = args.index("--eval"); ev = args[i + 1]; del args[i:i + 2]
    args = [a for a in args if a != "--full"]
    out = Path(args[0]); out.mkdir(parents=True, exist_ok=True)
    widths = [int(w) for w in args[1].split(",")]
    targets = []
    for t in args[2:]:
        if "=" in t and not t.startswith("#"):
            n, h = t.split("=", 1)
        else:
            n, h = t.strip("#/").replace("/", "_").replace("?", "_").replace("=", "-") or "home", t
        targets.append((n, h))
    srv, port = serve()
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w in widths:
            ctx = b.new_context(viewport={"width": w, "height": 900 if w >= 700 else 844}, service_workers="block", reduced_motion="reduce",
                                has_touch=w < 700, device_scale_factor=1)
            for n, h in targets:
                page = ctx.new_page()
                errs, bad = [], []
                page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
                page.on("pageerror", lambda e: errs.append("EXC " + str(e)[:160]))
                page.on("requestfailed", lambda r: bad.append(r.url[-60:]))
                page.goto("http://127.0.0.1:%d/index.html%s" % (port, h if h.startswith("#") else "#" + h))
                try:
                    page.wait_for_selector("#content h1, main h1, h1", timeout=8000)
                except Exception:
                    pass
                page.wait_for_timeout(900)
                if zoom:
                    page.evaluate("z => { document.documentElement.style.zoom = z }", zoom)
                    page.wait_for_timeout(300)
                info = page.evaluate("""() => ({h1: (document.querySelector('h1')||{}).textContent,
                    ov: document.documentElement.scrollWidth - document.documentElement.clientWidth, H: document.documentElement.scrollHeight})""")
                if ev:
                    print("  eval:", json.dumps(page.evaluate(ev), ensure_ascii=False)[:1500])
                f = out / ("%s-%d.png" % (n, w))
                page.screenshot(path=str(f), full_page=full)
                print("%-34s %4d  h1=%r overflow=%s height=%s errs=%s bad=%s" % (n, w, (info["h1"] or "")[:50], info["ov"], info["H"], errs[:3], bad[:2]))
                page.close()
            ctx.close()
        b.close()
    srv.shutdown()


if __name__ == "__main__":
    main()
