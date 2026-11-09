import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { catalogUrlName, primaryFiles, type CatalogPrimaryInput } from './catalog-primary.js';
const python = process.env.PYTHON312 ?? 'python3';
const a = 'a'.repeat(64),
  b = 'b'.repeat(64),
  c = 'c'.repeat(64);
function input(): CatalogPrimaryInput {
  return {
    manifest: {
      'nap/test': {
        url: 'https://example.test/%D0%B0%20b.pdf?q=x',
        http_status: 200,
        sha256: a,
        bytes: 4,
        retrieved: '2026-11-08T12:00',
      },
    },
    manifestFiles: [['nap/test', 'title', ['nap'], ['rates']]],
    rawFacts: new Map([['nap/test', { bytes: 4 }]]),
    cacheFacts: new Map(),
    sebraBase: 'https://example.test/',
    sebraCache: [],
    historicalGva: [],
    kfpPage: 'https://example.test/page',
    execution: { data: { '2026': { files: [{ file: 'month.xls', month: 1, sha256: b }] } } },
  };
}
it('matches Python URL decoding including Unicode, invalid bytes, escaped slash and queries', () => {
  const urls = [
    'https://x/%D0%B0%20b.pdf?q=%20',
    'https://x/a%2Fb',
    'https://x/%ff%ZZ',
    'https://x/кирилица+test?q=1',
  ];
  const code =
    "import sys,json,urllib.parse; print(json.dumps([urllib.parse.unquote(u.split('?')[0].rsplit('/',1)[-1]) for u in json.load(sys.stdin)]))";
  expect(urls.map(catalogUrlName)).toEqual(
    JSON.parse(
      execFileSync(python, ['-c', code], { input: JSON.stringify(urls), encoding: 'utf8' }),
    ),
  );
});
it('uses observed size, omits absent optional KFP bytes, rejects corrupt manifests and duplicate hashes', () => {
  const x = input();
  expect(primaryFiles(x)).toMatchObject([{ name: 'а b.pdf', bytes: 4 }, { name: 'month.xls' }]);
  expect(primaryFiles(x)[1]).not.toHaveProperty('bytes');
  x.rawFacts = new Map([['nap/test', { bytes: 5 }]]);
  expect(() => primaryFiles(x)).toThrow(/size/);
  x.rawFacts = new Map([
    ['nap/test', { bytes: 4 }],
    ['kfp_2026/month.xls', { bytes: 12 }],
  ]);
  expect(primaryFiles(x)[1]).toMatchObject({ bytes: 12 });
  x.manifest['nap/test']!.http_status = 403;
  expect(() => primaryFiles(x)).toThrow(/manifest/);
  x.manifest['nap/test']!.http_status = 200;
  x.execution.data['2026']!.files[0]!.sha256 = a;
  expect(() => primaryFiles(x)).toThrow(/checksum/);
  x.execution.data['2026']!.files[0]!.sha256 = b;
  x.rawFacts = new Map([
    ['nap/test', { bytes: 4 }],
    ['asbp/UMTBF-2026-2028-motivi.pdf', { bytes: 9, sha256: c }],
  ]);
  expect(primaryFiles(x).find((row) => row.source.includes('asbp'))).toMatchObject({
    bytes: 9,
    sha256: c,
  });
});
it('matches the unchanged Python donor over a real synthetic filesystem', () => {
  const script = new URL('../../test/fixtures/catalog/synthetic_primary.py', import.meta.url);
  const sample = JSON.parse(
    execFileSync(python, [script.pathname], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }),
  );
  const actual = primaryFiles({
    ...sample,
    rawFacts: new Map(Object.entries(sample.rawFacts)),
    cacheFacts: new Map(Object.entries(sample.cacheFacts)),
  });
  expect(actual).toEqual(sample.expected);
});
