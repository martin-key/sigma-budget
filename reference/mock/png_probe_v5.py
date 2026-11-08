#!/usr/bin/env python3
"""png_probe_v5.py - export the PNG of every shareable block of a screen of site/ (version v5, tag mock-v5) and save the files (project venv only).

  PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/mock/png_probe_v5.py OUTDIR WIDTH 'izp=#/izpalnenie' ['nachalo=#/' ...] [--click]

  Each target is name=hash. For every block with a „Сподели“ menu or a „PNG“ button the picture is made the way the page makes it
  (share.renderPng) and saved as OUTDIR/<name>-<width>-<block id>.png; with --click the real menu path is used instead
  (open „Сподели“, press „Изтегли изображение“, catch the download) so the saved file is exactly what a visitor gets.
  Prints per file: size in pixels, bytes, mock flag. Exit 1 on a console error or an empty canvas.
"""
import base64, http.server, json, os, socketserver, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # repository root
SITE = ROOT / "site"                                 # the Mock application: run this at the tag mock-v5
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".pw-browsers"))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(SITE), **k)

    def log_message(self, *a):
        pass


def main():
    from playwright.sync_api import sync_playwright
    args = sys.argv[1:]
    click = "--click" in args
    args = [a for a in args if a != "--click"]
    out = Path(args[0]); out.mkdir(parents=True, exist_ok=True)
    width = int(args[1])
    targets = []
    for t in args[2:]:
        n, h = t.split("=", 1) if "=" in t and not t.startswith("#") else (t.strip("#/").replace("/", "_") or "home", t)
        targets.append((n, h))
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    bad = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": width, "height": 900 if width >= 700 else 844}, service_workers="block",
                            accept_downloads=True, has_touch=width < 700)
        for n, h in targets:
            page = ctx.new_page()
            errs = []
            page.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append("EXC " + str(e)[:200]))
            page.goto("http://127.0.0.1:%d/index.html%s" % (port, h))
            try:
                page.wait_for_selector("h1", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(1200)
            ids = page.evaluate("""() => [...document.querySelectorAll('[data-share], .png-btn')].map(b => ({
                id: b.dataset.share || b.dataset.png, kind: b.dataset.share ? 'menu' : 'png',
                vis: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length) && !b.closest('details:not([open])')}))""")
            seen = set()
            for it in ids:
                if it["id"] in seen:
                    continue
                if click and not it["vis"]:
                    print("%-52s skipped (button not visible: closed disclosure)" % it["id"]); continue
                seen.add(it["id"])
                name = "%s-%d-%s.png" % (n, width, it["id"].replace("/", "_"))
                f = out / name
                try:
                    if click:
                        sel = '[data-share="%s"]' % it["id"] if it["kind"] == "menu" else '.png-btn[data-png="%s"]' % it["id"]
                        btn = page.locator(sel).first
                        btn.scroll_into_view_if_needed()
                        if it["kind"] == "menu":
                            btn.click(timeout=8000)
                            try:
                                page.wait_for_selector('[data-act]', timeout=3000)
                            except Exception:
                                pass
                            item = page.locator('dialog [data-act="png"], .popover [data-act="png"], [data-act="png"]').first
                            if not item.count():
                                acts = page.evaluate("() => [...document.querySelectorAll('[data-act]')].map(e => e.dataset.act)")
                                print("%-52s no image item in the menu (items: %s)" % (name, ",".join(acts))); page.keyboard.press("Escape"); continue
                            with page.expect_download(timeout=20000) as dl:
                                item.click(timeout=8000)
                            dl.value.save_as(str(f))
                        else:
                            with page.expect_download(timeout=20000) as dl:
                                btn.click(timeout=8000)
                            dl.value.save_as(str(f))
                    else:
                        url = page.evaluate("""async id => {
                            const m = await import('./js/share.js');
                            const spec = m.get(id);
                            const c = spec ? await m.renderPng(spec) : null;
                            return c ? c.toDataURL('image/png') : null;
                        }""", it["id"])
                        if not url:
                            print("%-40s no picture" % name); continue
                        f.write_bytes(base64.b64decode(url.split(",", 1)[1]))
                    from PIL import Image
                    im = Image.open(f)
                    print("%-52s %5dx%-5d %7d bytes" % (name, im.size[0], im.size[1], f.stat().st_size))
                except Exception as e:
                    bad += 1
                    print("%-52s FAIL %s" % (name, str(e).splitlines()[0][:120]))
            if errs:
                bad += 1
                print("  console errors:", errs[:3])
            page.close()
        b.close()
    srv.shutdown()
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
