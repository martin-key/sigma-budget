import { resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { loadWave13bFixture } from './wave13b-fixture.js';
import { runWave13b, wave13bStages } from './wave13b.js';
import { runGraph } from './graph.js';
import { compare } from '../parity/compare.js';
import { auditCatalogMetadata } from './catalog-metadata.js';
import {
  aggregationWording,
  aggregationActive,
  aggregationSourceGlue,
  glossarySourceGlue,
} from './aggregation-layers.js';
import { catalogWording, catalogActive } from './catalog-layers.js';
import { compareWave13b, loadWave13bReference } from './wave13b-parity.js';

const root = resolve(import.meta.dirname, '../../test/fixtures');
let result: ReturnType<typeof runWave13b>;
let fixture: Awaited<ReturnType<typeof loadWave13bFixture>>;
let reference: Awaited<ReturnType<typeof loadWave13bReference>>;
// Frozen graph setup exceeded the 10s hook limit with V8 coverage.
// Budget only this integration setup; all eight graph assertions remain.
beforeAll(async () => {
  fixture = await loadWave13bFixture(root);
  reference = await loadWave13bReference(root);
  result = runWave13b(fixture);
}, 30_000);
it('matches the independent Python source-glue result for a 64-term glossary', () => {
  const glossary = JSON.parse(Buffer.from(fixture.editorial.snapshots['glossary.json']).toString());
  glossary.terms = glossary.terms.slice(0, 64);
  glossary.categories = glossary.categories.filter(
    (row: { id: string }) => row.id !== 'byudzhet-2027',
  );
  const expected = JSON.parse(
    readFileSync(resolve(root, 'wave13b/mutants/glossary-glue.json'), 'utf8'),
  );
  expect(glossarySourceGlue(glossary, fixture.layers.sourceGlue.terms)).toEqual(expected);
});
it('reports frozen and unverified evidence separately from candidate metadata differences', () => {
  const streams = (result.outputs.get('publication-layers') as { streams: Map<string, Uint8Array> })
    .streams;
  const report = compareWave13b({
    streams,
    reference,
    registry: fixture.layers.registry,
    activeRoutes: fixture.layers.activeRoutes,
  });
  expect(report.outcome).toBe('unverified');
  expect(report.differences).toEqual([]);
  expect(report.byteDifferences).toEqual([]);
  expect(report.metadataValid).toBe(true);
  expect(report.artifacts.filter((a) => a.state === 'eligible')).toHaveLength(66);
  expect(report.artifacts.every((a) => Object.keys(a.sourceHashes).length > 0)).toBe(true);
  expect(
    Object.keys(
      report.artifacts.find((a) => a.file === 'indirect-tax-parameters.json')!.sourceHashes,
    ).filter((name) => name.startsWith('original:')),
  ).toHaveLength(6);
  expect(report.artifacts.filter((a) => a.state === 'frozen-only')).toHaveLength(3);
  expect(report.artifacts.filter((a) => a.state === 'unverified').map((a) => a.file)).toEqual([
    'gva-sectors.json',
  ]);
  expect(Buffer.from(streams.get('gva-sectors.json')!)).toEqual(
    Buffer.from(fixture.frozen.bytes['gva-sectors.json']),
  );
  const damaged = new Map(streams);
  damaged.delete('rates.json');
  damaged.set('ministries/stale.json', Buffer.from('{}'));
  const bad = compareWave13b({
    streams: damaged,
    reference,
    registry: fixture.layers.registry,
    activeRoutes: fixture.layers.activeRoutes,
  });
  expect(bad.outcome).toBe('fail');
  expect(bad.missing).toEqual(['rates.json']);
  expect(bad.unexpected).toEqual(['ministries/stale.json']);
});
it('computes catalog metadata from candidate bytes', () => {
  const streams = (result.outputs.get('publication-layers') as { streams: Map<string, Uint8Array> })
    .streams;
  const audit = auditCatalogMetadata({
    catalogBytes: streams.get('catalog.json')!,
    ownerBytes: streams,
    registry: fixture.layers.registry,
    activeRoutes: fixture.layers.activeRoutes,
  });
  expect(audit.reported).toEqual(audit.computed);
});
it('runs the integrated dataset stages without omitted producers', () => {
  expect(result.states.filter((state) => state.status !== 'success')).toEqual([]);
  const output = result.outputs.get('publication-layers') as { streams: Map<string, Uint8Array> };
  expect(output.streams.size).toBe(70);
  const guide = JSON.parse(Buffer.from(output.streams.get('guide.json')!).toString());
  expect(guide.steps.find((step: any) => step.screen.id === 'S12').screen.label).toBe(
    'Мерки в бюджета',
  );
});
it('runs the wrapper layers in the declared order and they are idempotent', () => {
  const order = result.states.map((state) => state.id);
  expect(order.slice(-5)).toEqual([
    'wording',
    'active-data',
    'source-glue',
    'catalog-refresh',
    'publication-layers',
  ]);
  const words = result.outputs.get('wording') as any;
  const active = result.outputs.get('active-data') as any;
  const glue = result.outputs.get('source-glue') as any;
  expect(aggregationWording(words.aggregation, fixture.layers.wording)).toEqual(words.aggregation);
  expect(catalogWording(words.catalog, fixture.layers.wording['catalog.json']!)).toEqual(
    words.catalog,
  );
  expect(aggregationActive(active.aggregation)).toEqual(active.aggregation);
  expect(catalogActive(active.catalog)).toEqual(active.catalog);
  expect(aggregationSourceGlue(glue.aggregation, fixture.layers.sourceGlue)).toEqual(
    glue.aggregation,
  );
});
it('propagates changed measure input into search using fresh stage results', () => {
  const changed = {
    ...fixture,
    fiscal: {
      ...fixture.fiscal,
      fiscal: {
        ...fixture.fiscal.fiscal,
        measures: structuredClone(fixture.fiscal.fiscal.measures),
      },
    },
  };
  changed.fiscal.fiscal.measures.intro.revenue[0]!.what += ' Променено описание.';
  const rerun = new Set([
    'measures',
    'core',
    'search',
    'catalog',
    'dataset-complete',
    'wording',
    'active-data',
    'source-glue',
    'catalog-refresh',
    'publication-layers',
  ]);
  const stages = wave13bStages(changed).map((stage) =>
    rerun.has(stage.id) ? stage : { ...stage, run: () => result.outputs.get(stage.id) },
  );
  const update = runGraph(stages);
  expect(update.states.filter((s) => s.status !== 'success')).toEqual([]);
  expect(update.outputs.get('measures')).not.toEqual(result.outputs.get('measures'));
  expect(update.outputs.get('search')).not.toEqual(result.outputs.get('search'));
});
it('reports a failed producer and skips its dependants while independent stages complete', () => {
  const changed = {
    ...fixture,
    indirectTaxes: {
      ...fixture.indirectTaxes,
      prices: { ...fixture.indirectTaxes.prices, A1: 'USD' },
    },
  };
  const rerun = new Set([
    'indirect-taxes',
    'search',
    'catalog',
    'dataset-complete',
    'wording',
    'active-data',
    'source-glue',
    'catalog-refresh',
    'publication-layers',
  ]);
  const stages = wave13bStages(changed).map((stage) =>
    rerun.has(stage.id) ? stage : { ...stage, run: () => result.outputs.get(stage.id) },
  );
  const update = runGraph(stages);
  expect(update.states.find((s) => s.id === 'indirect-taxes')?.status).toBe('failed');
  expect(update.states.find((s) => s.id === 'rates')?.status).toBe('success');
  expect(update.states.find((s) => s.id === 'search')?.status).toBe('success');
  expect(update.states.find((s) => s.id === 'catalog')?.status).toBe('success');
  expect(update.states.find((s) => s.id === 'dataset-complete')).toEqual({
    id: 'dataset-complete',
    status: 'skipped',
    blockedBy: ['indirect-taxes'],
  });
  expect(update.outputs.has('publication-layers')).toBe(false);
});
it('compares the complete output inventory and JSON with the independent graph', () => {
  const streams = (result.outputs.get('publication-layers') as { streams: Map<string, Uint8Array> })
    .streams;
  const oracle = resolve(root, 'wave13b/oracle');
  const walk = (base: string, prefix = ''): string[] =>
    readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? walk(resolve(base, entry.name), name) : [name];
    });
  const files = walk(oracle).sort();
  expect([...streams.keys()].sort()).toEqual(files);
  const diffs = files.flatMap((file) => {
    const expected = readFileSync(resolve(oracle, file));
    const actual = Buffer.from(streams.get(file)!);
    if (file.endsWith('.xml')) return expected.equals(actual) ? [] : [`${file}: bytes differ`];
    return compare(JSON.parse(expected.toString()), JSON.parse(actual.toString()), {
      dataset: file,
      file,
    })
      .filter(
        (difference) =>
          file !== 'catalog.json' ||
          !/\/datasets\/\d+\/(?:bytes|gzipBytes|parts\/\d+\/(?:bytes|gzipBytes))$/.test(
            difference.pointer,
          ),
      )
      .map(
        (difference) =>
          `${file}:${difference.pointer}: ${JSON.stringify(difference.expected)} != ${JSON.stringify(difference.actual)}`,
      );
  });
  expect(diffs.slice(0, 30)).toEqual([]);
});
