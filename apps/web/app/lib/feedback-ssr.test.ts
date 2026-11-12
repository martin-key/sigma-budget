import { expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { provideScope } from '../../client/env.js';
import { parse } from '../../client/data.js';
import { requestState } from '../../client/store.js';
import { build, frameHtml, resolve } from '../../client/render.js';

const load = async (name: string) =>
  parse(
    name,
    readFileSync(new URL(`../../../../data/release/${name}.json`, import.meta.url), 'utf8'),
  );
afterEach(() => provideScope(() => null));
async function documentAt(address: string, feedbackEmail?: string) {
  const url = new URL(address, 'https://budget.test');
  const route = resolve(address);
  const scope = {
    url,
    origin: url.origin,
    ...(feedbackEmail === undefined ? {} : { feedbackEmail }),
    state: requestState(route.query.per),
    data: new Map(),
    load,
  };
  provideScope(() => scope);
  return parseHTML(String(frameHtml(await build(route.route, route.params, route.query)))).document;
}

// The server draws the forms with the request's FEEDBACK_EMAIL: the first HTML must not say that no address is set.
it('/vrazka drawn on the server uses the configured feedback address', async () => {
  const doc = await documentAt('/vrazka', 'feedback@example.invalid');
  const article = doc.querySelector('article')!;
  expect(article.querySelector('a[href="mailto:feedback@example.invalid"]')).not.toBeNull();
  expect(article.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Изпрати');
  expect(article.textContent).not.toContain('Запази в този браузър');
});
it('/vrazka without a configured address keeps the message in the browser and says so', async () => {
  const doc = await documentAt('/vrazka', '');
  const article = doc.querySelector('article')!;
  expect(article.querySelector('a[href^="mailto:"]')).toBeNull();
  expect(article.querySelector('button[type="submit"]')?.textContent?.trim()).toBe(
    'Запази в този браузър',
  );
});
it('the glossary question form drawn on the server uses the configured feedback address', async () => {
  const doc = await documentAt('/rechnik/kfp', 'feedback@example.invalid');
  const article = doc.querySelector('article')!;
  expect(article.querySelector('a[href="mailto:feedback@example.invalid"]')).not.toBeNull();
});
