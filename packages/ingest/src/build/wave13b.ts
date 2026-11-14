import { fiscalStages, type FiscalGraphInput } from './fiscal-graph.js';
import { runGraph, type GraphStage } from './graph.js';
import { buildBudgets } from './budgets.js';
import type { ProgrammeEvidence } from './programmes.js';
import { buildDebt, type DebtInput } from './debt.js';
import { buildRates, type RatesEvidence } from './rates.js';
import { buildIndirectTaxes, type IndirectTaxReaderEvidence } from './indirect-taxes.js';
import {
  buildMunicipalities,
  type MunicipalityInput,
  type MunicipalityGeometryOptions,
} from './municipalities.js';
import { buildLaw } from './law.js';
import { buildComponents, type ComponentEvidence } from './components.js';
import { buildSebra, type SebraEvidence } from './sebra.js';
import {
  restoreEditorial,
  alignGuideLinks,
  type EditorialRoute,
  type GuideDataset,
} from './editorial.js';
import { buildBudgetPlan, type PlanInput, type PlanEditorial } from './dbp-gva.js';
import { buildFeed, type FeedInput } from './aggregation-feed.js';
import { buildCore, type CoreInput } from './aggregation-core.js';
import { buildSearch, type SearchInput } from './aggregation-search.js';
import {
  aggregationWording,
  aggregationActive,
  aggregationSourceGlue,
  glossarySourceGlue,
  type ScopeLayersInput,
} from './aggregation-layers.js';
import { buildCatalog, type CatalogBuildInput, type CatalogOwner } from './catalog-build.js';
import {
  catalogWording,
  catalogActive,
  catalogFinalRefresh,
  type CatalogProjectionInput,
} from './catalog-layers.js';
import { executionNumbers } from './context.js';

/** Inputs contain reader evidence and explicit frozen-only seeds, never stage output snapshots. */
export interface Wave13bInput {
  fiscal: FiscalGraphInput;
  programmes: ProgrammeEvidence;
  debt: Omit<DebtInput, 'execution'>;
  rates: RatesEvidence;
  indirectTaxes: IndirectTaxReaderEvidence;
  municipalities: MunicipalityInput;
  geometryOptions?: MunicipalityGeometryOptions;
  components: Omit<ComponentEvidence, 'law' | 'municipalities' | 'outlook' | 'execution'>;
  sebra: SebraEvidence;
  editorial: {
    snapshots: Record<'guide.json' | 'glossary.json', Uint8Array>;
    routes: EditorialRoute[];
  };
  plan: { figures: PlanInput; editorial: PlanEditorial; pdfSha256: string };
  frozen: {
    execution: unknown;
    executionProvenance: unknown;
    gva: unknown;
    releasesCurrent?: unknown;
    bytes: Record<'execution.json' | 'execution-provenance.json' | 'gva-sectors.json', Uint8Array> &
      Partial<Record<'releases/current.json', Uint8Array>>;
  };
  core: Omit<
    CoreInput,
    | 'buildDate'
    | 'outlook'
    | 'revenue'
    | 'expenditure'
    | 'measures'
    | 'execution'
    | 'ministries'
    | 'programs'
    | 'municipalities'
    | 'glossaryDataset'
  >;
  feed: Omit<
    FeedInput,
    'buildDate' | 'execution' | 'law' | 'rates' | 'debt' | 'expenditure' | 'sebra' | 'budget2027'
  >;
  search: Pick<SearchInput, 'authored' | 'billOrder'>;
  catalog: Omit<
    CatalogBuildInput,
    'out' | 'texts' | 'disk' | 'buildDate' | 'expectedMinistryFiles'
  >;
  layers: Pick<ScopeLayersInput, 'wording' | 'sourceGlue'> &
    Pick<CatalogProjectionInput, 'registry' | 'activeRoutes'>;
}

const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');
type Read = (id: string) => any;
/** Construct the real dataset graph. Law consumes raw legal evidence and the current ministry output. */
export function wave13bStages(input: Wave13bInput): GraphStage[] {
  const date = input.fiscal.buildDate;
  const fiscal = fiscalStages(input.fiscal);
  return [
    {
      id: 'frozen-inputs',
      requires: [],
      run: () => ({ ...input.frozen, numbers: executionNumbers(input.frozen.execution) }),
    },
    {
      id: 'editorial-restoration',
      requires: [],
      run: () =>
        restoreEditorial(input.editorial.snapshots, input.editorial.routes, {
          allowUnalignedGuide: true,
        }),
    },
    {
      id: 'guide-link-alignment',
      requires: ['editorial-restoration'],
      run: (read: Read) => {
        const restored = read('editorial-restoration');
        const guide = JSON.parse(Buffer.from(restored['guide.json']).toString()) as GuideDataset;
        return {
          glossary: JSON.parse(Buffer.from(restored['glossary.json']).toString()),
          guide: alignGuideLinks(guide, input.editorial.routes),
        };
      },
    },
    {
      id: 'editorial',
      requires: ['guide-link-alignment'],
      run: (read: Read) => read('guide-link-alignment'),
    },
    {
      id: 'budget-plan',
      requires: [],
      run: () => buildBudgetPlan(input.plan.figures, input.plan.editorial, input.plan.pdfSha256),
    },
    ...fiscal,
    { id: 'budgets', requires: [], run: () => buildBudgets(input.programmes, date) },
    {
      id: 'debt',
      requires: ['frozen-inputs'],
      run: (read: Read) =>
        buildDebt({ ...input.debt, execution: read('frozen-inputs').numbers }, date),
    },
    { id: 'rates', requires: [], run: () => buildRates(input.rates, date) },
    {
      id: 'indirect-taxes',
      requires: [],
      run: () => buildIndirectTaxes(input.indirectTaxes, date),
    },
    {
      id: 'municipalities',
      requires: [],
      run: () => buildMunicipalities(input.municipalities, date, input.geometryOptions),
    },
    {
      id: 'law',
      requires: [],
      optional: ['budget-2027', 'budgets'],
      run: (read: Read) => {
        const budget = read('budget-2027'),
          ministries = read('budgets');
        return buildLaw(
          { ...input.fiscal.law, ministries: ministries?.['ministries.json'] ?? null },
          date,
          budget ? { publication: budget.budget.publication } : undefined,
        );
      },
    },
    {
      id: 'components',
      requires: ['law', 'municipalities', 'annual-periods', 'frozen-inputs'],
      run: (read: Read) =>
        buildComponents(
          {
            ...input.components,
            law: read('law'),
            municipalities: read('municipalities').municipalities,
            outlook: read('annual-periods').outlook,
            execution: read('frozen-inputs').numbers,
          },
          date,
        ),
    },
    { id: 'sebra', requires: [], run: () => buildSebra(input.sebra, date) },
    {
      id: 'feed',
      requires: ['frozen-inputs', 'law', 'rates', 'debt', 'annual-periods', 'sebra', 'budget-2027'],
      run: (read: Read) =>
        buildFeed({
          ...input.feed,
          buildDate: date,
          execution: read('frozen-inputs').numbers,
          law: read('law'),
          rates: read('rates'),
          debt: read('debt'),
          expenditure: read('annual-periods').expenditure,
          sebra: read('sebra'),
          budget2027: read('budget-2027').budget,
        }),
    },
    {
      id: 'core',
      requires: ['annual-periods', 'measures', 'frozen-inputs'],
      optional: ['budgets', 'municipalities', 'editorial'],
      run: (read: Read) => {
        const annual = read('annual-periods'),
          budgets = read('budgets');
        return buildCore({
          ...input.core,
          buildDate: date,
          outlook: annual.outlook,
          revenue: annual.revenue,
          expenditure: annual.expenditure,
          measures: read('measures'),
          execution: read('frozen-inputs').numbers,
          ministries: budgets?.['ministries.json'],
          programs: budgets?.['programs.json'],
          municipalities: read('municipalities')?.municipalities,
          glossaryDataset: read('editorial')?.glossary,
        });
      },
    },
    {
      id: 'search',
      requires: [
        'annual-periods',
        'budget-2027',
        'measures',
        'budgets',
        'debt',
        'rates',
        'municipalities',
        'components',
        'core',
        'frozen-inputs',
      ],
      optional: ['indirect-taxes', 'law', 'sebra', 'feed', 'editorial', 'budget-plan'],
      run: (read: Read) => {
        const out = datasetObjects(read);
        const budget = read('budget-2027').budget;
        return buildSearch({
          buildDate: date,
          out,
          fallback: {
            'execution.json': read('frozen-inputs').execution,
            'execution-provenance.json': read('frozen-inputs').executionProvenance,
            'gva-sectors.json': read('frozen-inputs').gva,
            ...(read('editorial')
              ? {
                  'glossary.json': read('editorial').glossary,
                  'guide.json': read('editorial').guide,
                }
              : {}),
            ...(read('budget-plan') ? { 'dbp2027.json': read('budget-plan') } : {}),
          },
          texts: read('feed') ? { 'feed.xml': read('feed').rss } : {},
          authored: input.search.authored,
          billOrder: input.search.billOrder.filter((key) =>
            Object.hasOwn(budget.budgets.bill, key),
          ),
          debtLimitOrder: Object.keys(budget.debtLimits),
        });
      },
    },
    {
      id: 'catalog',
      requires: [
        'annual-periods',
        'measures',
        'budgets',
        'rates',
        'municipalities',
        'law',
        'components',
        'sebra',
        'feed',
        'core',
        'frozen-inputs',
      ],
      optional: ['search', 'budget-2027', 'debt', 'indirect-taxes', 'editorial', 'budget-plan'],
      run: (read: Read) => {
        const objects = {
          ...datasetObjects(read),
          ...(read('search') ? { 'search-index.json': read('search') } : {}),
        };
        const out = new Map<string, CatalogOwner>(
          Object.entries(objects)
            .filter(([name]) => name !== 'feed.xml')
            .map(([name, object]) => [
              name,
              { object: object as Record<string, any>, bytes: jsonBytes(object) },
            ]),
        );
        const frozen = read('frozen-inputs'),
          editorial = read('editorial');
        const disk = new Map<string, Uint8Array>([
          ['execution.json', frozen.bytes['execution.json']],
          ['execution-provenance.json', frozen.bytes['execution-provenance.json']],
          ['gva-sectors.json', frozen.bytes['gva-sectors.json']],
        ]);
        if (editorial) {
          disk.set('glossary.json', jsonBytes(editorial.glossary));
          disk.set('guide.json', jsonBytes(editorial.guide));
        }
        if (read('budget-plan')) disk.set('dbp2027.json', jsonBytes(read('budget-plan')));
        return buildCatalog({
          ...input.catalog,
          out,
          disk,
          texts: new Map([['feed.xml', Buffer.from(read('feed').rss)]]),
          buildDate: date,
          expectedMinistryFiles: Object.keys(read('budgets')).filter((name) =>
            name.startsWith('ministries/'),
          ),
          primary: { ...input.catalog.primary, execution: frozen.numbers },
          editorial: { ...input.catalog.editorial, execution: frozen.numbers },
        });
      },
    },
    {
      id: 'dataset-complete',
      requires: [
        'editorial',
        'budget-plan',
        'annual-periods',
        'budget-2027',
        'measures',
        'budgets',
        'debt',
        'rates',
        'indirect-taxes',
        'municipalities',
        'law',
        'components',
        'sebra',
        'feed',
        'core',
        'search',
        'catalog',
      ],
      run: () => true,
    },
    {
      id: 'wording',
      requires: ['dataset-complete', 'catalog', 'core', 'feed', 'search'],
      run: (read: Read) => ({
        catalog: catalogWording(
          read('catalog').catalog,
          input.layers.wording['catalog.json'] ?? {},
        ),
        aggregation: aggregationWording(
          {
            core: read('core'),
            feed: read('feed').feed,
            rss: read('feed').rss,
            search: read('search'),
          },
          input.layers.wording,
        ),
      }),
    },
    {
      id: 'active-data',
      requires: ['wording'],
      run: (read: Read) => ({
        catalog: catalogActive(read('wording').catalog),
        aggregation: aggregationActive(read('wording').aggregation),
      }),
    },
    {
      id: 'source-glue',
      requires: ['active-data', 'editorial'],
      run: (read: Read) => ({
        catalog: read('active-data').catalog,
        aggregation: aggregationSourceGlue(
          read('active-data').aggregation,
          input.layers.sourceGlue,
        ),
        glossary: glossarySourceGlue(read('editorial').glossary, input.layers.sourceGlue.terms),
      }),
    },
    {
      id: 'catalog-refresh',
      requires: [
        'source-glue',
        'catalog',
        'feed',
        'core',
        'frozen-inputs',
        'editorial',
        'budget-plan',
        'annual-periods',
        'budget-2027',
        'measures',
        'budgets',
        'debt',
        'rates',
        'indirect-taxes',
        'municipalities',
        'law',
        'components',
        'sebra',
      ],
      run: (read: Read) => {
        const projected = read('source-glue').aggregation;
        const frozen = read('frozen-inputs'),
          editorial = read('editorial');
        const objects = {
          ...datasetObjects(read),
          'core.json': projected.core,
          'feed.json': projected.feed,
          'search-index.json': projected.search,
          'glossary.json': read('source-glue').glossary,
          'guide.json': editorial.guide,
          'dbp2027.json': read('budget-plan'),
          'execution.json': frozen.execution,
          'execution-provenance.json': frozen.executionProvenance,
          'gva-sectors.json': frozen.gva,
          ...(frozen.releasesCurrent === undefined
            ? {}
            : { 'releases/current.json': frozen.releasesCurrent }),
        };
        const streams = new Map<string, Uint8Array>(
          Object.entries(objects).map(([name, object]) => [name, jsonBytes(object)]),
        );
        for (const [name, bytes] of Object.entries(frozen.bytes))
          streams.set(name, bytes as Uint8Array);
        streams.set('feed.xml', Buffer.from(projected.rss));
        const catalog = catalogFinalRefresh(read('source-glue').catalog, {
          ownerBytes: streams,
          registry: input.layers.registry,
          activeRoutes: input.layers.activeRoutes,
        });
        streams.set('catalog.json', jsonBytes(catalog));
        return {
          objects: { ...objects, 'catalog.json': catalog },
          streams,
          notes: read('catalog').notes,
        };
      },
    },
    {
      id: 'publication-layers',
      requires: ['catalog-refresh'],
      run: (read: Read) => read('catalog-refresh'),
    },
  ];
}

function datasetObjects(read: Read): Record<string, any> {
  const annual = read('annual-periods'),
    budget = read('budget-2027'),
    municipal = read('municipalities'),
    feed = read('feed');
  const out: Record<string, any> = {};
  if (annual)
    Object.assign(out, {
      'outlook.json': annual.outlook,
      'revenue.json': annual.revenue,
      'expenditure.json': annual.expenditure,
    });
  if (budget)
    Object.assign(out, {
      'budget2027.json': budget.budget,
      'budget2027-provenance.json': budget.provenance,
    });
  if (municipal)
    Object.assign(out, {
      'municipalities.json': municipal.municipalities,
      'geo/obshtini.json': municipal.geo,
    });
  if (feed) out['feed.json'] = feed.feed;
  Object.assign(out, read('budgets') ?? {});
  for (const [stage, name] of [
    ['measures', 'measures.json'],
    ['debt', 'debt.json'],
    ['rates', 'rates.json'],
    ['indirect-taxes', 'indirect-tax-parameters.json'],
    ['law', 'law.json'],
    ['components', 'components.json'],
    ['sebra', 'sebra.json'],
    ['core', 'core.json'],
  ] as const) {
    const value = read(stage);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export function runWave13b(input: Wave13bInput) {
  const stages = wave13bStages(input);
  return {
    ...runGraph(stages),
    dependencies: stages.map(({ id, requires, optional }) => ({
      id,
      requires: [...requires],
      optional: [...(optional ?? [])],
    })),
  };
}
