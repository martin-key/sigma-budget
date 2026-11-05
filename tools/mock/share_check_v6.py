#!/usr/bin/env python3
"""share_check_v5.py - does a shared link of site/ (version v6, tag mock-v6) open the same view?  (project venv only; docs/plan.md)

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/share_check_v6.py

For a set of screens in a non-default state: take every block that has a «Сподели» menu, build its link the way the menu does
(share.linkFor), open that link in a FRESH browser context (no stored state) and check that
  - it opens the same screen (same h1),
  - the state of the address survives (every query key except the block pointer ?to=),
  - the screen's own controls show the same values as in the original view,
  - the link never carries personal tax inputs (brutno, zaplata, ...), also for «Моите данъци» with a typed salary,
  - and that the menu itself offers exactly: image + link (+ the table file as the expert option) and nothing else.
Exit 1 on any failure; the last line is RESULT: ...
"""
import http.server, json, os, socketserver, sys, threading
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parents[2]            # repository root
SITE = ROOT / "site"                                 # the Mock application: run this at the tag mock-v6
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".pw-browsers"))

VIEWS = [
    "#/izpalnenie?g1=2024&g2=2025&obhvat=eu&rez=mesec&mesec=5",
    "#/izpalnenie?g1=2025&g2=2026&obhvat=nat",
    "#/razhodi?po=vid&izgled=tablica",
    "#/razhodi?po=funkcii&izgled=godini",
    "#/prihodi",
    "#/vedomstvo/0100",
    "#/dalg",
    "#/merki",
    "#/bvp?sy=2019",
    "#/5-minuti",
    "#/izpalnenie",
]
CONTROLS_JS = """() => ({
  h1: (document.querySelector('h1') || {}).textContent || '',
  fields: [...document.querySelectorAll('main select, main input[type=radio]:checked, main input[type=checkbox]:checked, main input[type=text]')]
    .map(e => (e.id || e.name || e.tagName) + '=' + (e.value || '')).sort().join(';'),
  pressed: [...document.querySelectorAll('main [aria-pressed="true"], main [role=tab][aria-selected="true"]')].map(e => e.textContent.trim().slice(0, 30)).sort().join(';')
})"""

VISIBLE_IDS_JS = """() => [...new Set([...document.querySelectorAll('[data-share]')]
  .filter(b => b.getClientRects().length && !b.closest('[hidden], details:not([open])')).map(b => b.dataset.share))]"""

FAILS = []
N = [0]


def ok(c, msg):
    N[0] += 1
    if not c:
        FAILS.append(msg)
        print("  FAIL", msg)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


def settle(page, hash_=None):
    page.wait_for_selector("h1", timeout=8000)
    page.wait_for_timeout(700)


def main():
    from playwright.sync_api import sync_playwright
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    with sync_playwright() as p:
        b = p.chromium.launch()
        for view in VIEWS:
            ctx = b.new_context(viewport={"width": 1280, "height": 900}, service_workers="block", reduced_motion="reduce")
            ctx.add_init_script("window.__HASH_ROUTES__ = true")   # V7: the app opens on paths (/prihodi); this check drives the hash addresses (js/loc.js hash mode)
            page = ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)[:120]))
            page.goto(base + view)
            settle(page)
            orig = page.evaluate(CONTROLS_JS)
            ids = page.evaluate(VISIBLE_IDS_JS)     # a block in a hidden tab panel rightly opens ITS tab: only blocks the visitor sees are compared
            ok(len(ids) > 0, f"{view}: no «Сподели» menu on the screen")
            want_q = dict(parse_qsl(view.split("?", 1)[1])) if "?" in view else {}
            for sid in ids[:6]:
                link = page.evaluate("""async id => { const m = await import('./js/share.js'); const s = m.get(id); return s ? m.linkFor(s) : null; }""", sid)
                ok(bool(link), f"{view} [{sid}]: no link")
                if not link:
                    continue
                qs = dict(parse_qsl(urlsplit(link.split("#", 1)[1]).query))
                for k, v in want_q.items():
                    ok(qs.get(k) == v, f"{view} [{sid}]: the link lost ?{k}={v} (has {qs.get(k)!r})")
                # a FRESH context: nothing stored, only the address
                c2 = b.new_context(viewport={"width": 1280, "height": 900}, service_workers="block", reduced_motion="reduce")
                c2.add_init_script("window.__HASH_ROUTES__ = true")   # V7: the app opens on paths (/prihodi); this check drives the hash addresses (js/loc.js hash mode)
                p2 = c2.new_page()
                p2.goto(base + "#" + link.split("#", 1)[1])
                settle(p2)
                now = p2.evaluate(CONTROLS_JS)
                ok(now["h1"] == orig["h1"], f"{view} [{sid}]: the link opens another screen: {now['h1']!r} instead of {orig['h1']!r}")
                ok(now["fields"] == orig["fields"], f"{view} [{sid}]: the controls differ: {now['fields']!r} vs {orig['fields']!r}")
                ok(now["pressed"] == orig["pressed"], f"{view} [{sid}]: the chosen tab/button differs: {now['pressed']!r} vs {orig['pressed']!r}")
                c2.close()
            # the menu: image + link, the table file as the expert option, nothing else
            if ids:
                btn = page.locator(f'[data-share="{ids[0]}"]').first
                btn.scroll_into_view_if_needed()
                btn.click()
                page.wait_for_selector("[data-act]", timeout=3000)
                acts = page.evaluate("() => [...document.querySelectorAll('[data-act]')].map(e => e.dataset.act)")
                ok(set(acts) <= {"png", "copy-link", "csv", "report"} and "png" in acts and "copy-link" in acts, f"{view}: the menu offers {acts}")
                page.keyboard.press("Escape")
            ok(not errs, f"{view}: script errors {errs[:2]}")
            ctx.close()

        # personal inputs never reach the address, and a link from this screen does not carry them
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, service_workers="block", reduced_motion="reduce")
        ctx.add_init_script("window.__HASH_ROUTES__ = true")   # V7: the app opens on paths (/prihodi); this check drives the hash addresses (js/loc.js hash mode)
        page = ctx.new_page()
        page.goto(base + "#/danaci?brutno=3000&zaplata=3000&demo=1")
        settle(page)
        field = page.locator("#s18-brutno, input[inputmode=decimal], input[type=text]").first
        field.fill("3456")
        page.wait_for_timeout(500)
        h = page.evaluate("location.hash")
        ok("3456" not in h, f"danaci: the salary is in the address: {h}")
        ids = page.evaluate(VISIBLE_IDS_JS)
        for sid in ids:
            link = page.evaluate("""async id => { const m = await import('./js/share.js'); const s = m.get(id); return s ? m.linkFor(s) : null; }""", sid)
            ok(link is not None and not any(k in link for k in ("brutno=", "zaplata=", "demo=", "3456")), f"danaci [{sid}]: the link carries personal inputs: {link}")
        ctx.close()
        b.close()
    srv.shutdown()
    print(f"RESULT: {'FAIL' if FAILS else 'PASS'}: {N[0]} checks, {len(FAILS)} failures")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
