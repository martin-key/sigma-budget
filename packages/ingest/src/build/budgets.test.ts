import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, expectTypeOf, it } from 'vitest';
import { buildBudgets, type BudgetOutputs } from './budgets.js';
import {
  cleanName,
  loadProgrammes,
  type ProgrammeEvidence,
  type ProgrammeLawEvidence,
  type ProgrammeRecord,
} from './programmes.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/programmes');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const evidence = () => ({
  source: read('inputs/program-budgets.json'),
  law: read('inputs/law-cache.json'),
  pdfs: read('inputs/pdf-evidence.json'),
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
