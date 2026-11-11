import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { afterEach, expect, it } from 'vitest';
import { provideScope } from '../../client/env.js';
import { requestState, store } from '../../client/store.js';
import { parse } from '../../client/data.js';
import { resolve } from '../../client/render.js';
import { embedHash, linkFor, shortLink } from '../../client/share.js';
import { ROUTES } from './routes';
import { screenQuery, screenSearch } from './query-params';
import { screenCacheKey } from './cache';
import { renderScreen } from './screen.server';
import * as lawContent from '../routes/zakon-content';
import { NarrativeContent } from '../routes/narrative-content';
import type { NarrativeModel } from './screens/narrative-types';

const release = {
  id: 'unit-test',
  dataBase: '/data/',
  origin: 'https://budget.test',
  sigmaUrl: 'https://sigma.test',
  feedbackEmail: '',
};
function scopeFor(path: string, savedUnit = 'eur') {
  return {
    url: new URL(path, release.origin),
    origin: release.origin,
    state: { ...requestState(), unit: savedUnit },
    data: new Map(),
    maps: {},
    load: async (name: string) =>
      parse(
        name,
        readFileSync(new URL(`../../../../data/release/${name}.json`, import.meta.url), 'utf8'),
      ),
  };
}
afterEach(() => provideScope(null));

it.each(['eur', 'pct'])(
  'retains explicit %s in shared client/server screen identity and edge cache',
  (unit) => {
    const path = `/prognoza?per=2029.forecast&unit=${unit}&to=s13-b-rev-exp`;
    const query = { per: '2029.forecast', unit, to: 's13-b-rev-exp' };
    const route = ROUTES.find((r) => r.id === 'S13')!;
    expect(screenQuery(route, query)).toEqual({ per: query.per, unit });
    expect(screenSearch('/prognoza', new URL(path, release.origin).search)).toBe(
      `?per=2029.forecast&unit=${unit}`,
    );
    expect(resolve(path).screen).toContain(`unit=${unit}`);
    const opposite = unit === 'eur' ? 'pct' : 'eur';
    expect(screenCacheKey('b', 'r', new URL(path, release.origin)).url).not.toBe(
      screenCacheKey(
        'b',
        'r',
        new URL(path.replace(`unit=${unit}`, `unit=${opposite}`), release.origin),
      ).url,
    );
  },
);
it('drops an unsupported unit while retaining the other screen and publication choices', () => {
  expect(screenSearch('/byudzhet-2027', '?unit=invalid&to=s34-ppd')).toBe('?dokument=plan');
  expect(resolve('/pari?unit=invalid').query.unit).toBeUndefined();
});
it.each(['eur', 'pct'])(
  'puts the visible %s unit in full, short and embedded links without personal calculator inputs',
  (unit) => {
    const scope = scopeFor('/prognoza?per=2029.forecast&salary=1234', unit);
    provideScope(() => scope);
    const spec = {
      id: 's13-b-rev-exp',
      embed: 'prognoza.s13-rev-exp',
      embedParams: { unit: 'invalid' },
    };
    for (const href of [
      linkFor(spec),
      `https://${shortLink(spec)}`,
      new URL(embedHash(spec), release.origin).href,
    ]) {
      const url = new URL(href);
      expect(url.searchParams.get('unit')).toBe(unit);
      expect(url.searchParams.get('per')).toBe('2029.forecast');
      expect(url.searchParams.has('salary')).toBe(false);
    }
  },
);
it('renders simultaneous EUR and GDP views independently, overriding the opposite saved unit', async () => {
  const scopes = new AsyncLocalStorage<ReturnType<typeof scopeFor>>();
  provideScope(() => scopes.getStore() ?? null);
  const render = (unit: string, saved: string) => {
    const scope = scopeFor(`/pari?unit=${unit}`, saved);
    return scopes.run(scope, async () => {
      const result = await renderScreen(scope.url, release);
      if (!('doc' in result)) throw new Error('Unexpected redirect');
      expect(store.get('unit')).toBe(unit);
      expect(result.doc.prerendered).toBe(`/pari?unit=${unit}`);
      return result.doc.view;
    });
  };
  const [eur, pct] = await Promise.all([render('eur', 'pct'), render('pct', 'eur')]);
  expect(pct).not.toBe(eur);
  expect(pct).toContain('36,1');
  expect(pct).toContain('от БВП');
  expect(eur).toContain('51,07');
});
it('draws the React law unit from the URL before hydration', async () => {
  const scope = scopeFor('/zakon?unit=pct');
  provideScope(() => scope);
  const result = await renderScreen(scope.url, release);
  if (!('doc' in result)) throw new Error('Unexpected redirect');
  const html = renderToStaticMarkup(
    <NarrativeContent
      content={lawContent}
      model={result.doc.model as NarrativeModel}
      navigation={{ go() {}, announce() {} }}
    />,
  );
  const { document } = parseHTML(html);
  expect(document.querySelector('#s14-unit-pct')?.hasAttribute('checked')).toBe(true);
  expect(document.querySelector('#s14-unit-eur')?.hasAttribute('checked')).toBe(false);
});
