import { clean } from '../io/data.js';
import {
  catalogSchema,
  refreshCatalog,
  type CatalogDocument,
  type CatalogRefreshInput,
} from './catalog-refresh.js';

function metadata(cat: CatalogDocument) {
  return {
    counts: cat.counts,
    datasets: cat.datasets.map((d) => ({
      id: d.id,
      slug: d.slug,
      source: d.source,
      screens: d.screens,
      ...('bytes' in d ? { bytes: d.bytes } : {}),
      ...('gzipBytes' in d ? { gzipBytes: d.gzipBytes } : {}),
      ...(d.schema ? { schema: d.schema } : {}),
      ...(d.parts ? { parts: d.parts } : {}),
    })),
  };
}
/** Independently recompute only stream-derived fields for the metadata report. */
export function auditCatalogMetadata(input: {
  catalogBytes: Uint8Array;
  ownerBytes: ReadonlyMap<string, Uint8Array>;
  registry: CatalogRefreshInput['registry'];
  activeRoutes: CatalogRefreshInput['activeRoutes'];
}) {
  const doc: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(input.catalogBytes),
  );
  clean(doc);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Invalid catalog');
  const cat = doc as CatalogDocument,
    owners = new Map(input.ownerBytes);
  owners.set('catalog.json', input.catalogBytes);
  const derived = refreshCatalog({
    catalog: cat,
    ownerBytes: owners,
    registry: input.registry,
    activeRoutes: input.activeRoutes,
  }).catalog;
  // Python refresh uses set equality for source; the audit also checks source order.
  for (const d of derived.datasets) {
    if (d.parts?.length) {
      const first = owners.get(d.parts[0]!.file.slice('data/'.length));
      if (!first) throw new Error(`Missing first part for ${d.slug}`);
      const shape = catalogSchema(first);
      d.schema = shape.schema;
      if (shape.source !== undefined) d.source = [...shape.source];
      continue;
    }
    if (d.status === 'pending' || !d.file || !['JSON', 'GeoJSON'].includes(d.format ?? ''))
      continue;
    const b = owners.get(d.file.slice('data/'.length));
    if (!b) throw new Error(`Missing owner ${d.file}`);
    const source = catalogSchema(b).source;
    if (source !== undefined) d.source = [...source];
  }
  return { computed: metadata(derived), reported: metadata(cat) };
}
