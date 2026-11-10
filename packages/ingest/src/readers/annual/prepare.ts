import { serializeAnnual } from './json.js';
import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir, link, unlink, rename } from 'node:fs/promises';
import { isAbsolute, relative, resolve, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseYaml } from '../../io/registry.js';
import { assert } from '../pdf/index.js';
import {
  extractAnnual2027,
  sha256,
  validDate,
  type AnnualRegistration,
  type AnnualExtractions,
} from './index.js';
import type { PdfLimits } from '../pdf/index.js';
import type { Data } from './bill.js';
export interface AnnualPreparationOptions {
  sourceRoot: string;
  registration: AnnualRegistration;
  buildDate: string;
  /** Separate, caller-owned candidate/export directory. Never the source checkout. */
  out: string;
  limits?: PdfLimits;
}
export interface AnnualPreparationReceipt extends Data {
  schema: 1;
  buildDate: string;
  outputs: {
    path: string;
    action: 'generated' | 'verified';
    bytes: number;
    sha256: string;
    source: unknown;
  }[];
  compatibility: string[];
}
const inside = (a: string, b: string) => {
  const r = relative(a, b);
  return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep));
};
export async function safePath(path: string, createDirs = false): Promise<void> {
  const absolute = resolve(path);
  let current = resolve(sep);
  for (const part of absolute.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      const s = await lstat(current);
      assert(
        !s.isSymbolicLink() &&
          (current === absolute ? s.isFile() || s.isDirectory() : s.isDirectory()),
        'Unsafe path: ' + current,
      );
      assert((await realpath(current)) === current, 'Symlink path: ' + current);
      if (s.isFile()) assert(s.nlink === 1, 'Hardlinked file: ' + current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      if (createDirs) {
        await mkdir(current);
        const s = await lstat(current);
        assert(
          s.isDirectory() && !s.isSymbolicLink() && (await realpath(current)) === current,
          'Unsafe created directory',
        );
      }
    }
  }
}
async function read(path: string, maxBytes: number): Promise<Buffer> {
  await safePath(path);
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await f.stat();
    assert(
      st.isFile() && st.nlink === 1 && st.size <= maxBytes,
      'Unsafe or oversized input: ' + path,
    );
    const bytes = await f.readFile();
    assert(bytes.length === st.size, 'Input changed during read');
    return bytes;
  } finally {
    await f.close();
  }
}
function registeredPath(root: string, path: string): string {
  assert(
    typeof path === 'string' &&
      !isAbsolute(path) &&
      !path.includes('\\') &&
      path.split('/').every((s) => s && s !== '.' && s !== '..'),
    'Invalid registered path',
  );
  const result = resolve(root, path);
  assert(inside(root, result) && result !== root, 'Registered input outside root');
  return result;
}
/** Read source/member metadata from the existing registry and independent pins. */
export async function readAnnualRegistration(
  registryPath: string,
  pinsPath: string,
): Promise<AnnualRegistration> {
  const registry = parseYaml(
    (await read(resolve(registryPath), 2 * 1024 * 1024)).toString('utf8'),
  ) as Data;
  assert(Array.isArray(registry.sources), 'Invalid source registry');
  const entries = registry.sources.filter((s: Data) => s.id === 'budget2027');
  assert(entries.length === 1, 'budget2027 registration missing or duplicate');
  const source = entries[0];
  assert(
    Array.isArray(source.members) && Array.isArray(source.files),
    'Annual registration lacks files/members',
  );
  const pins: Record<string, string> = Object.create(null);
  for (const line of (await read(resolve(pinsPath), 2 * 1024 * 1024))
    .toString('utf8')
    .split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([a-f\d]{64})  (.+)$/.exec(line);
    assert(m && !Object.hasOwn(pins, m[2]!), 'Invalid/duplicate original pin');
    pins[m[2]!] = m[1]!;
  }
  const archives = [...new Set(source.members.map((m: Data) => m.archive))];
  assert(
    archives.length === 1 && typeof archives[0] === 'string',
    'Annual archive registration differs',
  );
  const archive = archives[0];
  assert(
    source.files.filter((f: Data) => f.path === archive).length === 1,
    'Registered archive file missing',
  );
  const acquisitionFiles = source.files.filter(
    (f: Data) => typeof f.path === 'string' && f.path.endsWith('/acquisition.json'),
  );
  assert(acquisitionFiles.length === 1, 'Annual acquisition registration missing');
  const acquisition = acquisitionFiles[0].path;
  assert(pins[archive] && pins[acquisition], 'Annual original pins missing');
  return {
    id: 'budget2027',
    archive,
    archiveSha256: pins[archive]!,
    acquisition,
    acquisitionSha256: pins[acquisition]!,
    members: source.members,
  };
}
const OLD_METHOD =
  'Internal PyMuPDF rawdict/words comparison: first, middle and last numeric rows of the original 14 table views, plus all Annex 2 fragment cells by year and vertical band';
function canonical(value: any, key = ''): any {
  if (Array.isArray(value)) {
    const children = value.map((v) => canonical(v));
    if (key === 'checks')
      return children.sort((a, b) =>
        JSON.stringify(a.name ?? a.check).localeCompare(JSON.stringify(b.name ?? b.check)),
      );
    return children;
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k], k)]),
    );
  return value;
}
function firstDiff(actual: any, expected: any, path = ''): string | undefined {
  if (Object.is(actual, expected) || actual === expected) return;
  if (
    !actual ||
    !expected ||
    typeof actual !== 'object' ||
    typeof expected !== 'object' ||
    Array.isArray(actual) !== Array.isArray(expected)
  )
    return path || '/';
  const ak = Object.keys(actual),
    bk = Object.keys(expected);
  if (JSON.stringify(ak) !== JSON.stringify(bk)) return path || '/';
  for (const k of ak) {
    const diff = firstDiff(
      actual[k],
      expected[k],
      path + '/' + k.replace(/~/g, '~0').replace(/\//g, '~1'),
    );
    if (diff) return diff;
  }
}
/** Exact JSON-value comparison. No monetary, text, null or geometry tolerance.
 * Legacy Python method attribution is explicitly recognized; checks are keyed
 * by name because validation execution order is not a source-cell dimension. */
export function assertFreshAnnual(
  bytes: Uint8Array,
  expected: unknown,
  role: 'forecast' | 'bill',
): string[] {
  const actual = JSON.parse(Buffer.from(bytes).toString('utf8')),
    compatibility: string[] = [];
  if (role === 'forecast' && actual.cross_representation_checks?.method === OLD_METHOD) {
    actual.cross_representation_checks.method = (
      expected as Data
    ).cross_representation_checks.method;
    compatibility.push(
      'Legacy PyMuPDF internal-comparison attribution accepted; regenerated MuPDF.js source cells/geometry and every check compare exactly.',
    );
  }
  const diff = firstDiff(canonical(actual), canonical(expected));
  assert(!diff, `Stale ${role} extraction at ${diff}`);
  return compatibility;
}
async function writeNew(path: string, bytes: Uint8Array): Promise<void> {
  await safePath(dirname(path), true);
  await safePath(path);
  const temp = resolve(dirname(path), '.annual-' + randomUUID() + '.tmp');
  let created = false;
  try {
    const f = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    try {
      await f.writeFile(bytes);
      await f.sync();
    } finally {
      await f.close();
    }
    await safePath(path);
    await link(temp, path);
  } finally {
    if (created) await unlink(temp);
  }
}
export async function prepareAnnual(
  options: AnnualPreparationOptions,
): Promise<AnnualPreparationReceipt> {
  const { registration: r, buildDate } = options;
  validDate(buildDate);
  const root = resolve(options.sourceRoot),
    out = resolve(options.out);
  await safePath(root);
  await safePath(out);
  assert(!inside(out, root), 'Annual output overlaps source root');
  const rel = inside(root, out) ? relative(root, out).split(sep) : out.split(sep);
  assert(
    !rel.some((p) =>
      ['originals', 'release', 'releasedata', 'fixtures', 'registries', '.git'].includes(p),
    ) && !inside(resolve(root, 'data'), out),
    'Output must be an owned candidate/export directory',
  );
  const archivePath = registeredPath(root, r.archive),
    acquisitionPath = registeredPath(root, r.acquisition);
  assert(
    !inside(out, archivePath) && !inside(out, acquisitionPath),
    'Annual output overlaps originals',
  );
  const paths = {
    forecast: 'data/inputs/budget_forecast_2027.json',
    bill: 'data/inputs/budget_bill_2027.json',
  } as const;
  for (const path of Object.values(paths)) await safePath(resolve(out, path));
  await safePath(resolve(out, 'tmp/budget-2027-extractions.json'));
  const archive = await read(archivePath, 32 * 1024 * 1024),
    acquisition = await read(acquisitionPath, 1024 * 1024);
  const result = extractAnnual2027({
    registration: r,
    archive,
    acquisition,
    buildDate,
    limits: options.limits,
  });
  const pending: {
      path: string;
      relative: string;
      bytes: Buffer;
      role: 'forecast' | 'bill';
      present: boolean;
    }[] = [],
    compatibility: string[] = [];
  // Preflight both gates before generating either intermediate.
  for (const role of ['forecast', 'bill'] as const) {
    const path = resolve(out, paths[role]);
    await safePath(path);
    let bytes: Buffer | undefined;
    try {
      bytes = await read(path, 32 * 1024 * 1024);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (bytes) compatibility.push(...assertFreshAnnual(bytes, result[role], role));
    pending.push({
      path,
      relative: paths[role],
      role,
      present: !!bytes,
      bytes: bytes ?? Buffer.from(serializeAnnual(result[role])),
    });
  }
  const reportPath = resolve(out, 'tmp/budget-2027-extractions.json');
  await safePath(reportPath);
  const receipt: AnnualPreparationReceipt = {
    ...result.evidence,
    schema: 1,
    buildDate,
    outputs: pending.map((p) => ({
      path: p.relative,
      action: p.present ? 'verified' : 'generated',
      bytes: p.bytes.length,
      sha256: sha256(p.bytes),
      source: result[p.role].source,
    })),
    compatibility: [...new Set(compatibility)],
  };
  const created: string[] = [];
  try {
    for (const p of pending)
      if (!p.present) {
        await writeNew(p.path, p.bytes);
        created.push(p.path);
      }
    await safePath(dirname(reportPath), true);
    const temp = resolve(dirname(reportPath), '.annual-report-' + randomUUID() + '.tmp');
    try {
      await writeNew(temp, Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
      await safePath(reportPath);
      await rename(temp, reportPath);
    } finally {
      await unlink(temp).catch((e) => {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      });
    }
  } catch (e) {
    for (const path of created) await unlink(path);
    throw e;
  }
  return receipt;
}
