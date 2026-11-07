#!/usr/bin/env python3
"""motion_v6.py - the motion checks of site/ (V6, 26.10: css/motion.css + js/ui/motion.js). Project venv only.

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/motion_v6.py [--frames OUTDIR]

  1. reduced motion: html.mo is never set, nothing is hidden or animated, the final numbers are there at once
  2. motion on: the screen enters (running animations), the numbers count and END on the exact printed value, bars end at full width, nothing is left animating
  3. no layout shift: CLS of the SCREEN (#view; the boot shift of the footer/header is the site's own and is not counted) with motion <= without motion + 0.01, on 1280 / 390 / 320, with a 4x CPU throttle too
  4. scroll reveal: a block below the first viewport waits (opacity 0, [data-rv]), appears when scrolled to, keeps no hook; a keyboard focus reveals it; nothing is cut off with the safety timer
  5. dropdowns: popover opens with an animation and leaves with [data-closing]; the search panel opens with one
  6. no horizontal scroll at any moment of the entrance (320 px)
  7. SPA navigation releases observed elements from replaced pages (no reload between routes)
  --frames OUTDIR  also saves frames at 0 / 150 / 400 / 900 ms of «Начало» and «Месечни отчети»
Exit 1 on a failed check."""
import http.server, json, os, socketserver, sys, threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import expect_v6  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PLAN = expect_v6.plan()                               # the plan percentages of the latest report (site/data/execution.json)
SITE = ROOT / "site"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".pw-browsers"))
fails, checks = [], 0


def ok(c, msg):
    global checks
    checks += 1
    if not c:
        fails.append(msg)
        print("  FAIL", msg)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


CLS_JS = """() => { window.__cls = 0; window.__clsAll = 0; try { new PerformanceObserver(l => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__clsAll += e.value;
  if ((e.sources || []).some(s => s.node && s.node.closest && s.node.closest('#view'))) window.__cls += e.value; } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {} }"""
RUNNING = "() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#view')).length"
OBSERVERS_JS = """(() => {
  const Native = window.IntersectionObserver;
  window.__motionObservers = [];
  window.IntersectionObserver = class extends Native {
    constructor(callback, options) { super(callback, options); this.targets = new Set(); window.__motionObservers.push(this); }
    observe(el) { this.targets.add(el); super.observe(el); }
    unobserve(el) { this.targets.delete(el); super.unobserve(el); }
    disconnect() { this.targets.clear(); super.disconnect(); }
  };
})()"""


def main():
    from playwright.sync_api import sync_playwright
    frames = None
    if "--frames" in sys.argv:
        frames = Path(sys.argv[sys.argv.index("--frames") + 1]); frames.mkdir(parents=True, exist_ok=True)
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    U = "http://127.0.0.1:%d/index.html" % srv.server_address[1]
    with sync_playwright() as p:
        b = p.chromium.launch()

        def ctx(w, reduce):
            c = b.new_context(viewport={"width": w, "height": 900 if w >= 700 else 844}, service_workers="block", has_touch=w < 700,
                              reduced_motion="reduce" if reduce else "no-preference")
            c.add_init_script("window.__HASH_ROUTES__ = true")   # V7: these checks drive the hash addresses (js/loc.js hash mode)
            return c

        # 1. reduced motion
        print("1 reduced motion")
        pg = ctx(1280, True).new_page()
        pg.goto(U + "#/"); pg.wait_for_selector("#s15-b-plan .prog-text"); pg.wait_for_timeout(150)
        ok(not pg.evaluate("document.documentElement.classList.contains('mo')"), "reduced: html.mo is set")
        ok(pg.evaluate("document.querySelectorAll('[data-rv],[data-pg],.enter-anim').length") == 0, "reduced: motion hooks are on the page")
        ok(pg.evaluate(RUNNING) == 0, "reduced: animations are running")
        txt = pg.evaluate("[...document.querySelectorAll('#s15-b-plan .s15-prog-cur .prog-text')].map(e => e.textContent)")
        ok(txt == PLAN["cur"], f"reduced: the plan percentages are {txt} at once, expected {PLAN['cur']}")
        ok(pg.evaluate("[...document.querySelectorAll('.prog-fill')].every(f => getComputedStyle(f).transform === 'none')"), "reduced: a bar is scaled")
        pg.close()

        # 2. motion on: enter, count, end state
        print("2 motion on")
        pg = ctx(1280, False).new_page()
        pg.goto(U + "#/"); pg.wait_for_selector("h1")
        pg.wait_for_timeout(40)
        ok(pg.evaluate("document.documentElement.classList.contains('mo')"), "motion: html.mo is missing")
        ok(pg.evaluate(RUNNING) > 0, "motion: nothing animates when the screen enters")
        seen = []
        for _ in range(40):
            seen.append(pg.evaluate("(document.querySelector('#s15-b-plan .s15-prog-cur .prog-text') || {}).textContent"))
            pg.wait_for_timeout(50)
        ok(len(set(seen)) > 2, f"motion: the number does not count (saw {sorted(set(seen))[:4]})")
        pg.wait_for_timeout(900)
        txt = pg.evaluate("[...document.querySelectorAll('#s15-b-plan .prog-text')].map(e => e.textContent)")
        ok(txt == PLAN["bars"], f"motion: the counting ended on {txt}, expected {PLAN['bars']}")
        ok(pg.evaluate("[...document.querySelectorAll('.prog-fill')].every(f => getComputedStyle(f).transform === 'none' && !f.hasAttribute('data-pg'))"), "motion: a bar is left scaled / hooked")
        ok(pg.evaluate("[...document.querySelectorAll('#s15-b-plan .prog-fill')].map(f => f.style.width).join()") == ",".join(PLAN["widths"]), "motion: a bar width is not the plan value")
        ok(pg.evaluate(RUNNING) == 0, "motion: animations still run 1.5 s after the load")
        ok(pg.evaluate("[...document.querySelectorAll('#s15-b-plan .prog-text')].every(e => !e.style.minWidth && !e.style.display)"), "motion: a pinned min-width / display is left on a counted number")
        # the picture export (share.renderPng) and print call settle(): the final state at once, also in the middle of a count
        pg.goto(U + "?s=1#/"); pg.wait_for_selector("#s15-b-plan .prog-text"); pg.wait_for_timeout(250)
        mid = pg.evaluate("document.querySelector('#s15-b-plan .s15-prog-cur .prog-text').textContent")
        fin = pg.evaluate("async () => { (await import('./js/ui/motion.js')).settle(); return [...document.querySelectorAll('#s15-b-plan .prog-text')].map(e => e.textContent).join(); }")
        ok(fin == ",".join(PLAN["bars"]), f"settle: after {mid} the numbers are {fin}")
        # 4. scroll reveal
        print("4 scroll reveal")
        pg.goto(U + "#/izpalnenie"); pg.wait_for_selector("#s15-b-plan"); pg.wait_for_timeout(1200)
        hid = pg.evaluate("[...document.querySelectorAll('.page-body > [data-rv]')].map(e => [e.id || e.className.split(' ')[0], getComputedStyle(e).opacity])")
        ok(len(hid) >= 1 and all(float(o) < 0.05 for _, o in hid), f"reveal: below-fold blocks should wait invisible: {hid}")
        pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(1000)
        ok(pg.evaluate("document.querySelectorAll('.page-body > [data-rv]').length") == 0, "reveal: [data-rv] hooks remain after scrolling to the end")
        ok(pg.evaluate("[...document.querySelectorAll('.page-body > *')].every(e => getComputedStyle(e).opacity === '1')"), "reveal: a block is not fully visible after the scroll")
        pg.goto(U + "#/prihodi"); pg.wait_for_selector("h1"); pg.wait_for_timeout(1200)
        pg.evaluate("window.scrollTo(0,0)")
        tgt = pg.evaluate("(() => { const e = document.querySelector('.page-body > [data-rv] a, .page-body > [data-rv] button'); if (!e) return null; e.id = e.id || 'mo-probe'; return e.id; })()")
        if tgt:
            pg.focus("#" + tgt); pg.wait_for_timeout(700)
            ok(pg.evaluate("getComputedStyle(document.getElementById(%s).closest('.page-body > *')).opacity" % json.dumps(tgt)) == "1", "reveal: keyboard focus leaves the block invisible")
        # 5. dropdowns
        print("5 dropdowns")
        pg.goto(U + "#/razhodi"); pg.wait_for_selector("h1"); pg.wait_for_timeout(800)
        pg.click('#sidenav .nav-main[data-grp="2"]'); pg.wait_for_timeout(60)
        ok(pg.evaluate("document.getAnimations().some(a => a.animationName === 'mo-drop')"), "dropdown: the menu opens without an animation")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(40)
        ok(pg.evaluate("!!document.querySelector('.popover[data-closing]')"), "dropdown: the menu has no closing state")
        pg.wait_for_timeout(400)
        ok(pg.evaluate("document.querySelectorAll('.popover').length") == 0, "dropdown: the closed menu is still in the page")
        ok(pg.evaluate("document.activeElement.classList.contains('nav-main')"), "dropdown: the focus did not return to the button")
        pg.click("#btn-search"); pg.wait_for_timeout(60)
        ok(pg.evaluate("document.getAnimations().some(a => a.animationName === 'mo-drop')"), "search panel: opens without an animation")
        pg.close()

        # 7. Real SPA navigation: below-fold targets of the previous article must be released.
        print("7 SPA observer lifecycle")
        c = ctx(1280, False)
        c.add_init_script(OBSERVERS_JS)
        pg = c.new_page()
        pg.goto(U + "#/prihodi")
        for route, screen in (("#/prihodi", "S06"), ("#/razhodi", "S07"), ("#/izpalnenie", "S15"), ("#/prihodi", "S06")):
            pg.evaluate("h => { location.hash = h; }", route)
            pg.wait_for_selector(f'article[data-route="{screen}"][data-ready="1"]', timeout=8000)
            pg.wait_for_timeout(900)
            observed = pg.evaluate("() => window.__motionObservers.flatMap(o => [...o.targets]).map(el => el.isConnected)")
            ok(bool(observed), f"SPA {route}: the lifecycle probe did not exercise any observer targets")
            ok(all(observed), f"SPA {route}: {observed.count(False)} observed targets belong to removed pages")
        c.close()

        # 3. CLS and 6. overflow, also under a CPU throttle
        print("3 layout shift / 6 overflow")
        for w in (1280, 390, 320):
            for route in ("#/", "#/izpalnenie", "#/razhodi", "#/prihodi", "#/vedomstva", "#/5-minuti"):
                vals = {}
                for red in (True, False):
                    c = ctx(w, red); pg = c.new_page()
                    cdp = c.new_cdp_session(pg)
                    if not red and w == 320:
                        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
                    pg.add_init_script("(" + CLS_JS + ")()")
                    over = []
                    pg.goto(U + route); pg.wait_for_selector("h1")
                    for _ in range(12):
                        over.append(pg.evaluate("document.documentElement.scrollWidth - innerWidth")); pg.wait_for_timeout(120)
                    pg.wait_for_timeout(1500)
                    vals[red] = pg.evaluate("window.__cls")
                    if not red:
                        ok(max(over) <= 0, f"overflow: {w}px {route} scrolls sideways during the entrance ({max(over)}px)")
                        if route in ("#/", "#/izpalnenie"):
                            t = pg.evaluate("[...document.querySelectorAll('#s15-b-plan .prog-text')].map(e => e.textContent).join()")
                            ok(t == ",".join(PLAN["bars"]), f"throttle/{w}: the counting ended on {t}")
                    c.close()
                ok(vals[False] <= vals[True] + 0.01, f"CLS {w}px {route}: motion {vals[False]:.4f} vs no motion {vals[True]:.4f}")   # the site's own CLS (boot placeholder, footer) is not the motion's business: only an INCREASE fails

        if frames:
            print("frames ->", frames)
            for w in (1280, 390):
                for name, route in (("home", "#/"), ("izp", "#/izpalnenie")):
                    pg = ctx(w, False).new_page()
                    pg.goto(U + "about:blank" if False else U + route)
                    last = 0
                    for ms in (0, 150, 400, 900):
                        pg.wait_for_timeout(max(0, ms - last)); last = ms
                        pg.screenshot(path=str(frames / f"{name}-{w}-{ms:04d}ms.png"))
                    pg.close()
        b.close()
    print(f"RESULT: {'PASS' if not fails else 'FAIL'}: {checks} checks, {len(fails)} failures")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
