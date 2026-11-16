import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { compare } from '../parity/compare.js';
import { buildFiscalDonor, projectFiscalPublished } from './fiscal-build.js';
import { loadFiscalFixture } from './fiscal-fixture.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/fiscal');
const read = (name: string) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
it('rejects malformed evidence and changes in annual vintage', async () => {
  const a = await loadFiscalFixture(root);
  a.functions[0]!.parts[0]!.mln[0]! += 1000;
  expect(() => buildFiscalDonor(a, '2026-11-08')).toThrow(/parts do not add up/);
  const b = await loadFiscalFixture(root);
  const donor = buildFiscalDonor(b, '2026-11-08');
  b.forecast.tables.III_1!.columns[1]!.vintage = 'отчет';
  expect(() => projectFiscalPublished(donor, b.forecast)).toThrow(/vintage/);
});
it('preserves Python binary rounding in edge cases', async () => {
  const { pythonRound } = await import('../common/format.js');
  expect(pythonRound(2.675, 2)).toBe(2.67);
  expect(pythonRound(1.25, 1)).toBe(1.2);
  expect(pythonRound(-1.25, 1)).toBe(-1.2);
});
it('propagates changed source values and text through the transformations', async () => {
  const input = await loadFiscalFixture(root);
  const before = buildFiscalDonor(input, '2026-11-08');
  input.measures.intro.revenue[0]!.what += ' Променено описание.';
  input.forecast.tables.annex3_pct_gdp!.rows[63]!.values[2]! += 1;
  const donor = buildFiscalDonor(input, '2026-11-08');
  const projected = projectFiscalPublished(donor, input.forecast);
  expect(
    compare(before['measures.json'], donor['measures.json'], {
      dataset: 'measures',
      file: 'measures.json',
    }).length,
  ).toBeGreaterThan(0);
  expect(
    compare(read('oracle/outlook.json'), projected['outlook.json'], {
      dataset: 'outlook',
      file: 'outlook.json',
    }).length,
  ).toBeGreaterThan(0);
});
