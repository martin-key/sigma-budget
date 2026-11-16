import { expect, it } from 'vitest';
import { collect, destination } from './hrefs.ts';
it('internal addresses reach an active screen', () => {
  const found = collect();
  expect(found.size).toBeGreaterThan(0);
  expect(found.has('#/prihodi')).toBe(true);
  expect([...found].filter(([address]) => !destination(address).id)).toEqual([]);
});
