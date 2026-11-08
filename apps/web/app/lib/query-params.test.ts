import { expect, it } from 'vitest';
import { ROUTES } from './routes';
import { screenQuery, screenSearch } from './query-params';
import { match } from '../../client/routes.js';
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
