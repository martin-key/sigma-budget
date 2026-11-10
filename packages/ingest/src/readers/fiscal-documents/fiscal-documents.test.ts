import { readFile, mkdtemp, mkdir, writeFile, rm, symlink, link, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  authenticate,
  FISCAL_DOCUMENT_PATHS as paths,
  sha256,
  type FiscalOriginal,
  extractAsbp,
  asbpFiscalEvidence,
  extractNap,
  readNapRows,
  readEmfTexts,
  readFiscalZipMember,
  readIndirectTaxInput,
  readIndirectEvidence,
  nsiPackFromPdf,
  cleanAsbpPages,
  asbpTableRows,
  validateFiscalDestination,
  prepareFiscalDocuments,
  type AsbpExtraction,
  type NapExtraction,
  type IndirectOriginals,
} from './index.js';
import { type PdfDocument, type PdfPage, type PdfChar } from '../pdf/index.js';
import { parseLegalDocx } from '../documents/index.js';
import { buildFiscalDonor } from '../../build/fiscal-build.js';
import { loadFiscalFixture } from '../../build/fiscal-fixture.js';
import { buildRates, type RatesEvidence } from '../../build/rates.js';
import { buildIndirectTaxes } from '../../build/indirect-taxes.js';
const repo = resolve(import.meta.dirname, '../../../../..'),
  fixtures = join(repo, 'packages/ingest/test/fixtures');
const sourceRoot = process.env.FISCAL_DOCUMENT_TEST_ROOT,
  expectedRoot = process.env.FISCAL_DOCUMENT_PYTHON_EXPECTATIONS;
const json = async (p: string) => JSON.parse(await readFile(p, 'utf8'));
let temp: string;
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'sigma-fiscal-documents-test-'));
});
afterAll(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});
function original(path: string, bytes: Uint8Array): FiscalOriginal {
  return { path, bytes, sha256: sha256(bytes) };
}
function emf(text = '123,4'): Uint8Array {
  const chars = Buffer.from(text, 'utf16le'),
    recordSize = 76 + Math.ceil(chars.length / 4) * 4,
    total = 88 + recordSize + 20,
    b = Buffer.alloc(total);
  b.writeUInt32LE(1, 0);
  b.writeUInt32LE(88, 4);
  b.writeUInt32LE(0x464d4520, 40);
  b.writeUInt32LE(total, 48);
  b.writeUInt32LE(3, 52);
  b.writeUInt32LE(84, 88);
  b.writeUInt32LE(recordSize, 92);
  b.writeInt32LE(-10, 124);
  b.writeInt32LE(20, 128);
  b.writeUInt32LE(text.length, 132);
  b.writeUInt32LE(76, 136);
  chars.copy(b, 164);
  b.writeUInt32LE(14, 88 + recordSize);
  b.writeUInt32LE(20, 92 + recordSize);
  return b;
}
it('bounds EMR_EXTTEXTOUTW and preserves signed coordinates and record identity', () => {
  expect(readEmfTexts(emf())).toEqual([{ offset: 88, x: -10, y: 20, text: '123,4' }]);
  expect(readEmfTexts(emf('БВП 123,4'))[0]!.text).toBe('БВП 123,4');
});
it.each(['size', 'chars', 'offset', 'dx', 'eof', 'count', 'length', 'glyph', 'utf16'] as const)(
  'rejects malformed EMF %s',
  (kind) => {
    const b = Buffer.from(emf());
    if (kind === 'size') b.writeUInt32LE(8, 92);
    if (kind === 'chars') b.writeUInt32LE(0xffffffff, 132);
    if (kind === 'offset') b.writeUInt32LE(0xffffffff, 136);
    if (kind === 'dx') b.writeUInt32LE(0xffffffff, 160);
    if (kind === 'eof') b.writeUInt32LE(0, b.length - 20);
    if (kind === 'count') b.writeUInt32LE(4, 52);
    if (kind === 'length') b.writeUInt32LE(b.length + 4, 48);
    if (kind === 'glyph') b.writeUInt32LE(0x10, 140);
    if (kind === 'utf16') b.writeUInt16LE(0xd800, 164);
    expect(() => readEmfTexts(b)).toThrow();
  },
);
it('authenticates bytes, identity and missing sources before decoding', () => {
  const source = original(paths.nap, Buffer.from('actual bytes'));
  expect(authenticate(source, paths.nap)).toBe(source.bytes);
  expect(() => authenticate({ ...source, sha256: '0'.repeat(64) }, paths.nap)).toThrow(/SHA-256/);
  expect(() => authenticate({ ...source, path: paths.asbp }, paths.nap)).toThrow(/source/);
  expect(() => authenticate(undefined as unknown as FiscalOriginal, paths.nap)).toThrow(/Missing/);
});
function fakePdf(tokens: { text: string; x: number; y: number }[], number = 231): PdfDocument {
  const page: PdfPage = {
    number,
    bbox: [0, 0, 700, 900],
    width: 700,
    height: 900,
    text: tokens.map((t) => t.text).join('\n'),
    edges: [],
    pathBounds: [],
    blocks: [
      {
        bbox: [0, 0, 700, 900],
        lines: tokens.map((t) => {
          const chars: PdfChar[] = [...t.text].map((text, i) => ({
            text,
            bbox: [t.x + i * 4, t.y, t.x + (i + 1) * 4, t.y + 10],
            origin: [t.x + i * 4, t.y + 8],
          }));
          return {
            bbox: [t.x, t.y, t.x + t.text.length * 4, t.y + 10],
            wmode: 0,
            direction: [1, 0],
            spans: [
              {
                text: t.text,
                bbox: [t.x, t.y, t.x + t.text.length * 4, t.y + 10],
                font: 'Test',
                size: 10,
                bold: false,
                chars,
              },
            ],
          };
        }),
      },
    ],
  };
  return {
    sha256: '0'.repeat(64),
    engine: 'mupdf@1.26.4',
    method: 'explicit synthetic physical test',
    pages: [page],
    metadata: {},
  };
}
const pack = () =>
  fakePdf([
    { text: '(BGN)', x: 10, y: 5 },
    { text: '(Левове)', x: 10, y: 15 },
    { text: '2024', x: 200, y: 50 },
    { text: '2025', x: 250, y: 50 },
    { text: 'Цигари с филтър - кутия', x: 10, y: 100 },
    { text: '5.50', x: 200, y: 100 },
    { text: '5.73', x: 250, y: 100 },
  ]);
it('binds NSI values to physical year centers and rejects a swapped/missing/unit cell', () => {
  const pdf = pack();
  expect(nsiPackFromPdf(pdf).cells.map((c) => [c.year, c.value])).toEqual([
    [2024, 5.5],
    [2025, 5.73],
  ]);
  const moved = pack();
  moved.pages[0]!.blocks[0]!.lines.at(-1)!.spans[0]!.chars.forEach((c) => {
    c.bbox[0] += 60;
    c.bbox[2] += 60;
  });
  expect(() => nsiPackFromPdf(moved)).toThrow(/price column/);
  const unit = pack();
  unit.pages[0]!.text = unit.pages[0]!.text.replace('(BGN)', '(EUR)');
  expect(() => nsiPackFromPdf(unit)).toThrow(/currency/);
  const changed = pack();
  const l = changed.pages[0]!.blocks[0]!.lines.at(-1)!;
  l.spans[0]!.chars[0]!.text = '6';
  l.spans[0]!.text = '6.73';
  expect(nsiPackFromPdf(changed).cells.at(-1)!.value).toBe(6.73);
});
it('retains physical ASBP multiline ownership and rejects duplicate numeric columns', () => {
  const pdf = fakePdf(
    [
      { text: 'Разходи', x: 10, y: 10 },
      { text: '123,4', x: 210, y: 18 },
      { text: '567,8', x: 310, y: 18 },
    ],
    1,
  );
  expect(
    asbpTableRows(
      pdf,
      [[1, [0, 100]]],
      [
        ['2026', 220],
        ['2027', 320],
      ],
      150,
    )[0]!.values,
  ).toEqual([123.4, 567.8]);
  const duplicate = fakePdf(
    [
      { text: '123,4', x: 210, y: 18 },
      { text: '567,8', x: 220, y: 18 },
    ],
    1,
  );
  expect(() => asbpTableRows(duplicate, [[1, [0, 100]]], [['2026', 220]], 150)).toThrow(
    /duplicate/,
  );
});
it('removes raised inline footnotes but retains leading footnote labels', () => {
  const p = fakePdf([{ text: 'Text1', x: 0, y: 10 }], 1),
    line = p.pages[0]!.blocks[0]!.lines[0]!,
    s = line.spans[0]!;
  const raised = {
    ...s,
    text: '2',
    chars: [
      {
        text: '2',
        bbox: [20, 8, 24, 12] as [number, number, number, number],
        origin: [20, 8] as [number, number],
      },
    ],
  };
  line.spans = [s, raised];
  expect(cleanAsbpPages(p)[0]!.body).toBe('Text1\n');
  line.spans = [raised, s];
  expect(cleanAsbpPages(p)[0]!.body).toBe('2Text1\n');
});
it('preflights every protected/overlap/alias category without creating output', async () => {
  const root = join(temp, 'safety'),
    source = join(root, 'source'),
    external = join(root, 'external');
  await mkdir(source, { recursive: true });
  await mkdir(external);
  const registry = join(external, 'registry.yaml'),
    pins = join(external, 'pins.sha256');
  await writeFile(registry, 'immutable registry');
  await writeFile(pins, 'immutable pins');
  const base = {
    sourceRoot: source,
    registryPath: registry,
    pinsPath: pins,
    readDate: '2026-11-10',
    out: join(root, 'new'),
  };
  await expect(validateFiscalDestination(base)).resolves.toBe(base.out);
  for (const out of [
    root,
    source,
    join(source, 'candidate'),
    registry,
    pins,
    join(registry, 'child'),
    external,
    join(root, 'release/new'),
    join(root, 'originals/new'),
    join(root, 'cache/new'),
  ])
    await expect(validateFiscalDestination({ ...base, out })).rejects.toThrow();
  const alias = join(root, 'alias');
  await symlink(external, alias);
  await expect(
    validateFiscalDestination({ ...base, out: join(alias, 'candidate') }),
  ).rejects.toThrow(/Symlink/);
  const dangling = join(root, 'dangling');
  await symlink(join(root, 'missing'), dangling);
  await expect(validateFiscalDestination({ ...base, out: dangling })).rejects.toThrow(/Symlink/);
  const hard = join(root, 'hard');
  await link(registry, hard);
  await expect(validateFiscalDestination({ ...base, out: hard })).rejects.toThrow();
  await expect(validateFiscalDestination({ ...base, registryPath: hard })).rejects.toThrow(
    /hardlinked/,
  );
  expect(await readFile(registry, 'utf8')).toBe('immutable registry');
  expect(await readFile(pins, 'utf8')).toBe('immutable pins');
  expect((await readdir(root)).includes('new')).toBe(false);
});

describe.skipIf(!sourceRoot || !expectedRoot)(
  'actual pinned originals against fresh locked Python',
  () => {
    let sources: Record<keyof typeof paths, FiscalOriginal>,
      asbp: AsbpExtraction,
      nap: NapExtraction,
      decodedIndirect: ReturnType<typeof readIndirectTaxInput> | undefined;
    const indirectInput = () =>
      (decodedIndirect ??= readIndirectTaxInput(sources as IndirectOriginals));
    beforeAll(async () => {
      sources = {} as typeof sources;
      for (const key of Object.keys(paths) as (keyof typeof paths)[])
        sources[key] = original(paths[key], await readFile(join(sourceRoot!, paths[key])));
      asbp = extractAsbp(sources.asbp, sources.bill);
      nap = extractNap(sources.nap);
    }, 240_000);
    it('compares every ASBP table row/page/label/null/value, clean page and municipal quote', async () => {
      const donor = await json(join(expectedRoot!, 'asbp.json'));
      for (const [key, table] of Object.entries(asbp.tables)) {
        expect(
          table.rows.map((r) => ({ page: r.page, label: r.label, x0: r.x0, values: r.values })),
        ).toEqual(
          donor.tables[key].rows.map((r: any) => ({
            page: r.page,
            label: r.label,
            x0: r.x0,
            values: r.values,
          })),
        );
        for (const row of table.rows)
          for (const cell of row.cells) {
            expect(cell.value).toBe(row.values[cell.column]);
            expect(cell.header).toBe(table.columns[cell.column]);
            expect(cell.unit).toBe(row.unit);
          }
      }
      expect(asbp.pages).toEqual(await json(join(expectedRoot!, 'pages.json')));
      expect(asbp.municipalText).toEqual(donor.tables.IV_text);
      for (const key of [
        'pdf_numeric_rows',
        'docx_numeric_rows',
        'identical_rows',
        'differing_rows',
        'docx_rows_without_pair',
      ] as const)
        expect(asbp.docx_check[key]).toEqual(donor.docx_check[key]);
      expect(asbp.docx_check.matches).toHaveLength(127);
      expect(asbp.docx_check.differing_rows).toHaveLength(9);
    });
    it('feeds the complete unchanged fiscal builders with actual ASBP evidence', async () => {
      const fixture = await loadFiscalFixture(join(fixtures, 'fiscal'));
      const before = buildFiscalDonor(fixture, '2026-11-08'),
        after = buildFiscalDonor({ ...fixture, ...asbpFiscalEvidence(asbp) }, '2026-11-08');
      expect(after).toEqual(before);
    });
    it('matches every NAP physical cell and the complete rates output', async () => {
      expect(nap.rows).toEqual(await json(join(expectedRoot!, 'nap.json')));
      expect(Object.keys(nap.rows)).toHaveLength(95);
      const r = join(fixtures, 'components-rates'),
        evidence: RatesEvidence = {
          doo: await json(join(r, 'inputs/doo-blocks.json')),
          nzok: await json(join(r, 'inputs/nzok-blocks.json')),
          bill: parseLegalDocx(sources.bill.bytes).blocks,
          nap: nap.rows,
        };
      expect(buildRates(evidence, '2026-11-08')).toEqual(await json(join(r, 'rates.json')));
      const changed = structuredClone(evidence);
      changed.nap['1.2.']!.cells[4] = '99';
      expect(() => buildRates(changed, '2026-11-08')).toThrow();
      delete changed.nap['1.2.'];
      expect(() => buildRates(changed, '2026-11-08')).toThrow(/missing/);
      expect(nap.physicalRows.every((r) => r.cells.length === 15 && r.boxes.length === 15)).toBe(
        true,
      );
    });
    it('matches the complete independent INDIRECT coefficients and complete builder output', async () => {
      const indirect = indirectInput();
      expect(readIndirectEvidence(sources as IndirectOriginals)).toEqual(
        await json(join(expectedRoot!, 'indirect-independent.json')),
      );
      expect(buildIndirectTaxes(indirect.input, '2026-11-10')).toEqual(
        await json(join(expectedRoot!, 'indirect-builder.json')),
      );
      expect(indirect.documents.nsi.page).toBe(231);
      expect(indirect.documents.nsi.yearHeaders).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    }, 240_000);
    it('fails finite corrupted actual sources, changed units, column labels and missing cells', () => {
      const indirect = indirectInput();
      const bad = Buffer.from(sources.nap.bytes);
      bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
      expect(() => readNapRows({ ...sources.nap, bytes: bad })).toThrow(/SHA-256/);
      const wrong = structuredClone(indirect.input);
      wrong.duties.C4 = '1000 kg';
      expect(() => buildIndirectTaxes(wrong, '2026-11-10')).toThrow(/units/);
      const missing = structuredClone(indirect.input);
      delete missing.prices.B5;
      expect(() => buildIndirectTaxes(missing, '2026-11-10')).toThrow(/decimal/);
      const label = structuredClone(indirect.input);
      label.prices.B1 = 'Dieselkraftstoff';
      expect(() => buildIndirectTaxes(label, '2026-11-10')).toThrow(/product/);
      const amount = structuredClone(indirect.input);
      amount.duties.C7 = '999';
      expect(() => buildIndirectTaxes(amount, '2026-11-10')).toThrow(/statutory/);
      expect(() =>
        readIndirectEvidence({ ...sources, nsi: undefined } as unknown as IndirectOriginals),
      ).toThrow(/Missing/);
      const emf = readFiscalZipMember(sources.bill.bytes, 'word/media/image19.emf');
      expect(readEmfTexts(emf).some((t) => t.text.includes('2026'))).toBe(true);
    });
    it('writes two complete deterministic new owned exports and rejects reuse before writing', async () => {
      const base = {
        sourceRoot: sourceRoot!,
        registryPath: join(sourceRoot!, 'data/sources.yaml'),
        pinsPath: join(sourceRoot!, 'data/originals.sha256'),
        readDate: '2026-11-10',
      };
      const first = join(temp, 'export1'),
        second = join(temp, 'export2');
      const receipt1 = await prepareFiscalDocuments({ ...base, out: first }),
        receipt2 = await prepareFiscalDocuments({ ...base, out: second });
      expect(receipt1).toEqual(receipt2);
      const names = (await readdir(first)).sort();
      expect(names).toEqual((await readdir(second)).sort());
      for (const name of names)
        expect(await readFile(join(first, name))).toEqual(await readFile(join(second, name)));
      await expect(prepareFiscalDocuments({ ...base, out: first })).rejects.toThrow(
        /new directory/,
      );
      for (const [key, source] of Object.entries(sources))
        expect(sha256(await readFile(join(sourceRoot!, paths[key as keyof typeof paths])))).toBe(
          source.sha256,
        );
      const absent = join(temp, 'missing-source');
      await mkdir(join(absent, 'data'), { recursive: true });
      for (const name of ['sources.yaml', 'originals.sha256'])
        await writeFile(
          join(absent, 'data', name),
          await readFile(join(sourceRoot!, 'data', name)),
        );
      const missingOut = join(temp, 'missing-output');
      await expect(
        prepareFiscalDocuments({
          ...base,
          sourceRoot: absent,
          registryPath: join(absent, 'data/sources.yaml'),
          pinsPath: join(absent, 'data/originals.sha256'),
          out: missingOut,
        }),
      ).rejects.toThrow();
      expect((await readdir(temp)).includes('missing-output')).toBe(false);
    }, 480_000);
  },
);
