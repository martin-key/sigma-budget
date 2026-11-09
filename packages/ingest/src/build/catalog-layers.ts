import {
  catalogCounts,
  refreshCatalog,
  type CatalogDocument,
  type CatalogRefreshInput,
} from './catalog-refresh.js';

export interface CatalogProjectionInput {
  raw: CatalogDocument;
  wording: Readonly<Record<string, string>>;
  ownerBytes: ReadonlyMap<string, Uint8Array>;
  registry: CatalogRefreshInput['registry'];
  activeRoutes: CatalogRefreshInput['activeRoutes'];
}
/** Catalog-scoped wording, active-data filtering and refresh, in production order. */
export function projectCatalog(input: CatalogProjectionInput): CatalogDocument {
  let serialized = JSON.stringify(input.raw);
  for (const [from, to] of Object.entries(input.wording))
    serialized = serialized.replaceAll(
      JSON.stringify(from).slice(1, -1),
      JSON.stringify(to).slice(1, -1),
    );
  const cat = JSON.parse(serialized) as CatalogDocument;
  const ids = new Set(['D24', 'M01', 'M02', 'M03', 'M04', 'M05']),
    slugs = new Set([
      'sebra',
      'mock-activities',
      'mock-indicators',
      'mock-municipal-finance',
      'mock-payments',
      'mock-projects',
    ]);
  cat.datasets = cat.datasets.filter((d) => !ids.has(d.id) && !slugs.has(d.slug));
  cat.files = cat.files.filter(
    (f: any) => !(f.source ?? []).includes('sebra') && !(f.usedBy ?? []).includes('sebra'),
  );
  for (const d of cat.datasets) d.source = d.source.filter((s) => s !== 'sebra');
  for (const key of ['traps', 'methodology']) {
    const rows = cat[key];
    if (!Array.isArray(rows)) throw new Error(`Invalid catalog ${key}`);
    for (const row of rows) {
      if (Array.isArray(row.related))
        row.related = row.related.filter((slug: string) => !slugs.has(slug));
      if (typeof row.text === 'string')
        row.text = row.text.replace(', плащанията по СЕБРА — в евро', '');
    }
  }
  if (!Array.isArray(cat.groups)) throw new Error('Invalid catalog groups');
  cat.groups = cat.groups.filter((g: any) => cat.datasets.some((d) => d.group === g.id));
  cat.counts = catalogCounts(cat, true);
  const streams = new Map(input.ownerBytes);
  streams.set('catalog.json', Buffer.from(JSON.stringify(cat)));
  return refreshCatalog({
    catalog: cat,
    ownerBytes: streams,
    registry: input.registry,
    activeRoutes: input.activeRoutes,
  }).catalog;
}
