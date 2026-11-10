/** Isolated, deadline-bound MEMFS only. Never mount NODEFS/WORKERFS. */
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { ARCHIVE_LIMITS, archivePath } from './archive.js';
import { assert } from '../pdf/index.js';
import { crc32 } from 'node:zlib';
async function main() {
  assert(isAbsolute(workerData.wasmModule), '7z module must be absolute');
  const pkg = JSON.parse(
    await readFile(join(dirname(workerData.wasmModule), 'package.json'), 'utf8'),
  );
  assert(pkg.name === '7z-wasm' && pkg.version === '1.2.0', 'Expected pinned 7z-wasm@1.2.0');
  const factory = createRequire(import.meta.url)(workerData.wasmModule);
  let log: string[] = [];
  let length = 0;
  // Emscripten 1.2.0 initializes NODEFS flags even though only MEMFS is mounted.
  // Its deprecated binding('constants') is unavailable under Node permissions.
  // Supply only the equivalent public read-only constants; other bindings remain denied.
  const originalBinding = (process as any).binding;
  (process as any).binding = (name: string) =>
    name === 'constants' ? { fs: Object.freeze({ ...fsConstants }) } : originalBinding(name);
  let module: any;
  try {
    module = await factory({
      noInitialRun: true,
      print: (s: string) => {
        s = String(s ?? '');
        length += s.length;
        assert(length <= 2 * 1024 * 1024, '7z listing limit');
        log.push(s);
      },
      printErr: (s: string) => {
        length += String(s ?? '').length;
        assert(length <= 2 * 1024 * 1024, '7z error limit');
      },
      stdin: () => null,
    });
  } finally {
    (process as any).binding = originalBinding;
  }
  module.FS.writeFile('/archive.7z', new Uint8Array(workerData.bytes));
  const run = (args: string[]) => {
    try {
      const rc = module.callMain(args);
      assert(rc === undefined || rc === 0, '7z failed: ' + rc);
    } catch (e) {
      if ((e as any).status !== 0) throw e;
    }
  };
  run(['l', '-slt', '-ba', '-bsp0', '-sccUTF-8', '-p', '--', '/archive.7z']);
  const entries = log
    .join('\n')
    .trim()
    .split(/\n\s*\n/u)
    .filter(Boolean)
    .map((block) => {
      const entry: Record<string, string> = {};
      for (const line of block.split('\n')) {
        const m = /^([^=]+?) = (.*)$/u.exec(line);
        assert(m && !Object.hasOwn(entry, m[1]!), 'Malformed 7z listing');
        entry[m[1]!] = m[2]!;
      }
      return entry;
    });
  assert(entries.length > 0 && entries.length <= ARCHIVE_LIMITS.maxEntries, '7z entry count limit');
  let total = 0;
  const seen = new Set<string>(),
    selected: Record<string, string>[] = [];
  for (const e of entries) {
    archivePath(e.Path!);
    const alias = e.Path!.normalize('NFC').toLowerCase();
    assert(!seen.has(alias), '7z duplicate/alias path');
    seen.add(alias);
    const size = Number(e.Size),
      packed = e['Packed Size'] === '' ? workerData.bytes.length : Number(e['Packed Size']);
    assert(
      Number.isSafeInteger(size) && size >= 0 && size <= ARCHIVE_LIMITS.maxMemberBytes,
      '7z member size limit',
    );
    total += size;
    assert(
      total <= ARCHIVE_LIMITS.maxTotalBytes &&
        total <= workerData.bytes.length * ARCHIVE_LIMITS.maxRatio,
      '7z expansion limit',
    );
    assert(
      e.Encrypted !== '+' &&
        !e['Symbolic Link'] &&
        !e['Hard Link'] &&
        !/\bl[rwx-]{9}|\bp[rwx-]{9}/u.test(e.Attributes ?? ''),
      '7z encrypted/link/special member',
    );
    for (const m of (e.Method ?? '').matchAll(/LZMA2?:(\d+)/gu))
      assert(Number(m[1]) <= 26, '7z dictionary memory limit');
    if (e.Path!.includes('програмен формат') && e.Path!.toLowerCase().endsWith('.pdf'))
      selected.push(e);
  }
  assert(selected.length === 1, '7z judicial programme member missing/duplicate');
  module.FS.mkdir('/out');
  log = [];
  length = 0;
  run(['x', '-y', '-bsp0', '-p', '-o/out', '--', '/archive.7z', selected[0]!.Path!]);
  const files = selected.map((e) => {
    const path = '/out/' + e.Path,
      st = module.FS.lstat(path);
    assert(
      module.FS.isFile(st.mode) && st.size === Number(e.Size),
      '7z extracted member type/size mismatch',
    );
    const bytes = module.FS.readFile(path);
    assert(
      /^[A-Fa-f\d]{8}$/u.test(e.CRC ?? '') && crc32(bytes) === Number.parseInt(e.CRC!, 16),
      '7z extracted CRC mismatch',
    );
    return { member: e.Path, bytes };
  });
  parentPort!.postMessage({ files });
}
if (parentPort) main().catch((e) => parentPort!.postMessage({ error: String(e?.stack ?? e) }));
