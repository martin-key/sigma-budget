import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildComponents, type ComponentEvidence } from './components.js';
import { buildRates, type RatesEvidence } from './rates.js';
import { compare } from '../parity/compare.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/components-rates');
const read = (name: string): unknown => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const evidence = () => ({
  components: {
    law: read('inputs/law.json'),
    doo: read('inputs/doo-blocks.json'),
    nzok: read('inputs/nzok-blocks.json'),
    tables: read('inputs/tables.json'),
    pages: read('inputs/pages.json'),
    execution: read('inputs/execution.json'),
    municipalities: read('inputs/municipalities.json'),
    outlook: read('inputs/outlook.json'),
    summary: read('inputs/kfp-components.json'),
  } as ComponentEvidence,
  rates: {
    doo: read('inputs/doo-blocks.json'),
    nzok: read('inputs/nzok-blocks.json'),
    bill: read('inputs/bill-blocks.json'),
    nap: read('inputs/nap-rows.json'),
  } as RatesEvidence,
});
it('rejects changed transfer and monthly source values', () => {
  const e = evidence();
  e.components.summary.budgets_2026_law.state_budget.transfers_to.doo++;
  expect(() => buildComponents(e.components, '2026-11-08')).toThrow(/frozen input summary/);
  const f = evidence();
  f.components.execution.data['2026']!.nat.rev![6]!++;
  expect(() => buildComponents(f.components, '2026-11-08')).toThrow(/July/);
});
it('rejects altered contribution and legal source values', () => {
  const e = evidence();
  e.rates.nap['1.2.']!.cells[4] = '99';
  expect(() => buildRates(e.rates, '2026-11-08')).toThrow(/total differs/);
  const f = evidence();
  const block = f.rates.nzok.find((b) => b[0] === 'p' && b[1].startsWith('Чл. 2. '));
  if (!block || block[0] !== 'p') throw new Error('missing legal paragraph');
  block[1] = block[1].replace('8 на сто', '9 на сто');
  expect(() => buildRates(f.rates, '2026-11-08')).toThrow(/disagree/);
});

it('derives activity rates from the legal grid rather than the frozen result', () => {
  const e = evidence();
  const i = e.rates.doo.findIndex(
    (b) => b[0] === 'p' && b[1].startsWith('Приложение № 2А към чл. 14'),
  );
  const block = e.rates.doo.slice(i + 1, i + 6).find((b) => b[0] === 't');
  if (!block || block[0] !== 't') throw new Error('activity grid missing');
  const row = block[1][2]!;
  const code = row[0]!.trim();
  row[2] = '1,0';
  const result = buildRates(e.rates, '2026-11-08');
  expect(result.tzpb.activities.find((a) => a.code === code)?.from).toBe(1);
  expect(
    compare(read('rates.json'), result, { dataset: 'rates', file: 'rates.json' }).length,
  ).toBeGreaterThan(0);
});

it('rounds binary-float ties the same way as the Python oracle', async () => {
  const { roundForPython } = await import('../common/format.js');
  const cases = read('rounding.json') as { value: number; places: number; rounded: number }[];
  for (const c of cases) expect(roundForPython(c.value, c.places)).toBe(c.rounded);
});
