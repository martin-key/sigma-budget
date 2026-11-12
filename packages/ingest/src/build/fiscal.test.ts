import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { stateDebtTable, type StateDebtTableInput } from './fiscal.js';

const fixture = resolve(import.meta.dirname, '../../test/fixtures/fiscal');
const bytes = (name: string) => readFileSync(resolve(fixture, name));
const input = (): StateDebtTableInput => JSON.parse(bytes('vi-1-input.json').toString());
const hash = (name: string) => createHash('sha256').update(bytes(name)).digest('hex');

it('reproduces the independent Python Table VI-1 result from frozen evidence', () => {
  const provenance = JSON.parse(bytes('provenance.json').toString());
  expect(hash('vi-1-input.json')).toBe(provenance.frozenInputSha256);
  expect(hash('vi-1-oracle.json')).toBe(provenance.oracleSha256);
  expect(stateDebtTable(input())).toEqual(JSON.parse(bytes('vi-1-oracle.json').toString()));
});

it('rejects missing, non-numeric, and inconsistent debt cells', () => {
  const missing = input();
  missing.rows = missing.rows.filter((row) => row.label !== 'БВП, млн. евро');
  expect(() => stateDebtTable(missing)).toThrow(/incomplete/);
  const blank = input();
  blank.rows.find((row) => row.label === 'Външен дълг, млн. евро')!.values[0] = null;
  expect(() => stateDebtTable(blank)).toThrow(/incomplete/);
  const inconsistent = input();
  inconsistent.rows.find((row) => row.label === 'Външен дълг, млн. евро')!.values[0]! += 1;
  expect(() => stateDebtTable(inconsistent)).toThrow(/external \+ domestic/);
});

import { loadAnnex } from './annex.js';
import { buildOutlook, buildRevenue, type FiscalEvidence } from './fiscal.js';
function fiscalEvidence(): FiscalEvidence {
  const source = JSON.parse(bytes('inputs/data/originals/asbp/asbp_tables.json').toString());
  return {
    annex: loadAnnex(source.tables),
    tables: source.tables,
    differingRows: source.docx_check.differing_rows,
    pages: JSON.parse(
      bytes(
        'inputs/data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
      ).toString(),
    ),
  };
}
it('builds outlook and revenue from the frozen source evidence', () => {
  const e = fiscalEvidence();
  expect(buildOutlook(e, '2026-11-08')).toEqual(JSON.parse(bytes('donor/outlook.json').toString()));
  expect(buildRevenue(e, '2026-11-08')).toEqual(JSON.parse(bytes('donor/revenue.json').toString()));
});
import { buildExpenditure, type ExpenditureEvidence } from './fiscal-expenditure.js';
function expenditureEvidence(): ExpenditureEvidence {
  const readInput = (name: string) =>
    JSON.parse(bytes(`inputs/data/inputs/${name}.json`).toString());
  return {
    ...fiscalEvidence(),
    functions: readInput('kfp_functions_2026').functions,
    cofog: readInput('cofog_bg'),
    population: readInput('population'),
  };
}
it('builds expenditure from the frozen source evidence', () => {
  expect(buildExpenditure(expenditureEvidence(), '2026-11-08')).toEqual(
    JSON.parse(bytes('donor/expenditure.json').toString()),
  );
});
