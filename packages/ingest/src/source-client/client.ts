import { join, resolve, matchesGlob, basename } from 'node:path';
import { parseYaml, registries, type SourceEntry } from '../io/registry.js';
import { byteKind, validateBytes, type ByteKind } from './formats.js';
import { download, publicUrl, type Download, type FetchOptions } from './transport.js';
import {
  GISCO_CSV,
  GISCO_GEOJSON,
  LAU_BASE,
  OBLAST_BASE,
  OBLAST_URL,
  reduceGisco,
  reduceOblast,
} from './reducers.js';
import {
  exists,
  guardOutput,
  immutable,
  jsonBytes,
  listFiles,
  noLinks,
  readBounded,
  replacePointer,
  safeRelative,
  sha256,
  withLock,
} from './files.js';

const AUTO = new Set(['auto', 'fetch', 'fetch-bg', 'auto-bg']);
const HEX = /^[a-f0-9]{64}$/;
type EntryFile = NonNullable<SourceEntry['files']>[number];
export interface SourceFile {
  source: SourceEntry;
  entry: EntryFile;
  path: string;
  expected?: string;
}
export interface BlobFact {
  file: string;
  sha256: string;
  bytes: number;
  url?: string;
  httpStatus?: number;
  encoding?: string;
  attempts?: number;
  wireFile?: string;
  wireSha256?: string;
}
export interface AcquisitionRow {
  source: string;
  path: string;
  url?: string;
  page?: string;
  original?: string;
  imported?: string;
  expected?: string;
  status: 'ok' | 'unavailable' | 'manual' | 'historical-unverified';
  method: 'fetch' | 'reduce' | 'preserve' | 'import';
  drift?: 'same' | 'changed' | 'un-pinned';
  file?: string;
  sha256?: string;
  retrieved?: string;
  bytes?: number;
  kind?: ByteKind;
  raw?: BlobFact[];
  error?: string;
  checks?: Record<string, unknown>;
  replaces?: { path: string; sha256: string }[];
  proposedPins?: { path: string; sha256: string }[];
  resumed?: boolean;
}
export interface SourceSnapshot {
  schema: 'source-snapshot/1';
  identity: string;
  operation: 'collect' | 'refetch' | 'import-source';
  started: string;
  completed: string;
  complete: boolean;
  numericalValidation: 'not-run';
  historicalReconstruction: 'unverified';
  collected: AcquisitionRow[];
  receipt?: string;
  manifestSha256?: string;
}
export interface ClientOptions extends FetchOptions {
  sourceRoot: string;
  registryPath: string;
  pinsPath?: string;
  clock?: () => Date;
}
export interface CollectOptions {
  snapshotRoot: string;
  seedRoot?: string;
  sources?: string[];
  resume?: boolean;
  checkDrift?: boolean;
  summaryPath?: string;
}
export interface OperationResult {
  code: number;
  snapshot: SourceSnapshot;
  snapshotSha256: string;
  dryRun?: boolean;
}
export interface KfpGrid {
  sheet: string;
  rows: number;
  columns: number;
  title: string;
  unitText: string;
}
/** Bind PR43's real workbook reader here. A hash/magic check is never a substitute. */
export type KfpDecoder = (bytes: Buffer) => KfpGrid | Promise<KfpGrid>;
export interface ImportOptions {
  source: string;
  file: string;
  snapshotRoot: string;
  url?: string;
  replace?: boolean;
  dryRun?: boolean;
  decodeKfp?: KfpDecoder;
  summaryPath?: string;
}
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
export class SourceClient {
  readonly sources: SourceEntry[];
  readonly pins: ReadonlyMap<string, string>;
  readonly identity: string;
  readonly protectedPaths: string[];
  readonly sourceRoot: string;
  private constructor(
    readonly options: ClientOptions,
    sources: SourceEntry[],
    pins: Map<string, string>,
    identity: string,
  ) {
    this.sources = sources;
    this.pins = pins;
    this.identity = identity;
    this.sourceRoot = resolve(options.sourceRoot);
    this.protectedPaths = [
      this.sourceRoot,
      resolve(options.registryPath),
      ...(options.pinsPath ? [resolve(options.pinsPath)] : []),
    ];
  }
  static async open(options: ClientOptions): Promise<SourceClient> {
    await noLinks(options.sourceRoot);
    if (!(await exists(options.sourceRoot))) throw new Error('Source root does not exist');
    const registry = await readBounded(options.registryPath, 8 * 1024 * 1024);
    const [reg] = registries(parseYaml(registry.toString('utf8')), { schema: 1, datasets: [] });
    const pins = new Map<string, string>();
    const pinBytes = options.pinsPath
      ? await readBounded(options.pinsPath, 8 * 1024 * 1024)
      : Buffer.alloc(0);
    for (const line of pinBytes.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      if (!match) throw new Error('Malformed SHA-256 pin line');
      const path = safeRelative(match[2]!);
      if (pins.has(path)) throw new Error('Duplicate pin path: ' + path);
      pins.set(path, match[1]!);
    }
    const ownership = new Set<string>();
    for (const source of reg.sources) {
      for (const entry of source.files ?? []) {
        safeRelative(entry.path, true);
        if (ownership.has(entry.path)) {
          // zdb and excise-law intentionally share the same raw DV page.
          const other = reg.sources
            .flatMap((s) => (s.files ?? []).filter((f) => f.path === entry.path))
            .filter((f) => f !== entry);
          if (other.some((f) => f.url !== entry.url || f.sha256 !== entry.sha256))
            throw new Error('Conflicting registered source path');
        }
        ownership.add(entry.path);
        if (
          entry.sha256 !== undefined &&
          (typeof entry.sha256 !== 'string' || !HEX.test(entry.sha256))
        )
          throw new Error('Invalid registry SHA-256');
        if (pins.has(entry.path) && entry.sha256 && pins.get(entry.path) !== entry.sha256)
          throw new Error('Registry/pin disagreement: ' + entry.path);
        if (entry.url !== undefined) publicUrl(String(entry.url), options.allowLocalHttp);
        if (AUTO.has(source.acquisition) && /[*?\[\]{}]/.test(entry.path))
          throw new Error('Automatic acquisition requires an exact registered path');
      }
    }
    return new SourceClient(
      options,
      reg.sources,
      pins,
      sha256(Buffer.concat([registry, Buffer.from('\0'), pinBytes])),
    );
  }
  now(): string {
    const date = (this.options.clock ?? (() => new Date()))();
    if (!(date instanceof Date) || Number.isNaN(date.getTime()))
      throw new Error('Invalid acquisition clock');
    return date.toISOString();
  }
  files(sourceIds?: string[]): SourceFile[] {
    if (
      sourceIds &&
      (!sourceIds.length ||
        new Set(sourceIds).size !== sourceIds.length ||
        sourceIds.some((id) => !this.sources.some((s) => s.id === id)))
    )
      throw new Error('Unknown or duplicate source selection');
    return this.sources
      .filter((s) => !sourceIds || sourceIds.includes(s.id))
      .flatMap((source) =>
        (source.files ?? [])
          .filter((entry) => /^(data\/originals|data\/cache)\//.test(entry.path))
          .map((entry) => ({
            source,
            entry,
            path: entry.path,
            expected: this.pins.get(entry.path) ?? text(entry.sha256),
          })),
      );
  }
  async protectOutput(root: string, additional: string[] = [], summary?: string): Promise<void> {
    await guardOutput(root, [...this.protectedPaths, ...additional]);
    if (summary) {
      await guardOutput(summary, [...this.protectedPaths, ...additional, root]);
      if (await exists(summary)) throw new Error('Summary output already exists');
    }
  }
  private blank(
    operation: SourceSnapshot['operation'],
    extra: Partial<SourceSnapshot> = {},
  ): SourceSnapshot {
    const now = this.now();
    return {
      schema: 'source-snapshot/1',
      identity: this.identity,
      operation,
      started: now,
      completed: now,
      complete: false,
      numericalValidation: 'not-run',
      historicalReconstruction: 'unverified',
      collected: [],
      ...extra,
    };
  }
  private async checkpoint(root: string, snapshot: SourceSnapshot): Promise<void> {
    snapshot.completed = this.now();
    const { receipt: _, ...payload } = snapshot;
    const bytes = jsonBytes(payload),
      receipt = 'receipts/' + sha256(bytes) + '.json';
    await immutable(join(root, receipt), bytes);
    snapshot.receipt = receipt;
    await replacePointer(join(root, 'snapshot.json'), jsonBytes(snapshot));
  }
  async readSnapshot(path: string): Promise<SourceSnapshot> {
    const bytes = await readBounded(path, 32 * 1024 * 1024),
      doc = JSON.parse(bytes.toString('utf8')) as SourceSnapshot;
    if (
      doc.schema !== 'source-snapshot/1' ||
      doc.identity !== this.identity ||
      !Array.isArray(doc.collected) ||
      doc.numericalValidation !== 'not-run' ||
      doc.historicalReconstruction !== 'unverified'
    )
      throw new Error('Snapshot identity or schema mismatch');
    const root = resolve(path, '..');
    if (!doc.receipt || !/^receipts\/[a-f0-9]{64}\.json$/.test(doc.receipt))
      throw new Error('Snapshot receipt is missing');
    const receipt = await readBounded(join(root, safeRelative(doc.receipt)), 32 * 1024 * 1024);
    const { receipt: _, ...payload } = doc;
    if (sha256(receipt) !== basename(doc.receipt, '.json') || !receipt.equals(jsonBytes(payload)))
      throw new Error('Snapshot receipt mismatch');
    const seen = new Set<string>();
    for (const row of doc.collected) {
      safeRelative(row.path);
      if (!this.sources.some((s) => s.id === row.source) || seen.has(row.source + '\0' + row.path))
        throw new Error('Invalid snapshot source identity');
      seen.add(row.source + '\0' + row.path);
      const owner = this.files([row.source]).find((f) => matchesGlob(row.path, f.path));
      if (!owner) throw new Error('Snapshot path is not registered');
      if (row.url && row.url !== owner.entry.url && row.method !== 'import')
        throw new Error('Snapshot URL changed');
      if (row.file) {
        const data = await readBounded(
          join(root, safeRelative(row.file)),
          this.options.maxDecodedBytes ?? this.options.maxBytes,
        );
        if (!row.sha256 || sha256(data) !== row.sha256 || data.length !== row.bytes)
          throw new Error('Snapshot source bytes changed');
      } else if (row.status === 'ok') throw new Error('Successful snapshot row has no file');
      for (const fact of row.raw ?? []) {
        const bytes = await readBounded(
          join(root, safeRelative(fact.file)),
          this.options.maxDecodedBytes ?? this.options.maxBytes,
        );
        if (sha256(bytes) !== fact.sha256 || bytes.length !== fact.bytes)
          throw new Error('Snapshot raw bytes changed');
        if (fact.wireFile) {
          const wire = await readBounded(
            join(root, safeRelative(fact.wireFile)),
            this.options.maxBytes,
          );
          if (sha256(wire) !== fact.wireSha256) throw new Error('Snapshot wire bytes changed');
        }
      }
    }
    return doc;
  }
  private async seed(seed: string, root: string): Promise<void> {
    for (const folder of ['data/originals', 'data/cache']) {
      for (const rel of await listFiles(join(seed, folder))) {
        const target = join(root, folder, safeRelative(rel));
        if (!(await exists(target)))
          await immutable(
            target,
            await readBounded(join(seed, folder, rel), this.options.maxBytes),
          );
      }
    }
  }
  private async store(root: string, path: string, bytes: Buffer): Promise<string> {
    safeRelative(path);
    const file =
      (await exists(join(root, path))) &&
      sha256(
        await readBounded(join(root, path), this.options.maxDecodedBytes ?? this.options.maxBytes),
      ) !== sha256(bytes)
        ? 'versions/' + sha256(bytes) + '/' + path
        : path;
    await immutable(join(root, file), bytes);
    return file;
  }
  private async fetched(
    root: string,
    url: string,
    path: string,
    format?: string,
  ): Promise<{ data: Download; fact: BlobFact }> {
    const data = await download(url, this.options, (b) => {
      validateBytes(path, b, format);
    });
    const digest = sha256(data.bytes),
      file = 'raw/' + digest;
    await immutable(join(root, file), data.bytes);
    const wireDigest = sha256(data.wire);
    const wireFile = data.encoding === 'gzip' ? 'raw/' + wireDigest : undefined;
    if (wireFile) await immutable(join(root, wireFile), data.wire);
    return {
      data,
      fact: {
        file,
        sha256: digest,
        bytes: data.bytes.length,
        url: data.url,
        httpStatus: data.status,
        encoding: data.encoding,
        attempts: data.attempts,
        ...(wireFile ? { wireFile, wireSha256: wireDigest } : {}),
      },
    };
  }
  private async acquire(root: string, f: SourceFile): Promise<AcquisitionRow> {
    const row: AcquisitionRow = {
      source: f.source.id,
      path: f.path,
      url: text(f.entry.url),
      expected: f.expected,
      status: 'unavailable',
      method: f.entry.via ? 'reduce' : 'fetch',
    };
    const raw: BlobFact[] = [];
    try {
      if (
        !row.url ||
        ['minfin.bg', 'www.minfin.bg'].includes(new URL(row.url).hostname) ||
        f.source.access === 'browser-only'
      )
        throw new Error('Automatic URL missing or browser-only source');
      let bytes: Buffer;
      if (f.entry.via) {
        if (
          f.path === 'data/cache/gisco_lau_bg.json' &&
          f.source.id === 'gisco' &&
          row.url === LAU_BASE
        ) {
          const csv = await this.fetched(root, GISCO_CSV, 'gisco.csv');
          raw.push(csv.fact);
          const geo = await this.fetched(root, GISCO_GEOJSON, 'gisco.geojson');
          raw.push(geo.fact);
          bytes = jsonBytes(reduceGisco(csv.data.bytes, geo.data.bytes));
        } else if (
          f.path === 'data/cache/eurostat_pop_nuts3_bg.json' &&
          f.source.id === 'eurostat' &&
          row.url === OBLAST_BASE
        ) {
          const pop = await this.fetched(root, OBLAST_URL, 'oblast.json');
          raw.push(pop.fact);
          bytes = jsonBytes(reduceOblast(pop.data.bytes));
        } else throw new Error('Unknown registered acquisition reducer');
      } else {
        const fetched = await this.fetched(root, row.url, f.path, text(f.source.format));
        raw.push(fetched.fact);
        bytes = fetched.data.bytes;
      }
      const kind = validateBytes(f.path, bytes, text(f.source.format)),
        digest = sha256(bytes);
      const file = await this.store(root, f.path, bytes);
      return {
        ...row,
        status: 'ok',
        file,
        sha256: digest,
        bytes: bytes.length,
        kind,
        raw,
        retrieved: this.now(),
        drift: f.expected ? (digest === f.expected ? 'same' : 'changed') : 'un-pinned',
        checks: {
          byteKind: kind,
          numericalValidation: 'not-run',
          historicalRaw: f.entry.via ? 'new-acquisition-only' : 'not-asserted',
        },
      };
    } catch (error) {
      return { ...row, raw, error: error instanceof Error ? error.message : 'Acquisition failed' };
    }
  }
  private result(snapshot: SourceSnapshot, checkDrift = false): OperationResult {
    const unavailable = snapshot.collected.some((r) => r.status === 'unavailable');
    const changed = snapshot.collected.some((r) => r.status === 'ok' && r.drift !== 'same');
    return {
      code: unavailable ? 3 : checkDrift && changed ? 1 : 0,
      snapshot,
      snapshotSha256: sha256(jsonBytes(snapshot)),
    };
  }
  async collect(options: CollectOptions): Promise<OperationResult> {
    const seed = resolve(options.seedRoot ?? this.sourceRoot),
      root = resolve(options.snapshotRoot);
    const files = this.files(options.sources);
    await this.protectOutput(root, [seed], options.summaryPath);
    return withLock(root, async () => {
      const previous =
        options.resume && (await exists(join(root, 'snapshot.json')))
          ? await this.readSnapshot(join(root, 'snapshot.json'))
          : undefined;
      await this.seed(seed, root);
      const snapshot = this.blank('collect');
      for (const f of files) {
        if (!AUTO.has(f.source.acquisition)) continue;
        const old =
          previous?.operation === 'collect'
            ? previous.collected.find(
                (r) =>
                  r.source === f.source.id &&
                  r.path === f.path &&
                  r.expected === f.expected &&
                  r.status === 'ok',
              )
            : undefined;
        snapshot.collected.push(old ? { ...old, resumed: true } : await this.acquire(root, f));
        await this.checkpoint(root, snapshot);
      }
      snapshot.complete = true;
      await this.checkpoint(root, snapshot);
      if (options.summaryPath)
        await immutable(options.summaryPath, Buffer.from(driftMarkdown(snapshot)));
      return this.result(snapshot, options.checkDrift);
    });
  }
  async refetch(options: CollectOptions & { manifestPath: string }): Promise<OperationResult> {
    const root = resolve(options.snapshotRoot);
    await this.protectOutput(root, [options.manifestPath], options.summaryPath);
    const bytes = await readBounded(options.manifestPath, 16 * 1024 * 1024);
    const manifest: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !manifest ||
      typeof manifest !== 'object' ||
      !Array.isArray((manifest as { inputs?: unknown }).inputs)
    )
      throw new Error('Manifest inputs missing');
    const files: SourceFile[] = [];
    for (const input of (manifest as { inputs: Record<string, unknown>[] }).inputs) {
      if (input.kind !== 'source') continue;
      if (
        typeof input.path !== 'string' ||
        typeof input.source !== 'string' ||
        typeof input.sha256 !== 'string' ||
        !HEX.test(input.sha256)
      )
        throw new Error('Invalid manifest source');
      const found = this.files([input.source]).find((f) =>
        matchesGlob(input.path as string, f.path),
      );
      if (
        !found ||
        text(input.url) !== text(found.entry.url) ||
        text(input.via) !== text(found.entry.via) ||
        input.acquisition !== found.source.acquisition
      )
        throw new Error('Manifest/registry source identity mismatch');
      if (files.some((f) => f.path === input.path && f.source.id === input.source))
        throw new Error('Duplicate manifest source');
      files.push({ ...found, path: safeRelative(input.path), expected: input.sha256 });
    }
    return withLock(root, async () => {
      const manifestSha256 = sha256(bytes);
      const previous =
        options.resume && (await exists(join(root, 'snapshot.json')))
          ? await this.readSnapshot(join(root, 'snapshot.json'))
          : undefined;
      if (
        previous &&
        (previous.operation !== 'refetch' || previous.manifestSha256 !== manifestSha256)
      )
        throw new Error('Resume manifest changed');
      const snapshot = this.blank('refetch', { manifestSha256 });
      for (const f of files) {
        if (!AUTO.has(f.source.acquisition) || !f.entry.url) {
          snapshot.collected.push({
            source: f.source.id,
            path: f.path,
            url: text(f.entry.url),
            expected: f.expected,
            status: 'manual',
            method: 'preserve',
            error: 'Manual source; not refetched',
          });
        } else {
          const old = previous?.collected.find(
            (r) => r.source === f.source.id && r.path === f.path && r.status === 'ok',
          );
          snapshot.collected.push(old ? { ...old, resumed: true } : await this.acquire(root, f));
        }
        await this.checkpoint(root, snapshot);
      }
      snapshot.complete = true;
      await this.checkpoint(root, snapshot);
      if (options.summaryPath)
        await immutable(options.summaryPath, Buffer.from(driftMarkdown(snapshot)));
      // Python refetch prioritizes actual drift over an unavailable response.
      const result = this.result(snapshot, true);
      if (snapshot.collected.some((r) => r.status === 'ok' && r.drift === 'changed'))
        result.code = 1;
      return result;
    });
  }
  async status() {
    const rows: {
      source: string | null;
      path: string;
      expected?: string;
      sha256?: string;
      state: string;
      acquisition?: string;
      optional: boolean;
    }[] = [];
    const files = this.files();
    const seen = new Set<string>();
    const paths = new Set([
      ...this.pins.keys(),
      ...files.filter((f) => !/[*?\[\]{}]/.test(f.path)).map((f) => f.path),
    ]);
    for (const folder of ['data/originals', 'data/cache'])
      for (const p of await listFiles(join(this.sourceRoot, folder))) paths.add(folder + '/' + p);
    for (const path of [...paths].sort()) {
      if (!/^(data\/originals|data\/cache)\//.test(path)) continue;
      const f = files.find((f) => matchesGlob(path, f.path));
      const expected = this.pins.get(path) ?? f?.expected;
      const base = {
        source: f?.source.id ?? null,
        path,
        expected,
        acquisition: f?.source.acquisition,
        // originals.py OPTIONAL: metadata retained for reference, not a build source.
        optional: path.startsWith('data/originals/data_europa/'),
      };
      if (!(await exists(join(this.sourceRoot, path)))) {
        rows.push({ ...base, state: expected ? 'historical-unverified' : 'missing' });
        continue;
      }
      const bytes = await readBounded(join(this.sourceRoot, path), this.options.maxBytes),
        digest = sha256(bytes);
      let state = expected
        ? digest === expected
          ? 'present'
          : f?.source.live === true
            ? 'live-changed'
            : 'changed'
        : 'un-pinned';
      try {
        validateBytes(path, bytes, text(f?.source.format));
      } catch {
        state = 'wrong-format';
      }
      rows.push({ ...base, sha256: digest, state });
      seen.add(path);
    }
    const months = [...seen]
      .map((p) => /\/kfp_(\d{4})\/.*EU[ _]funds_(\d{2})(\d{2})_/i.exec(p))
      .filter((m) => m && m[1]!.slice(-2) === m[3] && +m[2]! >= 1 && +m[2]! <= 12)
      .map((m) => m![1] + '-' + m![2])
      .sort();
    const latest = months.at(-1);
    const latestAsOf = latest
      ? new Date(Date.UTC(+latest.slice(0, 4), +latest.slice(5), 0)).toISOString().slice(0, 10)
      : undefined;
    return {
      code: rows.some(
        (r) =>
          !r.optional &&
          ['historical-unverified', 'missing', 'wrong-format', 'changed'].includes(r.state),
      )
        ? 1
        : 0,
      rows,
      latestAsOf,
      numericalValidation: 'not-run' as const,
      historicalReconstruction: 'unverified' as const,
    };
  }
  async importSource(options: ImportOptions): Promise<OperationResult> {
    const root = resolve(options.snapshotRoot);
    await this.protectOutput(root, [options.file], options.summaryPath);
    const source = this.sources.find((s) => s.id === options.source);
    if (
      !source ||
      !['import', 'manual', 'supplied', 'fetch', 'fetch-bg', 'auto', 'auto-bg'].includes(
        source.acquisition,
      )
    )
      throw new Error('Unknown or non-importable source');
    if (options.url) {
      const url = publicUrl(options.url, this.options.allowLocalHttp);
      const allowed = [source.page, ...(source.files ?? []).map((f) => f.url)].filter(
        (v): v is string => typeof v === 'string',
      );
      if (!allowed.some((v) => new URL(v).origin === new URL(url).origin))
        throw new Error('Manual source URL is not registered');
    }
    const bytes = await readBounded(options.file, this.options.maxBytes),
      digest = sha256(bytes);
    const registered = this.files([source.id]);
    // Both supported pin sources describe historical versions, including when
    // their bytes are absent. Use the same inventory for restore and correction.
    const expectedPins = new Map([
      ...this.pins,
      ...registered
        .filter((f) => f.expected && !/[*?\[\]{}]/.test(f.path))
        .map((f): [string, string] => [f.path, f.expected!]),
    ]);
    const known = [...expectedPins]
      .filter(([, hash]) => hash === digest)
      .map(([path]) => path)
      .filter((p) => registered.some((f) => matchesGlob(p, f.path)));
    let path: string,
      checks: Record<string, unknown>,
      proposedPins: { path: string; sha256: string }[] | undefined;
    if (known.length) {
      path = known[0]!;
      checks = { match: 'registered-sha256', numericalValidation: 'not-run' };
    } else {
      if (source.id !== 'kfp' || byteKind(bytes) !== 'xls')
        throw new Error('Unknown hash; only new monthly KFP reports can be identified by content');
      if (!options.decodeKfp)
        throw new Error('KFP physical workbook decoder is required for an unpinned report');
      const period = validateKfpGrid(await options.decodeKfp(bytes));
      const suffix = /_BG_WEB(_\d+)?\.xls$/i.exec(basename(options.file))?.[1] ?? '';
      path = `data/originals/kfp_${period.year}/${period.year}-EU_funds_${String(period.month).padStart(2, '0')}${String(period.year).slice(-2)}_BG_WEB${suffix}.xls`;
      if (!registered.some((f) => matchesGlob(path, f.path)))
        throw new Error('KFP period is outside the registered file patterns');
      checks = { ...period, sheet: 'стартова', size: [54, 4], numericalValidation: 'not-run' };
      proposedPins = [{ path, sha256: digest }];
    }
    const kind = validateBytes(path, bytes, text(source.format));
    const snapshot = this.blank('import-source');
    const operation = async (): Promise<OperationResult> => {
      const replaces: { path: string; sha256: string }[] = [];
      if (proposedPins) {
        const key = kfpMonth(path);
        const versions = [...expectedPins].map(([path, sha256]) => ({ path, sha256 }));
        for (const tree of [this.sourceRoot, root])
          for (const rel of await listFiles(join(tree, 'data/originals'))) {
            const p = 'data/originals/' + rel;
            if (key && kfpMonth(p) === key)
              versions.push({
                path: p,
                sha256: sha256(await readBounded(join(tree, p), this.options.maxBytes)),
              });
          }
        for (const version of versions)
          if (
            key &&
            kfpMonth(version.path) === key &&
            version.sha256 !== digest &&
            !replaces.some((r) => r.path === version.path && r.sha256 === version.sha256)
          )
            replaces.push(version);
        if (replaces.length && !options.replace)
          throw new Error(
            'A different KFP version is present or pinned; --replace is required to record a correction candidate',
          );
      }
      const expected = expectedPins.get(path);
      const row: AcquisitionRow = {
        source: source.id,
        path,
        url: options.url,
        page: text(source.page),
        original: basename(options.file),
        imported: this.now(),
        expected,
        status: 'ok',
        method: 'import',
        sha256: digest,
        bytes: bytes.length,
        kind,
        retrieved: this.now(),
        drift: expected ? (expected === digest ? 'same' : 'changed') : 'un-pinned',
        checks: { ...checks, retrievedBasis: 'import-time-only' },
        ...(replaces.length ? { replaces } : {}),
        ...(proposedPins ? { proposedPins } : {}),
      };
      if (!options.dryRun) {
        await this.seed(this.sourceRoot, root);
        row.file = await this.store(root, path, bytes);
        const rawFile = 'raw/' + digest;
        await immutable(join(root, rawFile), bytes);
        row.raw = [{ file: rawFile, sha256: digest, bytes: bytes.length, url: row.url }];
      }
      snapshot.collected.push(row);
      snapshot.complete = true;
      if (!options.dryRun) {
        await this.checkpoint(root, snapshot);
        if (options.summaryPath)
          await immutable(options.summaryPath, Buffer.from(driftMarkdown(snapshot)));
      }
      return { ...this.result(snapshot), ...(options.dryRun ? { dryRun: true } : {}) };
    };
    return options.dryRun ? operation() : withLock(root, operation);
  }
}
export function kfpMonth(path: string): string | undefined {
  const m = /\/kfp_(\d{4})\/[^/]*EU[ _]funds_(\d{2})(\d{2})_BG_WEB(?:_\d+)?\.xls$/i.exec(path);
  return m && m[1]!.slice(-2) === m[3] ? m[1] + '-' + m[2] : undefined;
}
export function validateKfpGrid(grid: KfpGrid) {
  if (grid.sheet !== 'стартова' || grid.rows !== 54 || grid.columns !== 4)
    throw new Error('KFP requires sheet стартова, 54 rows and 4 columns');
  const m = /КЪМ\s+(\d{2})\.(\d{2})\.(\d{4})\s+ГОДИНА/.exec(grid.title);
  if (!m) throw new Error('KFP cell A3 has no as-of date');
  const day = +m[1]!,
    month = +m[2]!,
    year = +m[3]!;
  if (
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day !== new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    throw new Error('KFP period must end on the last day of the month');
  const unitText = grid.unitText.replace(/\s/gu, '').toLowerCase();
  const unit = unitText.includes('млн.лв')
    ? 'BGN'
    : unitText.includes('млн.евро')
      ? 'EUR'
      : undefined;
  if (unit !== (year <= 2025 ? 'BGN' : 'EUR'))
    throw new Error('KFP unit disagrees with the report year');
  return {
    year,
    month,
    day,
    unit,
    asOf: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}
export function driftMarkdown(snapshot: SourceSnapshot): string {
  const escape = (v: unknown) =>
    String(v ?? '—')
      .replace(/[|\r\n]/g, ' ')
      .replace(/</g, '&lt;');
  return [
    '# Source acquisition drift',
    '',
    'Byte-kind and provenance checks only. Numerical validation has not run. Historical reconstruction is unverified. Pins remain unchanged.',
    '',
    '| Source | File | Result | SHA-256 | Expected | Detail |',
    '|---|---|---|---|---|---|',
    ...snapshot.collected.map(
      (r) =>
        '| ' +
        [
          r.source,
          r.path,
          r.drift ?? r.status,
          r.sha256,
          r.expected,
          r.error ??
            (r.method === 'reduce' ? 'New raw acquisition; historical raw unavailable' : r.method),
        ]
          .map(escape)
          .join(' | ') +
        ' |',
    ),
    '',
  ].join('\n');
}
