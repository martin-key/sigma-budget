import { rejectReactKeyWarnings } from './metadata-test-warnings';
import { createHash } from 'node:crypto';
import { expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { MigratedScreen } from '../migration/registry';
import { textModel } from '../lib/screens/text';
import { renderScreen } from '../lib/screen.server';
import { provideScope } from '../../client/env.js';
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
  if (!(name in docs)) throw new Error(name);
  return docs[name] as T;
};
const fixture = (file: string) =>
  readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), 'utf8');
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
      b = semantics(fixture(c.file));
    expect({ ...a, text: undefined }).toEqual({ ...b, text: undefined });
    expect(a.text).toBe(b.text);
    const { document } = parseHTML(fixture(c.file));
    expect(result.doc.status).toBe(c.status);
    expect(result.doc.title).toBe(document.title);
    for (const tag of result.doc.tags)
      expect(
        [...document.querySelectorAll(tag.tag)].some((x) =>
          Object.entries(tag.attrs).every(([k, v]) => x.getAttribute(k) === v),
        ),
      ).toBe(true);
    expect(JSON.parse(result.doc.ld)).toEqual(
      JSON.parse(document.querySelector('#ld-page')!.textContent!),
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

rejectReactKeyWarnings();
