// The «За проекта» screen (S26) is gone: its notes are in the footer, its status legend is on «Методология». The route table keeps a
// record of S26 only because the current data release still names it (data/release/catalog.json, dataset core: screens); the record goes
// with the next regular data release (docs/dev-guide.md, section 11). This file guards that the visitor never meets it.
import { existsSync, readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as legacyChrome from '../../client/chrome.js';
import { model as catalogModel, screensOf } from '../../client/catalog.js';
import { provideScope } from '../../client/env.js';
import { resolve } from '../../client/render.js';
import { redirectHash } from '../../client/redirects.js';
import { browserRoutes } from '../../client/routes.js';
import { getIndex } from '../../client/searchlib.js';
import { requestState } from '../../client/store.js';
import { NAV_GROUPS, footerHtml } from '../components/chrome/chrome';
import { migrated } from '../migration/registry';
import { loader } from '../routes/not-found';
import routeConfig from '../routes';
import { ROUTES } from './routes';
import { renderScreen } from './screen.server';

const RELEASE = new URL('../../../../data/release/', import.meta.url);
const releaseFile = (name: string) =>
  JSON.parse(readFileSync(new URL(`${name}.json`, RELEASE), 'utf8')) as unknown;
const release = (origin: string) => ({
  id: '',
  dataBase: '/data/',
  origin,
  sigmaUrl: '',
  feedbackEmail: '',
});
const useRelease = (url: URL) =>
  provideScope(() => ({
    url,
    origin: url.origin,
    state: requestState(null),
    data: new Map(),
    maps: {},
    load: async (name: string) => releaseFile(name),
  }));
const S26 = ROUTES.find((r) => r.id === 'S26')!;
const GONE = /za-proekta|За проекта|data-route="S26"/;
afterEach(() => provideScope(() => null));

describe('the retired S26 record', () => {
  it('is still named by the current data release, which is the only reason it stays', () => {
    const catalog = releaseFile('catalog') as { datasets: { id: string; screens: string[] }[] };
    expect(catalog.datasets.find((d) => d.id === 'core')?.screens).toContain('S26');
  });

  it('is marked retired and has no address, no samples, no menu entry and no next screens', () => {
    expect(S26).toMatchObject({ retired: true, pattern: null, nav: false, next: [], samples: [] });
    expect(ROUTES.filter((r) => r.retired).map((r) => r.id)).toEqual(['S26']);
    expect(ROUTES.some((r) => r.next.includes('S26'))).toBe(false);
    // the browser checks (tests/e2e/screens.py and others) walk window.__ROUTES__: a retired id must not be there to be visited
    expect(browserRoutes().map((r) => r.id)).not.toContain('S26');
    expect(browserRoutes()).toHaveLength(ROUTES.length - 1);
  });

  it('has no route module, no React or legacy screen and no page styles', () => {
    expect(JSON.stringify(routeConfig)).not.toMatch(/za-proekta|"S26"/);
    expect(migrated('S26')).toBe(false);
    for (const file of [
      '../routes/za-proekta.tsx',
      '../routes/about-content.tsx',
      '../migration/screen-S26.tsx',
      '../../client/pages/s26-za-proekta.js',
      '../../public/css/pages/s26-za-proekta.css',
    ])
      expect(existsSync(new URL(file, import.meta.url)), file).toBe(false);
  });

  it('is in neither menu, phone menu nor footer, in the React and the legacy chrome alike', () => {
    for (const groups of [NAV_GROUPS, legacyChrome.NAV_GROUPS])
      expect(groups.flatMap(([, ids]) => ids)).not.toContain('S26');
    expect(renderToString(<>{footerHtml({ wide: true })}</>)).not.toMatch(GONE);
    expect(String(legacyChrome.footerHtml({ wide: true }))).not.toMatch(GONE);
  });

  it('gives the data catalogue («Методология») no screen and no link for it', () => {
    expect(screensOf(['S26'])).toEqual([]);
    const M = catalogModel(releaseFile('catalog'), undefined);
    expect(M.screens.map((s: { id: string }) => s.id)).not.toContain('S26');
    const core = M.sets.find((s: { id: string }) => s.id === 'core');
    expect(core.screens).toContain('S26'); // the release names it ...
    expect(core.screenRoutes.map((r: { id: string }) => r.id)).not.toContain('S26'); // ... the page does not show it
  });

  it('is not offered by the search', async () => {
    useRelease(new URL('https://budget.test/tarsene'));
    const { entries } = await getIndex();
    expect(entries.length).toBeGreaterThan(100);
    expect(
      entries.filter((e: { title: string; href: string }) => GONE.test(`${e.title} ${e.href}`)),
    ).toEqual([]);
  });

  it('is not linked from «Методология», which the server draws from the current release', async () => {
    const url = new URL('https://sigma-budget.my-data.bg/danni');
    useRelease(url);
    const result = await renderScreen(url, release(url.origin));
    if ('redirect' in result) throw Error(result.redirect);
    expect(result.doc.status).toBe(200);
    expect(result.doc.view).toContain('data-route="S24"');
    for (const part of [result.doc.view, result.doc.topbar, result.doc.footer])
      expect(part).not.toMatch(GONE);
  });
});

describe('the old address /za-proekta', () => {
  it.each(['/za-proekta', '/za-proekta?to=s26-legend', '/za-proekta?per=2026.law&demo=empty'])(
    '%s resolves to «Методология» without its query',
    (address) => {
      const r = resolve(address);
      expect(r.route.id).toBe('S24');
      expect(r.want).toBe('/danni');
    },
  );

  it('is rewritten in the pages’ own hash links too', () => {
    expect(redirectHash('#/za-proekta?to=s26-open')).toBe('#/danni');
  });

  it.each(['/za-proekta', '/za-proekta?to=s26-legend'])(
    '%s is answered with a 301 to /danni by the catch-all route that now serves it',
    async (address) => {
      const url = new URL(address, 'https://sigma-budget.my-data.bg');
      useRelease(url);
      const thrown = await loader({
        request: new Request(url),
        context: { release: release(url.origin) },
      } as unknown as Parameters<typeof loader>[0]).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(301);
      expect((thrown as Response).headers.get('Location')).toBe('/danni');
    },
  );
});
