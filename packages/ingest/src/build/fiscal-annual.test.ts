import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildAnnualPeriods, type AnnualForecast } from './fiscal-annual.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/fiscal');
const read = (name: string) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const forecast = (): AnnualForecast => read('inputs/data/inputs/budget_forecast_2027.json');
it('reproduces every annual record from the independent Python oracle', () => {
  const output = buildAnnualPeriods(forecast());
  for (const name of ['outlook', 'revenue', 'expenditure'] as const)
    expect(output[name]).toEqual(read(`oracle/${name}.json`).byPeriod);
});
it('rejects a changed annual column vintage and a missing required cell', () => {
  const a = forecast();
  a.tables.annex3_mln!.columns[2]!.vintage = 'отчет';
  expect(() => buildAnnualPeriods(a)).toThrow(/vintage/);
  const b = forecast();
  b.tables.annex3_mln!.rows[0]!.values[2] = null;
  expect(() => buildAnnualPeriods(b)).toThrow(/Non-numeric/);
});
it('adds decimal source cells before converting the derived result to a float', () => {
  const input = forecast();
  input.tables.annex3_mln!.rows[61]!.values[2] = 0.1;
  input.tables.annex3_mln!.rows[57]!.values[2] = 0.2;
  expect(buildAnnualPeriods(input).outlook['2027.draft']!.series.primaryBalance!.value).toBe(0.3);
});
