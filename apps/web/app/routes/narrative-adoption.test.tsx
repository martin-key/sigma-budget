// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { expect, it, vi, afterEach } from 'vitest';
import { MigratedScreen } from '../migration/registry';
import { textModel } from '../lib/screens/text';
import type { NarrativeModel } from '../lib/screens/narrative-types';
import { store } from '../../client/store.js';
import { headers, handle } from './novo';
import inputs from './__fixtures__/narrative-inputs.json';
import manifest from './__fixtures__/narrative-manifest.json';
import { rejectReactKeyWarnings } from './metadata-test-warnings';
vi.mock('../../client/loc.js', async (original) => ({
  ...(await original<object>()),
  toHref: (s: string) => s.replace(/^#(?=\/)/, ''),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const release = {
  id: manifest.releaseId,
  dataBase: '/data/',
  origin: manifest.origin,
  sigmaUrl: '',
  feedbackEmail: '',
};
const docs: Record<string, unknown> = inputs;
const load = async <T,>(name: string): Promise<T> => {
  if (!(name in docs)) throw Error(name);
  return docs[name] as T;
};
const model = async (screen: 'S14' | 'S16', query = {}) =>
  (await textModel(screen, {}, query, { release, load })) as NarrativeModel;
const frozen = (file: string) => {
  const container = document.createElement('div');
  container.innerHTML = readFileSync(`app/routes/__fixtures__/${file}`, 'utf8');
  return container;
};
afterEach(() => store.set('unit', 'eur'));
for (const screen of ['S14', 'S16'] as const)
  it(`${screen} adopts server headings, blocks and disclosures without replacement`, async () => {
    const m = await model(screen),
      setQuery = vi.fn(),
      announce = vi.fn(),
      go = vi.fn();
    const tree = <MigratedScreen model={m} navigation={{ setQuery, announce, go }} />;
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(tree);
    const heading = container.querySelector('h1'),
      section = container.querySelector('section');
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) });
    });
    try {
      expect(container.querySelector('h1')).toBe(heading);
      expect(container.querySelector('section')).toBe(section);
      expect(errors).toEqual([]);
      if (screen === 'S14') {
        const details = container.querySelector('details')!;
        details.open = true;
        await act(async () => root.render(tree));
        expect(container.querySelector('details')).toBe(details);
        expect(details.open).toBe(true);
        const sort = container.querySelector<HTMLButtonElement>(
          '#s14-t-bjudzheti [data-key="law"]',
        )!;
        sort.focus();
        await act(async () => sort.click());
        const values = (el: HTMLElement) =>
          [...el.querySelectorAll('#s14-t-bjudzheti tbody tr')].map((x) => x.textContent);
        expect(values(container)).toEqual(values(frozen('S14-sort.browser.html')));
        expect(document.activeElement).toBe(sort);
        expect(announce).toHaveBeenCalledExactlyOnceWith(
          'Сортирано по „Разходи по закона“, възходящо',
        );
        const radio = container.querySelector<HTMLInputElement>('#s14-unit-pct')!;
        await act(async () => radio.click());
        const kpis = (el: HTMLElement) =>
          [...el.querySelectorAll('#s14-nakratko .kpi-value')].map((x) => x.textContent);
        expect(kpis(container)).toEqual(kpis(frozen('S14-pct.browser.html')));
      } else {
        const button = container.querySelector<HTMLButtonElement>('[data-query="vid=law"]')!;
        button.focus();
        const legacy = vi.fn();
        document.addEventListener('click', legacy);
        try {
          await act(async () => button.click());
        } finally {
          document.removeEventListener('click', legacy);
        }
        expect(legacy).not.toHaveBeenCalled();
        expect(setQuery).toHaveBeenCalledExactlyOnceWith({ vid: 'law' });
        expect(announce).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(button);
        expect(go).not.toHaveBeenCalled();
        const rss = container.querySelector<HTMLInputElement>('#s16-rss-url')!;
        rss.focus();
        expect(rss.selectionEnd).toBe(rss.value.length);
        expect(rss.selectionStart).toBe(0);
      }
    } finally {
      await act(async () => root!.unmount());
      container.remove();
    }
  });
it('feed is live metadata with a short TTL; its RSS subscription keeps the current alias', async () => {
  expect(handle.cache.ttl).toBe(60);
  expect(headers()['Cache-Control']).toContain('s-maxage=60');
  const m = await model('S16');
  m.release = { ...release, dataBase: `/data/releases/${'a'.repeat(64)}/data/` };
  const html = renderToString(<MigratedScreen model={m} navigation={{ go() {}, announce() {} }} />);
  expect(html).toContain(`${release.origin}/data/feed.xml`);
});
for (const screen of ['S14', 'S16'] as const)
  it(`${screen} propagates cancellation and distinguishes missing from pending required data`, async () => {
    const required = screen === 'S14' ? 'law' : 'feed';
    for (const [name, state] of [
      ['Error', 'error'],
      ['PendingError', 'pending'],
      ['AbortError', 'aborted'],
    ]) {
      const read = textModel(
        screen,
        {},
        {},
        {
          release,
          load: async <T,>(key: string): Promise<T> => {
            if (key === required) {
              const e = Error('unavailable');
              e.name = name;
              throw e;
            }
            return load<T>(key);
          },
        },
      );
      if (state === 'aborted') await expect(read).rejects.toMatchObject({ name });
      else expect((await read).view).toBe(state);
    }
  });
it('law remains usable without the optional ministry comparison and rejects unsupported periods', async () => {
  const m = (await textModel(
    'S14',
    {},
    {},
    {
      release,
      load: async <T,>(key: string) => {
        if (key === 'ministries') throw Error('offline');
        return load<T>(key);
      },
    },
  )) as NarrativeModel;
  expect(m.view).toBe('ready');
  expect(m.failed).toContain('ministries');
  expect(
    renderToString(<MigratedScreen model={m} navigation={{ go() {}, announce() {} }} />),
  ).toContain('Пътят на бюджета');
  expect((await model('S14', { per: '2024.report' })).unsupported).toBe(true);
  expect((await model('S14', { per: 'invalid' })).period.key).toBe('2026.law');
});
for (const per of ['2026.draft', '2026.law'])
  it(`feed preserves the adopted-law percentage and citation under ${per}`, async () => {
    const m = await model('S16', { per });
    const container = document.createElement('div');
    container.innerHTML = renderToString(
      <MigratedScreen model={m} navigation={{ go() {}, announce() {} }} />,
    );
    const expected = frozen('S16.html');
    const sentences = (el: HTMLElement) =>
      [...el.querySelectorAll('.s16-five li')].map((x) =>
        x.textContent?.replace(/\s+/g, ' ').trim(),
      );
    expect(sentences(container)).toEqual(sentences(expected));
    expect(container.querySelector('#s16-b-summary [data-src]')?.getAttribute('data-src')).toBe(
      expected.querySelector('#s16-b-summary [data-src]')?.getAttribute('data-src'),
    );
    expect(m.content.feed?.highlights?.planBasis?.periodKey).toBe('2026.law');
  });
rejectReactKeyWarnings();
