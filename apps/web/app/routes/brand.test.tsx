import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { provideScope } from '../../client/env.js';
import { requestState } from '../../client/store.js';
import { renderScreen } from '../lib/screen.server';
import core from './__fixtures__/core.json';
import glossary from './__fixtures__/glossary.json';

afterEach(() => provideScope(() => null));
it('uses the public product name in the document and metadata while preserving the group credit', async () => {
  const url = new URL('https://sigma-budget.my-data.bg/za-proekta');
  const docs: Record<string, unknown> = { core, glossary };
  provideScope(() => ({
    url,
    origin: url.origin,
    state: requestState(null),
    data: new Map(),
    load: async (name: string) => docs[name],
  }));
  const result = await renderScreen(url, {
    id: '',
    dataBase: '/data/',
    origin: url.origin,
    sigmaUrl: '',
    feedbackEmail: '',
  });
  if ('redirect' in result) throw Error(result.redirect);
  expect(result.doc.title).toContain('СИГМА Бюджет');
  expect(result.doc.ld).toContain('СИГМА Бюджет');
  expect(result.doc.ld).toContain('Работна група „Бюджет на светло“');
});
it('names the installed application consistently', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../public/manifest.json', import.meta.url), 'utf8'),
  );
  expect(manifest.name).toBe('СИГМА Бюджет');
  expect(manifest.short_name).toBe('СИГМА Бюджет');
});
