import { AnnualLineage, type BillExtraction, type Extraction } from '../../build/annual-lineage.js';
import { checkAnnexSums, loadAnnex, type Annex, type AnnexTables } from '../../build/annex.js';
import { decimalSum } from '../../build/fiscal-annual.js';
import { readPinnedFile, type PinnedFile } from '../workbooks/index.js';

export const LAW_ROWS = {
  rev: 0,
  'rev.tax': 1,
  'rev.nontax': 6,
  'rev.grants': 7,
  'exp.total': 8,
  'exp.interest': 14,
  eucontrib: 15,
  'exp.capex': 11,
  'exp.abroad': 12,
  'exp.contingency': 13,
  balance: 17,
} as const;
const reason = 'Приложение 1 не дава отделен законов знаменател за този ред.';
const split = 'Приложение 1 не дава национална/европейска разбивка на закона; колони 2/3 са отчет.';
export const LAW_COVERAGE = {
  kfp: Object.fromEntries(
    [
      'exp.personnel',
      'exp.maint',
      'exp.social',
      'exp.subsidies',
      'exp.reserve',
      'exp.interest.ext',
      'exp.interest.dom',
    ].map((id) => [id, reason]),
  ),
  nat: split,
  eu: split,
};
export interface ExecutionLawPlan {
  kfp: Record<string, number>;
  nat: Record<string, number>;
  eu: Record<string, number>;
  periodKey: '2026.law';
  basis: 'adopted-law';
  source: string[];
  asOf: string;
  unit: 'млн. €';
  coverage: typeof LAW_COVERAGE;
  note: string;
}
export interface ExecutionAnnualInput {
  plan: ExecutionLawPlan;
  provenance: Record<string, unknown>;
  annex3: Annex;
  /** This reader verifies prepared data and archive/member pins; it does not extract PDFs. */
  boundary: {
    kind: 'verified-prepared-annual-data';
    rawPdfDecoded: false;
    preparedInputPins?: Record<keyof ExecutionAnnualFiles, string>;
  };
}
export interface ExecutionAnnualFiles {
  forecast: PinnedFile;
  bill: PinnedFile;
  forecastArchive: PinnedFile;
  billArchive: PinnedFile;
  historicalAnnex3: PinnedFile;
}

/** Boundary for the PDF preparation stage: reuse its verified lineage and historical table reader. */
export function executionAnnualFromPrepared(
  lineage: AnnualLineage,
  historicalTables: AnnexTables,
): ExecutionAnnualInput {
  const table = 'annex1_execution2026',
    rows = lineage.inputs.F.tables[table]?.rows;
  if (!rows) throw new Error('Missing adopted-law Annex 1');
  const values: Record<string, number> = {},
    cells: Record<string, unknown> = {};
  for (const [id, rowIndex] of Object.entries(LAW_ROWS)) {
    const cell = lineage.f(table, rowIndex, 0, `execution.json#/plan2026/kfp/${id}`, '2026.law');
    if (cell.unit !== 'млн. €')
      throw new Error(`Wrong adopted-law unit in Annex 1 row ${rowIndex}: expected млн. €`);
    const row = rows[rowIndex]!;
    values[id] = cell.value;
    cells[id] = { ...lineage.entries[cell.provenance], row: row.label, rowIndex };
  }
  values.exp = decimalSum([values['exp.total']!, -values.eucontrib!]);
  values.fin = -values.balance!;
  cells.exp = {
    operation: 'subtract',
    operands: ['exp.total', 'eucontrib'],
    cells: [cells['exp.total'], cells.eucontrib],
  };
  cells.fin = {
    operation: 'negate',
    basis: 'balancing-operation',
    operands: ['balance'],
    cells: [cells.balance],
  };
  const doc = lineage.documents.forecast;
  const annex3 = loadAnnex(historicalTables);
  const problems = checkAnnexSums(annex3);
  if (problems.length) throw new Error(`Invalid historical Annex 3: ${problems.join('; ')}`);
  return {
    plan: {
      kfp: values,
      nat: {},
      eu: {},
      periodKey: '2026.law',
      basis: 'adopted-law',
      source: ['budget2027'],
      asOf: '2026-11-06',
      unit: 'млн. €',
      coverage: structuredClone(LAW_COVERAGE),
      note: 'Програма по ЗДБРБ 2026, МФ, приложение 1. Финансирането е балансова операция (-салдо).',
    },
    provenance: {
      kfp: {
        ...doc,
        sha256: doc.memberSha256,
        periodKey: '2026.law',
        basis: 'adopted-law',
        table,
        column: lineage.inputs.F.tables[table]!.columns[0],
        rows: cells,
      },
      nat: { rows: {}, reason: split },
      eu: { rows: {}, reason: split },
    },
    annex3,
    boundary: { kind: 'verified-prepared-annual-data', rawPdfDecoded: false },
  };
}

/** All five real file pins are checked before interpreting a prepared annual input. */
export function readExecutionAnnual(files: ExecutionAnnualFiles): ExecutionAnnualInput {
  const forecast = JSON.parse(readPinnedFile(files.forecast).toString('utf8')) as Extraction;
  const bill = JSON.parse(readPinnedFile(files.bill).toString('utf8')) as BillExtraction;
  const historical = JSON.parse(readPinnedFile(files.historicalAnnex3).toString('utf8')) as {
    tables: AnnexTables;
  };
  const result = executionAnnualFromPrepared(
    new AnnualLineage(forecast, bill, {
      forecast: readPinnedFile(files.forecastArchive),
      bill: readPinnedFile(files.billArchive),
    }),
    historical.tables,
  );
  result.boundary.preparedInputPins = Object.fromEntries(
    Object.entries(files).map(([role, file]) => [role, file.sha256]),
  ) as Record<keyof ExecutionAnnualFiles, string>;
  return result;
}
