import { inflateRawSync, crc32 } from 'node:zlib';
import { Worker } from 'node:worker_threads';
import { assert } from '../pdf/index.js';
import { createHash } from 'node:crypto';
import type { ProgrammePdfInput } from './programmes.js';
export const ARCHIVE_LIMITS = {
  maxBytes: 128 * 1024 * 1024,
  maxMemberBytes: 32 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxEntries: 2048,
  maxRatio: 1000,
  timeoutMs: 60_000,
} as const;
export function archivePath(name: string): void {
  assert(
    typeof name === 'string' &&
      name.length > 0 &&
      name.length <= 1024 &&
      !/^[\\/]|^[a-z]:/iu.test(name) &&
      !/[\\\0-\x1f\x7f]/u.test(name) &&
      name.split('/').every((p) => p && p !== '.' && p !== '..'),
    'Unsafe archive member path',
  );
}
interface ZipEntry {
  name: string;
  directory: boolean;
  read: () => Buffer;
}
/** ZIP32 central and local headers, CRC and declared/actual output bounds.
 * Legacy Parliament names are IBM866 as in the donor; UTF-8 flag is honored. */
export function programmeZip(bytes: Uint8Array): ZipEntry[] {
  const b = Buffer.from(bytes);
  assert(b.length <= ARCHIVE_LIMITS.maxBytes, 'Archive byte limit');
  let end = -1;
  for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--)
    if (b.readUInt32LE(p) === 0x06054b50 && p + 22 + b.readUInt16LE(p + 20) === b.length) {
      end = p;
      break;
    }
  assert(
    end >= 0 && b.readUInt16LE(end + 4) === 0 && b.readUInt16LE(end + 6) === 0,
    'Invalid/multidisk ZIP',
  );
  const count = b.readUInt16LE(end + 10),
    offset = b.readUInt32LE(end + 16);
  assert(
    count === b.readUInt16LE(end + 8) &&
      count < 65535 &&
      count <= ARCHIVE_LIMITS.maxEntries &&
      offset + b.readUInt32LE(end + 12) === end,
    'ZIP directory limit/bounds',
  );
  let p = offset,
    total = 0;
  const entries: ZipEntry[] = [],
    seen = new Set<string>(),
    ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    assert(p + 46 <= end && b.readUInt32LE(p) === 0x02014b50, 'Invalid ZIP entry');
    const flags = b.readUInt16LE(p + 8),
      method = b.readUInt16LE(p + 10),
      crc = b.readUInt32LE(p + 16),
      packed = b.readUInt32LE(p + 20),
      size = b.readUInt32LE(p + 24),
      n = b.readUInt16LE(p + 28),
      extra = b.readUInt16LE(p + 30),
      comment = b.readUInt16LE(p + 32),
      local = b.readUInt32LE(p + 42),
      mode = b.readUInt32LE(p + 38) >>> 16;
    assert(
      p + 46 + n + extra + comment <= end && b.readUInt16LE(p + 34) === 0,
      'Invalid ZIP entry bounds/disk',
    );
    const raw = b.subarray(p + 46, p + 46 + n),
      name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'ibm866', { fatal: true }).decode(raw),
      directory = name.endsWith('/'),
      clean = directory ? name.slice(0, -1) : name;
    archivePath(clean);
    const alias = clean.normalize('NFC').toLowerCase();
    assert(!seen.has(alias), 'Duplicate/alias ZIP member');
    seen.add(alias);
    assert(
      !(flags & 1) &&
        [0, 8].includes(method) &&
        ((mode & 0xf000) === 0 || (mode & 0xf000) === (directory ? 0x4000 : 0x8000)),
      'ZIP encryption/link/type/method',
    );
    total += size;
    assert(
      size <= ARCHIVE_LIMITS.maxMemberBytes &&
        total <= ARCHIVE_LIMITS.maxTotalBytes &&
        size <= Math.max(1, packed) * ARCHIVE_LIMITS.maxRatio,
      'ZIP expansion limit',
    );
    assert(
      local + 30 <= offset &&
        b.readUInt32LE(local) === 0x04034b50 &&
        b.readUInt16LE(local + 6) === flags &&
        b.readUInt16LE(local + 8) === method,
      'ZIP local header mismatch',
    );
    const ln = b.readUInt16LE(local + 26),
      lx = b.readUInt16LE(local + 28),
      start = local + 30 + ln + lx;
    assert(
      raw.equals(b.subarray(local + 30, local + 30 + ln)) && start + packed <= offset,
      'ZIP member name/bounds mismatch',
    );
    if (!(flags & 8))
      assert(
        b.readUInt32LE(local + 14) === crc &&
          b.readUInt32LE(local + 18) === packed &&
          b.readUInt32LE(local + 22) === size,
        'ZIP local CRC/size mismatch',
      );
    assert(!ranges.some(([a, z]) => local < z && start + packed > a), 'Overlapping ZIP members');
    ranges.push([local, start + packed]);
    entries.push({
      name,
      directory,
      read: () => {
        const compressed = b.subarray(start, start + packed),
          data =
            method === 0
              ? Buffer.from(compressed)
              : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
        assert(data.length === size && crc32(data) === crc, 'ZIP member size/CRC mismatch');
        return data;
      },
    });
    p += 46 + n + extra + comment;
  }
  assert(p === end, 'ZIP central directory size mismatch');
  return entries;
}
export interface SevenZipOptions {
  /** Absolute resolved 7z-wasm@1.2.0 module, supplied by the standalone Node package. */
  wasmModule: string;
  timeoutMs?: number;
}
export async function readProgrammeSevenZip(
  bytes: Uint8Array,
  options: SevenZipOptions,
): Promise<{ member: string; bytes: Uint8Array }[]> {
  assert(bytes.length <= ARCHIVE_LIMITS.maxBytes, '7z byte limit');
  const timeout = options.timeoutMs ?? ARCHIVE_LIMITS.timeoutMs;
  assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 60_000, 'Invalid 7z timeout');
  const worker = new Worker(new URL('./archive-worker.js', import.meta.url), {
    execArgv: process.execArgv.filter((a) => !a.startsWith('--input-type')),
    workerData: { bytes, wasmModule: options.wasmModule },
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('7z processing deadline')), timeout);
      worker.once('message', (r) => (r.error ? reject(new Error(r.error)) : resolve(r.files)));
      worker.once('error', reject);
      worker.once('exit', (code) => reject(new Error('7z worker exited before result: ' + code)));
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
export async function extractProgrammeArchive(bytes: Uint8Array, options: SevenZipOptions) {
  const pdfs: ProgrammePdfInput[] = [],
    members: { file: string; chain: string[]; sha256: string }[] = [],
    seen = new Set<string>();
  let total = 0;
  const add = (file: string, data: Uint8Array, chain: string[]) => {
    archivePath(file);
    assert(
      /^\d{4}[_-].*\.pdf$/iu.test(file) && !file.includes('/'),
      'Unexpected programme filename',
    );
    const alias = file.normalize('NFC').toLowerCase();
    assert(!seen.has(alias), 'Duplicate programme output alias');
    seen.add(alias);
    total += data.length;
    assert(total <= ARCHIVE_LIMITS.maxTotalBytes, 'Programme output total limit');
    pdfs.push({ file, bytes: data });
    members.push({ file, chain, sha256: createHash('sha256').update(data).digest('hex') });
  };
  const selected = programmeZip(bytes).filter(
    (e) => !e.directory && e.name.includes('7.Програмни'),
  );
  assert(selected.length > 0, 'Programme archive folder missing');
  for (const e of selected) {
    if (e.name.endsWith('.zip')) {
      for (const child of programmeZip(e.read()))
        if (!child.directory) {
          assert(child.name.endsWith('.pdf'), 'Unexpected nested programme ZIP member');
          add(child.name, child.read(), [e.name, child.name]);
        }
    } else if (e.name.endsWith('.7z')) {
      const files = await readProgrammeSevenZip(e.read(), options);
      assert(files.length === 1, 'Expected one judicial programme PDF');
      for (const f of files) add('0600_СВ.pdf', f.bytes, [e.name, f.member]);
    } else throw new Error('Unexpected programme archive member: ' + e.name);
  }
  assert(pdfs.length === 46, 'Incomplete programme archive: ' + pdfs.length);
  return { pdfs, members };
}
