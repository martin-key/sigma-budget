import { publicOrganization, finalPendingCopy } from './launch-copy-test-helper';
import { rejectReactKeyWarnings } from './metadata-test-warnings';
import { createHash } from 'node:crypto';
import { expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { MigratedScreen } from '../migration/registry';
import { textModel } from '../lib/screens/text';
import { renderScreen } from '../lib/screen.server';
import { build, docTitle, frameHtml, resolve } from '../../client/render.js';
import { head } from '../../client/seo.js';
import { provideScope } from '../../client/env.js';
import { data } from '../../client/data.js';
import { csvFor, get as shareSpec, reset as resetShare } from '../../client/share.js';
import { requestState } from '../../client/store.js';
import manifest from './__fixtures__/narrative-manifest.json';
import inputs from './__fixtures__/narrative-inputs.json';
const docs: Record<string, unknown> = inputs;
const release = {
  id: manifest.releaseId,
  dataBase: '/data/',
  origin: manifest.origin,
  sigmaUrl: '',
  feedbackEmail: '',
};
const load = async <T,>(name: string): Promise<T> => {
  if (name === 'releases/current') return { release_id: manifest.releaseId } as T;
  if (!(name in docs)) throw new Error(name);
  return docs[name] as T;
};
const fixture = (file: string) =>
  readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), 'utf8');
// Keep frozen captures unchanged; remove only the retired future-data blocks and copy.
function launchCopy(html: string) {
  const { document } = parseHTML(html);
  document
    .querySelectorAll('#s16-b-expected,#s14-2027,[data-pending-id="P07"]')
    .forEach((n) => n.remove());
  document.querySelectorAll('.s14-text').forEach((n) => {
    if (n.textContent?.includes('програмите още не са добавени в тази версия')) n.remove();
  });
  return document
    .toString()
    .replaceAll('и какво предстои.', 'и хронологията на събитията.')
    .replaceAll(
      ' Адресите на събитията в него са примерни, докато порталът няма постоянен адрес.',
      '',
    );
}
export function semantics(html: string) {
  const { document } = parseHTML(html),
    article = document.querySelector('article')!;
  article.normalize();
  const norm = (s: string | null) => s?.replace(/\s+/g, ' ').trim();
  const headings = [...article.querySelectorAll('h1,h2,h3')].map((x) => [
    x.tagName,
    x.id,
    norm(x.textContent),
  ]);
  const links = [...article.querySelectorAll('a')].map((x) => [
    norm(x.textContent),
    x.getAttribute('href'),
  ]);
  const controls = [...article.querySelectorAll('select,button,input,details')].map((x) => [
    x.tagName,
    x.id,
    x.getAttribute('data-query'),
    x.getAttribute('download'),
  ]);
  const bodyLayout = [...article.querySelectorAll('.page-body > *')].map((x) => [x.tagName, x.id]);
  article.querySelectorAll('.sr-only,[aria-hidden="true"],script,style').forEach((n) => n.remove());
  const w = document.createTreeWalker(article, 4);
  let n;
  const parts = [];
  while ((n = w.nextNode())) if (n.textContent?.trim()) parts.push(n.textContent);
  return { headings, links, controls, bodyLayout, text: norm(parts.join(' ')) };
}
afterEach(() => provideScope(() => null));
for (const c of manifest.cases) {
  it(`${c.file} preserves frozen ordered text, headings, links, controls and metadata`, async () => {
    const url = new URL(c.address, manifest.origin);
    const scope = { url, origin: url.origin, data: new Map(), state: requestState(null), load };
    provideScope(() => scope);
    const result = await renderScreen(url, release);
    if ('redirect' in result) throw Error(result.redirect);
    const model = await textModel(
      c.screen as 'S14' | 'S16',
      {},
      c.query as Record<string, string>,
      { release, load },
    );
    const actual = renderToString(
      <MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />,
    );
    const a = semantics(actual),
      b = semantics(finalPendingCopy(launchCopy(fixture(c.file))));
    expect({ ...a, text: undefined }).toEqual({ ...b, text: undefined });
    expect(a.text).toBe(b.text);
    const { document } = parseHTML(launchCopy(fixture(c.file)));
    expect(result.doc.status).toBe(c.status);
    expect(result.doc.title).toBe(document.title);
    for (const tag of result.doc.tags)
      expect(
        [...document.querySelectorAll(tag.tag)].some((x) =>
          Object.entries(tag.attrs).every(([k, v]) => x.getAttribute(k) === v),
        ),
      ).toBe(true);
    expect(JSON.parse(result.doc.ld)).toEqual(
      JSON.parse(publicOrganization(document.querySelector('#ld-page')!.textContent!)),
    );
  });
}
for (const screen of ['S14', 'S16']) {
  for (const mutation of ['heading', 'target'])
    it(`${screen} catches deliberate ${mutation} breakage`, () => {
      const html = fixture(screen + '.html');
      const broken =
        mutation === 'heading'
          ? html.replace(/(<h2[^>]*id=")/, '$1broken-')
          : html.replace('href="/izpalnenie', 'href="/broken');
      expect(semantics(broken)).not.toEqual(semantics(html));
    });
}

it('frozen server documents and inputs match their recorded checksums', () => {
  for (const c of [...manifest.cases, ...manifest.browserCases, ...manifest.exportCases])
    expect(createHash('sha256').update(fixture(c.file)).digest('hex')).toBe(c.sha256);
  expect(
    createHash('sha256')
      .update(readFileSync(new URL('./__fixtures__/narrative-inputs.json', import.meta.url)))
      .digest('hex'),
  ).toBe(manifest.inputsSha256);
});

// Preserve the CSV oracle check previously run by the fixture regeneration script.
for (const c of manifest.exportCases) {
  it(`${c.file} preserves the frozen legacy CSV`, async () => {
    const url = new URL(c.address, manifest.origin);
    const scope = { url, origin: url.origin, data: new Map(), state: requestState(null), load };
    provideScope(() => scope);
    await data.load('core');
    const route = resolve(c.address);
    resetShare(route.route);
    await build(route.route, route.params, route.query);
    await data.load('releases/current');
    const table = (scope as any).maps.attached.get('s14-t-bjudzheti').table;
    expect(csvFor({ ...shareSpec(c.block), table })).toBe(fixture(c.file));
  });
}

// Live legacy parity remains independent of React after retiring the pending blocks.
for (const c of manifest.cases.filter((c) => !c.query.demo)) {
  it(`${c.file} matches the current independent legacy renderer`, async () => {
    const url = new URL(c.address, manifest.origin);
    const scope = {
      url,
      origin: url.origin,
      data: new Map(),
      state: requestState(c.query.per || null),
      load,
    };
    provideScope(() => scope); // one scope per request, as on the server, so loaded files stay available to head()
    // As the server does: core first, so the pending notes and dateModified come from the same frozen release.
    await data.load('core');
    const route = resolve(c.address);
    resetShare(route.route);
    const vm = await build(route.route, route.params, route.query);
    await data.load('releases/current'); // dateModified of the JSON-LD, as on the server
    // The legacy title, head tags and JSON-LD stay pinned to the frozen capture (formerly the period-fixture regeneration check).
    const { document: frozen } = parseHTML(launchCopy(fixture(c.file)));
    const title = docTitle(vm),
      metadata = head(vm, title);
    expect(title).toBe(frozen.title);
    for (const tag of metadata.tags)
      expect(
        [...frozen.querySelectorAll(tag.tag)].some((x) =>
          Object.entries(tag.attrs as Record<string, string>).every(
            ([k, v]) => x.getAttribute(k) === v,
          ),
        ),
        `${c.file}: ${tag.tag} ${JSON.stringify(tag.attrs)}`,
      ).toBe(true);
    expect(JSON.parse(metadata.ld)).toEqual(
      JSON.parse(publicOrganization(frozen.querySelector('#ld-page')!.textContent!)),
    );
    const legacy = String(frameHtml(vm))
      .replaceAll('href="#/', 'href="/')
      .replaceAll('href="data/', 'href="/data/')
      .replaceAll(
        '/vrazka?type=error&amp;block=',
        `/vrazka?type=error&amp;from=${url.pathname.slice(1)}&amp;block=`,
      );
    const model = await textModel(
      c.screen as 'S14' | 'S16',
      {},
      c.query as Record<string, string>,
      { release, load },
    );
    expect(
      semantics(
        renderToString(<MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />),
      ),
    ).toEqual(semantics(legacy));
  });
}

rejectReactKeyWarnings();
