import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { loadWave13bFixture } from './wave13b-fixture.js';
import { runWave13b, wave13bStages } from './wave13b.js';
import { runGraph } from './graph.js';
import { auditCatalogMetadata } from './catalog-metadata.js';
import {
  aggregationWording,
  aggregationActive,
  aggregationSourceGlue,
} from './aggregation-layers.js';
import { catalogWording, catalogActive } from './catalog-layers.js';

const root = resolve(import.meta.dirname, '../../test/fixtures');
let result: ReturnType<typeof runWave13b>;
let fixture: Awaited<ReturnType<typeof loadWave13bFixture>>;

// Frozen graph setup exceeded the 10s hook limit with V8 coverage.
// Budget only this integration setup.
beforeAll(async () => {
  fixture = await loadWave13bFixture(root);
  result = runWave13b(fixture);
}, 30_000);
it('computes catalog metadata from candidate bytes', () => {
  const streams = (result.outputs.get('publication-layers') as { streams: Map<string, Uint8Array> })
    .streams;
  const audit = auditCatalogMetadata({
    catalogBytes: streams.get('catalog.json')!,
    ownerBytes: streams,
    registry: fixture.layers.registry,
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
