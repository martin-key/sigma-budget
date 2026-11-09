// S24 („Откъде са данните?“) and S27 („Обратна връзка“) against the documents of the base Worker (__fixtures__/reference-manifest.json,
// frozen by capture-reference.mjs from the unmodified legacy renderer): the React screen keeps their ordered text, headings, links and
// controls, and the server keeps their status, title, head tags and JSON-LD.
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
import manifest from './__fixtures__/reference-manifest.json';
import inputs from './__fixtures__/reference-inputs.json';
import type { TextScreenModel } from '../lib/screen-state';

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
  return structuredClone(docs[name]) as T;
};
const fixture = (file: string) =>
  readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), 'utf8');
const CONTROL_ATTRS = [
  'name',
  'type',
  'data-query',
  'download',
  'aria-describedby',
  'aria-controls',
  'aria-selected',
  'aria-pressed',
  'role',
];
export function semantics(html: string) {
  const { document } = parseHTML(html),
    article = document.querySelector('article')!;
  article.normalize();
  const norm = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();
  const headings = [...article.querySelectorAll('h1,h2,h3')].map((x) => [
    x.tagName,
    x.id,
    norm(x.textContent),
  ]);
  const links = [...article.querySelectorAll('a')].map((x) => [
    norm(x.textContent),
    x.getAttribute('href'),
    x.getAttribute('download'),
  ]);
  const controls = [
    ...article.querySelectorAll('select,button,input,textarea,details,form,[role="tabpanel"]'),
  ].map((x) => [
    x.tagName,
    x.id,
    ...CONTROL_ATTRS.map((a) => x.getAttribute(a)),
    x.hasAttribute('hidden'),
    (x as HTMLInputElement).getAttribute('value'),
  ]);
  const selected = [...article.querySelectorAll('option')]
    .filter((o) => o.hasAttribute('selected'))
    .map((o) => [o.parentElement?.closest('select')?.id, o.getAttribute('value')]);
  article.querySelectorAll('.sr-only,[aria-hidden="true"],script,style').forEach((n) => n.remove());
  const w = document.createTreeWalker(article, 4);
  let n;
  const parts = [];
  while ((n = w.nextNode())) if (n.textContent?.trim()) parts.push(n.textContent);
  return { headings, links, controls, selected, text: norm(parts.join(' ')) };
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
      c.screen as TextScreenModel['screen'],
      c.params as Record<string, string>,
      c.query as Record<string, string>,
      { release, load },
    );
    const actual = renderToString(
      <MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />,
    );
    const a = semantics(actual),
      b = semantics(fixture(c.file));
    expect(a.headings).toEqual(b.headings);
    expect(a.links).toEqual(b.links);
    expect(a.controls).toEqual(b.controls);
    expect(a.selected).toEqual(b.selected);
    expect(a.text).toBe(b.text);
    const { document } = parseHTML(fixture(c.file));
    expect(result.doc.status).toBe(c.status);
    expect(result.doc.title).toBe(document.title);
    for (const tag of result.doc.tags)
      expect(
        [...document.querySelectorAll(tag.tag)].some((x) =>
          Object.entries(tag.attrs).every(([k, v]) => x.getAttribute(k) === v),
        ),
        JSON.stringify(tag),
      ).toBe(true);
    expect(JSON.parse(result.doc.ld)).toEqual(
      JSON.parse(document.querySelector('#ld-page')!.textContent!),
    );
    expect(result.doc.css).toEqual(
      [...document.querySelectorAll('link[rel="stylesheet"][href*="/css/pages/"]')]
        .map((l) => l.getAttribute('href')!.replace(/^.*\/css\/pages\/|\.css$/g, ''))
        .sort(),
    );
  });
}
for (const file of ['S24.html', 'S27.html']) {
  for (const mutation of ['heading', 'target', 'control'])
    it(`${file} catches deliberate ${mutation} breakage`, () => {
      const html = fixture(file);
      const broken =
        mutation === 'heading'
          ? html.replace('<h2 id="', '<h2 id="broken-')
          : mutation === 'target'
            ? html.replace('<a href="/', '<a href="/broken-')
            : html.replace('aria-describedby="', 'aria-describedby="broken ');
      expect(semantics(broken)).not.toEqual(semantics(html));
    });
}

it('frozen server documents and inputs match their recorded checksums', () => {
  for (const c of manifest.cases)
    expect(createHash('sha256').update(fixture(c.file)).digest('hex')).toBe(c.sha256);
  expect(
    createHash('sha256')
      .update(readFileSync(new URL('./__fixtures__/reference-inputs.json', import.meta.url)))
      .digest('hex'),
  ).toBe(manifest.inputsSha256);
});

rejectReactKeyWarnings();
