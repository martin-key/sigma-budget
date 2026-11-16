import { SearchRows } from '../build/aggregation-search.js';
import { releaseSchema } from '@sigma-budget/dataset-schema';
import { buildMeasures2027 } from '../build/measures.js';
import { catalogCounts, refreshCatalog } from '../build/catalog-refresh.js';
import { readProductionProgrammes, withProductionProgrammes } from './programmes.js';
import { readDebtIssues, registerDebtCatalog } from './debt-issues.js';
import { mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { runGraph } from '../build/graph.js';
import { wave13bStages } from '../build/wave13b.js';
import type { ExecutionContext, ExecutorResult } from '../release-build/types.js';
import { reviseLaunchTexts, reviseProgrammeSources } from './launch-texts.js';
import { loadProduction } from './loader.js';
import { readTaxDatasets, withProductionBudgets, registerTaxCatalog } from './taxes.js';
import { validateProduction } from './validation.js';
/** This is the committed entry loaded by the offline exported-code compiler. */
export async function executeRelease(context: Readonly<ExecutionContext>): Promise<ExecutorResult> {
  if (context.missingIntermediates?.length) {
    const view = join(context.scratchRoot, 'prepared-inputs');
    await cp(context.exportRoot, view, { recursive: true, errorOnExist: true, force: false });
    context = Object.freeze({ ...context, preparedInputRoot: view });
  }
  const prepared = await loadProduction(context);
  const generatedIntermediates = await Promise.all(
    (context.missingIntermediates ?? []).map(async (i) => {
      const b = await readFile(join(context.preparedInputRoot!, i.path));
      return {
        path: i.path,
        bytes: b.length,
        sha256: createHash('sha256').update(b).digest('hex'),
        mime: i.path.endsWith('.pdf')
          ? 'application/pdf'
          : i.path.endsWith('.7z')
            ? 'application/x-7z-compressed'
            : i.path.endsWith('.zip')
              ? 'application/zip'
              : 'application/json',
        kind: 'generated-intermediate',
        datasets: i.datasets,
      };
    }),
  );
  context = Object.freeze({ ...context, generatedIntermediates });
  registerTaxCatalog(prepared.input, context);
  registerDebtCatalog(prepared.input, context);
  prepared.input.core.sources = reviseProgrammeSources(
    prepared.input.core.sources,
  ) as typeof prepared.input.core.sources;
  const graph = runGraph(
    withProductionBudgets(
      withProductionProgrammes(
        reviseLaunchTexts(wave13bStages(prepared.input)),
        readProductionProgrammes(context),
      ),
      {
        ...readTaxDatasets(context),
        'debt-issues.json': readDebtIssues(context),
      },
    ),
  );
  const failed = graph.states.filter((s) => s.status !== 'success');
  if (failed.length) throw new Error('Production graph failed: ' + JSON.stringify(failed));
  const publication = graph.outputs.get('publication-layers') as {
    streams: Map<string, Uint8Array>;
  };
  if (!publication?.streams.size) throw new Error('Production graph did not publish outputs');
  const texts = JSON.parse(
    await readFile(join(context.exportRoot, 'data/inputs/measures_2027.json'), 'utf8'),
  );
  const budget = JSON.parse(Buffer.from(publication.streams.get('budget2027.json')!).toString());
  const measures = buildMeasures2027(texts, budget, context.buildDate);
  publication.streams.set('measures2027.json', Buffer.from(JSON.stringify(measures) + '\n'));
  const catalog = JSON.parse(Buffer.from(publication.streams.get('catalog.json')!).toString());
  catalog.datasets.push({
    id: 'D39',
    slug: 'measures2027',
    title: measures.meta.title,
    description: 'Текстове на мерките от АСБП 2027–2029',
    group: 'budget',
    status: 'real',
    eager: false,
    contains: ['D39'],
    mock: false,
    asOf: '2026-11-06',
    mediaType: 'application/json',
    source: ['budget2027'],
    file: 'data/measures2027.json',
    format: 'JSON',
    period: '2027–2029',
  });
  publication.streams.set('catalog.json', Buffer.from(JSON.stringify(catalog) + '\n'));
  const schema = {
    ...releaseSchema(),
    meta: {
      ...measures.meta,
      id: 'D40',
      source: ['wg'],
      asOf: context.buildDate,
      title: 'JSON Schema на изданието',
      unit: 'JSON Schema',
      sourceNote: 'Генерирано от guards в packages/dataset-schema, JSON Schema draft 2020-12.',
    },
  };
  publication.streams.set('schema.json', Buffer.from(JSON.stringify(schema) + '\n'));
  catalog.datasets.push({
    id: 'D40',
    slug: 'schema',
    title: 'JSON Schema на изданието',
    description: 'Договори на публикуваните JSON файлове',
    group: 'service',
    status: 'real',
    eager: false,
    contains: ['D40'],
    mock: false,
    asOf: schema.meta.asOf,
    source: schema.meta.source,
    file: 'data/schema.json',
    format: 'JSON',
    mediaType: 'application/json',
  });
  publication.streams.set('catalog.json', Buffer.from(JSON.stringify(catalog) + '\n'));
  // The catalogue's new owners are also discoverable through the dataset search group.
  const search = JSON.parse(Buffer.from(publication.streams.get('search-index.json')!).toString());
  const addedRows = new SearchRows();
  for (const slug of ['measures2027', 'schema']) {
    const d = catalog.datasets.find((d: any) => d.slug === slug);
    const group = catalog.groups.find((g: any) => g.id === d.group).label;
    addedRows.add(
      'datasets',
      d.title,
      `${group} · ${prepared.input.search.authored.searchKeywords.status.real}`,
      '',
      '',
      'real',
      `#/danni/${slug}`,
      `${slug.replaceAll('-', ' ')} ${d.id} ${d.file.split('/').at(-1)}`,
    );
  }
  search.items.push(...addedRows.rows);
  publication.streams.set('search-index.json', Buffer.from(JSON.stringify(search) + '\n'));
  const refreshed = refreshCatalog({
    catalog,
    ownerBytes: publication.streams,
    registry: prepared.input.layers.registry,
  }).catalog;
  publication.streams.set('catalog.json', Buffer.from(JSON.stringify(refreshed) + '\n'));
  for (const [path, bytes] of publication.streams) {
    if (path.startsWith('releases/'))
      throw new Error('Lifecycle metadata must not be produced by the graph');
    const destination = join(context.candidateRoot, 'data', path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  const validation = validateProduction(context, prepared);
  const { parse } = await import('yaml');
  const registry = parse(
    (await readFile(join(context.exportRoot, 'data/datasets.yaml'))).toString(),
  );
  return {
    validation,
    ...(generatedIntermediates.length ? { generatedIntermediates } : {}),
    datasets: registry.datasets
      .filter((d: any) => d.status !== 'pending' && d.id !== 'releases')
      .map((d: any) => ({
        id: d.id,
        action: d.id === 'gva-sectors' ? 'preserved-input' : 'built',
      })),
    extractions: [
      ...prepared.extractions,
      { schema: 'production-graph/1', stages: graph.states, rawReconstruction: 'unverified' },
    ],
  };
}
