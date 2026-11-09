import { expect, it } from 'vitest';
import { ROUTES } from './routes';
import { screenQuery, screenSearch } from './query-params';
import { match } from '../../client/routes.js';
import { resolve } from '../../client/render.js';

it('normalizes the October document before SSR filtering and cache identity', () => {
  expect(screenSearch('/byudzhet-2027', '?to=s34-ppd')).toBe('?dokument=plan');
  expect(screenSearch('/byudzhet-2027', '?dokument=plan&to=s34-ppd')).toBe('?dokument=plan');
  expect(resolve('/byudzhet-2027?to=s34-ppd').query.dokument).toBe('plan');
  expect(resolve('/byudzhet-2027?dokument=bill&to=s34-ppd').query.dokument).toBe('bill');
  expect(resolve('/byudzhet-2027?to=s34-bill').query.dokument).toBeUndefined();
});
it.each(['maastricht', 'eu', 'quarterly', 'interest', 'balance', 'finance', 'newdebt'])(
  'restores old historical debt chart %s before filtering and preserves explicit periods',
  (chart) => {
    expect(screenSearch('/embed/dalg.s17-' + chart, '')).toBe('?per=2026.law');
    expect(screenSearch('/dalg', '?to=s17-b-' + (chart === 'finance' ? 'fin' : chart))).toBe(
      '?per=2026.law' +
        (['maastricht', 'eu', 'quarterly'].includes(chart) ? '&obhvat=maastricht' : ''),
    );
    expect(resolve('/embed/dalg.s17-' + chart).periodResolution.resolved).toBe('2026.law');
    expect(resolve('/dalg?to=s17-b-' + chart + '&per=2027.draft').periodResolution.resolved).toBe(
      '2027.draft',
    );
    expect(screenSearch('/dalg', '')).toBe('');
  },
);
it.each(['/', '/5-minuti'])(
  'keeps the primary introduction %s independent of a historical session',
  (path) => {
    expect(screenSearch(path, '?per=2026.law')).toBe('');
    const resolved = resolve(path + '?per=2026.law');
    expect(resolved.query.per).toBeUndefined();
    expect(resolved.periodResolution.resolved).toBe('2027.draft');
  },
);
it.each(['s17-meter', 's17-meter-l', 's17-meter-l-value'])(
  'resolves the legacy debt meter %s to its historical Maastricht scope',
  (target) => {
    expect(screenSearch('/dalg', '?to=' + target)).toBe('?per=2026.law&obhvat=maastricht');
    expect(resolve('/dalg?to=' + target).query.obhvat).toBe('maastricht');
    expect(screenSearch('/dalg', '?to=' + target + '&obhvat=zdd')).toBe('?obhvat=zdd&per=2026.law');
    expect(screenSearch('/dalg', '?to=' + target + '&per=2027.draft')).toBe(
      '?per=2027.draft&obhvat=maastricht',
    );
  },
);
it('server and edge retain only the matched screens declared state', () => {
  const r = ROUTES.find((r) => r.id === 'S07')!;
  expect(
    screenQuery(r, { per: '2026.draft', po: 'vid', to: 'block', q: 'unrelated', utm_source: 'x' }),
  ).toEqual({ per: '2026.draft', po: 'vid' });
  expect(screenSearch('/razhodi', '?po=vid&to=block&q=unrelated')).toBe('?po=vid');
  expect(screenSearch('/not-a-screen', '?q=x')).toBeNull();
});
it('all sample controls are declared; optional execution subpath remains validated', () => {
  for (const r of ROUTES)
    for (const sample of r.samples) {
      const u = new URL(sample.slice(1), 'https://budget.test');
      for (const key of u.searchParams.keys()) expect(['per', 'demo', ...r.query]).toContain(key);
    }
  expect(match(['izpalnenie', 'wrong'])).toBeNull();
  expect(match(['izpalnenie', 'byudzheti'])?.route.id).toBe('S15');
});
