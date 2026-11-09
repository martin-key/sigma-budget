import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { safePath, strictJson } from './context.js';
import type { KfpCapture } from './kfp-capture.js';
import type { KfpEvidence } from './kfp.js';

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const object = (x: unknown): x is Record<string, any> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
function file(root: string, path: string): Buffer {
  const target = safePath(root, path),
    st = lstatSync(target);
  if (!st.isFile()) throw new Error(`not a regular file: ${path}`);
  return readFileSync(target);
}
/** Load authenticated captures and reconcile the explicit raw inventory with actual bytes. */
export function loadKfpEvidence(
  root: string,
  capturePath: string,
  manifestPath: string,
  absent = false,
): KfpEvidence {
  const manifest = strictJson(file(root, manifestPath).toString('utf8'));
  if (!object(manifest) || typeof manifest.capturesSha256 !== 'string')
    throw new Error('invalid capture manifest');
  const bytes = file(root, capturePath);
  if (sha(bytes) !== manifest.capturesSha256) throw new Error('capture hash mismatch');
  const input = strictJson(bytes.toString('utf8'));
  if (
    !object(input) ||
    input.version !== 1 ||
    input.xlrd !== '2.0.2' ||
    input.rawOriginalsPresent !== true ||
    !Array.isArray(input.reports)
  )
    throw new Error('invalid capture evidence');
  const byKey: Record<string, KfpCapture> = Object.create(null);
  for (const cap of input.reports) {
    if (
      !object(cap) ||
      typeof cap.year !== 'string' ||
      !/^\d{4}$/.test(cap.year) ||
      typeof cap.filename !== 'string' ||
      !cap.filename.endsWith('.xls') ||
      cap.filename.includes('/') ||
      cap.filename.includes('\\') ||
      typeof cap.rawSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(cap.rawSha256)
    )
      throw new Error('invalid capture inventory');
    if (cap.readFailure !== null)
      throw new Error(`capture records a read failure: ${cap.year}/${cap.filename}`);
    const key = `${cap.year}/${cap.filename}`;
    if (Object.hasOwn(byKey, key)) throw new Error(`duplicate capture: ${key}`);
    byKey[key] = cap as unknown as KfpCapture;
  }
  const filesByYear: Record<string, string[]> = {},
    reports: Record<string, KfpCapture> = Object.create(null);
  const base = safePath(root, 'data/originals');
  if (!existsSync(base)) return { rawPresent: false, reports, filesByYear };
  if (!lstatSync(base).isDirectory()) throw new Error('originals path is not a directory');
  for (const ent of readdirSync(base, { withFileTypes: true })) {
    if (!/^kfp_\d{4}$/.test(ent.name)) continue;
    const dir = safePath(root, `data/originals/${ent.name}`);
    if (!ent.isDirectory() || !lstatSync(dir).isDirectory())
      throw new Error(`invalid originals directory: ${ent.name}`);
    const year = ent.name.slice(4),
      names = readdirSync(dir).filter((name) => name.endsWith('.xls'));
    filesByYear[year] = names;
    for (const name of names) {
      const bytes = file(root, `data/originals/${ent.name}/${name}`),
        key = `${year}/${name}`,
        cap = byKey[key];
      if (!cap) continue; // Extra raw files are counted, even when not yet represented by a capture.
      if (sha(bytes) !== cap.rawSha256) throw new Error(`raw bytes differ from capture: ${key}`);
      reports[key] = cap;
    }
  }
  if (absent) {
    if (Object.values(filesByYear).some((names) => names.length))
      throw new Error('cannot declare raw originals absent when reports are present');
    return { rawPresent: false, reports, filesByYear };
  }
  return { rawPresent: true, reports, filesByYear };
}
