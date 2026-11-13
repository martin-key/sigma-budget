import { basename } from 'node:path';
import { pythonRound } from '../../common/format.js';
import { pythonFloatSum } from '../../common/numbers.js';
import {
  readWorkbook,
  sheetByName,
  workbookCell,
  numericCell,
  sourceCellSha256,
  type PinnedFile,
  type Workbook,
} from '../workbooks/index.js';
import { BLANK_ROWS, ROWS, SUM_IDENTITIES } from './layout.js';

export const SCOPES = ['kfp', 'nat', 'eu'] as const;
export type Scope = (typeof SCOPES)[number];
export type Columns<T> = Record<Scope, Record<string, T>>;
export const SHEET = 'стартова';
const letters = { kfp: 'B', nat: 'C', eu: 'D' } as const;
const norm = (text: unknown) => String(text).replace(/\s+/gu, ' ').trim().toLowerCase();
const label = (text: unknown) =>
  String(text)
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\s*(?:I|II|III|IV|V|VI|І|ІІ|ІІІ)\.\s+/, '')
    .replace(/\s+\d\s*$/, '');
export interface ExecutionReport {
  year: number;
  month: number;
  asOf: string;
  unit: 'BGN' | 'EUR';
  unitText: string;
  filename: string;
  sha256: string;
  labels: Record<string, string>;
  values: Record<string, Record<Scope, number>>;
  evidence: {
    engine: string;
    sheet: string;
    dimensions: [number, number];
    declaredRange: string | null;
    sourceCells: Record<string, string>;
    cachedFormulas: number;
    missingCells: number;
    blankCells: number;
  };
  warnings: string[];
}
export function lastDay(year: number, month: number): string {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    year < 2022 ||
    year > 9999 ||
    month < 1 ||
    month > 12
  )
    throw new Error('Invalid report year/month');
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
/** Parse a freshly decoded workbook, keeping caches exactly as saved by the Ministry. */
export function parseExecutionReport(
  workbook: Workbook,
  filename: string,
  knownDifferences: Readonly<Record<string, number>> = {},
): ExecutionReport {
  if (workbook.format !== 'xls') throw new Error('Execution reports must be BIFF .xls');
  const sheet = sheetByName(workbook, SHEET);
  if (sheet.rows !== 54 || sheet.columns !== 4)
    throw new Error(`${filename}: unexpected sheet size ${sheet.rows}x${sheet.columns}`);
  const date = String(workbookCell(sheet, 'A3').value).match(
    /КЪМ\s+(\d{2})\.(\d{2})\.(\d{4})\s+ГОДИНА/u,
  );
  if (!date) throw new Error(`${filename}: missing report date in A3`);
  const [day, month, year] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const asOf = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (asOf !== lastDay(year!, month!))
    throw new Error(`${filename}: date is not the last day of month`);
  const period = /EU[ _]funds_(\d{2})(\d{2})_/.exec(filename);
  if (!period || Number(period[1]) !== month || 2000 + Number(period[2]) !== year)
    throw new Error(`${filename}: filename/date mismatch`);
  const unitText = String(workbookCell(sheet, 'D4').value),
    unit = norm(unitText);
  const currency = unit.includes('млн.лв') ? 'BGN' : unit.includes('млн.евро') ? 'EUR' : null;
  if (currency !== (year! <= 2025 ? 'BGN' : 'EUR'))
    throw new Error(`${filename}: wrong or missing currency unit`);
  const labels: Record<string, string> = {},
    values: ExecutionReport['values'] = {},
    sourceCells: Record<string, string> = {};
  let cachedFormulas = 0,
    missingCells = 0,
    blankCells = 0;
  for (let row = 1; row <= 54; row++)
    for (const col of ['A', 'B', 'C', 'D']) {
      const address = `${col}${row}`,
        cell = workbookCell(sheet, address);
      sourceCells[address] = sourceCellSha256(workbook, sheet, address);
      if (cell.cache === 'value') cachedFormulas++;
      if (cell.type === 'missing') missingCells++;
      if (cell.type === 'blank') blankCells++;
    }
  for (const spec of ROWS) {
    const a = workbookCell(sheet, `A${spec.row}`).value;
    if (!norm(a).includes(norm(spec.fragment)))
      throw new Error(`${filename}: row ${spec.row} label mismatch (${spec.id})`);
    labels[spec.id] = label(a);
    values[spec.id] = Object.fromEntries(
      SCOPES.map((scope) => [
        scope,
        pythonRound(numericCell(sheet, `${letters[scope]}${spec.row}`), 6),
      ]),
    ) as Record<Scope, number>;
  }
  if (
    !norm(workbookCell(sheet, 'A47').value).startsWith('приватизация') ||
    !norm(workbookCell(sheet, 'A48').value).includes('възмездни')
  )
    throw new Error(`${filename}: rows 47-48 label mismatch`);
  labels['fin.priv'] = 'Приватизация, придобиване на дялове и акции, и възмездни средства - нето';
  for (const row of BLANK_ROWS)
    for (const col of ['B', 'C', 'D']) {
      const cell = workbookCell(sheet, `${col}${row}`);
      if (
        !(
          year === 2022 &&
          month! < 12 &&
          row === 47 &&
          ['C', 'D'].includes(col) &&
          cell.type === 'number' &&
          cell.value === 0
        ) &&
        !['blank', 'missing'].includes(cell.type) &&
        !(cell.type === 'text' && cell.value === '')
      )
        throw new Error(`${filename}: expected blank cell ${col}${row}`);
      if (cell.formula !== undefined || cell.arrayFormula !== undefined)
        throw new Error(`${filename}: formula in blank row ${row}`);
    }
  const warnings: string[] = [];
  const check = (deviation: number, bound: number, identity: string) => {
    if (deviation > bound + 1e-9)
      throw new Error(`${filename}: identity ${identity} differs by ${deviation} (bound ${bound})`);
  };
  for (const [parent, children] of Object.entries(SUM_IDENTITIES))
    for (const scope of SCOPES)
      check(
        Math.abs(values[parent]![scope] - pythonFloatSum(children.map((k) => values[k]![scope]))),
        (children.length + 1) * 0.5e-6,
        `${parent}/${scope}`,
      );
  for (const scope of SCOPES) {
    const v = (id: string) => values[id]![scope];
    check(
      Math.abs(v('balance') - (v('rev') - v('exp') + v('transfers') - v('eucontrib'))),
      5 * 0.5e-6,
      `balance/${scope}`,
    );
    const deviation = Math.abs(v('fin') + v('balance'));
    if (year === 2024 && month === 5 && deviation > 0.005 && deviation <= 0.0101)
      warnings.push(`${filename}: known source difference fin=-balance/${scope}: ${deviation}`);
    else if (knownDifferences[`fin=-balance/${letters[scope]}`] !== undefined) {
      check(
        Math.abs(v('fin') + v('balance') - knownDifferences[`fin=-balance/${letters[scope]}`]!),
        1e-6,
        `registered fin=-balance/${scope}`,
      );
      warnings.push(`${filename}: source fin=-balance/${scope}: ${v('fin') + v('balance')}`);
    } else check(deviation, 0.005, `fin=-balance/${scope}`);
    const cell = workbookCell(sheet, `${letters[scope]}34`);
    const control =
      cell.type === 'blank' || cell.type === 'missing'
        ? 0
        : pythonRound(numericCell(sheet, cell.address), 6);
    if (year === 2024 && month === 11 && Math.abs(control) > 1e-5 && Math.abs(control) <= 0.00004)
      warnings.push(`${filename}: known source difference row34/${scope}: ${control}`);
    else if (knownDifferences[`row34/${letters[scope]}`] !== undefined) {
      check(
        Math.abs(control - knownDifferences[`row34/${letters[scope]}`]!),
        1e-6,
        `registered row34/${scope}`,
      );
      warnings.push(`${filename}: source row34/${scope}: ${control}`);
    } else check(Math.abs(control), 1e-5, `row34/${scope}`);
  }
  for (const [id, value] of Object.entries(values))
    check(Math.abs(value.kfp - (value.nat + value.eu)), 1e-6, `к.2=к.3+к.4/${id}`);
  return {
    year: year!,
    month: month!,
    asOf,
    unit: currency!,
    unitText,
    filename,
    sha256: workbook.sha256,
    labels,
    values,
    warnings,
    evidence: {
      engine: workbook.engine,
      sheet: SHEET,
      dimensions: [sheet.rows, sheet.columns],
      declaredRange: sheet.declaredRange,
      sourceCells,
      cachedFormulas,
      missingCells,
      blankCells,
    },
  };
}
export type ExecutionSourceDifferences = Readonly<
  Record<
    string,
    {
      readonly file: string;
      readonly differences: Readonly<Record<string, number>>;
    }
  >
>;
export function readExecutionReport(
  input: PinnedFile,
  sourceDifferences: ExecutionSourceDifferences = {},
): ExecutionReport {
  const registered = sourceDifferences[input.sha256];
  if (registered && registered.file !== basename(input.path))
    throw new Error('Historical source filename mismatch');
  return parseExecutionReport(
    readWorkbook({ ...input, format: 'xls' }),
    basename(input.path),
    registered?.differences,
  );
}
