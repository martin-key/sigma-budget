"""Draw the raster images of the site from HTML: the social card (og.png, 1200x630) and the app icons of the manifest (icon-192.png, icon-512.png).

    python3 -m venv tmp/venv && tmp/venv/bin/pip install --require-hashes -r tests/requirements-dev.lock
    PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m playwright install chromium
    PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m apps.web.scripts.make_images      # from the root of the repository

The images are committed in apps/web/public/ (index.html, app/root.tsx and manifest.json name them); run this again after a change of the mark,
the logo or the colours. The brand is the one of СИГМА:
  - the mark, the magnifier-„С“ with the map of Bulgaria, is sigma-mark.svg next to this script: a byte copy of apps/web/public/logo-icon.svg of
    the СИГМА project (midt-bg/sigma), vendored so that this script never reads another checkout;
  - the logo of the header is apps/web/public/sigma-logo.svg, the unchanged file of СИГМА, followed by «Бюджет» in the site serif
    (app/components/chrome/chrome.tsx LOGO, public/css/layout.css .brand);
  - favicon.ico, favicon-16.png, favicon-32.png and apple-touch-icon.png are byte copies of the files of СИГМА and are not drawn here.
icon-192/512.png are drawn like that apple-touch-icon: a full-bleed tile in TILE with the whole mark in white, centred. Fitted against the 180 px
original the mark is 0.644 of the side wide; there the antialiased tip of the handle reaches 0.402 of the side from the centre, just past the 0.4
safe circle of a maskable icon, so the mark is drawn 0.636 wide (1% smaller, the same look) and stays inside it with a margin.

The card uses the type of the site: the serif and mono stacks are read from public/css/tokens.css. The site ships no font files, so the card is
drawn with what the host has; the first face of the serif stack, Charter, is a system font of Apple systems. Elsewhere install XCharter, the free
Bitstream Charter extended with Cyrillic (CTAN fonts/xcharter, Bitstream's free licence), e.g. its four opentype/*.otf files into
~/.local/share/fonts and `fc-cache -f`: the card names it right after Charter. The script prints the face every text was drawn with and stops
if the serif text did not come out in Charter.
"""

import base64
import pathlib
import re

from playwright.sync_api import sync_playwright

WEB = pathlib.Path(__file__).resolve().parents[1]
PUBLIC = WEB / 'public'
PAPER, INK, CRIMSON, SOFT, TILE = '#FDFAF4', '#15110C', '#AC1B18', '#6B6257', '#7C040D'
MARK_SVG = (pathlib.Path(__file__).with_name('sigma-mark.svg')).read_text(encoding='utf-8')
LOGO_SVG = (PUBLIC / 'sigma-logo.svg').read_text(encoding='utf-8')
MARK_RATIO = 58.52 / 72.18  # height / width of the mark's viewBox
ICON_SCALE = 0.636  # the mark's width on the tile, as a share of the side (0.644 in the apple-touch-icon of СИГМА; see the docstring)


def font_stack(name):
    """a font stack of the site, as tokens.css defines it"""
    css = (PUBLIC / 'css' / 'tokens.css').read_text(encoding='utf-8')
    m = re.search(r'--font-' + name + r':\s*([^;]+);', css)
    return ' '.join(m.group(1).split())


SERIF = font_stack('serif').replace('Charter,', "Charter, XCharter, 'Bitstream Charter',", 1)
MONO = font_stack('mono')


def svg_uri(svg):
    """an <img> source: each SVG keeps its own <style> (the mark and the logo both use .cls-1/.cls-2), and the image stays a vector"""
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode('utf-8')).decode('ascii')


def white(svg):
    """the mark for the tile: every fill white"""
    return re.sub(r'fill:#[0-9a-fA-F]{3,6}', 'fill:#fff', svg)


CARD = f"""<!doctype html><html lang="bg"><head><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px;background:{PAPER};color:{INK};-webkit-font-smoothing:antialiased}}
.c{{position:relative;box-sizing:border-box;width:1200px;height:630px;padding:64px 72px;display:flex;flex-direction:column}}
.brand{{display:flex;align-items:baseline;gap:.32em;font-size:34px}}
.brand img{{flex:none;display:block;width:auto;height:.775em;position:relative;top:.08em}}
.brand span{{font:400 1em/1 {SERIF};letter-spacing:-.02em}}
.k{{margin-top:58px;font:500 20px/1 {MONO};letter-spacing:.16em;text-transform:uppercase;color:{CRIMSON};display:flex;align-items:center;gap:14px}}
.k::before{{content:"";width:40px;height:2px;background:{CRIMSON}}}
h1{{margin:26px 0 0;font:400 86px/1.02 {SERIF};letter-spacing:-.025em;max-width:820px}}
h1 em{{color:{CRIMSON}}}
.q{{margin-top:auto;padding-top:22px;border-top:2px solid {INK};font:500 19px/1.5 {MONO};letter-spacing:.08em;text-transform:uppercase;color:{SOFT};display:flex;gap:18px;flex-wrap:wrap}}
.q span+span::before{{content:"·";margin-right:18px;color:{CRIMSON}}}
.mark{{position:absolute;right:72px;top:228px;width:260px;height:auto}}
</style></head><body><div class="c">
<div class="brand"><img src="{svg_uri(LOGO_SVG)}" alt=""><span>Бюджет</span></div>
<div class="k">Държавният бюджет · 2026</div>
<h1>Бюджетът на&nbsp;България на&nbsp;<em>достъпен</em> език</h1>
<img class="mark" src="{svg_uri(MARK_SVG)}" alt="">
<div class="q"><span>Откъде идват парите</span><span>Къде отиват</span><span>Изпълнява ли се планът</span><span>Колко дължим</span></div>
</div></body></html>"""


def icon(size):
    """the white mark on the full-bleed tile, centred, ICON_SCALE of the side wide"""
    w = size * ICON_SCALE
    h = w * MARK_RATIO
    return (f'<!doctype html><html><head><style>html,body{{margin:0;width:{size}px;height:{size}px;background:{TILE};overflow:hidden}}'
            f'img{{position:absolute;left:{(size - w) / 2}px;top:{(size - h) / 2}px;width:{w}px;height:{h}px}}</style></head>'
            f'<body><img src="{svg_uri(white(MARK_SVG))}" alt=""></body></html>')


def used_fonts(pg, selector):
    """the platform faces Chromium drew the text of `selector` with (CDP CSS.getPlatformFontsForNode, the text of the node itself)"""
    cdp = pg.context.new_cdp_session(pg)
    cdp.send('DOM.enable')
    cdp.send('CSS.enable')
    root = cdp.send('DOM.getDocument')['root']['nodeId']
    node = cdp.send('DOM.querySelector', {'nodeId': root, 'selector': selector})['nodeId']
    fonts = cdp.send('CSS.getPlatformFontsForNode', {'nodeId': node})['fonts']
    cdp.detach()
    return [(f['postScriptName'] or f['familyName'], f['glyphCount']) for f in fonts]


def main():
    with sync_playwright() as p:
        # without the GPU process: on some headless hosts a screenshot otherwise never completes (the page loads, the frame never comes)
        b = p.chromium.launch(args=['--disable-gpu', '--disable-software-rasterizer'])
        pg = b.new_page(viewport={'width': 1200, 'height': 630})
        pg.set_content(CARD)
        pg.evaluate('document.fonts.ready')
        pg.wait_for_function('[...document.images].every(i => i.complete && i.naturalWidth)')
        for sel in ('.brand span', 'h1', 'h1 em', '.k', '.q span'):
            fonts = used_fonts(pg, sel)
            print(f'{sel}: ' + ', '.join(f'{name} ({n} glyphs)' for name, n in fonts))
            if sel in ('.brand span', 'h1', 'h1 em') and not all('charter' in name.lower() for name, _ in fonts):
                raise SystemExit(f'{sel} is not drawn in Charter: install Charter or XCharter (see the docstring)')
        pg.screenshot(path=str(PUBLIC / 'og.png'))
        for size in (512, 192):
            pg.set_viewport_size({'width': size, 'height': size})
            pg.set_content(icon(size))
            pg.wait_for_function('[...document.images].every(i => i.complete && i.naturalWidth)')
            pg.screenshot(path=str(PUBLIC / f'icon-{size}.png'))
        b.close()
    print('og.png, icon-512.png, icon-192.png → apps/web/public/')


if __name__ == '__main__':
    main()
