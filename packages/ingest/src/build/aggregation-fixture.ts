import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readPinned, parseJsonStat } from '../io/data.js';
import { parsePythonJson } from '../common/numbers.js';
import { executionNumbers } from './context.js';
import { buildCore, zddTable, pendingFromExecution, type CoreInput } from './aggregation-core.js';
import { editorialSiteName } from './aggregation-rss.js';
import { buildFeed, type FeedInput } from './aggregation-feed.js';
import { buildSearch, orderedKeysFromJson, type SearchInput } from './aggregation-search.js';
import { projectAggregation } from './aggregation-layers.js';
const INVENTORY_HASH = 'b450559cff13d366b3a314b053a389f710b96b9e3ab03a35d67db8daca714b46';
/** Read hash-pinned dependency bytes only; published and oracle snapshots are never builder inputs. */
export async function loadAggregationFixture(fixture: string, buildDate: string) {
  const root = resolve(fixture);
  if ((await realpath(root)) !== root) throw new Error('Fixture path contains a symlink');
  async function safe(path: string) {
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (await realpath(path)) !== path)
      throw new Error('Unsafe fixture file');
  }
  const inventoryPath = join(root, 'provenance.json');
  await safe(inventoryPath);
  const inventory = JSON.parse(
    (await readPinned(inventoryPath, INVENTORY_HASH)).toString('utf8'),
  ) as { baseline: string; files: Record<string, string> };
  if (inventory.baseline !== '10697d0def6ff6892029a311e2b590602e66b931')
    throw new Error('Wrong baseline');
  const bytes = new Map<string, Buffer>();
  for (const [name, hash] of Object.entries(inventory.files)) {
    if (!/^(?:upstream|inputs|archive)\//.test(name) && name !== 'authored.json') continue;
    if (
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((p) => !p || p === '.' || p === '..')
    )
      throw new Error('Invalid fixture path');
    const path = join(root, name);
    await safe(path);
    bytes.set(name, await readPinned(path, hash));
  }
  const raw = (name: string) => {
    const b = bytes.get(name);
    if (!b) throw new Error('Missing pinned input: ' + name);
    return b.toString('utf8');
  };
  const json = (name: string): any => parsePythonJson(raw(name));
  const fallback: Record<string, any> = {};
  for (const name of bytes.keys())
    if (name.startsWith('upstream/') && name.endsWith('.json'))
      fallback[name.slice('upstream/'.length)] = json(name);
  const out = { ...fallback };
  for (const name of [
    'glossary.json',
    'guide.json',
    'catalog.json',
    'dbp2027.json',
    'gva-sectors.json',
  ])
    delete out[name];
  const authored = json('authored.json'),
    execution = executionNumbers(fallback['execution.json']),
    population = json('inputs/population.json');
  authored.pending = pendingFromExecution(authored.pending, execution);
  const coreInput: CoreInput = {
    buildDate,
    outlook: out['outlook.json'],
    revenue: out['revenue.json'],
    expenditure: out['expenditure.json'],
    measures: out['measures.json'],
    execution,
    law: json('archive/cache/law_bill.json'),
    budgetCount: authored.budgetCount,
    sources: authored.sources,
    pending: authored.pending,
    population,
    populationAsOf: authored.populationAsOf,
    zdd: zddTable(json('archive/originals/asbp/asbp_tables.json').tables.VI_1.rows),
    ministries: out['ministries.json'],
    programs: out['programs.json'],
    municipalities: out['municipalities.json'],
    gisco: json('archive/cache/gisco_lau_bg.json'),
    glossaryDataset: fallback['glossary.json'],
    glossaryInput: json('inputs/glossary.json'),
  };
  const feedInput: FeedInput = {
    siteName: editorialSiteName(json('inputs/glossary.json')),
    buildDate,
    execution,
    law: out['law.json'],
    rates: out['rates.json'],
    debt: out['debt.json'],
    expenditure: out['expenditure.json'],
    sebra: out['sebra.json'],
    budget2027: out['budget2027.json'],
    annualUpdated: json('archive/originals/eurostat/gov_10dd_edpt1_BG_EU.json').updated,
    quarterUpdated: json('archive/originals/eurostat/gov_10q_ggdebt_BG.json').updated,
    cofogUpdated: json('inputs/cofog_bg.json').updated,
    population,
    populationStat: parseJsonStat(raw('archive/originals/eurostat/tps00001_BG.json')),
    populationAsOf: authored.populationAsOf,
    pending: authored.pending,
  };
  const builtFeed = buildFeed(feedInput),
    core = buildCore(coreInput);
  out['feed.json'] = builtFeed.feed;
  out['core.json'] = core;
  const budgetText = raw('upstream/budget2027.json');
  const searchInput: SearchInput = {
    buildDate,
    out,
    fallback,
    texts: { 'feed.xml': builtFeed.rss },
    authored,
    billOrder: orderedKeysFromJson(budgetText, ['budgets', 'bill']),
    debtLimitOrder: orderedKeysFromJson(budgetText, ['debtLimits']),
  };
  const search = buildSearch(searchInput),
    projected = projectAggregation({
      core,
      feed: builtFeed.feed,
      rss: builtFeed.rss,
      search,
      wording: json('inputs/wording.json'),
      sourceGlue: authored.sourceGlue,
    });
  return { raw: { core, feed: builtFeed.feed, rss: builtFeed.rss, search }, projected };
}
