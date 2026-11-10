import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import SheetJSEngine from 'xlsx';
import type * as SheetJS from 'xlsx';
import { zipMember } from '../../build/annual-lineage.js';
import { ooxmlCells } from './ooxml.js';

// The CommonJS distribution includes legacy BIFF code pages. This is a Node-only entry point.
const engine = SheetJSEngine as typeof SheetJS;
export const WORKBOOK_ENGINE = 'sheetjs/0.20.3' as const;
export type WorkbookFormat = 'xls' | 'xlsx';
export interface PinnedFile {
  path: string;
  sha256: string;
}
export interface PinnedWorkbook extends PinnedFile {
  format: WorkbookFormat;
}
export interface WorkbookCell {
  address: string;
  /** Zero-based coordinates, never inferred from a flattened row. */
  row: number;
  column: number;
  type: 'number' | 'text' | 'boolean' | 'error' | 'blank' | 'missing';
  value: number | string | boolean | null;
  formula?: string;
  arrayFormula?: string;
  cache: 'value' | 'missing' | 'not-formula';
  numberFormat?: string;
  formatted?: string;
  /** Exact OOXML <v> token; shared-string cells retain their index here. */
  rawValue?: string;
}
export interface WorkbookSheet {
  name: string;
  /** Range recorded by the engine, including formatting-only trailing cells. */
  declaredRange: string | null;
  /** Extent of actual values/formulae, excluding formatting-only blank cells. */
  rows: number;
  columns: number;
  cells: Record<string, WorkbookCell>;
  merges: string[];
}
export interface Workbook {
  engine: typeof WORKBOOK_ENGINE;
  format: WorkbookFormat;
  sha256: string;
  bytes: number;
  sheetNames: string[];
  sheets: Record<string, WorkbookSheet>;
  date1904: boolean;
}
export const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

export function verifyPin(bytes: Uint8Array, expected: string, name = 'input'): string {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Invalid SHA-256 pin: ${name}`);
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`SHA-256 mismatch: ${name}`);
  return actual;
}
export function readPinnedFile(input: PinnedFile): Buffer {
  const bytes = readFileSync(input.path);
  verifyPin(bytes, input.sha256, input.path);
  return bytes;
}

/** Decode actual BIFF/OXML bytes. Never evaluate formulas or fetch external links.
 * A formula's value is the saved cache; an absent cache remains null, never zero.
 */
export function decodeWorkbook(
  bytes: Uint8Array,
  options: { format: WorkbookFormat; sha256: string },
): Workbook {
  verifyPin(bytes, options.sha256, 'workbook');
  const buffer = Buffer.from(bytes);
  if (bytes.length > 100 * 1024 * 1024) throw new Error('Workbook exceeds 100 MiB');
  if (bytes.length < 8) throw new Error('Truncated workbook');
  if (options.format === 'xls') {
    if (!buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
      throw new Error('Expected an OLE BIFF .xls workbook');
  } else if (options.format === 'xlsx') {
    if (buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('Expected an OOXML .xlsx workbook');
    // Prevent SheetJS's permissive text/CSV fallback and authenticate the workbook container.
    zipMember(buffer, '[Content_Types].xml');
    zipMember(buffer, 'xl/workbook.xml');
  } else throw new Error('Unsupported workbook format');
  // Validate original numeric tokens before the engine can truncate malformed text.
  const scalars = options.format === 'xlsx' ? ooxmlCells(buffer) : null;
  const decoded = engine.read(buffer, {
    type: 'buffer',
    cellFormula: true,
    cellNF: true,
    cellText: true,
    cellDates: false,
    sheetStubs: true,
    WTF: true,
  });
  if (!decoded.SheetNames.length || new Set(decoded.SheetNames).size !== decoded.SheetNames.length)
    throw new Error('Missing or duplicate workbook sheets');
  const sheets: Record<string, WorkbookSheet> = Object.create(null);
  for (const name of decoded.SheetNames) {
    const source = decoded.Sheets[name];
    if (!source) throw new Error(`Missing worksheet: ${name}`);
    const sheet: WorkbookSheet = {
      name,
      declaredRange: source['!ref'] ?? null,
      rows: 0,
      columns: 0,
      cells: Object.create(null),
      merges: (source['!merges'] ?? []).map(engine.utils.encode_range),
    };
    for (const [address, raw] of Object.entries(source)) {
      if (!/^[A-Z]+[1-9][0-9]*$/.test(address)) continue;
      const position = engine.utils.decode_cell(address);
      if (position.r >= 1048576 || position.c >= 16384) throw new Error('Invalid cell coordinate');
      let type: WorkbookCell['type'];
      switch (raw.t) {
        case 'n':
          type = 'number';
          break;
        case 's':
        case 'str':
          type = 'text';
          break;
        case 'b':
          type = 'boolean';
          break;
        case 'e':
          type = 'error';
          break;
        case 'z':
          type = 'blank';
          break;
        default:
          throw new Error(`Unsupported cell type: ${name}!${address}`);
      }
      const scalar = scalars?.[name]?.[address];
      const isFormula = raw.f !== undefined || raw.F !== undefined || scalar?.formula !== undefined;
      const hasScalarCache =
        scalar?.rawValue !== undefined && (scalar.rawValue !== '' || type === 'text');
      const value =
        isFormula && scalar && !hasScalarCache
          ? null
          : raw.v === undefined || raw.v === null
            ? isFormula && hasScalarCache && type === 'text'
              ? scalar!.rawValue!
              : null
            : raw.v;
      if (
        value !== null &&
        (typeof value === 'number'
          ? !Number.isFinite(value)
          : typeof value !== 'string' && typeof value !== 'boolean')
      )
        throw new Error(`Invalid cell value: ${name}!${address}`);
      const cell: WorkbookCell = {
        address,
        row: position.r,
        column: position.c,
        type,
        value,
        ...(raw.f !== undefined || scalar?.formula !== undefined
          ? { formula: raw.f ?? scalar?.formula }
          : {}),
        ...(raw.F !== undefined ? { arrayFormula: raw.F } : {}),
        cache: isFormula ? (value === null ? 'missing' : 'value') : 'not-formula',
        ...(raw.z !== undefined ? { numberFormat: raw.z } : {}),
        ...(raw.w !== undefined ? { formatted: raw.w } : {}),
        ...(scalar?.rawValue !== undefined ? { rawValue: scalar.rawValue } : {}),
      };
      sheet.cells[address] = cell;
      if (type !== 'blank' || cell.formula !== undefined || cell.arrayFormula !== undefined) {
        sheet.rows = Math.max(sheet.rows, position.r + 1);
        sheet.columns = Math.max(sheet.columns, position.c + 1);
      }
    }
    sheets[name] = sheet;
  }
  return {
    engine: WORKBOOK_ENGINE,
    format: options.format,
    sha256: options.sha256,
    bytes: bytes.length,
    sheetNames: [...decoded.SheetNames],
    sheets,
    date1904: !!decoded.Workbook?.WBProps?.date1904,
  };
}
export function readWorkbook(input: PinnedWorkbook): Workbook {
  return decodeWorkbook(readPinnedFile(input), input);
}
export function sheetByName(workbook: Workbook, name: string): WorkbookSheet {
  const sheet = workbook.sheets[name];
  if (!sheet) throw new Error(`Missing worksheet: ${name}`);
  return sheet;
}
export function workbookCell(sheet: WorkbookSheet, address: string): WorkbookCell {
  if (!/^[A-Z]+[1-9][0-9]*$/.test(address)) throw new Error(`Invalid cell address: ${address}`);
  const { r: row, c: column } = engine.utils.decode_cell(address);
  if (row >= 1048576 || column >= 16384) throw new Error('Invalid cell coordinate');
  return (
    sheet.cells[address] ?? {
      address,
      row,
      column,
      type: 'missing',
      value: null,
      cache: 'not-formula',
    }
  );
}
/** Rectangular grid with explicit missing cells. Bound allocations before walking sparse sheets. */
export function workbookGrid(sheet: WorkbookSheet, range?: string): WorkbookCell[][] {
  if (!range && (!sheet.rows || !sheet.columns)) return [];
  const { s, e } = range
    ? engine.utils.decode_range(range)
    : { s: { r: 0, c: 0 }, e: { r: sheet.rows - 1, c: sheet.columns - 1 } };
  if (
    s.r < 0 ||
    s.c < 0 ||
    e.r < s.r ||
    e.c < s.c ||
    e.r >= 1048576 ||
    e.c >= 16384 ||
    (e.r - s.r + 1) * (e.c - s.c + 1) > 1_000_000
  )
    throw new Error('Invalid or oversized grid');
  return Array.from({ length: e.r - s.r + 1 }, (_, r) =>
    Array.from({ length: e.c - s.c + 1 }, (_, c) =>
      workbookCell(sheet, engine.utils.encode_cell({ r: s.r + r, c: s.c + c })),
    ),
  );
}
/** Numeric cells stay numeric. Error, missing and empty cells are never silently coerced. */
export function numericCell(sheet: WorkbookSheet, address: string): number {
  const cell = workbookCell(sheet, address);
  if (cell.type !== 'number' || typeof cell.value !== 'number' || cell.cache === 'missing')
    throw new Error(`Missing numeric value/cache: ${sheet.name}!${address}`);
  return cell.value;
}
/** Source text for decimal consumers, without rounding a numeric OOXML token through Number. */
export function workbookCellText(cell: WorkbookCell): string | null {
  if (cell.value === null) return null;
  if (cell.type === 'error') throw new Error(`Workbook error cell: ${cell.address}`);
  return cell.type === 'number' && cell.rawValue !== undefined ? cell.rawValue : String(cell.value);
}
/** Stable address-and-value evidence tied to the complete original file's digest. */
export function sourceCellSha256(
  workbook: Workbook,
  sheet: WorkbookSheet,
  address: string,
): string {
  if (workbook.sheets[sheet.name] !== sheet) throw new Error('Sheet does not belong to workbook');
  const cell = workbookCell(sheet, address);
  return sha256(
    JSON.stringify([
      workbook.sha256,
      sheet.name,
      address,
      cell.type,
      cell.value,
      cell.formula ?? null,
      cell.arrayFormula ?? null,
      cell.cache,
      cell.rawValue ?? null,
    ]),
  );
}
