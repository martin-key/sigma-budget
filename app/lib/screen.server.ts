// The first response of a screen (docs/adr/0002-react-router-ssr.md): the screen that site/js/router.js paints in the browser, drawn
// here from the release of the request. The browser then takes the same document over (site/js/main.js), as it took over the
// prerendered files before. The request scope (site/js/env.js) is set by workers/app.ts around this call.
import { resolve, build, frameHtml, docTitle, periodsFor, errorVm } from '../../site/js/render.js';
import { head } from '../../site/js/seo.js';
import { bannerHtml, topbarHtml, tabbarHtml, footerHtml } from '../../site/js/chrome.js';
import { data } from '../../site/js/data.js';
import { toHref, parts, fileHref } from '../../site/js/loc.js';

export interface HeadTag { tag: 'meta' | 'link'; attrs: Record<string, string> }
export interface ScreenDoc {
  status: number;
  title: string;
  tags: HeadTag[];
  ld: string;
  /** the page styles of the screen (css/pages/<name>.css), by name */
  css: string[];
  /** the address this document is the screen of (site/js/router.js dropStalePrerender compares it); '404' for the 404 screen */
  prerendered: string;
  bare: boolean;
  release: { id: string; dataBase: string; origin: string; sigmaUrl: string };
  banner: string;
  topbar: string;
  view: string;
  /** the view is left for the browser to build (the embed view) */
  busy: boolean;
  footer: string;
  tabbar: string;
}
export type ScreenResult = { redirect: string } | { doc: ScreenDoc };

/* the browser rewrites old #/x links and file links relative to the root (data/core.json) once they are in the page (site/js/loc.js
   fixLinks); the document gets the same links from the start */
const fixLinks = (s: string, base = '') => s
  .replace(/href="(#\/[^"]*)"/g, (_m, h: string) => `href="${toHref(h)}"`)
  .replace(/href="(data\/[^"]*)"/g, (_m, h: string) => `href="${fileHref(h, base)}"`);
const sameAddress = (a: string, b: string) => { try { return decodeURIComponent(a) === decodeURIComponent(b); } catch { return a === b; } };

type Rel = ScreenDoc['release'];
/** the screen of a request URL: a redirect to its canonical address, or the document */
export async function renderScreen(url: URL, release: Rel): Promise<ScreenResult> {
  const address = url.pathname + url.search;
  const r = resolve(address);
  if (r.found && !sameAddress(r.want, address)) return { redirect: r.want };    // /Prihodi, an old address, a default ?per= → the canonical one
  const { route, params, query } = r;

  try { await data.load('core'); } catch { /* the footer and the source cards degrade without core.json, as in the browser */ }
  let vm;
  let status = route.id === 'S30' ? 404 : 200;
  if (route.bare) vm = null;                                   // the embed view is built in the browser (site/js/pages/s29-embed.js)
  else {
    try { vm = await build(route, params, query, { path: r.segs.join('/') }); }
    catch (e) { console.error(e); vm = errorVm(route, params, query); status = 500; }
    if (vm.route.id === 'S30') status = 404;
  }
  const shown = vm ? vm.route : route;
  const title = vm ? docTitle(vm) : `${route.title} · Бюджет на светло`;
  const h = vm ? head(vm, title) : { tags: [], ld: '{}' };
  const mod = vm?.mod as { styles?: string[] } | null | undefined;
  return {
    doc: {
      status,
      title,
      tags: h.tags as HeadTag[],
      ld: h.ld,
      css: [...(mod?.styles || [])].sort(),
      prerendered: shown.id === 'S30' ? '404' : r.want,
      bare: !!route.bare,
      release,
      banner: String(bannerHtml()),
      topbar: fixLinks(String(topbarHtml({ route: shown, periods: periodsFor(shown, mod) }))),
      view: vm ? fixLinks(String(frameHtml(vm)), release.dataBase === '/data/' ? '' : release.dataBase) : '',
      busy: !vm,
      footer: fixLinks(String(footerHtml({ wide: true, cur: shown.id, theme: '', from: parts(r.want).path.replace(/^\//, '') }))),
      tabbar: fixLinks(String(tabbarHtml(shown))),
    },
  };
}
