#!/usr/bin/env python3
"""perf.py - first paint, long tasks and scroll smoothness of the heaviest screens of web assets/ on a phone with a throttled CPU (V6, 27.10).  Project venv only.

  PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.perf [--rate 4] [--width 390] [--routes S05,S06,S07,S08] [--motion off]

  Per screen: FCP, time until the screen is ready (article[data-ready=1]), long tasks (>50 ms) while loading and while scrolling top to bottom in 12 steps, the longest task, the worst frame gap while scrolling, layout shifts of the screen.
  Motion is ON by default (the costs of motion.js on scroll are part of the measure). Limits (exit 1 when exceeded, at 4x throttle): ready <= 6 s, longest LOAD task <= 1000 ms (the one big task is the parse of vendor/echarts.min.js, 1 MB, loaded only by screens with charts: ~200 ms unthrottled),
  no long task at all while scrolling, worst scroll frame gap <= 250 ms."""


from pathlib import Path as _Path
import http.server, os, socketserver, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = __import__("tests.e2e.static_assets", fromlist=["root"]).root()
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / "tmp" / "pw-browsers"))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


INIT = """(() => { window.__lt = []; window.__fcp = 0;
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true }); } catch (e) {} })()"""
SCROLL = """async () => { const gaps = []; let last = performance.now(); let n = 0;
  const H = document.documentElement.scrollHeight - innerHeight; const t0 = performance.now(); const lt0 = window.__lt.length;
  await new Promise(res => { const step = () => { const now = performance.now(); gaps.push(now - last); last = now; n++; if (n > 12) return res(); scrollTo(0, H * n / 12); setTimeout(() => requestAnimationFrame(step), 90); }; requestAnimationFrame(step); });
  const lt = window.__lt.slice(lt0);
  return { ms: Math.round(performance.now() - t0), worst: Math.round(Math.max(...gaps.slice(1)) - 90), long: lt.length, longest: lt.length ? Math.max(...lt.map(x => x[1])) : 0, H }; }"""


def main():
    from playwright.sync_api import sync_playwright
    a = sys.argv[1:]
    rate = float(a[a.index("--rate") + 1]) if "--rate" in a else 4
    width = int(a[a.index("--width") + 1]) if "--width" in a else 390
    routes = a[a.index("--routes") + 1].split(",") if "--routes" in a else ["S05", "S06", "S07", "S08", "S10", "S13", "S15", "S12"]
    motion = not ("--motion" in a and a[a.index("--motion") + 1] == "off")
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    U = "http://127.0.0.1:%d/index.html" % srv.server_address[1]
    bad = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        c0 = b.new_page(); c0.goto(U); c0.wait_for_timeout(600)
        table = {r["id"]: r["samples"][0] for r in c0.evaluate("window.__ROUTES__") if r.get("samples")}
        c0.close()
        print(f"{width}px, CPU x{rate:g}, motion {'on' if motion else 'off'}")
        print("route   FCP  ready  load-long(max)  scroll: ms  worst-gap  long(max)")
        for rid in routes:
            ctx = b.new_context(viewport={"width": width, "height": 844}, service_workers="block", has_touch=width < 700, reduced_motion="no-preference" if motion else "reduce")
            pg = ctx.new_page()
            cdp = ctx.new_cdp_session(pg)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})
            pg.add_init_script(INIT)
            pg.goto(U + table[rid])
            pg.wait_for_selector("article.page[data-ready='1']", timeout=60000)
            ready = pg.evaluate("Math.round(performance.now())")
            pg.wait_for_timeout(1800)
            ld = pg.evaluate("window.__lt")
            sc = pg.evaluate(SCROLL)
            row = (rid, pg.evaluate("window.__fcp"), ready, len(ld), max([d for _, d in ld] or [0]), sc["ms"], sc["worst"], sc["long"], sc["longest"])
            print("%-6s %5d %6d   %3d (%4d)        %6d    %6d    %3d (%4d)" % row)
            if ready > 6000 * rate / 4 or row[4] > 1000 * rate / 4 or sc["long"] > 0 or sc["worst"] > 250 * rate / 4:
                bad.append(f"{rid}: ready {ready} ms, longest load task {row[4]} ms, long tasks while scrolling {sc['long']}, worst frame gap {sc['worst']} ms")
            ctx.close()
        b.close()
    print("RESULT:", "PASS" if not bad else "FAIL: " + "; ".join(bad))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
