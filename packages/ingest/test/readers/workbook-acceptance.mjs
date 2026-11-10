// Optional raw-original acceptance, deliberately separate from tests whose inputs are tracked.
// Missing required originals fail this command; they are never reported as skipped PASS.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readWorkbook,
  sha256,
  sheetByName,
  workbookCellText,
  workbookGrid,
} from '../../dist/readers/workbooks/index.js';
const project = fileURLToPath(new URL('../../../../', import.meta.url));
const args = process.argv.slice(2);
assert.equal(args.length, 4, '--originals ORIGINALS_ROOT --out NEW_REPORT.json');
assert.equal(args[0], '--originals');
assert.equal(args[2], '--out');
const originals = resolve(args[1]),
  out = resolve(args[3]);
const ir = JSON.parse(
  readFileSync(join(project, 'packages/ingest/test/fixtures/indirect-taxes/reader-ir.json')),
);
const captures = JSON.parse(
  readFileSync(
    join(project, 'packages/ingest/test/fixtures/debt-local/inputs/reader-captures.json'),
  ),
);
const checks = [],
  inputs = [];
const load = (file, pin) => {
  const path = join(originals, file),
    before = sha256(readFileSync(path));
  assert.equal(before, pin);
  const wb = readWorkbook({ path, sha256: pin, format: 'xlsx' });
  inputs.push({ path, sha256: before });
  return wb;
};
for (const [key, name] of [
  ['prices', 'Sheet1'],
  ['duties', 'Excise duties'],
  ['vat', 'VAT'],
]) {
  const source = ir.sources[key === 'vat' ? 'duties' : key];
  const wb = load(source.path.replace(/^data\/originals\//, ''), source.sha256),
    sheet = sheetByName(wb, name);
  const actual = Object.fromEntries(
    Object.values(sheet.cells)
      .filter((c) => c.value !== null)
      .map((c) => [c.address, workbookCellText(c)]),
  );
  assert.deepEqual(actual, ir[key]);
  checks.push({
    kind: 'EC',
    sheet: name,
    cells: Object.keys(actual).length,
    sha256: wb.sha256,
    dimensions: [sheet.rows, sheet.columns],
  });
}
const sebraPath = join(
  project,
  'packages/ingest/test/fixtures/debt-local/inputs/data/originals/sebra/midt_sebra_31.08.2026.xlsx',
);
const wb = load('sebra/midt_sebra_31.08.2026.xlsx', sha256(readFileSync(sebraPath))),
  sheet = sheetByName(wb, 'Sheet1');
const rows = workbookGrid(sheet)
  .map((row) =>
    Object.fromEntries(
      row
        .filter((c) => c.value !== null)
        .map((c) => [c.address.match(/^[A-Z]+/)[0], workbookCellText(c)]),
    ),
  )
  .filter((r) => Object.keys(r).length);
assert.deepEqual(rows, captures.files['2026-08-31'].rows);
checks.push({
  kind: 'SEBRA',
  sheet: 'Sheet1',
  rows: rows.length,
  sha256: wb.sha256,
  dimensions: [sheet.rows, sheet.columns],
});
for (const input of inputs)
  assert.equal(sha256(readFileSync(input.path)), input.sha256, 'original changed');
const report = {
  schema: 'workbook-acceptance/1',
  outcome: 'pass',
  inputs,
  checks,
  evidence:
    'Actual source workbooks decoded in Node and compared with independent saved Python readers; originals unchanged.',
  limitations: [
    'Only supplied pinned publications are established here; missing historical originals are not reconstructed.',
  ],
};
writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ out, checks: checks.length, outcome: 'pass' }) + '\n');
