import { gzip } from 'pako';
import { clean } from '../io/data.js';

export interface CatalogSchemaField {
  key: string;
  type: 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
  length?: number;
}
export interface CatalogPart {
  code: string;
  file: string;
  bytes: number;
  gzipBytes: number;
}
export interface CatalogEntry {
  id: string;
  slug: string;
  status: string;
  source: string[];
  screens: string[];
  file?: string | null;
  format?: string;
  parts?: CatalogPart[];
  bytes?: number;
  gzipBytes?: number;
  schema?: CatalogSchemaField[];
  [key: string]: unknown;
}
export interface CatalogDocument {
  datasets: CatalogEntry[];
  counts: Record<string, number>;
  files: unknown[];
  [key: string]: unknown;
}
export interface CatalogRefreshInput {
  catalog: CatalogDocument;
  /** Exact bytes written for the owner files, relative to the data directory. */
  ownerBytes: ReadonlyMap<string, Uint8Array>;
  registry: readonly { id: string; screens?: readonly string[] }[];
  activeRoutes: readonly string[];
}

/** Python 3.12 uses zlib for gzip; pako is independent of Node's zlib-ng. */
export const catalogGzipSize = (bytes: Uint8Array): number => gzip(bytes, { level: 9 }).length;

/** Read the top-level key order from the stream, including integer-like keys. */
export function catalogSchema(bytes: Uint8Array): {
  schema: CatalogSchemaField[];
  source?: string[];
} {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  clean(value);
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new Error('Catalog JSON owner must be an object');
  const obj = value as Record<string, unknown>;
  const schema: CatalogSchemaField[] = [];
  // JSON.parse validates the full document. Scan only top-level string tokens to
  // preserve insertion order even for integer-like keys, which JS reorders.
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') {
          i++;
          continue;
        }
        if (text[i] === '"') break;
      }
      if (depth === 1) {
        let next = i + 1;
        while (/\s/.test(text[next] ?? '')) next++;
        if (text[next] === ':') {
          const key = JSON.parse(text.slice(start, i + 1)) as string;
          if (!keys.includes(key)) keys.push(key);
        }
      }
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  for (const key of keys) {
    if (key === 'meta') continue;
    const v = obj[key];
    const type = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    if (!['null', 'array', 'object', 'number', 'string', 'boolean'].includes(type))
      throw new Error('Invalid schema value');
    const row: CatalogSchemaField = { key, type: type as CatalogSchemaField['type'] };
    if (Array.isArray(v)) row.length = v.length;
    else if (v && typeof v === 'object') row.length = Object.keys(v).length;
    schema.push(row);
  }
  const meta = obj.meta;
  if (meta !== undefined && (meta === null || Array.isArray(meta) || typeof meta !== 'object'))
    throw new Error('Invalid owner metadata');
  const source = (meta as Record<string, unknown> | undefined)?.source;
  if (source === undefined || source === null) return { schema };
  if (typeof source === 'object' && !Array.isArray(source) && Object.keys(source).length === 0)
    return { schema, source: [] };
  if (!Array.isArray(source) || source.some((s) => typeof s !== 'string'))
    throw new Error('Invalid owner source');
  return { schema, source: source as string[] };
}

export function catalogCounts(
  cat: CatalogDocument,
  countEmptyParts = false,
): Record<string, number> {
  return {
    datasets: cat.datasets.length,
    files: cat.datasets.reduce(
      (n, d) =>
        n +
        (countEmptyParts && d.parts !== undefined
          ? d.parts.length
          : d.parts?.length || (d.file ? 1 : 0)),
      0,
    ),
    real: cat.datasets.filter((d) => d.status === 'real').length,
    mock: cat.datasets.filter((d) => d.status === 'mock').length,
    pending: cat.datasets.filter((d) => d.status === 'pending').length,
    primarySources: cat.files.length,
  };
}

/** Refresh only derived metadata from the explicit bytes and audited consumer registry. */
export function refreshCatalog(input: CatalogRefreshInput): {
  catalog: CatalogDocument;
  changes: string[];
} {
  const cat = structuredClone(input.catalog),
    changes: string[] = [];
  clean(cat);
  if (
    !Array.isArray(cat.datasets) ||
    !Array.isArray(cat.files) ||
    !cat.counts ||
    typeof cat.counts !== 'object' ||
    Array.isArray(cat.counts)
  )
    throw new Error('Invalid catalog document');
  for (const d of cat.datasets) {
    if (
      !d ||
      typeof d.id !== 'string' ||
      typeof d.slug !== 'string' ||
      typeof d.status !== 'string' ||
      !Array.isArray(d.source) ||
      d.source.some((s) => typeof s !== 'string') ||
      !Array.isArray(d.screens) ||
      d.screens.some((s) => typeof s !== 'string')
    )
      throw new Error('Invalid catalog entry');
  }
  const routes = new Set(input.activeRoutes);
  const consumers = new Map<string, readonly string[]>();
  for (const row of input.registry) {
    if (consumers.has(row.id)) throw new Error(`Duplicate registry id: ${row.id}`);
    consumers.set(row.id, row.screens ?? []);
  }
  const bytesFor = (file: string) => {
    if (
      !file.startsWith('data/') ||
      file
        .slice(5)
        .split('/')
        .some((p) => !p || p === '.' || p === '..')
    )
      throw new Error(`Invalid owner path: ${file}`);
    const bytes = input.ownerBytes.get(file.slice(5));
    if (!bytes) throw new Error(`Missing owner bytes: ${file}`);
    return bytes;
  };
  for (const d of cat.datasets) {
    if (d.status !== 'pending') {
      if (d.parts?.length) {
        let total = 0,
          gz = 0;
        for (const part of d.parts) {
          const raw = bytesFor(part.file),
            zipped = catalogGzipSize(raw);
          if (part.bytes !== raw.length || part.gzipBytes !== zipped) {
            part.bytes = raw.length;
            part.gzipBytes = zipped;
            changes.push(`${d.slug} part ${part.code}: size`);
          }
          total += raw.length;
          gz += zipped;
        }
        if (d.bytes !== total || d.gzipBytes !== gz) {
          d.bytes = total;
          d.gzipBytes = gz;
          changes.push(`${d.slug}: summed size`);
        }
      } else if (d.file) {
        const raw = bytesFor(d.file);
        if (d.id !== 'D25') {
          const zipped = catalogGzipSize(raw);
          if (d.bytes !== raw.length || d.gzipBytes !== zipped) {
            d.bytes = raw.length;
            d.gzipBytes = zipped;
            changes.push(`${d.slug}: size`);
          }
        } else if ('bytes' in d || 'gzipBytes' in d)
          throw new Error('Self catalog must omit sizes');
        if (d.format === 'JSON' || d.format === 'GeoJSON') {
          const parsed = catalogSchema(raw);
          if (JSON.stringify(d.schema) !== JSON.stringify(parsed.schema)) {
            d.schema = parsed.schema;
            changes.push(`${d.slug}: schema`);
          }
          if (
            parsed.source &&
            (new Set(d.source).size !== new Set(parsed.source).size ||
              parsed.source.some((s) => !d.source.includes(s)))
          ) {
            d.source = [...parsed.source];
            changes.push(`${d.slug}: source`);
          }
        }
      }
    }
    const declared = consumers.get(d.slug);
    if (declared) {
      const screens = declared.filter((id) => routes.has(id));
      if (JSON.stringify(screens) !== JSON.stringify(d.screens)) {
        d.screens = screens;
        changes.push(`${d.slug}: screens`);
      }
    }
  }
  const counts = catalogCounts(cat);
  if (JSON.stringify(counts) !== JSON.stringify(cat.counts)) {
    cat.counts = counts;
    changes.push('counts');
  }
  clean(cat);
  return { catalog: cat, changes };
}
