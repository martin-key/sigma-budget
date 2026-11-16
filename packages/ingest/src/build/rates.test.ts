import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transformRatesAnnexes, transformContributionRows, type LawBlock } from './rates.js';

const root = resolve(import.meta.dirname, '../../test/fixtures/components-rates');
const read = (name: string): unknown => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const blocks = () => read('inputs/doo-blocks.json') as LawBlock[];
const heading = (list: LawBlock[], title: string) => {
  const i = list.findIndex((b) => b[0] === 'p' && b[1].startsWith(title));
  const table = list.slice(i + 1, i + 6).find((b) => b[0] === 't');
  if (!table || table[0] !== 't') throw new Error('fixture table missing');
  return table[1];
};
describe('law annex grids', () => {
  it('matches the independent Python transformation', () => {
    expect(transformRatesAnnexes(blocks())).toEqual(read('annexes.json'));
  });
  it('rejects misaligned activity identities', () => {
    const input = blocks();
    heading(input, 'Приложение № 1А към чл. 9')[2]![2] = 'changed';
    expect(() => transformRatesAnnexes(input)).toThrow(/not aligned/);
  });
  it('rejects a missing activity rate', () => {
    const input = blocks();
    heading(input, 'Приложение № 2А към чл. 14')[2]![2] = '';
    expect(() => transformRatesAnnexes(input)).toThrow(/rate is missing/);
  });
  it('propagates a changed valid rate instead of copying an output', () => {
    const input = blocks();
    const row = heading(input, 'Приложение № 2А към чл. 14')[2]!;
    const code = row[0]!.trim();
    row[2] = '9,9';
    expect(transformRatesAnnexes(input).activities.find((a) => a.code === code)?.from).toBe(9.9);
  });
});

it('transforms NAP fund cells and verifies the contribution totals', () => {
  const rows = read('inputs/nap-rows.json') as Record<string, import('./rates.js').ContributionRow>;
  expect(transformContributionRows(rows)).toEqual(read('funds.json'));
  rows['1.2.']!.cells[4] = '99';
  expect(() => transformContributionRows(rows)).toThrow(/total differs/);
});
