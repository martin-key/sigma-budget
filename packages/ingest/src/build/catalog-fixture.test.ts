import { scopeAnnualCatalogTraps } from './catalog-editorial.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import { loadCatalogFixture } from './catalog-fixture.js';
import { buildCatalog } from './catalog-build.js';
import { parsePythonJson } from '../common/numbers.js';
const dir = fileURLToPath(new URL('../../test/fixtures/catalog/', import.meta.url));
// Reuse the pinned baseline; mutation cases copy the maps or objects they alter.
let fixtureBase: Awaited<ReturnType<typeof loadCatalogFixture>>;
beforeAll(async () => {
  fixtureBase = await loadCatalogFixture(dir, '2026-11-08');
});
it('matches independent raw, refreshed and published Python catalogs', async () => {
  const actual = fixtureBase;
  const oracle = async (name: string) =>
    JSON.parse(await readFile(`${dir}/oracle/${name}.json`, 'utf8'));
  expect(actual.raw).toEqual(await oracle('raw'));
  expect(JSON.stringify(actual.raw)).toBe(
    (await readFile(`${dir}/oracle/raw.json`, 'utf8')).trimEnd(),
  );
  expect(actual.projected).toEqual(await oracle('final'));
  expect(JSON.stringify(actual.projected)).toBe(await readFile(`${dir}/oracle/final.json`, 'utf8'));
  expect(actual.projected).toEqual(await oracle('published'));
});

it.each(['revenue', 'law'])('matches the %s donor mutation', async (name) => {
  const fixture = fixtureBase;
  const bytes = await readFile(`${dir}/cases/inputs/${name}.json`);
  const out = new Map(fixture.buildInput.out);
  out.set(`${name}.json`, { bytes, object: parsePythonJson(bytes.toString('utf8')) });
  const actual = buildCatalog({ ...fixture.buildInput, out }).catalog;
  expect(actual).toEqual(JSON.parse(await readFile(`${dir}/cases/oracle/${name}.json`, 'utf8')));
});
it('rejects missing or unexpected ministry owners', () => {
  const fixture = fixtureBase;
  const missing = new Map(fixture.buildInput.out);
  missing.delete(fixture.buildInput.expectedMinistryFiles[0]!);
  expect(() => buildCatalog({ ...fixture.buildInput, out: missing })).toThrow(/ministry file set/);
  const extra = new Map(fixture.buildInput.out);
  extra.set('ministries/unexpected.json', extra.get(fixture.buildInput.expectedMinistryFiles[0]!)!);
  expect(() => buildCatalog({ ...fixture.buildInput, out: extra })).toThrow(/ministry file set/);
});
it('refreshes stale derived metadata from the candidate streams and registry', async () => {
  const { refreshCatalog } = await import('./catalog-refresh.js');
  const state = fixtureBase,
    cat = structuredClone(state.projected);
  const d = cat.datasets.find((x) => x.slug === 'revenue')!;
  d.bytes = 1;
  d.gzipBytes = 2;
  d.schema = [];
  d.source = ['wrong'];
  d.screens = ['S99'];
  cat.counts.files = 1;
  const streams = new Map(state.ownerBytes);
  streams.set('catalog.json', Buffer.from(JSON.stringify(cat)));
  const result = refreshCatalog({
    catalog: cat,
    ownerBytes: streams,
    registry: state.registry,
    activeRoutes: state.activeRoutes,
  });
  const expected = state.projected.datasets.find((x) => x.slug === 'revenue')!;
  expect(result.catalog.datasets.find((x) => x.slug === 'revenue')).toEqual(expected);
  expect(result.catalog.counts).toEqual(state.projected.counts);
  const altered = state.registry.map((x) =>
    x.id === 'revenue' ? { ...x, screens: ['S19', 'S04', 'S99'] } : x,
  );
  const changed = refreshCatalog({
    catalog: state.projected,
    ownerBytes: streams,
    registry: altered,
    activeRoutes: ['S04', 'S19'],
  });
  expect(changed.catalog.datasets.find((x) => x.slug === 'revenue')!.screens).toEqual([
    'S19',
    'S04',
  ]);
});

it('shares the aggregation authored catalog definitions', async () => {
  const catalog = JSON.parse(await readFile(`${dir}/inputs/authored.json`, 'utf8'));
  const aggregation = JSON.parse(
    await readFile(
      new URL('../../test/fixtures/aggregation/authored.json', import.meta.url),
      'utf8',
    ),
  );
  expect(catalog.catalogDefinitions).toEqual(aggregation.catalogDefinitions);
  expect(catalog.catalogGroups).toEqual(aggregation.catalogGroups);
});

it.each(['int', 'float', 'exp', 'negative0', 'bool', 'yearfloat', 'yearexp'])(
  'preserves donor numeric display for %s',
  async (name) => {
    const source = await readFile(`${dir}/cases/inputs/${name}.json`),
      bytes = await readFile(`${dir}/cases/serialized/${name}.json`);
    const out = new Map(fixtureBase.buildInput.out);
    out.set(name.startsWith('year') ? 'revenue.json' : 'law.json', {
      bytes,
      object: parsePythonJson(source.toString('utf8')),
    });
    expect(buildCatalog({ ...fixtureBase.buildInput, out }).catalog).toEqual(
      JSON.parse(await readFile(`${dir}/cases/oracle/${name}.json`, 'utf8')),
    );
  },
);
it('rejects malformed metadata and preserves Python truth for empty collections', async () => {
  const state = fixtureBase;
  const replace = (name: string, object: Record<string, any>) => {
    const out = new Map(state.buildInput.out);
    out.set(name, { object, bytes: Buffer.from(JSON.stringify(object) + '\n') });
    return out;
  };
  const original = state.buildInput.out.get('outlook.json')!.object;
  const missing = structuredClone(original);
  delete missing.meta;
  expect(() =>
    buildCatalog({ ...state.buildInput, out: replace('outlook.json', missing) }),
  ).toThrow(/meta/);
  const invalid = structuredClone(original);
  invalid.meta.pending = 'P01';
  expect(() =>
    buildCatalog({ ...state.buildInput, out: replace('outlook.json', invalid) }),
  ).toThrow(/pending/);
  invalid.meta.pending = {};
  invalid.meta.mock = {};
  invalid.meta.unit = {};
  invalid.meta.source = {};
  const cat = buildCatalog({ ...state.buildInput, out: replace('outlook.json', invalid) }).catalog;
  const entry = cat.datasets.find((d) => d.slug === 'outlook')!;
  expect(entry.mock).toBe(false);
  expect(entry.source).toEqual([]);
  expect(entry).not.toHaveProperty('pending');
  expect(entry).not.toHaveProperty('unit');
});
it('metadata audit independently detects stale lengths, gzip, schema, sources, screens and counts', async () => {
  const { auditCatalogMetadata } = await import('./catalog-metadata.js');
  const cat = structuredClone(fixtureBase.projected),
    row = cat.datasets.find((d) => d.slug === 'revenue')!,
    multi = cat.datasets.find((d) => d.slug === 'ministries-programs')!;
  const reordered = cat.datasets.find((d) => d.slug === 'expenditure')!;
  reordered.source.reverse();
  row.bytes = 0;
  row.gzipBytes = 0;
  row.source = ['wrong'];
  row.screens = [];
  row.schema = [];
  multi.parts![0]!.bytes = 0;
  multi.schema = [];
  cat.counts.files = 0;
  const audit = auditCatalogMetadata({
    catalogBytes: Buffer.from(JSON.stringify(cat)),
    ownerBytes: fixtureBase.ownerBytes,
    registry: fixtureBase.registry,
    activeRoutes: fixtureBase.activeRoutes,
  });
  const r = audit.reported.datasets.find((d) => d.slug === 'revenue')!,
    c = audit.computed.datasets.find((d) => d.slug === 'revenue')!;
  expect(r.bytes).not.toEqual(c.bytes);
  expect(r.gzipBytes).not.toEqual(c.gzipBytes);
  expect(r.schema).not.toEqual(c.schema);
  expect(r.source).not.toEqual(c.source);
  expect(r.screens).not.toEqual(c.screens);
  expect(audit.reported.counts).not.toEqual(audit.computed.counts);
  expect(audit.reported.datasets.find((d) => d.slug === 'expenditure')!.source).not.toEqual(
    audit.computed.datasets.find((d) => d.slug === 'expenditure')!.source,
  );
  const m = audit.reported.datasets.find((d) => d.slug === 'ministries-programs')!,
    n = audit.computed.datasets.find((d) => d.slug === 'ministries-programs')!;
  expect(m.parts).not.toEqual(n.parts);
  expect(m.schema).not.toEqual(n.schema);
});
it('uses owner and text precedence, inherits RSS metadata, and notes missing disk fallbacks', () => {
  const state = fixtureBase,
    disk = new Map(state.buildInput.disk),
    texts = new Map(state.buildInput.texts);
  disk.set('outlook.json', Buffer.from('invalid disk fallback'));
  disk.set('feed.xml', Buffer.from('wrong feed'));
  disk.delete('glossary.json');
  const rss = Buffer.from('<rss/>');
  texts.set('feed.xml', rss);
  const result = buildCatalog({ ...state.buildInput, disk, texts });
  const entry = result.catalog.datasets.find((d) => d.slug === 'feed-rss')!;
  expect(entry.bytes).toBe(rss.length);
  expect(entry.source).toEqual(state.buildInput.out.get('feed.json')!.object.meta.source);
  expect(result.notes.join('\n')).toContain('glossary.json');
  expect(result.catalog.datasets.some((d) => d.slug === 'glossary')).toBe(false);
});

it('scopes the next annual catalogue to legacy arrays and the November byPeriod series', () => {
  const input = fixtureBase.buildInput;
  const catalog = buildCatalog({
    ...input,
    editorial: { ...input.editorial, traps: scopeAnnualCatalogTraps(input.editorial.traps) },
  }).catalog;
  const note = (catalog.traps as { id: string; text: string }[]).find(
    (t) => t.id === 'two-versions',
  )!;
  expect(note.text).toContain('само за старите масиви към проекта за 2026');
  expect(note.text).toContain('2026.expected е очаквано изпълнение');
  expect(note.text).toContain('2027.draft е проект');
  expect(note.text).toContain('2028.forecast и 2029.forecast са прогнози');
  expect(note.text).toContain('Приходите и икономическите разходни редове са от Приложение 3 (стр. 191–192)');
  expect(note.text).toContain('разходите по функции са от Табл. III-1 (стр. 73)');
});
