import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { verifyProgrammeInputs } from './programme-fixture.js';
import { dirname, resolve } from 'node:path';
import { expect, expectTypeOf, it } from 'vitest';
import { buildBudgets, type BudgetOutputs } from './budgets.js';
import {
  cleanName,
  loadProgrammes,
  type ProgrammeEvidence,
  type ProgrammeLawEvidence,
  type ProgrammeRecord,
} from './programmes.js';
import { compare } from '../parity/compare.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/programmes');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const evidence = () => ({
  source: read('inputs/program-budgets.json'),
  law: read('inputs/law-cache.json'),
  pdfs: read('inputs/pdf-evidence.json'),
});
function differences(actual: Record<string, unknown>, oracle = 'oracle.json') {
  const expected = read(oracle);
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].flatMap((file) =>
    compare(expected[file], actual[file], {
      dataset:
        file === 'programs.json'
          ? 'programs'
          : file === 'ministries.json'
            ? 'ministries'
            : 'ministries-programs',
      file,
    }),
  );
}
it('matches the independent Python oracle for the complete scoped file set', () => {
  const diffs = differences(buildBudgets(evidence(), '2026-11-08'));
  const report = { outcome: diffs.length ? 'fail' : 'pass', differences: diffs, unverified: [] };
  if (process.env.PROGRAMMES_PARITY_REPORT) {
    mkdirSync(dirname(process.env.PROGRAMMES_PARITY_REPORT), { recursive: true });
    writeFileSync(process.env.PROGRAMMES_PARITY_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  expect(diffs).toEqual([]);
});
it('checks every frozen input hash', () => {
  const provenance = read('provenance.json');
  for (const [name, hash] of Object.entries(provenance.frozenInputSha256))
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(root, 'inputs', name)))
        .digest('hex'),
    ).toBe(hash);
});
it('rejects a changed frozen input hash', async () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'programme-fixture-'));
  try {
    cpSync(root, temp, { recursive: true });
    writeFileSync(resolve(temp, 'inputs/law-cache.json'), 'changed');
    await expect(verifyProgrammeInputs(temp)).rejects.toThrow(/Input hash mismatch/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
it('rejects a missing ministry code', () => {
  const e = evidence();
  delete e.source.budgets['1000'];
  expect(() => buildBudgets(e, '2026-11-08')).toThrow(/missing ministry code 1000/);
});
it('rejects a duplicate programme id for the same year', () => {
  const e = evidence(),
    pdf = e.pdfs[e.source.budgets['1000'].file];
  pdf.cells.push(structuredClone(pdf.cells[0]));
  expect(() => buildBudgets(e, '2026-11-08')).toThrow(/duplicate programme id/);
});
it('fails parity when a programme total no longer sums', () => {
  const e = evidence(),
    pdf = e.pdfs[e.source.budgets['1000'].file];
  const total = pdf.cells.find(
    (entry: any) =>
      entry[0][0] === 'Проект 2026' &&
      (entry[0][1] === 'total' || entry[0][1] === '1000.00.00') &&
      entry[1].values,
  );
  expect(total).toBeDefined();
  // Keep the cell identities valid while breaking its relationship to the policies.
  for (const i of [0, 1, 3, 4]) total[1].values[i] += 100;
  expect(differences(buildBudgets(e, '2026-11-08')).length).toBeGreaterThan(0);
});
it('checks all frozen oracle hashes', () => {
  const provenance = read('provenance.json');
  for (const [name, hash] of Object.entries(provenance.fixtureSha256))
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(root, name)))
        .digest('hex'),
    ).toBe(hash);
});

it('matches Python when an ambiguous row has a null source year', () => {
  const e = evidence();
  e.source.budgets['1800'].programs['1800.02.03'].by_year['Отчет 2023'] = null;
  expect(differences(buildBudgets(e, '2026-11-08'), 'null-cell-oracle.json')).toEqual([]);
});
it('matches Python Unicode word boundaries in programme names', () => {
  for (const c of read('name-oracle.json')) expect(cleanName(c.input)).toBe(c.expected);
});

it('exposes typed law evidence and builder outputs', () => {
  expectTypeOf<ProgrammeEvidence['law']>().toEqualTypeOf<ProgrammeLawEvidence>();
  expectTypeOf<ReturnType<typeof loadProgrammes>>().toEqualTypeOf<
    Record<string, ProgrammeRecord>
  >();
  expectTypeOf<ReturnType<typeof buildBudgets>>().toEqualTypeOf<BudgetOutputs>();
});
