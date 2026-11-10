import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as SheetJS from 'xlsx';
import { expect, it } from 'vitest';
import {
  decodeWorkbook,
  readWorkbook,
  sha256,
  sheetByName,
  sourceCellSha256,
  workbookCell,
  workbookCellText,
  workbookGrid,
} from './index.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const fixture = join(root, 'packages/ingest/test/fixtures/wave18');
it('decodes every actual BIFF cell against independent saved xlrd grids, not captured parser inputs', () => {
  const captures = JSON.parse(readFileSync(join(fixture, 'captures.json'), 'utf8')).reports;
  let count = 0;
  for (const capture of captures) {
    const wb = readWorkbook({
      path: join(fixture, `data/originals/kfp_${capture.year}`, capture.filename),
      sha256: capture.rawSha256,
      format: 'xls',
    });
    const sheet = sheetByName(wb, capture.sheet),
      grid = workbookGrid(sheet);
    expect([sheet.rows, sheet.columns]).toEqual(capture.dims);
    for (let row = 0; row < sheet.rows; row++)
      for (let col = 0; col < sheet.columns; col++) {
        const actual = grid[row]![col]!,
          expected = capture.cells[row][col];
        if (expected.type === 0 || expected.type === 6) {
          expect(actual.value).toBeNull();
        } else expect(actual.value).toBe(expected.value);
        count++;
      }
    if (capture.year === '2026') {
      expect(workbookCell(sheet, 'B11').formula).toBe('B12+B13+B14');
      expect(workbookCell(sheet, 'B11').cache).toBe('value');
    }
    expect(sourceCellSha256(wb, sheet, 'B11')).not.toBe(sourceCellSha256(wb, sheet, 'C11'));
  }
  expect(count).toBe(33 * 54 * 4);
});
it('reads tracked SEBRA XLSX names, shared strings, sparse grids and amounts against saved donor evidence', () => {
  const base = join(root, 'packages/ingest/test/fixtures/debt-local/inputs');
  const donor = JSON.parse(readFileSync(join(base, 'reader-captures.json'), 'utf8'));
  for (const [day, name] of [
    ['2026-08-27', 'data/cache/sebra_27.08.2026.xlsx'],
    ['2026-08-28', 'data/cache/sebra_28.08.2026.xlsx'],
    ['2026-08-31', 'data/originals/sebra/midt_sebra_31.08.2026.xlsx'],
  ]) {
    const path = join(base, name!),
      bytes = readFileSync(path);
    const wb = readWorkbook({ path, sha256: sha256(bytes), format: 'xlsx' });
    expect(wb.sheetNames).toEqual(['Sheet1']);
    const sheet = sheetByName(wb, 'Sheet1');
    const rows = workbookGrid(sheet)
      .map((row) =>
        Object.fromEntries(
          row
            .filter((c) => c.value !== null)
            .map((c) => [c.address.match(/^[A-Z]+/)![0], workbookCellText(c)]),
        ),
      )
      .filter((row) => Object.keys(row).length);
    expect(rows).toEqual(donor.files[day!].rows);
    expect(() => sheetByName(wb, 'Missing')).toThrow(/Missing worksheet/);
  }
});
it('preserves formula/cache/blank/missing/error/boolean semantics in a bounded OOXML grid', () => {
  const engine = createRequire(import.meta.url)('xlsx') as typeof SheetJS;
  const source = engine.utils.book_new();
  engine.utils.book_append_sheet(
    source,
    {
      '!ref': 'A1:F2',
      A1: { t: 'n', v: 2, f: '1+1' },
      B1: { t: 'n', f: '1+2' },
      C1: { t: 'b', v: false },
      D1: { t: 'e', v: 7 },
      E1: { t: 's', v: '' },
      F1: { t: 's', v: '', f: 'IF(1=1,"",1)' },
    },
    'Named',
  );
  const bytes = engine.write(source, { type: 'buffer', bookType: 'xlsx' });
  const wb = decodeWorkbook(bytes, { sha256: sha256(bytes), format: 'xlsx' }),
    sheet = sheetByName(wb, 'Named');
  expect(workbookCell(sheet, 'A1')).toMatchObject({
    type: 'number',
    value: 2,
    formula: '1+1',
    cache: 'value',
  });
  expect(workbookCell(sheet, 'B1')).toMatchObject({
    value: null,
    formula: '1+2',
    cache: 'missing',
  });
  expect(workbookCell(sheet, 'C1')).toMatchObject({ type: 'boolean', value: false });
  expect(workbookCell(sheet, 'D1').type).toBe('error');
  expect(workbookCell(sheet, 'E1')).toMatchObject({ type: 'text', value: '' });
  expect(workbookCell(sheet, 'F1')).toMatchObject({
    type: 'text',
    value: '',
    cache: 'value',
    formula: 'IF(1=1,"",1)',
  });
  expect(workbookCell(sheet, 'E2')).toMatchObject({ type: 'missing', value: null });
  expect(() => workbookGrid(sheet, 'A1:XFD1048576')).toThrow(/oversized/);
  expect(() =>
    decodeWorkbook(Buffer.from('a,b\n1,2'), { sha256: sha256('a,b\n1,2'), format: 'xlsx' }),
  ).toThrow();
});
