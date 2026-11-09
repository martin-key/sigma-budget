import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parsePythonJson } from '../common/numbers.js';
import { readPinned } from '../io/data.js';
import { executionNumbers } from './context.js';
import { buildCatalog, type CatalogOwner } from './catalog-build.js';
import type { CatalogFileFact } from './catalog-primary.js';
import { projectCatalog } from './catalog-layers.js';

const INVENTORY_HASH = '789cb9701a78700f20a7d49a5fc5b321e743df176de93512798541eefb934b68';
/** Load only pinned input and owner-stage captures. Oracles are not builder inputs. */
export async function loadCatalogFixture(path: string, buildDate: string) {
  const root = resolve(path);
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
  ) as { baseline: string; buildDate: string; files: Record<string, string> };
  if (
    inventory.baseline !== '2c26950ab11195c7390580a605ce3c376ddbc116' ||
    inventory.buildDate !== buildDate
  )
    throw new Error('Wrong catalog baseline or build date');
  const bytes = new Map<string, Buffer>();
  for (const [name, hash] of Object.entries(inventory.files)) {
    if (!/^(inputs|owners|final-owners)\//.test(name) && name !== 'policy.json') continue;
    if (name.includes('\\') || name.split('/').some((p) => !p || p === '.' || p === '..'))
      throw new Error('Invalid fixture path');
    const file = join(root, name);
    await safe(file);
    bytes.set(name, await readPinned(file, hash));
  }
  const raw = (name: string) => {
    const b = bytes.get(name);
    if (!b) throw new Error(`Missing pinned input: ${name}`);
    return b;
  };
  const json = (name: string): any => parsePythonJson(raw(name).toString('utf8'));
  const authored = json('inputs/authored.json'),
    manifest = json('inputs/manifest.json'),
    facts = json('inputs/file-facts.json');
  const out = new Map<string, CatalogOwner>(),
    disk = new Map<string, Uint8Array>(),
    text = new Map<string, Uint8Array>(),
    final = new Map<string, Uint8Array>(),
    overlays = new Map<string, Uint8Array>();
  const fallbacks = new Set(['glossary.json', 'guide.json', 'gva-sectors.json', 'dbp2027.json']);
  for (const [name, b] of bytes) {
    if (name.startsWith('owners/')) {
      const rel = name.slice('owners/'.length);
      final.set(rel, b);
      if (rel === 'feed.xml') text.set(rel, b);
      else if (fallbacks.has(rel)) disk.set(rel, b);
      else if (rel.endsWith('.json'))
        out.set(rel, { object: parsePythonJson(b.toString('utf8')), bytes: b });
      else disk.set(rel, b);
    } else if (name.startsWith('final-owners/'))
      overlays.set(name.slice('final-owners/'.length), b);
  }
  for (const [name, b] of overlays) final.set(name, b);
  const execution = executionNumbers(out.get('execution.json')?.object);
  const primary = {
    manifest,
    manifestFiles: authored.manifestFiles,
    rawFacts: new Map(Object.entries(facts.raw as Record<string, CatalogFileFact>)),
    cacheFacts: new Map(Object.entries(facts.cache as Record<string, CatalogFileFact>)),
    sebraBase: authored.sebraBase,
    sebraCache: authored.sebraCache,
    historicalGva: authored.historicalGva,
    kfpPage: authored.kfpPage,
    execution,
  };
  const editorial = {
    traps: authored.traps,
    methodology: authored.methodology,
    execution,
    manifest,
    eur: authored.eur,
  };
  const buildInput = {
    definitions: authored.catalogDefinitions,
    groups: authored.catalogGroups,
    pending: authored.pending,
    out,
    texts: text,
    disk,
    buildDate,
    expectedMinistryFiles: Object.keys(inventory.files)
      .filter((n) => n.startsWith('owners/ministries/'))
      .map((n) => n.slice('owners/'.length)),
    primary,
    editorial,
  };
  const built = buildCatalog(buildInput);
  const registry = parseYaml(raw('inputs/datasets.yaml').toString('utf8')) as {
    datasets: { id: string; screens?: string[] }[];
  };
  const routes = json('inputs/routes.json') as { routes: [string, ...unknown[]][] };
  const projected = projectCatalog({
    raw: built.catalog,
    wording: json('inputs/wording.json')['catalog.json'],
    ownerBytes: final,
    registry: registry.datasets,
    activeRoutes: routes.routes.map((r) => r[0]),
  });
  return {
    raw: built.catalog,
    projected,
    notes: built.notes,
    ownerBytes: final,
    buildInput,
    registry: registry.datasets,
    activeRoutes: routes.routes.map((r) => r[0]),
  };
}
