import { join, matchesGlob } from 'node:path';
import {
  parseYaml,
  registries,
  type DatasetRegistry,
  type SourceRegistry,
} from '../io/registry.js';
import { listFiles, readSafeBytes } from '../release-client/files.js';
import { record, type ReleaseFile } from '../release-client/types.js';
import {
  copyAuthenticated,
  fail,
  fileFacts,
  inspectPath,
  jsonBytes,
  safeDirectory,
  safeRelative,
  sha256,
} from './files.js';
import type { MissingIntermediate } from './types.js';

const LIMIT = 32 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const external = (path: string) => /^(data\/originals|data\/cache)\//.test(path);
export interface InputDeclaration {
  kind: 'source' | 'intermediate';
  source?: string;
  datasets: string[];
  entry: Record<string, unknown>;
}
export interface InputClosure {
  external: Map<string, InputDeclaration>;
  committed: Map<string, InputDeclaration>;
}
/** Dataset AND intermediate traversal, even for source/dataset IDs sharing a name.
 * Cycles in dataset aggregation are finite; each dependency contributes to every owner. */
export function transitiveInputClosure(
  sources: SourceRegistry,
  datasets: DatasetRegistry,
): InputClosure {
  const src = new Map(sources.sources.map((s) => [s.id, s]));
  const ds = new Map(datasets.datasets.map((d) => [d.id, d]));
  const intermediate = new Map((sources.intermediates ?? []).map((i) => [i.path, i]));
  const result: InputClosure = { external: new Map(), committed: new Map() };
  for (const dataset of datasets.datasets) {
    if (dataset.status === 'pending') continue;
    const todo = [...(dataset.inputs ?? [])],
      seen = new Set<string>();
    while (todo.length) {
      const input = todo.pop()!;
      if (seen.has(input)) continue;
      seen.add(input);
      todo.push(...(ds.get(input)?.inputs ?? []));
      const inter = intermediate.get(input);
      if (inter?.inputs !== undefined) {
        if (!Array.isArray(inter.inputs) || !inter.inputs.every((x) => typeof x === 'string'))
          fail('Invalid intermediate inputs');
        todo.push(...(inter.inputs as string[]));
      }
      const source = src.get(input);
      if (source && ['reference', 'generated'].includes(source.acquisition)) continue;
      const entries = source ? (source.files ?? []) : inter ? [inter] : [];
      for (const entry of entries) {
        const pattern = safeRelative(entry.path, true);
        // A declared raw file cannot disappear through an unsupported root.
        if (!pattern.startsWith('data/')) fail('Unsupported declared input path: ' + pattern);
        if (!external(pattern) && !pattern.startsWith('data/inputs/'))
          fail('Unsupported declared input root: ' + pattern);
        const map = external(pattern) ? result.external : result.committed;
        const existing = map.get(pattern);
        if (existing) {
          if (
            jsonBytes(existing.entry).compare(jsonBytes(entry)) !== 0 ||
            existing.source !== source?.id
          )
            fail('Ambiguous input ownership: ' + pattern);
          if (!existing.datasets.includes(dataset.id)) existing.datasets.push(dataset.id);
        } else
          map.set(pattern, {
            kind: source ? 'source' : 'intermediate',
            ...(source ? { source: source.id } : {}),
            datasets: [dataset.id],
            entry,
          });
      }
      if (!source && !inter && !ds.has(input) && input.startsWith('data/'))
        fail('Unregistered file dependency: ' + input);
    }
  }
  for (const map of [result.external, result.committed])
    for (const rec of map.values()) rec.datasets.sort();
  return result;
}
export function parsePins(bytes: Buffer): Map<string, string> {
  const pins = new Map<string, string>();
  for (const line of bytes.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) fail('Malformed originals.sha256');
    const path = safeRelative(match[2]!);
    if (pins.has(path)) fail('Duplicate input pin: ' + path);
    pins.set(path, match[1]!);
  }
  return pins;
}
interface SnapshotRow extends Record<string, unknown> {
  source: string;
  path: string;
  status: string;
  file?: string;
  sha256?: string;
  bytes?: number;
}
interface SnapshotSelection {
  rows: Map<string, SnapshotRow>;
  sha256?: string;
  receipt?: string;
}
async function snapshotSelection(
  root: string,
  sourceBytes: Buffer,
  pinBytes: Buffer,
  sources: SourceRegistry,
): Promise<SnapshotSelection> {
  const path = join(root, 'snapshot.json');
  if (!(await inspectPath(path))) return { rows: new Map() };
  const bytes = await readSafeBytes(path, LIMIT),
    doc: unknown = JSON.parse(bytes.toString('utf8'));
  if (
    !record(doc) ||
    doc.schema !== 'source-snapshot/1' ||
    doc.identity !== sha256(Buffer.concat([sourceBytes, Buffer.from('\0'), pinBytes])) ||
    !Array.isArray(doc.collected) ||
    doc.numericalValidation !== 'not-run' ||
    doc.historicalReconstruction !== 'unverified' ||
    typeof doc.receipt !== 'string' ||
    !/^receipts\/[a-f0-9]{64}\.json$/.test(doc.receipt)
  )
    fail('Source snapshot identity/schema mismatch');
  const receipt = await readSafeBytes(join(root, doc.receipt), LIMIT);
  const { receipt: ignored, ...payload } = doc;
  if (
    sha256(receipt) !== doc.receipt.slice(9, -5) ||
    !receipt.equals(Buffer.from(JSON.stringify(payload) + '\n'))
  )
    fail('Source snapshot receipt mismatch');
  const rows = new Map<string, SnapshotRow>();
  for (const raw of doc.collected) {
    if (
      !record(raw) ||
      typeof raw.path !== 'string' ||
      typeof raw.source !== 'string' ||
      typeof raw.status !== 'string'
    )
      fail('Invalid snapshot row');
    const row = raw as SnapshotRow;
    safeRelative(row.path);
    const owner = sources.sources.find((s) => s.id === row.source);
    const entry = owner?.files?.find((f) => matchesGlob(row.path, f.path));
    if (!entry || rows.has(row.path)) fail('Unknown or duplicate snapshot path: ' + row.path);
    if (row.url !== undefined && row.method !== 'import' && row.url !== entry.url)
      fail('Snapshot source URL mismatch');
    if (row.status === 'ok') {
      if (
        typeof row.file !== 'string' ||
        typeof row.sha256 !== 'string' ||
        !HEX.test(row.sha256) ||
        !Number.isSafeInteger(row.bytes)
      )
        fail('Invalid successful snapshot row');
      safeRelative(row.file);
      const facts = await fileFacts(join(root, row.file), row.bytes);
      if (facts.sha256 !== row.sha256) fail('Snapshot selected bytes changed');
    }
    if (row.raw !== undefined) {
      if (!Array.isArray(row.raw)) fail('Invalid raw acquisition facts');
      for (const fact of row.raw) {
        if (
          !record(fact) ||
          typeof fact.file !== 'string' ||
          typeof fact.sha256 !== 'string' ||
          !HEX.test(fact.sha256) ||
          !Number.isSafeInteger(fact.bytes)
        )
          fail('Invalid raw fact');
        const actual = await fileFacts(join(root, safeRelative(fact.file)), Number(fact.bytes));
        if (actual.sha256 !== fact.sha256) fail('Snapshot raw bytes changed');
        if (fact.wireFile !== undefined) {
          if (typeof fact.wireFile !== 'string' || typeof fact.wireSha256 !== 'string')
            fail('Invalid wire fact');
          if ((await fileFacts(join(root, safeRelative(fact.wireFile)))).sha256 !== fact.wireSha256)
            fail('Snapshot wire bytes changed');
        }
      }
    }
    rows.set(row.path, row);
  }
  return { rows, sha256: sha256(bytes), receipt: doc.receipt };
}
export interface PreparedInputs {
  sources: SourceRegistry;
  datasets: DatasetRegistry;
  inputs: ReleaseFile[];
  committedInputs: ReleaseFile[];
  selectedFiles: Map<string, string>;
  snapshot: { sha256: string; acquisitionSha256?: string; acquisitionReceipt?: string };
  registries: Record<string, string>;
  missingIntermediates: MissingIntermediate[];
}
export const mime = (path: string): string =>
  ({
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
    zip: 'application/zip',
    '7z': 'application/x-7z-compressed',
    json: 'application/json',
    jsonld: 'application/ld+json',
    xml: 'application/xml',
    html: 'text/html',
    txt: 'text/plain',
    csv: 'text/csv',
  })[path.split('.').at(-1)!.toLowerCase()] ?? 'application/octet-stream';

/** Authenticate the entire declared closure, not a validator's historical warning list. */
export async function prepareInputs(
  exportRoot: string,
  inputRoot: string,
  generators: readonly string[] = [],
): Promise<PreparedInputs> {
  await safeDirectory(inputRoot);
  const sourceBytes = await readSafeBytes(join(exportRoot, 'data/sources.yaml'), LIMIT);
  const datasetBytes = await readSafeBytes(join(exportRoot, 'data/datasets.yaml'), LIMIT);
  const pinBytes = await readSafeBytes(join(exportRoot, 'data/originals.sha256'), LIMIT);
  const [sources, datasets] = registries(
    parseYaml(sourceBytes.toString('utf8')),
    parseYaml(datasetBytes.toString('utf8')),
  );
  const pins = parsePins(pinBytes),
    selection = await snapshotSelection(inputRoot, sourceBytes, pinBytes, sources);
  const closure = transitiveInputClosure(sources, datasets);
  const available = new Set<string>(selection.rows.keys());
  for (const folder of ['data/originals', 'data/cache']) {
    const path = join(inputRoot, folder);
    if (await inspectPath(path))
      for (const file of await listFiles(path)) available.add(folder + '/' + file);
  }
  const committed = (await listFiles(exportRoot)).filter((p) => p.startsWith('data/inputs/'));
  const inputs = new Map<string, ReleaseFile>(),
    committedInputs = new Map<string, ReleaseFile>();
  const selectedFiles = new Map<string, string>();
  const missing: string[] = [];
  const missingIntermediates: MissingIntermediate[] = [];
  function generated(path: string, pattern: string, declaration: InputDeclaration): boolean {
    if (
      declaration.kind !== 'intermediate' ||
      declaration.entry.reproducible !== true ||
      !generators.includes(pattern) ||
      /[?*\[]/.test(path)
    )
      return false;
    safeRelative(path);
    if (!missingIntermediates.some((i) => i.path === path))
      missingIntermediates.push({
        path,
        declaration: pattern,
        datasets: declaration.datasets,
        ...(pins.get(path) ? { legacyPin: pins.get(path) } : {}),
      });
    return true;
  }
  for (const [declarations, paths, factsMap, fromSnapshot] of [
    [closure.external, [...new Set([...available, ...pins.keys()].filter(external))], inputs, true],
    [closure.committed, committed, committedInputs, false],
  ] as const) {
    for (const [pattern, declaration] of declarations) {
      const hits = paths.filter((p) => matchesGlob(p, pattern)).sort();
      if (!hits.length) {
        if (!generated(pattern, pattern, declaration)) missing.push(pattern);
        continue;
      }
      for (const path of hits) {
        safeRelative(path);
        if (fromSnapshot && !available.has(path)) {
          if (generated(path, pattern, declaration)) continue;
          fail('Missing declared input: ' + path, 3);
        }
        const row = fromSnapshot ? selection.rows.get(path) : undefined;
        if (row && row.status !== 'ok') fail('Required acquisition did not succeed: ' + path, 3);
        const selected = row?.file ?? path;
        const file = join(fromSnapshot ? inputRoot : exportRoot, safeRelative(selected));
        const facts = await fileFacts(file);
        const entryPin = declaration.entry.sha256;
        if (entryPin !== undefined && (typeof entryPin !== 'string' || !HEX.test(entryPin)))
          fail('Invalid registry pin: ' + path);
        const pin = pins.get(path);
        if (pin && entryPin && pin !== entryPin) fail('Registry/pin disagreement: ' + path);
        const expected = pin ?? entryPin;
        if (expected && facts.sha256 !== expected)
          fail('Input differs from committed pin: ' + path);
        if (!expected && declaration.entry.pinned !== false && fromSnapshot)
          fail('Input is not pinned in the processing commit: ' + path);
        if (row?.expected !== undefined && row.expected !== expected)
          fail('Snapshot expected pin mismatch: ' + path);
        const previous = factsMap.get(path);
        if (previous) {
          previous.datasets = [
            ...new Set([...(previous.datasets as string[]), ...declaration.datasets]),
          ].sort();
          continue;
        }
        const source = sources.sources.find((s) => s.id === declaration.source);
        const fact: ReleaseFile = {
          path,
          ...facts,
          mime: mime(path),
          kind: declaration.kind,
          datasets: declaration.datasets,
        };
        for (const key of ['producer', 'reproducible', 'category'])
          if (declaration.entry[key] !== undefined) fact[key] = declaration.entry[key];
        if (source) {
          fact.source = source.id;
          fact.acquisition = source.acquisition;
          for (const key of ['period', 'page'])
            if (source[key] !== undefined) fact[key] = source[key];
          for (const key of ['url', 'via'])
            if (declaration.entry[key] !== undefined) fact[key] = declaration.entry[key];
        }
        if (row) {
          fact.acquisitionMethod = row.method;
          if (row.retrieved) fact.retrieved = row.retrieved;
        }
        factsMap.set(path, fact);
        if (fromSnapshot) selectedFiles.set(path, file);
      }
    }
  }
  if (missing.length) fail('Missing declared inputs: ' + missing.sort().join(', '), 3);
  const ordered = [...inputs.values()];
  // Locale-independent canonical inventory order.
  ordered.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const committedOrdered = [...committedInputs.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return {
    sources,
    datasets,
    inputs: ordered,
    committedInputs: committedOrdered,
    selectedFiles,
    snapshot: {
      sha256: sha256(jsonBytes(ordered)),
      ...(selection.sha256
        ? { acquisitionSha256: selection.sha256, acquisitionReceipt: selection.receipt }
        : {}),
    },
    registries: {
      'data/sources.yaml': sha256(sourceBytes),
      'data/datasets.yaml': sha256(datasetBytes),
      'data/originals.sha256': sha256(pinBytes),
    },
    missingIntermediates: missingIntermediates.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  };
}
export async function stageInputs(prepared: PreparedInputs, exportRoot: string): Promise<void> {
  for (const fact of prepared.inputs)
    await copyAuthenticated(
      prepared.selectedFiles.get(fact.path)!,
      join(exportRoot, fact.path),
      fact,
    );
}
export async function verifyStagedInputs(
  prepared: PreparedInputs,
  exportRoot: string,
): Promise<void> {
  for (const fact of [...prepared.inputs, ...prepared.committedInputs]) {
    const actual = await fileFacts(join(exportRoot, fact.path), fact.bytes);
    if (actual.sha256 !== fact.sha256)
      fail('Executor changed an authenticated input: ' + fact.path);
  }
}
