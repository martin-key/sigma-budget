import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { transformDoo, transformNzok } from './components-social.js';
import type { LawBlock } from './rates.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/components-rates');
const read = (p: string): unknown => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const inputs = () => ({
  doo: read('inputs/doo-blocks.json') as LawBlock[],
  nzok: read('inputs/nzok-blocks.json') as LawBlock[],
});
it('matches social budget transformations in independent Python', () => {
  const e = inputs();
  expect({ doo: transformDoo(e.doo), nzok: transformNzok(e.nzok) }).toEqual(read('social.json'));
});
it('rejects a modified social budget total', () => {
  const e = inputs();
  const table = e.doo.find(
    (b) => b[0] === 't' && b[1].some((r) => r[0] === 'I.' && /ПРИХОДИ/u.test(r[1] ?? '')),
  );
  if (!table || table[0] !== 't') throw new Error('fixture table missing');
  const row = table[1].find((r) => r[0] === 'I.' && /ПРИХОДИ/u.test(r[1] ?? ''))!;
  row[row.length - 1] = '1';
  expect(() => transformDoo(e.doo)).toThrow();
});
it('rejects an additional numeric table in ДОО article 1', () => {
  const { doo } = inputs();
  const nextArticle = doo.findIndex((b) => b[0] === 'p' && /^Чл\.\s*2\./u.test(b[1]));
  expect(nextArticle).toBeGreaterThan(0);
  doo.splice(nextArticle, 0, ['t', [['Допълнителен разход', '1,0']]]);
  expect(() => transformDoo(doo)).toThrow(/exactly three ДОО tables/u);
});
