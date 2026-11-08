import { expect, it } from 'vitest';
import { cached } from './cache';
it('text routes opt into edge caching while 404 remains no-store', () => {
  expect(cached(86400)()['Cache-Control']).toContain('s-maxage=86400');
  expect(cached(0)()['Cache-Control']).toBe('no-store');
});
