import { expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { provideScope } from '../../client/env.js';
import { parse } from '../../client/data.js';
import { requestState } from '../../client/store.js';
import { build, frameHtml, resolve } from '../../client/render.js';
import * as catalogue from '../../client/catalog.js';
import * as feed from '../../client/pages/s16-novo.js';
import * as reactFeed from '../routes/novo-content';

const load = async (name: string) =>
  parse(
    name,
    readFileSync(new URL(`../../../../data/release/${name}.json`, import.meta.url), 'utf8'),
  );
afterEach(() => provideScope(() => null));
async function documentAt(address: string) {
  const url = new URL(address, 'https://budget.test');
  const route = resolve(address);
  provideScope(() => ({
    url,
    origin: url.origin,
    state: requestState(route.query.per),
    data: new Map(),
    load,
  }));
  return parseHTML(String(frameHtml(await build(route.route, route.params, route.query)))).document;
}
it('excludes pending sets from lookup, counts, filters and related links without changing the release', async () => {
  const original = await load('catalog');
  const before = JSON.stringify(original);
  const model = catalogue.model(original, undefined);
  expect(model.counts.pending).toBe(0);
  expect(model.counts.datasets).toBe(
    original.datasets.filter((s: any) => s.status !== 'pending').length,
  );
  for (let i = 1; i <= 7; i++) expect(model.find(`p0${i}`)).toBeNull();
  for (const item of [...model.traps, ...model.methods])
    expect(item.related.every((s: any) => s.status !== 'pending')).toBe(true);
  expect(JSON.stringify(original)).toBe(before);
});
for (const path of ['/danni', '/izpalnenie', '/izpalnenie/byudzheti', '/5-minuti', '/']) {
  it(`${path} has no future-data notices or pending catalogue links`, async () => {
    const doc = await documentAt(path);
    const article = doc.querySelector('article')!;
    expect(article.textContent).not.toMatch(
      /предстои|предстоят|още не|в тази версия|\b403\b|само през браузър|работна група/i,
    );
    expect(
      article.querySelector('a[href*="/danni/p0"],.chip[data-query="status=pending"]'),
    ).toBeNull();
  });
}
for (const path of Array.from({ length: 7 }, (_, i) => `/danni/p0${i + 1}`)) {
  it(`${path} resolves to the existing not-found screen`, async () => {
    expect((await documentAt(path)).querySelector('article')?.getAttribute('data-route')).toBe(
      'S30',
    );
  });
}
it('both feed models exclude pending and announced events from chronology and counts', () => {
  const ctx: any = {
    data: {
      feed: {
        events: [
          {
            id: 'ready',
            title: 'Публикуван отчет',
            date: '2026-10-01',
            kind: 'report',
            status: 'real',
          },
          {
            id: 'pending',
            title: 'Бъдещ отчет',
            date: '2026-10-02',
            kind: 'report',
            status: 'pending',
          },
          {
            id: 'announced',
            title: 'Обявен отчет',
            date: '2026-10-03',
            kind: 'report',
            dateKind: 'announced',
          },
        ],
      },
    },
    query: {},
  };
  for (const renderer of [feed, reactFeed]) {
    const model = renderer.model(ctx);
    expect(model.events.map((e: any) => e.id)).toEqual(['ready']);
    expect(model.counts.get('report')).toBe(1);
  }
});

it('every published dataset passport omits internal and future-data copy', async () => {
  const sets = catalogue.model(await load('catalog'), undefined).sets;
  for (const set of sets) {
    const article = (await documentAt(`/danni/${set.slug}`)).querySelector('article')!;
    const text = article.textContent || '';
    expect(
      text.match(
        /предстои|предстоят|още не|в тази версия|\b403\b|само през браузър|работна група|прототип/gi,
      ),
      set.slug,
    ).toBeNull();
    expect(article.querySelector('a[href*="/danni/p0"]'), set.slug).toBeNull();
  }
});
