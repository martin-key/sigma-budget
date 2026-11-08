import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildComponents, type ComponentEvidence } from './components.js';
import { buildRates, type RatesEvidence } from './rates.js';
import { verifyComponentsRatesInputs } from './components-rates-fixture.js';
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
it('builds both scoped files with exact semantic parity against frozen Python outputs', () => {
  const e = evidence(),
    actual = {
      components: buildComponents(e.components, '2026-11-08'),
      rates: buildRates(e.rates, '2026-11-08'),
    };
  const differences = (['components', 'rates'] as const).flatMap((dataset) =>
    compare(read(`${dataset}.json`), actual[dataset], { dataset, file: `${dataset}.json` }),
  );
  const report = { outcome: differences.length ? 'fail' : 'pass', differences, unverified: [] };
  if (process.env.COMPONENTS_RATES_PARITY_REPORT) {
    mkdirSync(dirname(process.env.COMPONENTS_RATES_PARITY_REPORT), { recursive: true });
    writeFileSync(
      process.env.COMPONENTS_RATES_PARITY_REPORT,
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  expect(differences).toEqual([]);
});
it('checks all frozen source and oracle hashes', async () => {
  await verifyComponentsRatesInputs(root);
  const provenance = read('provenance.json') as { fixtureSha256: Record<string, string> };
  for (const [name, hash] of Object.entries(provenance.fixtureSha256))
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(root, name)))
        .digest('hex'),
    ).toBe(hash);
});
it('rejects changed source evidence', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'wave06-input-'));
  try {
    cpSync(root, dir, { recursive: true });
    writeFileSync(resolve(dir, 'inputs/nap-rows.json'), 'changed');
    await expect(verifyComponentsRatesInputs(dir)).rejects.toThrow(/Input hash mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
