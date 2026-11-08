import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  cpSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { compare, type Difference } from '../parity/compare.js';
import { buildFiscalDonor, projectFiscalPublished } from './fiscal-build.js';
import { loadFiscalFixture, verifyFiscalInputs } from './fiscal-fixture.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/fiscal');
const read = (name: string) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
it('matches all frozen donor, projected and published fiscal datasets exactly', async () => {
  const input = await loadFiscalFixture(root),
    donor = buildFiscalDonor(input, '2026-11-08'),
    final = projectFiscalPublished(donor, input.forecast);
  const differences: Difference[] = [];
  for (const name of Object.keys(donor) as (keyof typeof donor)[]) {
    const dataset = name.slice(0, -5);
    for (const [stage, expected, actual] of [
      ['donor', read(`donor/${name}`), donor[name]],
      ['projected', read(`oracle/${name}`), final[name]],
      ['published', read(`published/${name}`), final[name]],
    ] as const)
      differences.push(
        ...compare(expected, actual, { dataset: `${dataset}:${stage}`, file: name }),
      );
  }
  const report = { outcome: differences.length ? 'fail' : 'pass', differences, unverified: [] };
  if (process.env.FISCAL_PARITY_REPORT) {
    mkdirSync(dirname(process.env.FISCAL_PARITY_REPORT), { recursive: true });
    writeFileSync(process.env.FISCAL_PARITY_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  expect(differences).toEqual([]);
});
it('rejects a changed source and its hash', async () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'fiscal-fixture-'));
  try {
    cpSync(root, temp, { recursive: true });
    writeFileSync(resolve(temp, 'inputs/data/inputs/population.json'), '{}');
    await expect(verifyFiscalInputs(temp)).rejects.toThrow(/Input hash mismatch/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
it('rejects a fixture symlink even when its target has the expected bytes', async () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'fiscal-fixture-'));
  try {
    cpSync(root, temp, { recursive: true });
    const target = resolve(temp, 'published/outlook.json');
    rmSync(target);
    symlinkSync(resolve(root, 'published/outlook.json'), target);
    await expect(verifyFiscalInputs(temp)).rejects.toThrow(/Symlink in fiscal fixture/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
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
