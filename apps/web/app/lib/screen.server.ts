import { store } from '../../client/store.js';
import { viewUnit } from '../../client/publication-query.js';
// The first response of a screen (docs/adr/0002-react-router-ssr.md): the screen that apps/web/client/router.js paints in the browser, drawn
// here from the release of the request. The browser then takes the same document over (apps/web/client/main.js), as it took over the
// prerendered files before. The request scope (apps/web/client/env.js) is set by apps/web/workers/app.ts around this call.
import { migrated } from '../migration/registry';
import { textModel, textMetadata } from './screens/text';
import type { TextScreenModel } from './screen-state';
import { resolve, build, frameHtml, docTitle, periodsFor, errorVm } from '../../client/render.js';
import { head } from '../../client/seo.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { bannerHtml, topbarHtml, tabbarHtml, footerHtml } from '../components/chrome/chrome';
import { data } from '../../client/data.js';
import { screenQuery } from '../../client/routes.js';
import { toHref, parts, fileHref } from '../../client/loc.js';
import { reset as resetShare } from '../../client/share.js';
import { index as glossaryIndex, link as linkTerms } from '../../client/glossary-scan.js';
import { parseHTML } from 'linkedom';

export interface HeadTag {
  tag: 'meta' | 'link';
  attrs: Record<string, string>;
}
export interface ScreenDoc {
  status: number;
  title: string;
  tags: HeadTag[];
  ld: string;
  /** the page styles of the screen (css/pages/<name>.css), by name */
  css: string[];
  /** the address this document is the screen of (apps/web/client/router.js dropStalePrerender compares it); '404' for the 404 screen */
  prerendered: string;
  bare: boolean;
  release: {
    id: string;
    dataBase: string;
    origin: string;
    sigmaUrl: string;
    feedbackEmail: string;
  };
  banner: string;
  topbar: string;
  view: string;
  /** the view is left for the browser to build (the embed view) */
  busy: boolean;
  footer: string;
  tabbar: string;
  model?: TextScreenModel;
}
export type ScreenResult = { redirect: string } | { doc: ScreenDoc };

/* the browser rewrites old #/x links and file links relative to the root (data/core.json) once they are in the page (apps/web/client/loc.js
   fixLinks); the document gets the same links from the start */
const fixLinks = (s: string, base = '') =>
  s
    .replace(/href="(#\/[^"]*)"/g, (_m, h: string) => `href="${toHref(h)}"`)
    .replace(/href="(data\/[^"]*)"/g, (_m, h: string) => `href="${fileHref(h, base)}"`);
/* the glossary links the browser adds to running text (apps/web/client/glossary-scan.js, the same rules), so a crawler reads them too. The
   article is parsed with linkedom only when it has text to scan, and written out only when a term was linked; linkedom writes the same
   HTML in its own spelling (&#160;, " />", empty attributes as ="" and so on), so the two spellings a reader could notice are put back */
async function withGlossary(article: string): Promise<string> {
  if (!article.includes('data-gl-scan')) return article;
  let terms;
  try {
    terms = glossaryIndex(await data.load('glossary'));
  } catch {
    return article;
  }
  const { document } = parseHTML(`<!doctype html><html><body>${article}</body></html>`);
  const root = document.querySelector('article.page');
  if (!root || !linkTerms(root, terms)) return article;
  return root.outerHTML.replace(/&#160;/g, '\u00a0').replace(/" \/>/g, '"/>');
}

const sameAddress = (a: string, b: string) => {
  try {
    return decodeURIComponent(a) === decodeURIComponent(b);
  } catch {
    return a === b;
  }
};

type Rel = ScreenDoc['release'];
/** the screen of a request URL: a redirect to its canonical address, or the document */
export async function renderScreen(url: URL, release: Rel): Promise<ScreenResult> {
  const address = url.pathname + url.search;
  const r = resolve(address);
  if (r.found && !sameAddress(r.want, address)) return { redirect: r.want }; // /Prihodi, an old address, a default ?per= → the canonical one
  const { route, params } = r;
  store.set('period', r.periodResolution.resolved);
  store.set('unit', viewUnit(r.query.unit) || 'eur');
  const query = screenQuery(route, r.query); // the keys of the screen only: what the edge cache keys it on (apps/web/workers/app.ts)

  resetShare(route);
  try {
    await data.load('core');
  } catch {
    /* the footer and the source cards degrade without core.json, as in the browser */
  }
  let vm;
  let preparedModel: TextScreenModel | undefined;
  let status = route.id === 'S30' ? 404 : 200;
  if (route.bare)
    vm = null; // the embed view is built in the browser (apps/web/client/pages/s29-embed.js)
  else {
    try {
      if (migrated(route.id)) {
        preparedModel = await textModel(route.id, params as Record<string, string>, query, {
          release,
          load: (name) => data.load(name),
        });
        vm = textMetadata(preparedModel);
      } else vm = await build(route, params, query, { path: r.segs.join('/') });
    } catch (e) {
      console.error(e);
      vm = errorVm(route, params, query);
      status = 500;
    }
    if (vm.route.id === 'S30') status = 404;
    // a file the screen needs could not be read (the „Опитайте пак“ state of apps/web/client/render.js): a 503 that apps/web/workers/app.ts never keeps
    else if (vm.view === 'error' && !vm.demo) status = 503;
  }
  const shown = vm ? vm.route : route;
  const title = vm ? docTitle(vm) : `${route.title} · Бюджет на светло`;
  const h = vm ? head(vm, title) : { tags: [], ld: '{}' };
  const mod = vm?.mod as { styles?: string[] } | null | undefined;
  const model =
    preparedModel ??
    (vm && migrated(shown.id)
      ? await textModel(shown.id, vm.params, query, { release, load: (name) => data.load(name) })
      : undefined);
  return {
    doc: {
      model,
      status,
      title,
      tags: h.tags as HeadTag[],
      ld: h.ld,
      css: [...(mod?.styles || [])].sort(),
      prerendered: shown.id === 'S30' ? '404' : r.screen,
      bare: !!route.bare,
      release,
      banner: model ? '' : renderToStaticMarkup(bannerHtml()),
      topbar: model
        ? ''
        : fixLinks(
            renderToStaticMarkup(topbarHtml({ route: shown, periods: periodsFor(shown, mod) })),
          ),
      view: model
        ? ''
        : vm
          ? fixLinks(
              await withGlossary(String(frameHtml(vm))),
              release.dataBase === '/data/' ? '' : release.dataBase,
            )
          : '',
      busy: !vm,
      footer: model
        ? ''
        : fixLinks(
            renderToStaticMarkup(
              footerHtml({
                wide: true,
                cur: shown.id,
                from: parts(r.want).path.replace(/^\//, ''),
              }),
            ),
          ),
      tabbar: model ? '' : fixLinks(renderToStaticMarkup(tabbarHtml(shown))),
    },
  };
}
