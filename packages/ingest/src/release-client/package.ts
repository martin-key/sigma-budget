import { verifyNodeProof } from './node-proof.js';
import { join, resolve } from 'node:path';
import { fileFacts, listFiles, readSafeBytes, safeDirectory, sha256 } from './files.js';
import {
  DEFAULT_OBJECT_LIMIT,
  MANIFEST_LIMIT,
  parseJson,
  record,
  ReleaseError,
  SHA256,
  type PackageOptions,
  type ReleaseFile,
  type ReleaseManifest,
} from './types.js';

// The path, MIME and size contract of workers/api/store.js; no data registry here.
const SEG = '[\\p{L}\\p{N}._\\-]+(?: [\\p{L}\\p{N}._\\-]+)*';
const SAFE_PATH = new RegExp(`^(?!.*(?:^|/)\\.\\.?(?:/|$))(?=.{1,300}$)${SEG}(?:/${SEG})*$`, 'u');
const MIMES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'text/html',
  'text/plain',
  'text/csv',
  'application/pdf',
  'application/zip',
  'application/x-7z-compressed',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rss+xml',
]);
export function objectLimit(value = DEFAULT_OBJECT_LIMIT): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ReleaseError(2, 'maxObjectBytes must be a positive safe integer');
  return value;
}
/** Sorted JSON object keys, preserving array order; exact bytes are never rewritten. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (record(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function parseManifest(
  bytes: Uint8Array,
  maxObjectBytes = DEFAULT_OBJECT_LIMIT,
): ReleaseManifest {
  const limit = objectLimit(maxObjectBytes);
  if (bytes.byteLength > MANIFEST_LIMIT)
    throw new ReleaseError(2, `Manifest exceeds ${MANIFEST_LIMIT} bytes`);
  const m = parseJson(bytes);
  if (
    !record(m) ||
    m.manifest_schema !== 'budget-release/1' ||
    !record(m.data_schema) ||
    !record(m.processing) ||
    !record(m.processing.code) ||
    typeof m.processing.code.commit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(m.processing.code.commit)
  )
    throw new ReleaseError(2, 'Invalid budget-release/1 manifest');
  if (Buffer.from(bytes).toString('utf8') !== canonicalJson(m) + '\n')
    throw new ReleaseError(2, 'Manifest must be canonical JSON (sorted keys and one newline)');
  if (
    m.data_schema.execution !== undefined &&
    (typeof m.data_schema.execution !== 'string' ||
      !['execution/1', 'execution/2'].includes(m.data_schema.execution))
  )
    throw new ReleaseError(2, 'Unsupported execution data schema');
  const paths = new Set<string>();
  const sizes = new Map<string, number>();
  for (const role of ['inputs', 'outputs'] as const) {
    if (!Array.isArray(m[role])) throw new ReleaseError(2, `Manifest ${role} must be an array`);
    for (const f of m[role]) {
      if (
        !record(f) ||
        typeof f.path !== 'string' ||
        !SAFE_PATH.test(f.path) ||
        paths.has(f.path) ||
        typeof f.sha256 !== 'string' ||
        !SHA256.test(f.sha256) ||
        !Number.isSafeInteger(f.bytes) ||
        Number(f.bytes) < 0 ||
        typeof f.mime !== 'string' ||
        !MIMES.has(f.mime)
      )
        throw new ReleaseError(2, `Invalid or duplicate manifest ${role} entry`);
      if (Number(f.bytes) > limit)
        throw new ReleaseError(
          2,
          `${f.path}: ${f.bytes} bytes exceeds configured object limit ${limit}`,
        );
      if (
        role === 'outputs' &&
        !(
          f.path === 'validation.json' ||
          (f.path.startsWith('data/') && !f.path.startsWith('data/releases/'))
        )
      )
        throw new ReleaseError(2, 'Outputs must be candidate data or validation.json');
      if (role === 'inputs' && (!f.path.startsWith('data/') || f.path.startsWith('data/releases/')))
        throw new ReleaseError(2, 'Inputs must be source paths under data/');
      if (sizes.has(String(f.sha256)) && sizes.get(String(f.sha256)) !== f.bytes)
        throw new ReleaseError(2, 'One object hash has conflicting sizes');
      paths.add(f.path);
      sizes.set(String(f.sha256), Number(f.bytes));
    }
  }
  const manifest = m as unknown as ReleaseManifest;
  if (
    !manifest.outputs.length ||
    manifest.outputs.filter(
      (f) =>
        f.path === 'validation.json' && f.role === 'validation' && f.mime === 'application/json',
    ).length !== 1
  )
    throw new ReleaseError(2, 'Manifest must list a validation report');
  return manifest;
}
export interface LocalObject {
  path: string;
  sha256: string;
  bytes: number;
  role: 'manifest' | 'input' | 'output';
}
export interface ReleasePackage {
  root: string;
  originals: string;
  releaseId: string;
  manifestBytes: Buffer;
  manifest: ReleaseManifest;
  objects: Map<string, LocalObject>;
  maxObjectBytes: number;
}
export async function checkedBytes(object: LocalObject, limit: number): Promise<Buffer> {
  const bytes = await readSafeBytes(object.path, limit);
  if (bytes.length !== object.bytes || sha256(bytes) !== object.sha256)
    throw new ReleaseError(2, 'Local object differs from its manifest');
  return bytes;
}
/** Offline: every declared input/output, build receipt, validation and package membership. */
export async function preflightRelease(options: PackageOptions): Promise<ReleasePackage> {
  const maxObjectBytes = objectLimit(options.maxObjectBytes);
  const root = await safeDirectory(resolve(options.release));
  const originals = await safeDirectory(resolve(options.originals));
  const manifestBytes = await readSafeBytes(join(root, 'manifest.json'), MANIFEST_LIMIT);
  const manifest = parseManifest(manifestBytes, maxObjectBytes);
  const releaseId = sha256(manifestBytes);
  const receipt = parseJson(await readSafeBytes(join(root, 'receipt.json'), MANIFEST_LIMIT));
  if (!record(receipt) || receipt.release_id !== releaseId)
    throw new ReleaseError(2, 'Build receipt release_id differs from manifest SHA-256');
  const allowed = new Set([
    'manifest.json',
    'receipt.json',
    ...manifest.outputs.map((f) => f.path),
  ]);
  for (const path of await listFiles(root))
    if (!allowed.has(path))
      throw new ReleaseError(2, 'Package contains a file absent from its manifest');
  const objects = new Map<string, LocalObject>();
  objects.set(releaseId, {
    path: join(root, 'manifest.json'),
    bytes: manifestBytes.length,
    sha256: releaseId,
    role: 'manifest',
  });
  for (const role of ['inputs', 'outputs'] as const) {
    for (const f of manifest[role]) {
      const path = join(role === 'outputs' ? root : originals, f.path);
      const facts = await fileFacts(path, f.bytes);
      if (facts.bytes !== f.bytes || facts.sha256 !== f.sha256)
        throw new ReleaseError(2, `${f.path}: bytes or SHA-256 differ from manifest`);
      if (!objects.has(f.sha256))
        objects.set(f.sha256, {
          path,
          bytes: f.bytes,
          sha256: f.sha256,
          role: role === 'inputs' ? 'input' : 'output',
        });
    }
  }
  const validation = parseJson(await readSafeBytes(join(root, 'validation.json'), maxObjectBytes));
  if (
    !record(validation) ||
    validation.passed !== true ||
    !Array.isArray(validation.groups) ||
    !validation.groups.length ||
    validation.groups.some(
      (g) =>
        !record(g) ||
        typeof g.group !== 'string' ||
        !['OK', 'WARN', 'SKIP'].includes(String(g.status)),
    )
  )
    throw new ReleaseError(2, 'Package validation did not pass');
  verifyNodeProof(
    manifest,
    manifestBytes,
    receipt,
    await readSafeBytes(join(root, 'validation.json'), maxObjectBytes),
  );
  return { root, originals, releaseId, manifestBytes, manifest, objects, maxObjectBytes };
}
export const fileUrlPath = (file: ReleaseFile) =>
  file.path.split('/').map(encodeURIComponent).join('/');
