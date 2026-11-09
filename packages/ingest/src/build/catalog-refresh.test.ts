import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  catalogCounts,
  catalogGzipSize,
  catalogSchema,
  refreshCatalog,
  type CatalogDocument,
} from './catalog-refresh.js';

const python = process.env.PYTHON312 ?? 'python3';
const enc = (text: string) => Buffer.from(text);

describe('catalog refresh', () => {
  it('matches Python 3.12 gzip across length and compression boundaries', () => {
    const samples = [
      Buffer.alloc(0),
      enc('abc'),
      enc('тест '.repeat(1000)),
      Buffer.from(Array.from({ length: 65537 }, (_, i) => (i * 73 + (i >> 7)) & 255)),
    ];
    const code =
      'import sys,gzip,json,base64; assert sys.version_info[:2] == (3, 12); print(json.dumps([len(gzip.compress(base64.b64decode(s),9,mtime=0)) for s in json.load(sys.stdin)]))';
    const expected = JSON.parse(
      execFileSync(python, ['-c', code], {
        input: JSON.stringify(samples.map((b) => b.toString('base64'))),
        encoding: 'utf8',
      }),
    ) as number[];
    expect(samples.map(catalogGzipSize)).toEqual(expected);
  });
  it('preserves source key order and rejects malformed, non-finite and invalid UTF-8', () => {
    expect(catalogSchema(enc('{"2":[],"1":{},"meta":{"source":["a"]},"z":true}'))).toEqual({
      schema: [
        { key: '2', type: 'array', length: 0 },
        { key: '1', type: 'object', length: 0 },
        { key: 'z', type: 'boolean' },
      ],
      source: ['a'],
    });
    for (const s of ['{', '{"x":1e999}', '{"x":NaN}', '{"meta":{"source":[1]}}'])
      expect(() => catalogSchema(enc(s))).toThrow();
    expect(() => catalogSchema(Uint8Array.from([0xff]))).toThrow();
  });
  it('refreshes actual part sizes, sources, schemas, screens and counts without mutating its input', () => {
    const cat: CatalogDocument = {
      files: [{}],
      counts: {},
      datasets: [
        {
          id: 'D01',
          slug: 'a',
          status: 'real',
          source: ['old'],
          screens: ['old'],
          file: 'data/a.json',
          format: 'JSON',
          bytes: 0,
          gzipBytes: 0,
        },
        {
          id: 'D02',
          slug: 'parts',
          status: 'real',
          source: [],
          screens: [],
          parts: [
            { code: 'x', file: 'data/ministries/x.json', bytes: 0, gzipBytes: 0 },
            { code: 'y', file: 'data/ministries/y.json', bytes: 0, gzipBytes: 0 },
          ],
        },
        { id: 'P01', slug: 'p01', status: 'pending', source: [], screens: [] },
      ],
    };
    const a = enc('{"x":[],"meta":{"source":["new"]}}'),
      x = enc('a'.repeat(60)),
      y = enc('b'.repeat(70));
    const result = refreshCatalog({
      catalog: cat,
      ownerBytes: new Map([
        ['a.json', a],
        ['ministries/x.json', x],
        ['ministries/y.json', y],
      ]),
      registry: [{ id: 'a', screens: ['S02', 'S01', 'S03'] }],
      activeRoutes: ['S01', 'S02'],
    });
    expect(result.catalog.datasets[0]).toMatchObject({
      bytes: a.length,
      gzipBytes: catalogGzipSize(a),
      source: ['new'],
      screens: ['S02', 'S01'],
      schema: [{ key: 'x', type: 'array', length: 0 }],
    });
    expect(result.catalog.datasets[1]).toMatchObject({
      bytes: x.length + y.length,
      gzipBytes: catalogGzipSize(x) + catalogGzipSize(y),
    });
    expect(result.catalog.counts).toEqual({
      datasets: 3,
      files: 3,
      real: 2,
      mock: 0,
      pending: 1,
      primarySources: 1,
    });
    expect(cat.datasets[0]!.bytes).toBe(0);
    expect(() =>
      refreshCatalog({ catalog: cat, ownerBytes: new Map(), registry: [], activeRoutes: [] }),
    ).toThrow(/Missing owner/);
  });
});
it('rejects missing runtime fields and values that JSON would silently omit', () => {
  const base: CatalogDocument = {
    files: [],
    counts: {},
    datasets: [{ id: 'P01', slug: 'p01', status: 'pending', source: [], screens: [] }],
  };
  const input = {
    catalog: base,
    ownerBytes: new Map<string, Uint8Array>(),
    registry: [],
    activeRoutes: [],
  };
  expect(() => refreshCatalog({ ...input, catalog: { ...base, extra: undefined } })).toThrow(
    /Invalid JSON/,
  );
  const broken = structuredClone(base) as any;
  delete broken.datasets[0].status;
  expect(() => refreshCatalog({ ...input, catalog: broken })).toThrow(/Invalid catalog entry/);
  expect(() => refreshCatalog({ ...input, catalog: { ...base, extra: Infinity } })).toThrow(
    /non-finite/,
  );
});

it('distinguishes an empty parts list in build and refresh counting', () => {
  const cat: CatalogDocument = {
    files: [],
    counts: {},
    datasets: [
      {
        id: 'D01',
        slug: 'test',
        status: 'real',
        source: [],
        screens: [],
        file: 'data/test.json',
        parts: [],
      },
    ],
  };
  expect(catalogCounts(cat, true).files).toBe(0);
  expect(catalogCounts(cat).files).toBe(1);
});
