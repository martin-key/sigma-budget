import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { articleOne, budgetRows, budgetTotals } from './law-articles.js';
const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../test/fixtures/law', name), 'utf8'));
const evidence = fixture('evidence.json'),
  oracle = fixture('articles-oracle.json');
it('matches article and budget outputs from Python', () => {
  const rows = budgetRows(evidence.law, evidence.ministries);
  expect(articleOne(evidence.law)).toEqual(oracle.art1);
  expect(rows).toEqual(oracle.rows);
  expect(budgetTotals(rows, evidence.law)).toEqual(oracle.totals);
});
it('rejects a missing article and an incorrect published amount', () => {
  const missing = structuredClone(evidence.law);
  delete missing.law['3'];
  expect(() => budgetRows(missing, evidence.ministries)).toThrow();
  const invalid = structuredClone(evidence.law);
  invalid.bill['1'].headline.rev = null;
  expect(() => articleOne(invalid)).toThrow();
  const missingTotal = structuredClone(evidence.law);
  delete missingTotal.sums.expKhil;
  expect(() => budgetTotals(budgetRows(missingTotal, evidence.ministries), missingTotal)).toThrow();
  const wrong = structuredClone(evidence.law);
  wrong.law['3'].headline.exp += 100;
  expect(() => budgetRows(wrong, evidence.ministries)).toThrow();
});
