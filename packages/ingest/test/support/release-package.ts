import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../src/release-client/package.js';
import { sha256 } from '../../src/release-client/files.js';
import type { ReleaseManifest } from '../../src/release-client/types.js';

export async function makeRelease(
  directory: string,
  name: string,
  input = Buffer.from('original-' + name),
) {
  const release = join(directory, name),
    originals = join(directory, name + '-originals');
  await mkdir(join(release, 'data'), { recursive: true });
  await mkdir(join(originals, 'data/originals'), { recursive: true });
  const data = Buffer.from(JSON.stringify({ value: name }) + '\n');
  const validation = Buffer.from(
    JSON.stringify({ passed: true, groups: [{ group: 'TEST', status: 'OK' }] }) + '\n',
  );
  const manifest: ReleaseManifest = {
    manifest_schema: 'budget-release/1',
    data_schema: { execution: 'execution/2' },
    processing: { code: { commit: 'a'.repeat(40) } },
    inputs: [
      {
        path: 'data/originals/source.bin',
        bytes: input.length,
        sha256: sha256(input),
        mime: 'application/octet-stream',
      },
    ],
    outputs: [
      { path: 'data/x.json', bytes: data.length, sha256: sha256(data), mime: 'application/json' },
      {
        path: 'validation.json',
        role: 'validation',
        bytes: validation.length,
        sha256: sha256(validation),
        mime: 'application/json',
      },
    ],
  };
  await writeFile(join(originals, manifest.inputs[0]!.path), input);
  await writeFile(join(release, 'data/x.json'), data);
  await writeFile(join(release, 'validation.json'), validation);
  const releaseId = await writeManifest(release, manifest);
  return { release, originals, manifest, releaseId };
}
export async function writeManifest(release: string, manifest: ReleaseManifest) {
  const bytes = canonicalJson(manifest) + '\n',
    rid = sha256(bytes);
  await writeFile(join(release, 'manifest.json'), bytes);
  await writeFile(
    join(release, 'receipt.json'),
    JSON.stringify({ release_id: rid, built: '2026-11-10T00:00:00Z' }) + '\n',
  );
  return rid;
}
