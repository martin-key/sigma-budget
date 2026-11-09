import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { byId, Check, fmt, gzipSize, numbersIn, pattern, total, walk } from './checks.js';
const oracle = JSON.parse(
  readFileSync(
    new URL('../../test/fixtures/validate14/helpers-oracle.json', import.meta.url),
    'utf8',
  ),
);
it('matches frozen Python helper evidence', () => {
  const sample = { items: [{ id: 'x', value: 1 }, { id: 'y', value: null }, true, 3.5], empty: {} };
  expect([...walk(sample)]).toEqual(oracle.walk);
  expect(pattern('$.items[12].value[3]')).toBe(oracle.pattern);
  expect(numbersIn(sample)).toBe(oracle.numbersIn);
  expect(total([1, true, 2.5, null])).toBe(oracle.total);
  expect(byId([{ id: 'x', v: 1 }, { id: 'x', v: 2 }, { v: 3 }, null])).toEqual(oracle.byId);
  for (const [value, digits, want] of oracle.fmt) expect(fmt(value, digits)).toBe(want);
  const c = new Check('HELPERS');
  c.ok(true, 'ok');
  c.near(1, 2, 0.5, 'distance');
  c.warn('warning');
  c.fact('fact');
  expect({ ...c }).toEqual(oracle.check);
  expect([
    gzipSize(Buffer.from('abc'.repeat(1000))),
    gzipSize(Buffer.from('тест '.repeat(300))),
  ]).toEqual(oracle.gzip);
});
