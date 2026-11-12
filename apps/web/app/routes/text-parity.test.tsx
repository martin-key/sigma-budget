import { publicOrganization, finalPendingCopy } from './launch-copy-test-helper';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { MigratedScreen, safeJSON } from '../migration/registry';
import core from './__fixtures__/core.json';
import glossary from './__fixtures__/glossary.json';
import type { TextScreenModel } from '../lib/screen-state';
import { build, frameHtml } from '../../client/render.js';
import { byId } from '../lib/legacy';
import { index as glossaryIndex, link as linkTerms } from '../../client/glossary-scan.js';
// The route descriptions are source input to the frozen migration oracle too.
vi.mock('../lib/routes.json', async () => ({
  default: JSON.parse(
    (await import('node:fs')).readFileSync(
      new URL('./__fixtures__/routes-05d6f6e.json', import.meta.url),
      'utf8',
    ),
  ),
}));
const fixture = (id: string) =>
  // The shared route catalogue now extends the fiscal screen through 2029; the frozen files stay intact.
  readFileSync(new URL(`./__fixtures__/${id}.html`, import.meta.url), 'utf8').replaceAll(
    'Накъде вървим? 2026–2028',
    'Накъде вървим? 2026–2029',
  );
function semantics(html: string, checkTargets = true) {
  const { document } = parseHTML(html),
    a = document.querySelector('article')!;
  const headings = [...a.querySelectorAll('h1,h2,h3')].map((x) => [
    x.tagName,
    x.getAttribute('id'),
    x.textContent?.replace(/\s+/g, ' ').trim(),
  ]);
  const links = [...a.querySelectorAll('a')].map((x) => [
    x.textContent?.replace(/\s+/g, ' ').trim(),
    x.getAttribute('href'),
  ]);
  for (const link of a.querySelectorAll('a[href]')) {
    const target = new URL(
      link.getAttribute('href')!,
      'https://sigma-budget.my-data.bg',
    ).searchParams.get('to');
    if (!target || !checkTargets) continue;
    const heading = a.querySelectorAll('h1,h2,h3');
    expect(
      [...heading].some((node) => node.id === target),
      `missing heading for ?to=${target}`,
    ).toBe(true);
  }
  a.querySelectorAll('.sr-only,[aria-hidden="true"],script,style').forEach((n) => n.remove());
  return {
    headings,
    links,
    text: (() => {
      const w = document.createTreeWalker(a, 4);
      let parts: string[] = [],
        n;
      while ((n = w.nextNode())) if (n.textContent?.trim()) parts.push(n.textContent);
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    })(),
  };
}
describe('frozen main 26f82ea, same release', () => {
  for (const screen of ['S26', 'S30'] as const)
    it(`${screen} preserves ordered text, headings and link destinations with current data disclosures`, async () => {
      const model: TextScreenModel = {
        screen,
        core,
        glossary,
        params: { path: 'nyama-takava-stranitsa' },
        query: {},
        release: { id: '', dataBase: '/data/', origin: '', sigmaUrl: '', feedbackEmail: '' },
      };
      const html = renderToStaticMarkup(
        <MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />,
      );
      let expected = fixture(screen);
      if (screen === 'S26') {
        const url = new URL('/za-proekta', 'https://sigma-budget.my-data.bg');
        const scope = {
          url,
          origin: url.origin,
          data: new Map<string, unknown>([
            ['core', core],
            ['glossary', glossary],
          ]),
          state: requestState(null),
          load: async (name: string) => (name === 'core' ? core : glossary),
        };
        provideScope(() => scope);
        expected = String(frameHtml(await build(byId.S26, {}, {})));
        const legacyDoc = parseHTML(`<html><body>${expected}</body></html>`).document;
        linkTerms(legacyDoc.querySelector('article'), glossaryIndex(glossary));
        expected = legacyDoc.querySelector('article')!.outerHTML.replaceAll('href="#/', 'href="/');
        expect(html).not.toContain('няколкото стойности');
        expect(html).not.toContain('data-s26-demo');
        expect(html).toContain('Официални източници');
        const actualDoc = parseHTML(html).document,
          oldDoc = parseHTML(
            // The data have no separate licence: they are public official documents.
            fixture(screen).replace(
              /<p>Лицензът на данните още не е избран\.[\s\S]*?<\/p>/,
              '<p>Данните са публични: идват от официални документи и нямат отделен лиценз.</p>',
            ),
          ).document;
        // Roadmap and working-group credits are intentionally retired; keep the open-data oracle.
        for (const id of ['s26-open']) {
          const section = (d: Document) =>
            `<article>${d.getElementById(id)!.closest('section')!.outerHTML}</article>`;
          expect(semantics(section(actualDoc), false)).toEqual(semantics(section(oldDoc), false));
        }
      }
      expect(semantics(html)).toEqual(semantics(expected));
    });
  it('seed cannot terminate its inert script', () =>
    expect(safeJSON({ text: '</script>\u2028' })).toBe('{"text":"\\u003c/script>\\u2028"}'));
});

import { renderScreen } from '../lib/screen.server';
import { provideScope } from '../../client/env.js';
import { requestState } from '../../client/store.js';
afterEach(() => provideScope(() => null));
for (const [screen, path, status] of [
  ['S26', '/za-proekta', 200],
  ['S30', '/nyama-takava-stranitsa', 404],
] as const) {
  it(`${screen} preserves frozen metadata, canonical, JSON-LD and status`, async () => {
    const url = new URL(path, 'https://sigma-budget.my-data.bg');
    const scope = {
      url,
      origin: url.origin,
      data: new Map(),
      state: requestState(null),
      load: async (name: string) => (name === 'core' ? core : glossary),
    };
    provideScope(() => scope);
    const result = await renderScreen(url, {
      id: '',
      dataBase: '/data/',
      origin: url.origin,
      sigmaUrl: '',
      feedbackEmail: '',
    });
    if ('redirect' in result) throw new Error(result.redirect);
    const { document } = parseHTML(fixture(screen));
    expect(result.doc.status).toBe(status);
    expect(result.doc.title).toBe(document.querySelector('title')!.textContent);
    const tags = [...document.querySelectorAll('meta[name],meta[property],link[rel="canonical"]')];
    for (const tag of result.doc.tags) {
      const match = tags.find((t) =>
        Object.entries(tag.attrs).every(([k, v]) => t.getAttribute(k) === v),
      );
      expect(match, JSON.stringify(tag)).toBeTruthy();
    }
    expect(JSON.parse(result.doc.ld)).toEqual(
      JSON.parse(publicOrganization(document.querySelector('#ld-page')!.textContent!)),
    );
  });
}

for (const screen of ['S26', 'S30'] as const)
  for (const view of ['loading', 'empty', 'error', 'pending'] as const) {
    it(`${screen} ${view} state preserves frozen screen semantics`, () => {
      const model: TextScreenModel = {
        screen,
        view,
        core,
        glossary,
        params: { path: 'nyama-takava-stranitsa' },
        query: { demo: view },
        release: { id: '', dataBase: '/data/', origin: '', sigmaUrl: '', feedbackEmail: '' },
      };
      expect(
        semantics(
          renderToStaticMarkup(
            <MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />,
          ),
        ),
      ).toEqual(semantics(finalPendingCopy(fixture(`${screen}-${view}`))));
    });
  }
