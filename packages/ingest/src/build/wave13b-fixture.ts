import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parsePythonJson } from '../common/numbers.js';
import { parseJsonStat } from '../io/data.js';
import { loadAnnex } from './annex.js';
import { loadEditorialRoutes } from './editorial.js';
import { executionNumbers } from './context.js';
import { pendingFromExecution, zddTable } from './aggregation-core.js';
import { editorialSiteName } from './aggregation-rss.js';
import { orderedKeysFromJson } from './aggregation-search.js';
import type { Wave13bInput } from './wave13b.js';

// This inventory contains reader inputs and explicitly frozen-only artifacts, never
// the donor or expected output of a stage with an eligible TypeScript producer.
export const WAVE13B_INPUTS = [
  'wave13b/legal-evidence.json',
  'wave13b/releases-current.json',
  'fiscal/datasets-provenance.json',
  'programmes/provenance.json',
  'programmes/inputs/original-hashes.json',
  'debt-local/provenance.json',
  'components-rates/provenance.json',
  'components-rates/inputs/capture-source-hashes.json',
  'indirect-taxes/provenance.json',
  'editorial/provenance.json',
  'dbp-gva/provenance.json',
  'law/provenance.json',
  'aggregation/provenance.json',
  'catalog/provenance.json',
  'wave13a/inputs-sha256.json',
  'fiscal/inputs/data/inputs/budget_forecast_2027.json',
  'fiscal/inputs/data/inputs/budget_bill_2027.json',
  'fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip',
  'fiscal/inputs/data/originals/asbp/asbp_tables.json',
  'fiscal/inputs/data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
  'fiscal/inputs/data/inputs/cofog_bg.json',
  'fiscal/inputs/data/inputs/kfp_functions_2026.json',
  'fiscal/inputs/data/inputs/measure_excerpts.json',
  'fiscal/inputs/data/inputs/measures_2026.json',
  'fiscal/inputs/data/inputs/population.json',
  'programmes/inputs/program-budgets.json',
  'programmes/inputs/law-cache.json',
  'programmes/inputs/pdf-evidence.json',
  'debt-local/inputs/reader-captures.json',
  'debt-local/inputs/dv-blocks.json',
  'debt-local/inputs/data/inputs/debt_stock.json',
  'debt-local/inputs/data/inputs/debt_gdp.json',
  'debt-local/inputs/data/inputs/municipal_transfers_2026.json',
  'debt-local/inputs/data/originals/eurostat/gov_10dd_edpt1_BG_EU.json',
  'debt-local/inputs/data/originals/eurostat/gov_10q_ggdebt_BG.json',
  'debt-local/inputs/data/cache/gisco_lau_bg.json',
  'debt-local/inputs/data/cache/eurostat_pop_nuts3_bg.json',
  'debt-local/inputs/oblast-jsonstat.json',
  'components-rates/inputs/doo-blocks.json',
  'components-rates/inputs/nzok-blocks.json',
  'components-rates/inputs/bill-blocks.json',
  'components-rates/inputs/nap-rows.json',
  'components-rates/inputs/tables.json',
  'components-rates/inputs/pages.json',
  'components-rates/inputs/kfp-components.json',
  'indirect-taxes/reader-ir.json',
  'editorial/inputs/glossary.json',
  'editorial/inputs/guide.json',
  'wave13b/sources.yaml',
  'dbp-gva/inputs/figures.json',
  'dbp-gva/inputs/editorial.json',
  'dbp-gva/inputs/plan.pdf',
  'aggregation/upstream/execution.json',
  'aggregation/upstream/execution-provenance.json',
  'aggregation/upstream/gva-sectors.json',
  'aggregation/authored.json',
  'aggregation/inputs/wording.json',
  'aggregation/inputs/glossary.json',
  'aggregation/archive/originals/eurostat/tps00001_BG.json',
  'catalog/inputs/authored.json',
  'catalog/inputs/manifest.json',
  'catalog/inputs/file-facts.json',
  'catalog/inputs/datasets.yaml',
  'catalog/inputs/routes.json',
] as const;
const MANIFEST_HASH = 'ae366137b0d93cccedbaec72de496437cd018674ae2b2d22f04eac94c7dd2eb5';
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export async function loadWave13bFixture(path: string): Promise<Wave13bInput> {
  const root = resolve(path);
  if ((await realpath(root)) !== root) throw new Error('Fixture root contains a symlink');
  async function safe(name: string) {
    if (
      name.includes('\\') ||
      name.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Unsafe fixture path');
    const file = join(root, name),
      s = await lstat(file);
    if (!s.isFile() || s.nlink !== 1 || (await realpath(file)) !== file)
      throw new Error(`Unsafe fixture file: ${name}`);
    return readFile(file);
  }
  const manifest = await safe('wave13b/provenance.json');
  if (sha(manifest) !== MANIFEST_HASH) throw new Error('Wave13b inventory hash mismatch');
  const inventory = JSON.parse(manifest.toString()) as {
    baseline: string;
    buildDate: string;
    files: Record<string, string>;
  };
  if (
    inventory.baseline !== '027a262288c0b0ca4b188482a8b8da43bb378047' ||
    inventory.buildDate !== '2026-11-08' ||
    Object.keys(inventory.files).sort().join('\n') !== [...WAVE13B_INPUTS].sort().join('\n')
  )
    throw new Error('Incomplete Wave13b inventory');
  const contents = new Map<string, Buffer>();
  for (const name of WAVE13B_INPUTS) {
    const data = await safe(name);
    if (sha(data) !== inventory.files[name]) throw new Error(`Fixture hash mismatch: ${name}`);
    contents.set(name, data);
  }
  const raw = (name: string) => {
    const value = contents.get(name);
    if (!value) throw new Error(`Missing fixture: ${name}`);
    return value;
  };
  const json = (name: string): any => parsePythonJson(raw(name).toString('utf8'));
  const law = json('wave13b/legal-evidence.json');
  const lawCache = json('programmes/inputs/law-cache.json');
  const fiscalSource = json('fiscal/inputs/data/originals/asbp/asbp_tables.json');
  const tables = fiscalSource.tables;
  const pages = json(
    'fiscal/inputs/data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
  );
  const capture = json('debt-local/inputs/reader-captures.json');
  const doo = json('components-rates/inputs/doo-blocks.json'),
    nzok = json('components-rates/inputs/nzok-blocks.json');
  const rawExecution = json('aggregation/upstream/execution.json'),
    execution = executionNumbers(rawExecution);
  const authored = json('aggregation/authored.json');
  authored.pending = pendingFromExecution(authored.pending, execution);
  const population = json('fiscal/inputs/data/inputs/population.json');
  const fiscal = {
    annex: loadAnnex(tables),
    tables,
    pages,
    differingRows: fiscalSource.docx_check.differing_rows,
    functions: json('fiscal/inputs/data/inputs/kfp_functions_2026.json').functions,
    cofog: json('fiscal/inputs/data/inputs/cofog_bg.json'),
    population,
    measures: json('fiscal/inputs/data/inputs/measures_2026.json'),
    excerpts: json('fiscal/inputs/data/inputs/measure_excerpts.json'),
    forecast: json('fiscal/inputs/data/inputs/budget_forecast_2027.json'),
  };
  const geo = json('debt-local/inputs/data/cache/gisco_lau_bg.json');
  const oblast = json('debt-local/inputs/data/cache/eurostat_pop_nuts3_bg.json');
  const annual = json('debt-local/inputs/data/originals/eurostat/gov_10dd_edpt1_BG_EU.json');
  const quarter = json('debt-local/inputs/data/originals/eurostat/gov_10q_ggdebt_BG.json');
  const cat = json('catalog/inputs/authored.json'),
    manifestDoc = json('catalog/inputs/manifest.json'),
    facts = json('catalog/inputs/file-facts.json');
  const registry = parseYaml(raw('catalog/inputs/datasets.yaml').toString()) as { datasets: any[] };
  const routes = json('catalog/inputs/routes.json') as { routes: [string, ...unknown[]][] };
  const archive = raw('fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip');
  return {
    fiscal: {
      fiscal,
      forecast: json('fiscal/inputs/data/inputs/budget_forecast_2027.json'),
      bill: json('fiscal/inputs/data/inputs/budget_bill_2027.json'),
      archives: { forecast: archive, bill: archive },
      law,
      buildDate: '2026-11-08',
    },
    programmes: {
      source: json('programmes/inputs/program-budgets.json'),
      law: lawCache,
      pdfs: json('programmes/inputs/pdf-evidence.json'),
    },
    debt: {
      table: tables.VI_1,
      gdp: fiscal.annex.gdp as number[],
      pages,
      paragraphs: json('debt-local/inputs/dv-blocks.json')
        .zdb.filter((b: [string, string]) => b[0] === 'p')
        .map((b: [string, string]) => b[1]),
      stock: json('debt-local/inputs/data/inputs/debt_stock.json'),
      gdpCopy: json('debt-local/inputs/data/inputs/debt_gdp.json'),
      annual: parseJsonStat(JSON.stringify(annual)) as any,
      quarterly: parseJsonStat(JSON.stringify(quarter)) as any,
      bnbGg: capture.bnbGg,
      bnbCg: capture.bnbCg,
      revisions: capture.revisions,
    },
    rates: {
      doo,
      nzok,
      bill: json('components-rates/inputs/bill-blocks.json'),
      nap: json('components-rates/inputs/nap-rows.json'),
    },
    indirectTaxes: json('indirect-taxes/reader-ir.json'),
    municipalities: {
      art: lawCache.municipal.art51,
      proto: json('debt-local/inputs/data/inputs/municipal_transfers_2026.json'),
      gis: geo,
      oblast: {
        updated: oblast.updated,
        jsonstat: parseJsonStat(raw('debt-local/inputs/oblast-jsonstat.json').toString()),
      },
      population,
    },
    geometryOptions: { preserveHistoricalChirpan: true },
    components: {
      doo,
      nzok,
      tables: json('components-rates/inputs/tables.json'),
      pages: json('components-rates/inputs/pages.json'),
      summary: json('components-rates/inputs/kfp-components.json'),
    },
    sebra: capture,
    editorial: {
      snapshots: {
        'glossary.json': raw('editorial/inputs/glossary.json'),
        'guide.json': raw('editorial/inputs/guide.json'),
      },
      routes: loadEditorialRoutes(json('catalog/inputs/routes.json')),
    },
    plan: {
      figures: json('dbp-gva/inputs/figures.json'),
      editorial: json('dbp-gva/inputs/editorial.json'),
      pdfSha256: sha(raw('dbp-gva/inputs/plan.pdf')),
    },
    frozen: {
      execution: rawExecution,
      executionProvenance: json('aggregation/upstream/execution-provenance.json'),
      gva: json('aggregation/upstream/gva-sectors.json'),
      releasesCurrent: json('wave13b/releases-current.json'),
      bytes: {
        'execution.json': raw('aggregation/upstream/execution.json'),
        'execution-provenance.json': raw('aggregation/upstream/execution-provenance.json'),
        'gva-sectors.json': raw('aggregation/upstream/gva-sectors.json'),
        'releases/current.json': raw('wave13b/releases-current.json'),
      },
    },
    core: {
      law: lawCache,
      budgetCount: authored.budgetCount,
      sources: authored.sources,
      pending: authored.pending,
      population,
      populationAsOf: authored.populationAsOf,
      zdd: zddTable(tables.VI_1.rows),
      gisco: geo,
      glossaryInput: json('aggregation/inputs/glossary.json'),
    },
    feed: {
      siteName: editorialSiteName(json('aggregation/inputs/glossary.json')),
      annualUpdated: annual.updated,
      quarterUpdated: quarter.updated,
      cofogUpdated: json('fiscal/inputs/data/inputs/cofog_bg.json').updated,
      population,
      populationStat: parseJsonStat(
        raw('aggregation/archive/originals/eurostat/tps00001_BG.json').toString(),
      ),
      populationAsOf: authored.populationAsOf,
      pending: authored.pending,
    },
    search: {
      authored,
      billOrder: orderedKeysFromJson(
        raw('fiscal/inputs/data/inputs/budget_bill_2027.json').toString(),
        ['bill'],
      ),
    },
    catalog: {
      definitions: cat.catalogDefinitions,
      groups: cat.catalogGroups,
      pending: cat.pending,
      primary: {
        manifest: manifestDoc,
        manifestFiles: cat.manifestFiles,
        rawFacts: new Map(Object.entries(facts.raw)),
        cacheFacts: new Map(Object.entries(facts.cache)),
        sebraBase: cat.sebraBase,
        sebraCache: cat.sebraCache,
        historicalGva: cat.historicalGva,
        kfpPage: cat.kfpPage,
        execution,
      },
      editorial: {
        traps: cat.traps,
        methodology: cat.methodology,
        execution,
        manifest: manifestDoc,
        eur: cat.eur,
      },
    },
    layers: {
      wording: json('aggregation/inputs/wording.json'),
      sourceGlue: authored.sourceGlue,
      registry: registry.datasets,
      activeRoutes: routes.routes.map((r) => r[0]),
    },
  };
}
