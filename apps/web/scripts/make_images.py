"""Draw the raster images of the site from HTML: the social card (og.png, 1200x630) and the app icons (icon-192/512.png, apple-touch-icon.png).

    PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m apps.web.scripts.make_images

The images are committed in web assets/ (index.html and manifest.json name them); run this again after a change of the mark or the colours.
The card uses the fonts of the site (Charter for the serif; the system mono), so draw it on macOS for the same look.
"""

from pathlib import Path as _Path
import pathlib

from playwright.sync_api import sync_playwright

SITE = pathlib.Path(__file__).resolve().parents[3] / 'site'
PAPER, INK, CRIMSON, SOFT = '#FDFAF4', '#15110C', '#AC1B18', '#6B6257'
MARK = (f'<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="17" width="5.4" height="10" fill="{INK}"/><rect x="13.3" y="12" width="5.4" height="15" fill="{INK}"/>'
        f'<rect x="21.6" y="7" width="5.4" height="20" fill="{INK}"/><rect x="4" y="27" width="24" height="1.6" fill="{INK}"/><circle cx="24.3" cy="4.2" r="2.6" fill="{CRIMSON}"/></svg>')

CARD = f"""<!doctype html><html lang="bg"><head><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px;background:{PAPER};color:{INK};-webkit-font-smoothing:antialiased}}
.c{{position:relative;box-sizing:border-box;width:1200px;height:630px;padding:64px 72px;display:flex;flex-direction:column}}
.brand{{display:flex;align-items:center;gap:18px;font:400 34px/1 Charter,Georgia,serif;letter-spacing:-.01em}}
.brand svg{{width:54px;height:54px}}
.k{{margin-top:58px;font:500 20px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:{CRIMSON};display:flex;align-items:center;gap:14px}}
.k::before{{content:"";width:40px;height:2px;background:{CRIMSON}}}
h1{{margin:26px 0 0;font:400 86px/1.02 Charter,Georgia,serif;letter-spacing:-.025em;max-width:820px}}
h1 em{{color:{CRIMSON}}}
.q{{margin-top:auto;padding-top:22px;border-top:2px solid {INK};font:500 19px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:{SOFT};display:flex;gap:18px;flex-wrap:wrap}}
.q span+span::before{{content:"·";margin-right:18px;color:{CRIMSON}}}
.bars{{position:absolute;right:72px;top:150px;display:flex;align-items:flex-end;gap:22px;height:300px}}
.bars i{{display:block;width:64px;background:{INK}}}
.bars i:nth-child(1){{height:38%}}.bars i:nth-child(2){{height:62%}}.bars i:nth-child(3){{height:100%;position:relative}}
.bars i:nth-child(3)::after{{content:"";position:absolute;left:50%;top:-54px;width:34px;height:34px;margin-left:-17px;border-radius:50%;background:{CRIMSON}}}
</style></head><body><div class="c">
<div class="brand">{MARK}<span>Бюджет на светло</span></div>
<div class="k">Държавният бюджет · 2026</div>
<h1>Бюджетът на България на <em>достъпен</em> език</h1>
<div class="bars" aria-hidden="true"><i></i><i></i><i></i></div>
<div class="q"><span>Откъде идват парите</span><span>Къде отиват</span><span>Изпълнява ли се планът</span><span>Колко дължим</span></div>
</div></body></html>"""


def icon(size, pad):
    """the mark on paper; `pad` is the safe margin (maskable icons are cropped to a circle by some launchers)"""
    inner = size - 2 * pad
    return (f'<!doctype html><html><head><style>html,body{{margin:0;width:{size}px;height:{size}px;background:{PAPER}}}'
            f'svg{{position:absolute;left:{pad}px;top:{pad}px;width:{inner}px;height:{inner}px}}</style></head><body>{MARK}</body></html>')


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1200, 'height': 630})
        pg.set_content(CARD)
        pg.wait_for_timeout(200)
        pg.screenshot(path=str(SITE / 'og.png'))
        for name, size, pad in (('icon-512.png', 512, 72), ('icon-192.png', 192, 27), ('apple-touch-icon.png', 180, 22)):
            pg.set_viewport_size({'width': size, 'height': size})
            pg.set_content(icon(size, pad))
            pg.screenshot(path=str(SITE / name))
        b.close()
    print('og.png, icon-512.png, icon-192.png, apple-touch-icon.png → site/')


if __name__ == '__main__':
    main()
