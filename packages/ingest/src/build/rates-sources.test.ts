import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { reconcileRates, transformAssumptions, transformRatesLaw } from './rates-sources.js';
import {
  transformRatesAnnexes,
  transformContributionRows,
  type LawBlock,
  type ContributionRow,
} from './rates.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/components-rates');
const read = (name: string): unknown => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const evidence = () => ({
  doo: read('inputs/doo-blocks.json') as LawBlock[],
  nzok: read('inputs/nzok-blocks.json') as LawBlock[],
  bill: read('inputs/bill-blocks.json') as LawBlock[],
  nap: read('inputs/nap-rows.json') as Record<string, ContributionRow>,
});
it('parses law and bill text against the Python source transformations', () => {
  const e = evidence();
  expect(transformRatesLaw(e.doo, e.nzok)).toEqual(read('rates-law.json'));
  expect(transformAssumptions(e.bill)).toEqual(read('assumptions.json'));
});
it('reconciles independent NAP, law, bill and annex sources', () => {
  const e = evidence(),
    law = transformRatesLaw(e.doo, e.nzok),
    bill = transformAssumptions(e.bill),
    funds = transformContributionRows(e.nap),
    annex = transformRatesAnnexes(e.doo);
  expect(() => reconcileRates(e.nap, funds, law, bill, annex.activities)).not.toThrow();
  bill['12']!.years['2026'] = '9';
  expect(() => reconcileRates(e.nap, funds, law, bill, annex.activities)).toThrow(
    /disagree|differ/,
  );
});
it('rejects a law limit inconsistent with NAP and bill', () => {
  const e = evidence(),
    law = transformRatesLaw(e.doo, e.nzok);
  law.max.from += 1;
  expect(() =>
    reconcileRates(
      e.nap,
      transformContributionRows(e.nap),
      law,
      transformAssumptions(e.bill),
      transformRatesAnnexes(e.doo).activities,
    ),
  ).toThrow(/limits/);
});
