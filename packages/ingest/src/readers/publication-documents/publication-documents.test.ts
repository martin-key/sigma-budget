import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32 } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { bgNumber, fold, extractLawBillBlocks } from './legal.js';
import { consistent, programmeCells, resolveProgrammeStructure } from './programme-cells.js';
import type { ProgrammeRow } from './programme-tokens.js';
import { archivePath, programmeZip, readProgrammeSevenZip } from './archive.js';
import {
  assertFreshPublication,
  publicationOutputPreflight,
  preparePublicationDocuments,
} from './prepare.js';
import { readPdf } from '../pdf/index.js';
import { programme2027Unavailable } from './programmes.js';

function zip(entries: { name: string; data: string; mode?: number }[]): Buffer {
  const parts: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const n = Buffer.from(e.name),
      b = Buffer.from(e.data),
      l = Buffer.alloc(30),
      c = Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(0x800, 6);
    l.writeUInt32LE(crc32(b), 14);
    l.writeUInt32LE(b.length, 18);
    l.writeUInt32LE(b.length, 22);
    l.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc32(b), 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(((e.mode ?? 0x8000) << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    parts.push(l, n, b);
    central.push(c, n);
    offset += 30 + n.length + b.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
describe('publication source safety', () => {
  it('retains monetary null/zero/sign and rejects malformed cells', () => {
    expect(bgNumber('–')).toBeNull();
    expect(bgNumber('0')).toBe(0);
    expect(bgNumber('−7 350 531,5')).toBe(-7350531.5);
    expect(() => bgNumber('1.000')).toThrow();
    expect(fold('ПOЛИTИКА 7.1')).toBe('ПОЛИТИКА 7.1');
    expect(() => extractLawBillBlocks([['p', 'Чл. 1.']], [])).toThrow();
  });
  it('requires actual PDF bytes and a complete legal document', () => {
    expect(() => readPdf(Buffer.from('not a PDF'))).toThrow(/header/);
    expect(() => readPdf(Buffer.from('%PDF-corrupt'))).toThrow();
    expect(programme2027Unavailable.status).toBe('unavailable');
    expect(programme2027Unavailable).not.toHaveProperty('allocations');
  });
  it('does not invent nine-column placements for inconsistent rows', () => {
    const row: ProgrammeRow = {
      label: 'Проект 2026',
      code: '1000.01.00',
      page: 1,
      tokens: [10, 8, 2, 9, 7, 2, 4, 1, 1],
      x1: [],
      x0: [],
      hdr: null,
      hdr_own: false,
    };
    const { cells } = programmeCells([row]);
    expect([...cells.values()][0]!.cell.values).toBeNull();
    expect(consistent(row.tokens)).toBe(false);
    expect(resolveProgrammeStructure(cells)).toBe(0);
    row.tokens = [10, 8, 2, 9, 7, 2, 1, 1, 0];
    const good = programmeCells([row]);
    expect([...good.cells.values()][0]!.cell.values).toEqual(row.tokens);
  });
  it('checks ZIP local/central headers, aliases, links, expansion and CRC', () => {
    expect(
      programmeZip(zip([{ name: '0100_НС.pdf', data: 'bytes' }]))[0]!
        .read()
        .toString(),
    ).toBe('bytes');
    for (const name of ['../escape', '/absolute', 'C:/drive', 'a//b', 'a\\b'])
      expect(() => archivePath(name)).toThrow();
    expect(() =>
      programmeZip(
        zip([
          { name: 'x', data: 'a' },
          { name: 'X', data: 'b' },
        ]),
      ),
    ).toThrow(/alias/);
    expect(() => programmeZip(zip([{ name: 'x', data: 'a', mode: 0xa000 }]))).toThrow(/link/);
    const bad = zip([{ name: 'x', data: 'a' }]);
    bad[31] = 98;
    expect(() => programmeZip(bad)[0]!.read()).toThrow(/CRC/);
    const bomb = zip([{ name: 'x', data: 'a' }]);
    const cd = 32;
    bomb.writeUInt32LE(40 * 1024 * 1024, cd + 24);
    expect(() => programmeZip(bomb)).toThrow(/expansion/);
  });
  it('terminates a bounded 7z worker on failure', async () => {
    await expect(
      readProgrammeSevenZip(Buffer.from('corrupt'), {
        wasmModule: '/nonexistent/7z-wasm',
        timeoutMs: 1,
      }),
    ).rejects.toThrow();
  });
  it('rejects any stale amount, year, quote, null or physical row order', () => {
    const expected = {
      rows: [
        ['01', 0],
        ['02', null],
      ],
      year: 2027,
      quote: 'original',
    };
    expect(() =>
      assertFreshPublication(Buffer.from(JSON.stringify(expected)), expected, 'test'),
    ).not.toThrow();
    for (const v of [
      { ...expected, year: 2026 },
      { ...expected, quote: 'changed' },
      {
        ...expected,
        rows: [
          ['01', 1],
          ['02', null],
        ],
      },
      {
        ...expected,
        rows: [
          ['01', 0],
          ['02', 0],
        ],
      },
      { ...expected, rows: expected.rows.slice().reverse() },
    ])
      expect(() =>
        assertFreshPublication(Buffer.from(JSON.stringify(v)), expected, 'test'),
      ).toThrow(/Stale/);
  });
  it('preflights all output aliases before writing and preserves stale bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'publication-safety-'));
    try {
      const input = join(root, 'input'),
        out = join(root, 'out'),
        registry = join(root, 'registry.yaml'),
        pins = join(root, 'pins');
      await mkdir(input);
      await writeFile(registry, 'schema: 1\nsources: []\n');
      await writeFile(pins, '');
      const opts = {
        inputRoot: input,
        registryPath: registry,
        pinsPath: pins,
        out,
        readDate: '2026-11-10',
        roles: ['law' as const],
      };
      await expect(
        publicationOutputPreflight({ ...opts, out: input }, ['data/cache/law_bill.json']),
      ).rejects.toThrow(/overlaps/);
      await expect(
        publicationOutputPreflight({ ...opts, out: root }, ['data/cache/law_bill.json']),
      ).rejects.toThrow(/overlaps/);
      await expect(publicationOutputPreflight(opts, ['a', 'A'])).rejects.toThrow(/alias/);
      await mkdir(out);
      await symlink(registry, join(out, 'alias'));
      await expect(publicationOutputPreflight(opts, ['alias'])).rejects.toThrow(/Unsafe|Symlink/);
      await link(registry, join(out, 'hard'));
      await expect(publicationOutputPreflight(opts, ['hard'])).rejects.toThrow(/Hardlinked/);
      await rm(join(out, 'hard'));
      await writeFile(join(out, 'stale'), 'sentinel');
      await expect(preparePublicationDocuments(opts)).rejects.toThrow(/registered/);
      expect(await readFile(join(out, 'stale'), 'utf8')).toBe('sentinel');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
