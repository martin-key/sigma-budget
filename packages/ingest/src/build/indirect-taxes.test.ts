import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { buildIndirectTaxes, type IndirectTaxReaderEvidence } from './indirect-taxes.js';

const root = resolve(import.meta.dirname, '../../test/fixtures/indirect-taxes');
const bytes = (name: string) => readFileSync(resolve(root, name));
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
let input: IndirectTaxReaderEvidence;
beforeAll(() => {
  const manifest = bytes('provenance.json');
  expect(hash(manifest)).toBe('c240c8fa33d9e9dd9c3064259a159864b3b4395c5559b8b2c80c45abecfcd575');
  const inventory = JSON.parse(manifest.toString());
  expect(inventory.baseline).toBe('027a262288c0b0ca4b188482a8b8da43bb378047');
  for (const [name, sha] of Object.entries(inventory.files)) expect(hash(bytes(name))).toBe(sha);
  input = JSON.parse(bytes('reader-ir.json').toString());
});

it('matches the frozen independent Python donor exactly', () => {
  expect(buildIndirectTaxes(input, '2026-11-08')).toEqual(
    JSON.parse(bytes('oracle.json').toString()),
  );
});
it('rejects altered EC country, units, columns, dates and currency declarations', () => {
  expect(() =>
    buildIndirectTaxes({ ...input, sheets: { ...input.sheets, vat: 'Other' } }, '2026-11-08'),
  ).toThrow(/worksheet/);
  for (const [table, key, value] of [
    ['prices', 'A5', 'Belgium'],
    ['prices', 'A1', 'in USD'],
    ['prices', 'B1', 'diesel'],
    ['prices', 'A2', '1'],
    ['prices', 'B2', 'kg'],
    ['duties', 'C4', 'kg'],
    ['duties', 'C1', 'Excises in BGN'],
    ['vat', 'C1', 'Other taxes'],
    ['vat', 'D7', '21'],
  ] as const) {
    const changed = { ...input, [table]: { ...input[table], [key]: value } };
    expect(() => buildIndirectTaxes(changed, '2026-11-08')).toThrow();
  }
});
it('checks statutory conversion, NSI columns, DOCX row and the cigarette schedule', () => {
  expect(() =>
    buildIndirectTaxes(
      { ...input, duties: { ...input.duties, C7: input.duties.D7! } },
      '2026-11-08',
    ),
  ).toThrow(/statutory EUR/);
  const nsiPages = [...input.nsiPages];
  const page = nsiPages.findIndex((text) => text.includes('Цигари с филтър - кутия'));
  nsiPages[page] = nsiPages[page]!.replace('(BGN)', '(USD)');
  expect(() => buildIndirectTaxes({ ...input, nsiPages }, '2026-11-08')).toThrow(/currency/);
  expect(() => buildIndirectTaxes({ ...input, docxTables: [] }, '2026-11-08')).toThrow(/VAT row/);
  expect(() => buildIndirectTaxes({ ...input, gazetteParts: [] }, '2026-11-08')).toThrow(
    /schedule/,
  );
});
it('propagates a source price into the output without changing the legal rate', () => {
  const before = buildIndirectTaxes(input, '2026-11-08');
  const after = buildIndirectTaxes(
    { ...input, prices: { ...input.prices, B5: '1700' } },
    '2026-11-08',
  );
  expect(after.fuels.petrol!.pricePerLitre).toBe(1.7);
  expect(after.fuels.petrol!.originalPrice).toBe(1700);
  expect(after.fuels.petrol!.excisePerLitre).toBe(before.fuels.petrol!.excisePerLitre);
});
