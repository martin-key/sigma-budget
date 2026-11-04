#!/usr/bin/env python3
"""overlap_v6.py - the final-review sweep of site/ (V6, 27.10): every route x every width, looking for what a visitor would call «a button on a button».  Project venv only.

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/overlap_v6.py [--widths 1920,1440,...] [--routes S06,S12] [--no-clicks] [--no-keys] [--quick] [--shots DIR]

  LAYOUT (every route x every width, motion off, banner on and off):
    overlap     two visible interactive elements (a, button, [role=tab], input, select, summary, [tabindex]) whose boxes cross by more than 2x2 px (ancestors and the content of a closed <details> are skipped;
                fixed bars are measured in their own place, never against the page that scrolls under them)
    hscroll     the page scrolls sideways
    outside     a visible element sticks out of the viewport sideways (inside a scroll container, a table wrap and the skip link it may)
    spill       the text of a button / link / tab / chip is wider than its box (and the box does not clip it)
    errors      a console error, a page error or a failed request while loading
    print       with print media there is no sideways scroll and the heading is visible
  CLICKS (1280 and 390, every route): each visible button / tab / switch / summary / menu is pressed; no console error, no page error, Escape closes what opened, the hash is restored
  KEYS (1280 and 390): Tab walks the first 25 stops without a focus ring lost off-screen; Escape closes the header dropdown and the search panel; Back / Forward keep the route
  --quick  widths 1440 / 1241 / 390, banner on, no clicks, no keys (about 2 minutes; accept_v6.py runs it)
  --shots DIR  a screenshot of the viewport of every page state with a layout finding (DIR/<route>-<width>px-<state>.png)
Exit 1 when anything is found; the findings are printed one per line.
"""
import http.server, json, os, socketserver, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".pw-browsers"))
WIDTHS = [1920, 1440, 1280, 1241, 1181, 1024, 768, 390, 320]
found = []


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


LAYOUT_JS = r"""() => {
  const out = [];
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) return false;
    if (e.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let d = e.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) { if (!d.open) { const sm = e.closest('summary'); if (!(sm && sm.parentElement === d)) return false; } }      // nested closed <details>
    if (e.classList.contains('skip-link') || e.closest('.sr-only') || e.closest('svg')) return false;      // the regions of a map are polygons: their boxes cross by nature
    return true; };
  const fixedOf = e => { for (let x = e; x && x !== document.body; x = x.parentElement) if (getComputedStyle(x).position === 'fixed') return x; return null; };
  const name = e => (e.id ? '#' + e.id : '') + '.' + String(e.className && e.className.baseVal === undefined ? e.className : '').split(' ')[0] + '«' + (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26) + '»';
  const sel = 'a[href],button,[role=tab],[role=button],input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  const els = [...document.querySelectorAll(sel)].filter(vis);
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (a.matches('.table-wrap,[role=region]') || b.matches('.table-wrap,[role=region]')) continue;       // a scroll region is a box around other things on purpose
    if (!!fixedOf(a) !== !!fixedOf(b)) continue;
    if ((a.matches('input') && b.closest('.field,.s28-field,form') && b.matches('.icon-btn')) || (b.matches('input') && a.closest('.field,.s28-field,form') && a.matches('.icon-btn'))) continue;   // the clear button sits INSIDE the search field on purpose
    let hit = null;                                             // per LINE box: an inline link that wraps has one box per line, the union of which says nothing
    for (const A of a.getClientRects()) { if (A.width < 2 || A.height < 2) continue; for (const B of b.getClientRects()) {
      const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (w > 4 && h > 4) { hit = [w, h, A.top]; break; } } if (hit) break; }
    if (hit) out.push({ k: 'overlap', m: `${name(a)} x ${name(b)} (${Math.round(hit[0])}x${Math.round(hit[1])} at y=${Math.round(hit[2] + scrollY)})` });
  }
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth + 1) out.push({ k: 'hscroll', m: `scrollWidth ${root.scrollWidth} > ${root.clientWidth}` });
  const inScroller = e => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
  for (const e of document.querySelectorAll('#topbar *,#view *,#footer *,#tabbar *')) {
    if (!vis(e) || inScroller(e) || e.closest('svg,canvas,.chart')) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && (r.right > innerWidth + 1.5 || r.left < -1.5)) { out.push({ k: 'outside', m: `${name(e)} box ${Math.round(r.left)}..${Math.round(r.right)} in ${innerWidth}px` }); break; }
  }
  for (const e of els) {
    if (e.closest('.table-wrap,.chart') || e.matches('.tab-panel')) continue;
    const cs = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 8 && cs.overflowX === 'visible' && cs.display !== 'inline' && e.clientWidth > 0 && !e.matches('input,select,textarea')) out.push({ k: 'spill', m: `${name(e)} text ${e.scrollWidth}px in a ${e.clientWidth}px box` });
  }
  return out;
}"""

CLICK_JS = r"""() => {
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); if (!(r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none') || e.closest('[hidden],[inert],dialog:not([open])')) return false;
    for (let d = e.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) { if (!d.open) { const sm = e.closest('summary'); if (!(sm && sm.parentElement === d)) return false; } }
    return true; };
  const skip = e => e.closest('#tabbar') && false || e.matches('[data-action="dismiss-banner"],[data-share-download],.skip-link') || /изтегли|копирай|отпечатай|download/i.test(e.textContent || '');
  const els = [...document.querySelectorAll('#view button,#view [role=tab],#view summary,#view [role=switch],#view input[type=radio],#view input[type=checkbox],#topbar button,#footer button,#footer summary,#sidenav button')].filter(e => vis(e) && !skip(e) && !e.disabled);
  els.forEach((e, i) => e.setAttribute('data-ovk', i));
  return els.length;
}"""


def main():
    from playwright.sync_api import sync_playwright
    a = sys.argv[1:]
    widths = [int(x) for x in a[a.index("--widths") + 1].split(",")] if "--widths" in a else WIDTHS
    only = set(a[a.index("--routes") + 1].split(",")) if "--routes" in a else None
    quick = "--quick" in a
    if quick and "--widths" not in a: widths = [1440, 1241, 390]
    clicks, keys = "--no-clicks" not in a and not quick, "--no-keys" not in a and not quick
    shots = Path(a[a.index("--shots") + 1]) if "--shots" in a else None
    if shots: shots.mkdir(parents=True, exist_ok=True)
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    U = "http://127.0.0.1:%d/index.html" % srv.server_address[1]
    n = 0

    def add(route, w, kind, msg):
        found.append(f"{route} {w}px [{kind}] {msg}")
        print("  FOUND", found[-1])

    def shot(pg, route, w, state):
        if shots: pg.screenshot(path=str(shots / f"{route}-{w}px-{state}.png"))

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg0 = b.new_page(); pg0.add_init_script("window.__HASH_ROUTES__ = true"); pg0.goto(U); pg0.wait_for_timeout(800)
        routes = [r for r in pg0.evaluate("window.__ROUTES__") if not r.get("bare") and (not only or r["id"] in only)]
        pg0.close()
        for r in routes:
            if not r["samples"]: r["samples"] = ["#/nyama-takava-stranitsa"]          # S30: the 404 screen

        def ctx(w):
            c = b.new_context(viewport={"width": w, "height": 900 if w >= 700 else 844}, service_workers="block", has_touch=w < 700, reduced_motion="reduce")
            c.add_init_script("window.__HASH_ROUTES__ = true")   # V7: these checks drive the hash addresses (js/loc.js hash mode)
            return c

        def load(c, hash_, errs):
            pg = c.new_page()
            pg.on("console", lambda m: errs.append("console: " + m.text[:140]) if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:140]))
            pg.on("requestfailed", lambda r: errs.append("request: " + r.url[-60:]))
            pg.goto(U + hash_)
            try: pg.wait_for_selector("article.page[data-ready='1']", timeout=9000)
            except Exception: errs.append("the screen never became ready")
            pg.wait_for_timeout(350)
            return pg

        # ---------------- layout matrix
        print("layout:", len(routes), "routes x", len(widths), "widths x banner on/off")
        for w in widths:
            c = ctx(w)
            for r in routes:
                for banner in ((True,) if quick else (True, False)):
                    errs = []
                    pg = load(c, r["samples"][0], errs)
                    if not banner:
                        pg.evaluate("document.getElementById('mockbar') && (document.getElementById('mockbar').hidden = true)"); pg.wait_for_timeout(60)
                    n += 1
                    fs = pg.evaluate(LAYOUT_JS)
                    for f in fs:
                        add(r["id"], w, f["k"] + ("" if banner else "/no-banner"), f["m"])
                    if fs: shot(pg, r["id"], w, "banner" if banner else "no-banner")
                    if banner:
                        for e in errs: add(r["id"], w, "errors", e)
                        for frac in ((0.33, 0.66, 1) if w in (1920, 1280, 1024, 390) else (1,)):         # sticky parts (S07's side column) are measured where they stick
                            pg.evaluate(f"window.scrollTo(0, (document.body.scrollHeight - innerHeight) * {frac})"); pg.wait_for_timeout(140)
                            fs = [f for f in pg.evaluate(LAYOUT_JS) if f["k"] in ("overlap", "outside")]
                            for f in fs: add(r["id"], w, f["k"] + f"/scrolled@{int(frac * 100)}", f["m"])
                            if fs: shot(pg, r["id"], w, f"scrolled{int(frac * 100)}")
                        under = pg.evaluate("(() => { const t = document.getElementById('tabbar'); if (!t || getComputedStyle(t).display === 'none') return null; const top = t.getBoundingClientRect().top; const bad = [...document.querySelectorAll('#footer a,#footer button,#footer summary')].filter(e => { const d = e.closest('details'); if (d && !d.open && !e.matches('summary')) return false; return e.getBoundingClientRect().bottom > top + 1 && e.getBoundingClientRect().height > 2; }); return bad.length ? bad[0].textContent.trim().slice(0, 24) : null; })()")
                        if under: add(r["id"], w, "under-tabbar", f"the last footer control «{under}» is hidden behind the bottom bar at the end of the page"); shot(pg, r["id"], w, "under-tabbar")
                        if w in (1280, 390):
                            pg.emulate_media(media="print"); pg.wait_for_timeout(120)
                            ph = pg.evaluate("[document.documentElement.scrollWidth - document.documentElement.clientWidth, !!document.querySelector('h1') && document.querySelector('h1').getBoundingClientRect().height > 0]")
                            if ph[0] > 1 or not ph[1]: add(r["id"], w, "print", f"sideways scroll {ph[0]}px / heading visible {ph[1]}"); shot(pg, r["id"], w, "print")   # taken with print media on
                    pg.close()
            c.close()

        # ---------------- every sample address, direct load (1280)
        c = ctx(1280)
        for r in routes:
            for h in r["samples"][1:]:
                errs = []
                pg = load(c, h, errs)
                for e in errs: add(r["id"], 1280, "errors", f"{h}: {e}")
                fs = [f for f in pg.evaluate(LAYOUT_JS) if f["k"] in ("overlap", "hscroll")]
                for f in fs: add(r["id"], 1280, f["k"], f"{h}: {f['m']}")
                if fs: shot(pg, r["id"], 1280, "sample" + str(r["samples"].index(h)))
                pg.close()
        c.close()

        # ---------------- clicks
        if clicks:
            for w in (1280, 390):
                c = ctx(w)
                for r in routes:
                    errs = []
                    pg = load(c, r["samples"][0], errs)
                    cnt = pg.evaluate(CLICK_JS)
                    print(f"clicks {r['id']} {w}px: {cnt} controls")
                    for i in range(min(cnt, 45)):
                        loc = pg.locator(f'[data-ovk="{i}"]')
                        errs.clear()
                        try:
                            if loc.count() == 0: continue
                            label = loc.first.evaluate("e => (e.getAttribute('aria-label') || e.textContent || e.id || e.className).trim().replace(/\\s+/g, ' ').slice(0, 28)")
                            loc.first.scroll_into_view_if_needed(timeout=1500)
                            loc.first.click(timeout=2000, no_wait_after=True)
                            pg.wait_for_timeout(90)
                        except Exception as e:
                            msg = str(e).splitlines()[0][:110]
                            if "intercepts pointer events" in str(e) or "not receiving" in str(e):
                                add(r["id"], w, "click-blocked", f"«{label}» cannot be pressed: {msg}")
                            continue
                        for e in errs: add(r["id"], w, "click-error", f"«{label}»: {e}")
                        pg.keyboard.press("Escape"); pg.wait_for_timeout(40)
                        if pg.evaluate("document.querySelectorAll('dialog[open],.popover:not([data-closing])').length"):
                            add(r["id"], w, "escape", f"«{label}» leaves a dialog/popover open after Escape")
                            pg.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.popover').forEach(d => d.remove())")
                        if not pg.evaluate("location.hash").startswith("#/" + (r["samples"][0].split("/")[1].split("?")[0] if len(r["samples"][0]) > 2 else "")):
                            pg.goto(U + r["samples"][0]); pg.wait_for_selector("article.page[data-ready='1']", timeout=8000); pg.evaluate(CLICK_JS)
                    pg.close()
                c.close()

        # ---------------- keyboard and history
        if keys:
            for w in (1280, 390):
                c = ctx(w)
                for r in routes[:6]:
                    errs = []
                    pg = load(c, r["samples"][0], errs)
                    pg.evaluate("document.activeElement && document.activeElement.blur()")
                    for k in range(25):
                        pg.keyboard.press("Tab")
                        s = pg.evaluate("(() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { vis: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden', ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' || e.matches(':focus-visible'), x: r.right > 0 && r.left < innerWidth, t: (e.textContent || e.id || '').trim().slice(0, 20) }; })()")
                        if s and (not s["vis"] or not s["x"]):
                            add(r["id"], w, "focus", f"Tab stop {k} «{s['t']}» is not visible / off-screen")
                    pg.keyboard.press("Escape")
                    pg.goto(U + "#/prihodi"); pg.wait_for_selector("article.page[data-ready='1']"); pg.go_back(); pg.wait_for_timeout(300)
                    if r["samples"][0].split("?")[0].rstrip("/") != pg.evaluate("location.hash").split("?")[0].rstrip("/") and r["id"] != "S01":
                        add(r["id"], w, "history", f"Back from #/prihodi did not return to {r['samples'][0]} (now {pg.evaluate('location.hash')})")
                    pg.go_forward(); pg.wait_for_timeout(300)
                    if "prihodi" not in pg.evaluate("location.hash"): add(r["id"], w, "history", "Forward did not return to #/prihodi")
                    for e in errs: add(r["id"], w, "errors", e)
                    pg.close()
                c.close()
        b.close()
    print(f"RESULT: {'PASS' if not found else 'FAIL'}: {n} page states, {len(found)} findings")
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
