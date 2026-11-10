import { readPdf, pdfTables, assert, ws, type PdfDocument, type Box } from '../pdf/index.js';
import type { ContributionRow } from '../../build/rates.js';
import { authenticate, FISCAL_DOCUMENT_PATHS, type FiscalOriginal } from './source.js';
export interface NapPhysicalRow {
  id: string;
  page: number;
  table: number;
  row: number;
  /** Fifteen physical column boxes; null denotes an unowned merged slot. */
  boxes: (Box | null)[];
  cells: string[];
  selected: boolean;
}
export interface NapExtraction {
  rows: Record<string, ContributionRow>;
  physicalRows: NapPhysicalRow[];
  source: { path: string; sha256: string; engine: string; method: string };
}
export function napFromPdf(pdf: PdfDocument): NapExtraction {
  const rows: Record<string, ContributionRow> = Object.create(null),
    physicalRows: NapPhysicalRow[] = [];
  for (const page of pdf.pages)
    for (const [table, tb] of pdfTables(page).entries()) {
      for (const [row, raw] of tb.rawCells.entries()) {
        const cells = raw.map(ws),
          m = /^(\d+(?:\.\d+)*\.)\s*(.*)$/u.exec(cells[0] ?? '');
        if (!m) continue;
        assert(
          cells.length === 15,
          `NAP page ${page.number}: numbered row has ${cells.length} columns`,
        );
        const id = m[1]!,
          selected = !Object.hasOwn(rows, id);
        physicalRows.push({
          id,
          page: page.number,
          table,
          row,
          boxes: tb.rows[row]!,
          cells,
          selected,
        });
        if (selected) rows[id] = { page: page.number, label: m[2]!, cells };
      }
    }
  for (const id of [
    ...Array.from({ length: 19 }, (_, i) => `${i + 1}.`),
    '1.1.',
    '1.2.',
    '5.1.2.',
    '5.2.2.',
    '10.1.2.',
    '10.2.2.',
  ])
    assert(rows[id], `NAP missing physical row ${id}`);
  return {
    rows,
    physicalRows,
    source: {
      path: FISCAL_DOCUMENT_PATHS.nap,
      sha256: pdf.sha256,
      engine: pdf.engine,
      method: 'MuPDF vector-ruled physical cells; first occurrence of each numbered row wins',
    },
  };
}
export function extractNap(source: FiscalOriginal): NapExtraction {
  const bytes = authenticate(source, FISCAL_DOCUMENT_PATHS.nap),
    pdf = readPdf(bytes);
  assert(pdf.pages.length === 22, 'NAP page count changed');
  return napFromPdf(pdf);
}
/** Synchronous independent-rule binding, decoding the particular supplied bytes. */
export const readNapRows = (source: FiscalOriginal): Record<string, ContributionRow> =>
  extractNap(source).rows;
