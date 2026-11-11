import { expect, it, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import {
  PERIODS,
  DEFAULT_PERIOD,
  resolvePeriod,
  selectPeriod,
  migratePeriod,
} from '../../client/periods.js';
import { annualView, periodIndex, previousPeriodIndex } from '../../client/annual.js';
import { requestState } from '../../client/store.js';
import { resolve } from '../../client/render.js';
import { provideScope } from '../../client/env.js';
import { topbarHtml } from '../components/chrome/chrome';
import { screenCacheKey } from './cache';
import { screenSearch } from './query-params';
import { linkFor, embedHash } from '../../client/share.js';
import { href } from '../../client/routes.js';
const load = (file: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../data/release/${file}.json`, import.meta.url), 'utf8'),
  );
afterEach(() => provideScope(() => null));
const expectedKeys = [
  '2024.report',
  '2025.report',
  '2026.law',
  '2026.expected',
  '2027.draft',
  '2028.forecast',
  '2029.forecast',
];
it('orders statuses explicitly and uses the 2027 draft as default', () => {
  expect(PERIODS.map((p) => p.key)).toEqual(expectedKeys);
  expect(DEFAULT_PERIOD).toBe('2027.draft');
});
for (const [requested, canonical, hasNotice] of [
  [undefined, '2027.draft', false],
  ['2026.law', '2026.law', false],
  ['2026.expected', '2026.expected', false],
  ['2026.draft', '2026.law', true],
  ['2027.forecast', '2027.draft', true],
  ['2028.forecast', '2028.forecast', true],
  ['2027.draft', '2027.draft', false],
  ['2029.forecast', '2029.forecast', false],
  ['no-such-period', '2027.draft', true],
  ['constructor', '2027.draft', true],
] as const) {
  it(`URL/state/SSR/cache matrix: ${requested ?? 'default'}`, () => {
    const address = '/pari' + (requested ? '?per=' + requested : '');
    const r = resolve(address);
    const state = requestState(requested);
    provideScope(() => ({ state }));
    expect(r.found).toBe(true);
    expect(r.want).toBe(address);
    expect(r.periodResolution.resolved).toBe(canonical);
    expect(state.period).toBe(canonical);
    expect(Boolean(r.periodResolution.notice)).toBe(hasNotice);
    const html = renderToStaticMarkup(topbarHtml({ periods: 'all' }));
    expect(html).toContain(PERIODS.find((p) => p.key === canonical)!.label);
    if (hasNotice) expect(html).toContain('period-notice');
    else expect(html).not.toContain('period-notice');
    const raw = screenSearch('/pari', requested ? '?per=' + requested + '&utm_campaign=x' : '');
    expect(raw).toBe(requested ? '?per=' + requested : '');
    if (requested && requested !== canonical) {
      expect(raw).not.toBe('?per=' + canonical);
      expect(
        screenCacheKey('build', 'release', new URL(address, 'https://budget.test')).url,
      ).not.toBe(
        screenCacheKey('build', 'release', new URL('/pari?per=' + canonical, 'https://budget.test'))
          .url,
      );
    }
    if (requested) {
      provideScope(() => ({
        state,
        origin: 'https://budget.test',
        url: new URL(address, 'https://budget.test'),
      }));
      expect(href('S05', {}, { per: requested })).toContain('per=' + canonical);
      expect(linkFor({ id: 'test' })).toContain('per=' + canonical);
      expect(embedHash({ route: 'pari', embed: 'test' })).toContain('per=' + canonical);
    }
  });
}
for (const hash of [false, true])
  for (const old of ['2026.draft', '2027.forecast', '2028.forecast']) {
    it(`one-time storage migration: ${old}, hash=${hash}`, () => {
      let address = 'https://budget.test/' + (hash ? '#/pari' : 'pari');
      let saved = JSON.stringify({ period: old, unit: 'eur', scope: 'kfp' });
      let replaces = 0;
      const opts = {
        get: () => saved,
        set: (_k: string, v: string) => {
          saved = v;
        },
        replace: (u: string) => {
          address = u;
          replaces++;
        },
      };
      const result = migratePeriod({ address, ...opts });
      expect(address).toContain('per=' + resolvePeriod(old).resolved);
      expect(result!.notice).toBeTruthy();
      expect(JSON.parse(saved)).toEqual({ unit: 'eur', scope: 'kfp' });
      expect(migratePeriod({ address, ...opts })).toBeNull();
      expect(replaces).toBe(1);
    });
  }
for (const hash of [false, true])
  it(`explicit default selection wins over legacy storage, hash=${hash}`, () => {
    let saved = JSON.stringify({ period: '2026.draft', unit: 'pct' });
    let address = 'https://budget.test/' + (hash ? '#/razhodi' : 'razhodi');
    let replacements = 0;
    const result = migratePeriod({
      address,
      explicitSelection: true,
      get: () => saved,
      set: (_key: string, value: string) => {
        saved = value;
      },
      replace: (value: string) => {
        address = value;
        replacements++;
      },
    });
    expect(result).toBeNull();
    expect(replacements).toBe(0);
    expect(address).not.toContain('per=');
    expect(JSON.parse(saved)).toEqual({ unit: 'pct' });
  });
it('URL wins, only the own legacy period is removed, storage failures are harmless', () => {
  let saved = JSON.stringify({ period: '2027.forecast', unit: 'pct' });
  let replacements = 0;
  const result = migratePeriod({
    address: 'https://budget.test/pari?per=2026.expected',
    get: () => saved,
    set: (_k: string, v: string) => {
      saved = v;
    },
    replace: () => {
      replacements++;
    },
  });
  expect(result).toBeNull();
  expect(replacements).toBe(0);
  expect(JSON.parse(saved)).toEqual({ unit: 'pct' });
  for (const text of ['broken', 'null', '[]'])
    expect(
      migratePeriod({
        address: 'https://budget.test/',
        get: () => text,
        set: () => {},
        replace: () => {
          throw new Error('must not replace');
        },
      }),
    ).toBeNull();
  expect(
    migratePeriod({
      address: 'https://budget.test/',
      get: () => {
        throw new Error('blocked');
      },
      set: () => {},
      replace: () => {},
    }),
  ).toBeNull();
  expect(
    migratePeriod({
      address: 'https://budget.test/',
      get: () => JSON.stringify({ period: '2026.draft' }),
      set: () => {},
      replace: () => {
        throw new Error('blocked history');
      },
    }),
  ).toBeNull();
});
it('never relabels an old publication as adopted law or a new forecast vintage', () => {
  const old = {
    years: [2024, 2025, 2026, 2027, 2028],
    vintage: ['actual', 'prelim', 'plan', 'forecast', 'forecast'],
    meta: { source: ['asbp'] },
  };
  expect(selectPeriod(old, '2025.report')).toMatchObject({
    available: true,
    vintage: 'prelim',
    legacy: true,
  });
  for (const key of expectedKeys.slice(2))
    expect(selectPeriod(old, key)).toMatchObject({
      available: false,
      reason: 'Това издание няма този период',
    });
});
it('projects keyed series without conflating the two 2026 columns or changing raw data', () => {
  const out = load('outlook'),
    rev = load('revenue'),
    exp = load('expenditure');
  const before = JSON.stringify([out, rev, exp]);
  const projected = annualView(out, 'outlook', out, '2026.expected');
  expect(projected.periodKeys).toEqual(expectedKeys);
  expect(projected.macroVintage[1]).toBe(out.macroVintage[1]);
  for (const p of PERIODS.slice(2)) {
    const i = periodIndex(projected, { period: p });
    expect(projected.kfp.revenue.mln[i]).toBe(out.byPeriod[p.key].series.revenue.value);
    expect(projected.kfp.expenditure.mln[i]).toBe(out.byPeriod[p.key].series.expenditure.value);
    const R = annualView(rev, 'revenue', out, p.key),
      X = annualView(exp, 'expenditure', out, p.key);
    const ri = R.periodKeys.indexOf(p.key),
      xi = X.periodKeys.indexOf(p.key);
    expect(R.rows[0].mln[ri]).toBe(out.byPeriod[p.key].series.revenue.value);
    expect(X.economic.rows[0].mln[xi]).toBe(out.byPeriod[p.key].series.expenditure.value);
    if (p.status === 'law') {
      expect(projected.gdp.mln[i]).toBeNull();
      expect(R.groups.every((g: { mln: Array<number | null> }) => g.mln[ri] === null)).toBe(true);
      expect(
        X.functions.items.every((g: { mln: Array<number | null> }) => g.mln[ri] === null),
      ).toBe(true);
    } else {
      expect(R.groups.every((g: { mln: Array<number | null> }) => Number.isFinite(g.mln[ri]))).toBe(
        true,
      );
      expect(
        X.functions.items.every((g: { mln: Array<number | null> }) => Number.isFinite(g.mln[ri])),
      ).toBe(true);
      expect(
        projected.macroRows.every((g: { values: Array<number | null> }) =>
          Number.isFinite(g.values[i]),
        ),
      ).toBe(true);
    }
  }
  expect(
    previousPeriodIndex(projected, { period: PERIODS.find((p) => p.key === '2026.expected')! }),
  ).toBe(projected.periodKeys.findIndex((k: string) => k === '2025.report'));
  expect(JSON.stringify([out, rev, exp])).toBe(before);
});

it('search entries use this releases annual values and canonical period URLs', async () => {
  const { annualSearch } = await import('../../client/searchlib.js');
  const out = load('outlook');
  const entries = annualSearch(out, load('revenue'), load('expenditure'));
  expect(entries.some((e) => e.stage === 'Проект 2027' && e.href.includes('per=2027.draft'))).toBe(
    true,
  );
  expect(
    entries.some((e) => e.stage === 'Прогноза 2029' && e.href.includes('per=2029.forecast')),
  ).toBe(true);
  expect(
    entries.some((e) => e.stage === 'Очаквано 2026' && e.href.includes('per=2026.expected')),
  ).toBe(true);
  expect(entries.some((e) => e.stage === 'Закон 2026' && e.title === 'ДДС')).toBe(false);
  expect(entries.filter((e) => e.stage === 'Закон 2026')).toHaveLength(4);
  const macro = entries.filter(
    (e) => e.href.includes('/bvp?') && e.href.includes('per=2027.draft'),
  );
  expect(macro.length).toBeGreaterThan(0);
  expect(macro.every((e) => e.stage === 'Прогноза 2027')).toBe(true);
});

it('canonicalizes the old GDP year bookmark and lets an explicit period win', () => {
  expect(resolve('/bvp?y=2025').want).toBe('/bvp?per=2025.report');
  const current = resolve('/bvp?y=2025&per=2029.forecast');
  expect(current.want).toBe('/bvp?per=2029.forecast');
  expect(current.query.per).toBe('2029.forecast');
  expect(current.query.y).toBeUndefined();
});

it('an explicitly empty or prototype-named period is unknown and never redirects', () => {
  for (const key of ['', '__proto__']) {
    const address = '/pari?per=' + key;
    expect(resolve(address).want).toBe(address);
    expect(resolvePeriod(key).notice).toContain('Непознат период');
    expect(selectPeriod({ byPeriod: {} }, key).available).toBe(false);
  }
});
