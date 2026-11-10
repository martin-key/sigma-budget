import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, matchesGlob, resolve } from 'node:path';
import { registries, parseYaml, type SourceEntry } from '../../io/registry.js';
import { readPinned } from '../../io/data.js';
import { isIsoDay } from '../../common/dates.js';

export interface ReaderOptions {
  inputRoot: string;
  registryPath: string;
  /** sha256sum file, usually data/originals.sha256; registry hashes also work. */
  pinsPath?: string;
  readDate: string;
}
export interface InputReceipt {
  source: string;
  path: string;
  sha256: string;
  bytes: number;
  readDate: string;
  registry: { path: string; sha256: string };
  pins: { path: string; sha256: string } | null;
  url: string | null;
}
export interface ReadResult<T> {
  data: T;
  receipt: InputReceipt;
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function parsePins(text: string): Map<string, string> {
  const pins = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const m = /^([a-f0-9]{64}) [ *](.+)$/u.exec(line);
    if (!m || pins.has(m[2]!)) throw new Error('Invalid or duplicate SHA-256 pin');
    pins.set(m[2]!, m[1]!);
  }
  return pins;
}

/** Offline, source-scoped loading. This deliberately does not calculate the
 * dataset/intermediate dependency closure or perform acquisition. */
export class SnapshotReader {
  private constructor(
    private readonly options: ReaderOptions,
    private readonly sources: SourceEntry[],
    private readonly pins: Map<string, string>,
    private readonly metadata: Pick<InputReceipt, 'registry' | 'pins'>,
  ) {}

  static async open(options: ReaderOptions): Promise<SnapshotReader> {
    if (!isIsoDay(options.readDate)) throw new Error('Invalid reader date');
    const root = resolve(options.inputRoot);
    if ((await realpath(root)) !== root) throw new Error('Symlink in input root');
    const bytes = await readFile(options.registryPath);
    const [registry] = registries(parseYaml(bytes.toString('utf8')), { schema: 1, datasets: [] });
    const pinBytes = options.pinsPath ? await readFile(options.pinsPath) : undefined;
    return new SnapshotReader(
      { ...options, inputRoot: root },
      registry.sources,
      pinBytes ? parsePins(pinBytes.toString('utf8')) : new Map(),
      {
        registry: { path: resolve(options.registryPath), sha256: hash(bytes) },
        pins: pinBytes ? { path: resolve(options.pinsPath!), sha256: hash(pinBytes) } : null,
      },
    );
  }

  async read(sourceId: string, path: string): Promise<ReadResult<Buffer>> {
    if (
      isAbsolute(path) ||
      !/^(data\/originals|data\/cache)\//u.test(path) ||
      path.includes('\\') ||
      path.split('/').some((p) => !p || p === '.' || p === '..') ||
      /[\0*?\[\]{}]/u.test(path)
    )
      throw new Error(`Invalid source path: ${path}`);
    const source = this.sources.find((s) => s.id === sourceId);
    const entries = source?.files?.filter((f) => matchesGlob(path, f.path)) ?? [];
    if (entries.length !== 1)
      throw new Error(`Source path not uniquely registered: ${sourceId}: ${path}`);
    const entry = entries[0]!;
    const pin = this.pins.get(path),
      declared = entry.sha256;
    if (
      declared !== undefined &&
      (typeof declared !== 'string' || !/^[a-f0-9]{64}$/u.test(declared))
    )
      throw new Error(`Invalid registry pin: ${path}`);
    if (pin && declared && pin !== declared) throw new Error(`Conflicting source pins: ${path}`);
    const expected = pin ?? declared;
    if (!expected) throw new Error(`Missing source pin: ${path}`);
    let target = this.options.inputRoot;
    for (const part of path.split('/')) {
      target = join(target, part);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error(`Symlink in source path: ${path}`);
    }
    const info = await lstat(target);
    if (!info.isFile() || info.size > 128 * 1024 * 1024)
      throw new Error(`Unsupported source file: ${path}`);
    const data = await readPinned(target, expected);
    return {
      data,
      receipt: {
        ...this.metadata,
        source: sourceId,
        path,
        sha256: expected,
        bytes: data.length,
        readDate: this.options.readDate,
        url: typeof entry.url === 'string' ? entry.url : null,
      },
    };
  }
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
