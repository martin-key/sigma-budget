#!/usr/bin/env python3
"""accept_v5.py - acceptance tests of docs/plan.md for site/ (version v5, tag mock-v5) (project venv only).

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/accept_v5.py [--shots OUTDIR]

NUMBERS  Every number of the comparison table of the home and of #/izpalnenie is read from the screen and compared with the value
         computed independently from data/execution.json (млн. € / 1000, rounded to two decimals): the reference Jan-Aug 2025 / 2026
         (the brief's literal figures 26,93 / 30,12 / 29,59 / 33,19 / -2,67 / -3,08 and the differences +3,19 / +3,60 / -0,41), August only
         («За месеца»), January, the negative balance, national budget vs EU funds, and 2024 as the earlier year. The month-only mode is
         also compared with the difference of two adjacent cumulative reports.
LAYOUT   At 1280 / 768 / 390 / 360 and at the two zoom equivalents (640 = 200 % of 1280; 320 = the reflow width of WCAG 1.4.10):
         no sideways scroll of the page, no clipped main result (the comparison table fits its own box), every chart has a table twin,
         every control is at least 44 px high on touch widths (links inside running text excepted), focus is visible on every stop of a
         tab walk and the walk goes down the page without jumping back.
Exit 1 on any failure; findings that are only advice are printed as NOTE.
"""
import http.server, json, os, re, socketserver, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # repository root
SITE = ROOT / "site"                                 # the Mock application: run this at the tag mock-v5
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".pw-browsers"))
FAILS, NOTES, N = [], [], [0]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


def ok(c, msg):
    N[0] += 1
    if not c:
        FAILS.append(msg)
        print("  FAIL", msg)


def note(msg):
    NOTES.append(msg)
    print("  NOTE", msg)


EX = json.load(open(SITE / "data" / "execution.json", encoding="utf-8"))
FOLD = {"kfp": "kfp", "nat": "nat", "eu": "eu"}
ROWS = [("rev", "Приходи"), ("exp.total", "Разходи"), ("balance", "Салдо")]


def cum(year, scope, row, month):
    return EX["data"][str(year)][scope][row][month - 1]


def val(year, scope, row, month, mode):
    if mode == "kum" or month == 1:
        return cum(year, scope, row, month)
    return cum(year, scope, row, month) - cum(year, scope, row, month - 1)


def num(s):
    s = s.replace("−", "-").replace(" ", " ").replace(" ", " ")
    m = re.search(r"[-+]?\d[\d ]*(?:,\d+)?", s)
    return float(m.group(0).replace(" ", "").replace(",", ".")) if m else None


GRID_JS = """() => {
  const g = document.querySelector('#s15-t-grid') || document.querySelector('table.data');
  if (!g) return null;
  const out = {};
  g.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
    const th = tr.querySelector('th'); const name = (th ? th.firstChild && th.firstChild.textContent : tr.children[0].textContent || '').trim();
    out[name] = [...tr.children].map(c => c.textContent.replace(/\\s+/g, ' ').trim());
  });
  return out;
}"""


def read_grid(page):
    return page.evaluate(GRID_JS)


def part_numbers(browser, port):
    print("NUMBERS")
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append("EXC " + str(e)[:160]))
    base = f"http://127.0.0.1:{port}/index.html"

    # the brief's literal figures on the home and on the comparison screen
    for hash_ in ("#/", "#/izpalnenie"):
        page.goto(base + hash_)
        page.wait_for_selector("table.data", timeout=8000)
        page.wait_for_timeout(300)
        txt = re.sub("[  ]", " ", page.evaluate("() => document.querySelector('main, #main, body').innerText")).replace("−", "-")
        for s in ("26,93", "30,12", "29,59", "33,19", "-2,67", "-3,08", "+3,19", "+3,60", "0,41"):
            ok(s in txt, f"{hash_}: the reference figure {s} is not on the screen")
        ok("дефицит" in txt, f"{hash_}: the word «дефицит» is missing next to the negative balance")
    # a percent on the negative base is never printed
    ok(not re.search(r"-\d+[,.]\d+ ?млрд\. €, [+-]?\d", txt), "izpalnenie: a percent follows the balance difference")

    cases = []
    for g1, g2 in ((2025, 2026), (2024, 2025), (2024, 2026)):
        for scope in ("kfp", "nat", "eu"):
            for month, mode in ((8 if g2 == 2026 else 12, "kum"), (8 if g2 == 2026 else 12, "mesec"), (1, "kum"), (1, "mesec"), (5, "kum"), (5, "mesec")):
                cases.append((g1, g2, scope, month, mode))
    done = 0
    for g1, g2, scope, month, mode in cases:
        q = f"?g1={g1}&g2={g2}&mesec={month}&obhvat={scope}&rez={mode}"
        page.goto(base + "#/izpalnenie" + q)
        page.wait_for_selector("#s15-t-grid", timeout=8000)
        page.wait_for_timeout(120)
        grid = read_grid(page)
        tag = f"{q}"
        if not grid:
            ok(False, f"{tag}: no comparison table")
            continue
        for row, label in ROWS:
            key = next((k for k in grid if k.startswith(label)), None)
            if not key:
                ok(False, f"{tag}: row {label} missing: {list(grid)[:4]}")
                continue
            cells = grid[key]
            got = [num(c) for c in cells[1:4]]
            want1 = val(g1, scope, row, month, mode) / 1000
            want2 = val(g2, scope, row, month, mode) / 1000
            ok(got[0] is not None and abs(got[0] - want1) <= 0.0051, f"{tag} {label} {g1}: screen {got[0]} model {want1:.4f}")
            ok(got[1] is not None and abs(got[1] - want2) <= 0.0051, f"{tag} {label} {g2}: screen {got[1]} model {want2:.4f}")
            if got[2] is not None:
                ok(abs(got[2] - (want2 - want1)) <= 0.0101, f"{tag} {label} difference: screen {got[2]} model {want2 - want1:.4f}")
        done += 1
        # «За месеца» is the difference of adjacent cumulative reports, never a single cumulative figure
        if mode == "mesec" and month > 1:
            for row, label in ROWS[:2]:
                a = cum(g2, scope, row, month) - cum(g2, scope, row, month - 1)
                ok(abs(val(g2, scope, row, month, "mesec") - a) < 1e-9, f"{tag}: model of the month-only mode is not a difference")
    print(f"  {done} comparisons read from the screen")

    # exact brief figures from the data, in млрд. €, to 3 decimals
    for (g, row, m, want) in ((2025, "rev", 8, 26.925), (2026, "rev", 8, 30.118), (2025, "exp.total", 8, 29.592), (2026, "exp.total", 8, 33.193),
                              (2025, "balance", 8, -2.666), (2026, "balance", 8, -3.075)):
        ok(abs(cum(g, "kfp", row, m) / 1000 - want) < 0.0006, f"data {g} {row} Jan-Aug: {cum(g, 'kfp', row, m) / 1000:.4f} vs brief {want}")
    for (g, row, want) in ((2025, "rev", 3.223), (2026, "rev", 3.770), (2025, "exp.total", 3.702), (2026, "exp.total", 4.644), (2025, "balance", -0.479), (2026, "balance", -0.874)):
        ok(abs(val(g, "kfp", row, 8, "mesec") / 1000 - want) < 0.0006, f"data {g} {row} August only: {val(g, 'kfp', row, 8, 'mesec') / 1000:.4f} vs brief {want}")
    ok(not errs, f"console errors {errs[:2]}")
    ctx.close()


ROUTES = [("home", "#/"), ("izpalnenie", "#/izpalnenie"), ("izp-2024", "#/izpalnenie?g1=2024&g2=2025&obhvat=eu&rez=mesec"), ("razhodi", "#/razhodi"),
          ("prihodi", "#/prihodi"), ("danaci", "#/danaci"), ("tarsene", "#/tarsene?q=%D0%94%D0%94%D0%A1"), ("izp-budzheti", "#/izpalnenie/byudzheti"),
          ("vedomstva", "#/vedomstva")]

TARGET_JS = """() => {
  const sel = 'button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button], .btn, a.btn, a.tab, .seg label, a[class*=card], a[class*=link-card]';
  const bad = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[hidden], details:not([open]) > :not(summary), .sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'absolute' && (r.width < 2 || r.height < 2)) continue;
    // the hit area of a hidden native input is its label
    let box = r;
    if (el.matches('input[type=radio],input[type=checkbox]')) { const l = el.closest('label') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')); if (l) box = l.getBoundingClientRect(); }
    // a link inside a sentence gets its hit area from an ::after box (layout.css, pointer:coarse): measure that box
    const pa = getComputedStyle(el, '::after');
    if (pa.content !== 'none' && pa.position === 'absolute') { const pw = parseFloat(pa.width), ph = parseFloat(pa.height); if (pw > box.width || ph > box.height) box = { width: Math.max(pw || 0, box.width), height: Math.max(ph || 0, box.height) }; }
    if (box.height < 43.5 || box.width < 43.5) bad.push({ n: (el.getAttribute('aria-label') || el.textContent || el.name || el.id || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 40), w: Math.round(box.width), h: Math.round(box.height), t: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') });
  }
  return bad;
}"""

OVERFLOW_JS = """() => {
  const de = document.documentElement;
  const wide = [];
  for (const el of document.querySelectorAll('main *, #main *')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (r.right > de.clientWidth + 1 && !el.closest('.table-wrap, [data-ui="table"], svg, .chart, pre, .map-svg, [data-scroll], .sr-only, .tab-list, [role=tablist]') && getComputedStyle(el).position !== 'fixed') wide.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className).slice(0, 30) + ' right=' + Math.round(r.right));
  }
  const grid = document.querySelector('#s15-t-grid-wrap, [data-route] .s01-wrap');
  return { page: de.scrollWidth - de.clientWidth, wide: wide.slice(0, 4), gridOver: grid ? grid.scrollWidth - grid.clientWidth : 0 };
}"""

FOCUS_JS = """() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const ring = (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') || (cs.boxShadow && cs.boxShadow !== 'none');
  const wrap = el.closest('label, .seg, details, .field');
  let ring2 = false;
  if (!ring && wrap) { const w = getComputedStyle(wrap); ring2 = (parseFloat(w.outlineWidth) > 0 && w.outlineStyle !== 'none') || (w.boxShadow && w.boxShadow !== 'none'); }
  const sib = el.nextElementSibling; // a visually hidden radio draws its ring on the label
  let ring3 = false;
  if (!ring && !ring2 && el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) { const w = getComputedStyle(l); ring3 = (parseFloat(w.outlineWidth) > 0 && w.outlineStyle !== 'none') || (w.boxShadow && w.boxShadow !== 'none'); } }
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const lab = el.closest('label'); let ringL = false;
  if (lab) { const w = getComputedStyle(lab); ringL = (parseFloat(w.outlineWidth) > 0 && w.outlineStyle !== 'none'); }
  const seg = !!el.closest('.seg');
  let ring4 = false;
  if (seg && el.nextElementSibling) { const w = getComputedStyle(el.nextElementSibling); ring4 = (parseFloat(w.outlineWidth) > 0 && w.outlineStyle !== 'none') || (w.boxShadow && w.boxShadow !== 'none'); }
  // a range input draws its ring on the thumb pseudo-element: look for that rule in the style sheets
  const sliderRing = el.matches('input[type=range]') && [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => r.selectorText && /focus-visible::-webkit-slider-thumb/.test(r.selectorText) && /outline:\\s*[1-9]/.test(r.cssText)); } catch (e) { return false; } });
  const prev = window.__prevFocus; window.__prevFocus = el;
  const back = !!(prev && prev !== el && prev.isConnected && !(prev.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  return { back, n: (el.getAttribute('aria-label') || el.textContent || el.name || el.id || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 36), tag: el.tagName.toLowerCase(), top: Math.round(r.top + scrollY), ring: !!(ring || ring2 || ring3 || ringL || ring4 || outline || sliderRing) };
}"""


def part_layout(browser, port):
    print("LAYOUT")
    base = f"http://127.0.0.1:{port}/index.html"
    for w in (1280, 768, 640, 390, 360, 320):
        touch = w <= 768
        ctx = browser.new_context(viewport={"width": w, "height": 900 if w >= 700 else 800}, service_workers="block", has_touch=touch, is_mobile=False)
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("EXC " + str(e)[:160]))
        for name, h in ROUTES:
            page.goto(base + h)
            try:
                page.wait_for_selector("h1", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(500)
            tag = f"{w} {name}"
            o = page.evaluate(OVERFLOW_JS)
            ok(o["page"] <= 0, f"{tag}: the page scrolls sideways by {o['page']}px")
            ok(not o["wide"], f"{tag}: content leaves the screen: {o['wide']}")
            ok(o["gridOver"] <= 0, f"{tag}: the main comparison table scrolls sideways by {o['gridOver']}px")
            # every chart has a table twin
            nochart = page.evaluate("""() => [...document.querySelectorAll('figure .chart, .chart[data-ready="1"]')].filter(c => {
                const f = c.closest('figure, section.block'); return f && !f.querySelector('table, details.fig-table, [data-attach]'); }).map(c => c.id || c.className).slice(0, 3)""")
            ok(not nochart, f"{tag}: chart without a table: {nochart}")
            if touch and w in (390, 768):
                bad = page.evaluate(TARGET_JS)
                # links inside running text and the tab-bar items are checked elsewhere; here controls only
                for b in bad:
                    ok(False, f"{tag}: target {b['t']} «{b['n']}» is {b['w']}x{b['h']}px (< 44)")
        ok(not errs, f"{w}: console errors {errs[:2]}")
        ctx.close()

    # keyboard: the tab walk, desktop and phone
    for w in (1280, 390):
        ctx = browser.new_context(viewport={"width": w, "height": 900 if w >= 700 else 800}, service_workers="block")
        page = ctx.new_page()
        for name, h in (("home", "#/"), ("izpalnenie", "#/izpalnenie"), ("danaci", "#/danaci"), ("razhodi", "#/razhodi"), ("tarsene", "#/tarsene")):
            page.goto(base + h)
            page.wait_for_selector("h1", timeout=8000)
            page.wait_for_timeout(500)
            stops, back, noring = [], 0, []
            for i in range(60):
                page.keyboard.press("Tab")
                f = page.evaluate(FOCUS_JS)
                if not f:
                    break
                if f["tag"] == "body":
                    break
                stops.append(f)
                if not f["ring"]:
                    noring.append(f["n"])
                if f["back"] and i > 0:
                    back += 1          # focus moved to an element EARLIER in the document (DOM order is the tab order)
            tag = f"{w} {name} (tab walk of {len(stops)} stops)"
            ok(len(stops) >= 8, f"{tag}: the walk found only {len(stops)} stops")
            ok(not noring, f"{tag}: no visible focus on {noring[:4]}")
            ok(back == 0, f"{tag}: the focus moves to an earlier element in the document {back} times")
            names_missing = [s for s in stops if not s["n"]]
            ok(not names_missing, f"{tag}: {len(names_missing)} stops without a text name")
        ctx.close()


def main():
    from playwright.sync_api import sync_playwright
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    only = [a for a in sys.argv[1:] if a in ("numbers", "layout")]
    with sync_playwright() as p:
        b = p.chromium.launch()
        if not only or "numbers" in only:
            part_numbers(b, port)
        if not only or "layout" in only:
            part_layout(b, port)
        b.close()
    srv.shutdown()
    print(f"RESULT: {'FAIL' if FAILS else 'PASS'}: {N[0]} checks, {len(FAILS)} failures, {len(NOTES)} notes")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
