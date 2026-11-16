/** Draw the social card and app icons.
 * Output bytes depend on the Chromium build and installed fonts. */
import { chromium, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PAPER = '#FDFAF4',
  INK = '#15110C',
  CRIMSON = '#AC1B18',
  SOFT = '#6B6257',
  TILE = '#7C040D';
const MARK_SVG = readFileSync(new URL('./sigma-mark.svg', import.meta.url), 'utf8');
const LOGO_SVG = readFileSync(join(PUBLIC, 'sigma-logo.svg'), 'utf8');
const MARK_RATIO = 58.52 / 72.18,
  ICON_SCALE = 0.636;
function fontStack(name: string) {
  const css = readFileSync(join(PUBLIC, 'css/tokens.css'), 'utf8');
  const m = new RegExp('--font-' + name + ':\\s*([^;]+);').exec(css);
  if (!m) throw Error('Missing font token: ' + name);
  return m[1].split(/\s+/).filter(Boolean).join(' ');
}
const SERIF = fontStack('serif').replace('Charter,', "Charter, XCharter, 'Bitstream Charter',"),
  MONO = fontStack('mono');
const svgURI = (svg: string) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const white = (svg: string) => svg.replace(/fill:#[0-9a-fA-F]{3,6}/g, 'fill:#fff');
export const CARD = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;background:${PAPER};color:${INK};-webkit-font-smoothing:antialiased}
.c{position:relative;box-sizing:border-box;width:1200px;height:630px;padding:64px 72px;display:flex;flex-direction:column}
.brand{display:flex;align-items:baseline;gap:.32em;font-size:34px}
.brand img{flex:none;display:block;width:auto;height:.775em;position:relative;top:.08em}
.brand span{font:400 1em/1 ${SERIF};letter-spacing:-.02em}
.k{margin-top:58px;font:500 20px/1 ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${CRIMSON};display:flex;align-items:center;gap:14px}
.k::before{content:"";width:40px;height:2px;background:${CRIMSON}}
h1{margin:26px 0 0;font:400 86px/1.02 ${SERIF};letter-spacing:-.025em;max-width:820px}
h1 em{color:${CRIMSON}}
.q{margin-top:auto;padding-top:22px;border-top:2px solid ${INK};font:500 19px/1.5 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${SOFT};display:flex;gap:18px;flex-wrap:wrap}
.q span+span::before{content:"·";margin-right:18px;color:${CRIMSON}}
.mark{position:absolute;right:72px;top:228px;width:260px;height:auto}
</style></head><body><div class="c">
<div class="brand"><img src="${svgURI(LOGO_SVG)}" alt=""><span>Бюджет</span></div>
<div class="k">Държавният бюджет · 2026</div>
<h1>Бюджетът на&nbsp;България на&nbsp;<em>достъпен</em> език</h1>
<img class="mark" src="${svgURI(MARK_SVG)}" alt="">
<div class="q"><span>Откъде идват парите</span><span>Къде отиват</span><span>Изпълнява ли се планът</span><span>Колко дължим</span></div>
</div></body></html>`;
export function icon(size: number) {
  const w = size * ICON_SCALE,
    h = w * MARK_RATIO;
  return `<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;background:${TILE};overflow:hidden}img{position:absolute;left:${(size - w) / 2}px;top:${(size - h) / 2}px;width:${w}px;height:${h}px}</style></head><body><img src="${svgURI(white(MARK_SVG))}" alt=""></body></html>`;
}
async function usedFonts(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const root = (await cdp.send('DOM.getDocument')).root.nodeId;
    const nodeId = (await cdp.send('DOM.querySelector', { nodeId: root, selector })).nodeId;
    return (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  } finally {
    await cdp.detach();
  }
}
export async function makeImages(out = PUBLIC) {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    args: ['--disable-gpu', '--disable-software-rasterizer'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(CARD);
    await page.evaluate('document.fonts.ready');
    const imagesReady = '[...document.images].every(i => i.complete && i.naturalWidth)';
    await page.waitForFunction(imagesReady);
    for (const selector of ['.brand span', 'h1', 'h1 em', '.k', '.q span']) {
      const fonts = await usedFonts(page, selector);
      console.log(
        selector +
          ': ' +
          fonts
            .map((f) => `${f.postScriptName || f.familyName} (${f.glyphCount} glyphs)`)
            .join(', '),
      );
      if (
        ['.brand span', 'h1', 'h1 em'].includes(selector) &&
        !fonts.every((f) => (f.postScriptName || f.familyName).toLowerCase().includes('charter'))
      )
        throw Error(selector + ' is not drawn in Charter: install Charter or XCharter');
    }
    await page.screenshot({ path: join(out, 'og.png') });
    for (const size of [512, 192]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(icon(size));
      await page.waitForFunction(imagesReady);
      await page.screenshot({ path: join(out, `icon-${size}.png`) });
    }
  } finally {
    await browser.close();
  }
  console.log('og.png, icon-512.png, icon-192.png → ' + out);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  await makeImages(values.out ? resolve(values.out) : PUBLIC);
}
