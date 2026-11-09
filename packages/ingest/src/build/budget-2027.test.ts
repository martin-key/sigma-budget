import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parsePythonJson } from '../common/numbers.js';
import {
  AnnualLineage,
  pointer,
  zipMember,
  type Extraction,
  type BillExtraction,
} from './annual-lineage.js';
import { buildAnnualPeriods } from './fiscal-annual.js';
import { buildBudget2027, numericBillCell, physicalBillCell } from './budget-2027.js';
const fixtures = resolve(import.meta.dirname, '../../test/fixtures');
const raw = (name: string) => readFileSync(resolve(fixtures, name), 'utf8');
const oracle = (name: string) => JSON.parse(raw(`wave13a/oracle/${name}`));
const inputs = () => {
  const forecast = parsePythonJson<Extraction>(
    raw('fiscal/inputs/data/inputs/budget_forecast_2027.json'),
  );
  const bill = parsePythonJson<BillExtraction>(
    raw('fiscal/inputs/data/inputs/budget_bill_2027.json'),
  );
  const zip = readFileSync(
    resolve(fixtures, 'fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip'),
  );
  return { forecast, bill, zip };
};
function prepareBaseline() {
  const { forecast, bill, zip } = inputs();
  const lineage = new AnnualLineage(forecast, bill, { forecast: zip, bill: zip });
  const annual = buildAnnualPeriods(forecast, lineage);
  const entries = structuredClone(lineage.entries);
  const { budget, provenance } = buildBudget2027(lineage, '2026-11-08');
  return { forecast, annual, entries, budget, provenance };
}
let baseline: ReturnType<typeof prepareBaseline>;
beforeAll(() => {
  baseline = prepareBaseline();
});
it('reproduces every annual period and its provenance entries from the Python donor', () => {
  expect(baseline.annual).toEqual(oracle('annual.json'));
  expect(baseline.entries).toEqual(oracle('annual-entries.json'));
});
it('reproduces the complete bill from the frozen Python donor', () => {
  expect(baseline.budget).toEqual(oracle('budget2027.json'));
});
it('reproduces every final provenance entry from the frozen Python donor', () => {
  expect(baseline.provenance).toEqual(oracle('budget2027-provenance.json'));
});
it('retains every budget and municipality identity, blanks and the documented GDP discrepancy', () => {
  const { forecast, budget } = baseline;
  expect(Object.keys(budget.budgets.bill)).toHaveLength(48); // Article 1 plus 47 budget identities.
  expect(budget.municipal.art52).toHaveLength(265);
  expect(budget.municipal.art53).toHaveLength(265);
  expect(budget.forecast.II_7[0].gaps['2']).toBe('Празна печатна клетка.');
  expect(forecast.tables.I_2!.rows[0]!.values[3]).not.toBe(
    forecast.tables.annex3_pct_gdp!.rows[63]!.values[2],
  );
});

function prepareChanged() {
  const { forecast, bill, zip } = inputs();
  const row = forecast.tables.II_7!.rows[0]!;
  row.values = [123, -12.5, 9];
  row.printed = ['123,0', '-12,5', '9,0'];
  bill.articles['67']![0]!.text = 'Граничен размер 31,25 млрд. евро.';
  bill.bill['1']!.rows[0]!.value = null;
  delete bill.bill['2'];
  const lineage = new AnnualLineage(forecast, bill, { forecast: zip, bill: zip });
  const { budget } = buildBudget2027(lineage, '2026-11-08');
  const changed = oracle('changed.json');
  return { budget, changed };
}
describe('changed Python donor', () => {
  let prepared: ReturnType<typeof prepareChanged>;
  beforeAll(() => {
    prepared = prepareChanged();
  });
  it('matches the measures across all years', () => {
    expect(prepared.budget.forecast.II_7[0]).toEqual(prepared.changed.measures);
  });
  it('matches the changed legal ceiling', () => {
    expect(prepared.budget.debtLimits['67']).toEqual(prepared.changed.debt67);
  });
  it('matches the changed bill rows', () => {
    expect(prepared.budget.budgets.bill['1'].rows).toEqual(prepared.changed.bill1rows);
  });
  it('preserves the separate Council-of-Ministers rows', () => {
    expect(prepared.budget.budgets.billMc['1'].rows).toEqual(prepared.changed.billMc1rows);
  });
  it('preserves an absent bill budget', () => {
    expect(prepared.budget.budgets.bill['2']).toBeUndefined();
  });
  it('preserves the budget present only in the Council-of-Ministers variant', () => {
    expect(prepared.budget.budgets.billMc['2']).toEqual(prepared.changed.billMcOnly);
  });
});

it('rejects altered archives, member hashes and null source hashes while using defaults only for absence', () => {
  const { forecast, bill, zip } = inputs();
  const corrupted = Buffer.from(zip);
  corrupted[100] = corrupted[100]! ^ 1;
  expect(() => zipMember(zip, 'missing.pdf')).toThrow(/missing/);
  expect(() => zipMember(Buffer.from('not a zip'), 'missing.pdf')).toThrow(/ZIP/);
  const negatives = oracle('negative-cases.json');
  expect(negatives.archiveSha256).toBe(true);
  expect(negatives.memberSha256).toBe(true);
  expect(() => new AnnualLineage(forecast, bill, { forecast: corrupted, bill: zip })).toThrow(
    /Archive checksum/,
  );
  const old = forecast.source.pdf_sha256;
  forecast.source.pdf_sha256 = '0'.repeat(64);
  expect(() => new AnnualLineage(forecast, bill, { forecast: zip, bill: zip })).toThrow(
    /member checksum/,
  );
  forecast.source.memberSha256 = old;
  forecast.source.pdf_sha256 = null;
  expect(() => new AnnualLineage(forecast, bill, { forecast: zip, bill: zip })).toThrow(
    /member checksum/,
  );
  delete forecast.source.pdf_sha256;
  expect(() => new AnnualLineage(forecast, bill, { forecast: zip, bill: zip })).not.toThrow();
});

it('validates every period header, units and required numeric cells', () => {
  const { forecast, bill, zip } = inputs();
  const lineage = new AnnualLineage(forecast, bill, { forecast: zip, bill: zip });
  bill.year = 2028;
  expect(() => buildBudget2027(lineage, '2026-11-08')).toThrow(/year or unit/);
  bill.year = 2027;
  bill.unit = 'млн. евро';
  expect(() => buildBudget2027(lineage, '2026-11-08')).toThrow(/year or unit/);
  bill.unit = 'хил. евро';
  const negatives = oracle('negative-cases.json');
  for (const [table, column, period] of [
    ['annex1_execution2026', 0, '2026.law'],
    ['annex3_mln', 1, '2026.expected'],
    ['annex3_mln', 2, '2027.draft'],
    ['annex3_mln', 3, '2028.forecast'],
    ['annex3_mln', 4, '2029.forecast'],
  ] as const) {
    expect(negatives[period]).toBe(true);
    const header = forecast.tables[table]!.columns[column]!;
    const original = header.vintage;
    header.vintage = 'отчет';
    expect(() => lineage.f(table, 0, column, 'out.json#/x', period)).toThrow(/vintage/);
    header.vintage = original;
    header.year += 1;
    expect(() => lineage.f(table, 0, column, 'out.json#/x', period)).toThrow(/year/);
    header.year -= 1;
  }
  const row = forecast.tables.annex3_mln!.rows[0]!;
  const unit = row.units[2]!;
  row.units[2] = '%';
  expect(() => lineage.f('annex3_mln', 0, 2, 'out.json#/x', '2027.draft')).toThrow(/unit/);
  row.units[2] = unit;
  row.values[2] = null;
  expect(() => lineage.f('annex3_mln', 0, 2, 'out.json#/x', '2027.draft')).toThrow(/Non-numeric/);
  delete forecast.tables.II_7!.columns[0]!.vintage;
  expect(lineage.f('II_7', 0, 0, 'out.json#/measure', '2027.draft').value).toBe(800);
});

it('retains Python numeric and pointer semantics and rejects ambiguous cells', () => {
  const cases = oracle('physical-cases.json');
  for (const item of cases.numeric) {
    if (item.error) expect(() => numericBillCell(item.text)).toThrow();
    else expect(numericBillCell(item.text)).toBe(item.value);
  }
  expect(pointer({ 'a/b': { '~x': 7 } }, '/a~1b/~0x')).toBe(7);
  expect(() => pointer({}, '/bad~2key')).toThrow();
  const bill = {
    source: {} as never,
    municipal: { art52: { rows: [{ name: 'X', values: [10], page: 1 }] } },
    tables: [
      {
        id: 't',
        page: 1,
        rawCells: [
          ['X', '10'],
          ['X', '10'],
        ],
      },
    ],
  } as unknown as BillExtraction;
  expect(cases.ambiguous).toBe(true);
  expect(() =>
    physicalBillCell(bill, bill.municipal.art52!.rows[0], '/municipal/art52/rows/0/values/0', 1),
  ).toThrow(/ambiguous/);
  const typed = parsePythonJson<BillExtraction>(
    '{"source":{},"bill":{"1":{"rows":[{"value":1},{"value":1.0}]}},"tables":[{"id":"t","page":1,"rawCells":[["1","1.0"]]}]}',
  );
  const row = { table: 't', page: 1 };
  expect(physicalBillCell(typed, row, '/bill/1/rows/0/value', null).printed).toBe(cases.printedInt);
  expect(physicalBillCell(typed, row, '/bill/1/rows/1/value', null).printed).toBe(
    cases.printedFloat,
  );
  expect(() =>
    physicalBillCell(typed, { table: 't', page: 2 }, '/bill/1/rows/0/value', null),
  ).toThrow(/page mismatch/);
  typed.bill['1']!.rows[0]!.value = 42;
  expect(() => physicalBillCell(typed, row, '/bill/1/rows/0/value', null)).toThrow(
    /printed numeric evidence/,
  );
});
