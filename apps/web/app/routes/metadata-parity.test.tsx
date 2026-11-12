import { publicOrganization, finalPendingCopy, finalApiCopy } from './launch-copy-test-helper';
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
import { PendingError } from '../../client/data.js';
import { build, frameHtml } from '../../client/render.js';
import { byId } from '../lib/legacy';
import manifest from './__fixtures__/metadata-manifest.json';
import inputs from './__fixtures__/metadata-inputs.json';
const docs: Record<string, unknown> = inputs;
const release = {
  id: manifest.releaseId,
  dataBase: '/data/',
  origin: manifest.origin,
  sigmaUrl: '',
  feedbackEmail: '',
};
const load = async <T,>(name: string): Promise<T> => {
  // The static fixture has no registry; this optional resource is absent, not offline.
  if (name === 'release/journal') throw new PendingError(name);
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
  article.querySelectorAll('.sr-only,[aria-hidden="true"],script,style').forEach((n) => n.remove());
  const w = document.createTreeWalker(article, 4);
  let n;
  const parts = [];
  while ((n = w.nextNode())) if (n.textContent?.trim()) parts.push(n.textContent);
  return { headings, links, controls, text: norm(parts.join(' ')) };
}
afterEach(() => provideScope(() => null));
for (const c of manifest.cases) {
  it(`${c.file} preserves ordered semantics and frozen metadata with the provenance clarification`, async () => {
    const url = new URL(c.address, manifest.origin);
    const scope = { url, origin: url.origin, data: new Map(), state: requestState(null), load };
    provideScope(() => scope);
    const result = await renderScreen(url, release);
    if ('redirect' in result) throw Error(result.redirect);
    const model = await textModel(
      c.screen as 'S25' | 'S35',
      {},
      c.query as Record<string, string>,
      { release, load },
    );
    const actual = renderToString(
      <MigratedScreen model={model} navigation={{ go() {}, announce() {} }} />,
    );
    // The public group heading now covers the 2027 publication too. Keep the
    // original captured HTML and its checksums intact.
    // SECURITY-06 intentionally replaces the unresolved CORS statement; preserve the frozen capture.
    const frozen = fixture(c.file)
      // Pending catalogue entries no longer have public pages or a missing-files notice.
      .replace(/<p class="small muted">Още 7 набора нямат файл,[\s\S]*?<\/p>/, '')
      .replace(/ За 4 от 46 бюджета програмите предстоят \([\s\S]*?P03<\/a>\)\./g, '')
      .replace(
        / файла, а още 7 набора предстоят\.(?: Истински API има само като предложение за втората фаза: виж по-долу\.)?/g,
        ' файла.',
      )
      .replaceAll('Бюджет 2026 и прогноза', 'Бюджет и прогноза')
      .replaceAll(
        'Тук няма жив API: всички данни на сайта са готови файлове, които можеш да свалиш и да прочетеш с код. Ето кои са, как изглеждат и как се ползват.',
        'Всички публикувани данни са достъпни като файлове, които можеш да свалиш и да прочетеш с код. Тук са адресите, полетата и примерите за използване.',
      )
      .replaceAll(
        'Файловете са в UTF-8. Ако ги четеш от страница на друг сайт, браузърът може да поиска разрешение от сървъра (CORS): за истинския портал това още не е решено.',
        'Файловете са в UTF-8. Публичните /api/releases и /data адреси позволяват четене от други сайтове чрез GET и HEAD (CORS: *), без изпращане на cookies или други удостоверителни данни.',
      )
      .replaceAll('Няма жив API', 'Отворени файлове с данни')
      // The data have no separate licence: they are public official documents.
      .replace(
        /(<h2 id="s25-licence"[^>]*>[^<]*<\/h2>)[\s\S]*?<p>Какво знаем днес:<\/p>/,
        '$1<p>Данните са публични: идват от официални документи и нямат отделен лиценз.</p><p>При ползване:</p>',
      )
      .replace('<li>Лиценз и условия за ползване.</li>', '')
      .replaceAll(
        'Сайтът е статичен. Няма сървър, който да отговаря на заявки с параметри, няма ключове за достъп и няма регистрация. Всеки набор е един готов файл с постоянен адрес: сваляш го цял и го филтрираш при себе си.',
        'Всеки набор е готов файл с постоянен адрес: сваляш го цял и го филтрираш при себе си. Публичните файлове се четат без ключ за достъп и без регистрация.',
      );
    // Keep the historical capture intact. S35's intentional copy and input-kind column
    // now follow the current legacy renderer; its links and controls still match the capture.
    const clarified = c.screen === 'S35' && !c.query.demo;
    const expected = clarified
      ? String(frameHtml(await build(byId.S35, {}, c.query)))
      : c.screen === 'S25'
        ? finalApiCopy(frozen)
        : finalPendingCopy(frozen);
    const a = semantics(actual),
      b = semantics(expected);
    expect({ ...a, text: undefined }).toEqual({ ...b, text: undefined });
    expect(a.text).toBe(b.text);
    if (clarified) {
      const old = semantics(frozen);
      expect(a.links).toEqual(old.links);
      expect(a.controls).toEqual(old.controls);
      expect(a.headings).toEqual(
        old.headings.map(([tag, id, title]) => [
          tag,
          id,
          id === 's35-files' ? 'Входни и изходни файлове' : title,
        ]),
      );
      const currentDoc = parseHTML(actual).document;
      const oldDoc = parseHTML(frozen).document;
      for (const id of ['s35-release', 's35-code', 's35-provenance', 's35-history'])
        expect(
          semantics(`<article>${currentDoc.getElementById(id)!.outerHTML}</article>`).text,
        ).toBe(semantics(`<article>${oldDoc.getElementById(id)!.outerHTML}</article>`).text);
      // The check groups are named in Bulgarian; the English summaries stay in validation.json.
      const checks = currentDoc.getElementById('s35-val')!.textContent!;
      expect(checks).toContain('Месечните отчети по КФП');
      expect(checks).toContain('наред');
      expect(checks).not.toMatch(/\bchecks\b|\bKFP\b/);
    }
    const { document } = parseHTML(
      clarified
        ? frozen.replaceAll(
            `${inputs['release/manifest'].inputs.length} оригинала`,
            `${inputs['release/manifest'].inputs.length} входни файла`,
          )
        : frozen,
    );
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
for (const screen of ['S25', 'S35']) {
  for (const mutation of ['heading', 'target'])
    it(`${screen} catches deliberate ${mutation} breakage`, () => {
      const html = fixture(screen + '.html');
      const broken =
        mutation === 'heading'
          ? html.replace('<h2 id="', '<h2 id="broken-')
          : html.replace('href="/danni', 'href="/broken');
      expect(semantics(broken)).not.toEqual(semantics(html));
    });
}

it('frozen server documents and inputs match their recorded checksums', () => {
  for (const c of manifest.cases)
    expect(createHash('sha256').update(fixture(c.file)).digest('hex')).toBe(c.sha256);
  expect(
    createHash('sha256')
      .update(readFileSync(new URL('./__fixtures__/metadata-inputs.json', import.meta.url)))
      .digest('hex'),
  ).toBe(manifest.inputsSha256);
});

rejectReactKeyWarnings();
