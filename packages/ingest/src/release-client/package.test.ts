import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeRelease, writeManifest } from '../../test/support/release-package.js';
import { preflightRelease } from './package.js';
import { sha256 } from './files.js';

describe('strict offline package preflight', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'operator-package-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('hashes all declared inputs and outputs without changing original bytes', async () => {
    const pkg = await makeRelease(directory, 'valid');
    const manifest = await readFile(join(pkg.release, 'manifest.json'));
    const result = await preflightRelease(pkg);
    expect(result.releaseId).toBe(sha256(manifest));
    expect(await readFile(join(pkg.release, 'manifest.json'))).toEqual(manifest);
    await writeFile(join(pkg.originals, pkg.manifest.inputs[0]!.path), 'wrong');
    await expect(preflightRelease(pkg)).rejects.toMatchObject({ code: 2 });
  });
  it('checks receipt identity, successful validation, missing files and unlisted data', async () => {
    const pkg = await makeRelease(directory, 'receipt');
    await writeFile(
      join(pkg.release, 'receipt.json'),
      JSON.stringify({ release_id: 'b'.repeat(64) }),
    );
    await expect(preflightRelease(pkg)).rejects.toThrow('receipt');
    await writeManifest(pkg.release, pkg.manifest);
    await writeFile(join(pkg.release, 'data/extra.json'), '{}');
    await expect(preflightRelease(pkg)).rejects.toThrow('absent');
    await rm(join(pkg.release, 'data/extra.json'));
    const bad = Buffer.from(
      JSON.stringify({ passed: false, groups: [{ group: 'TEST', status: 'FAIL' }] }),
    );
    await writeFile(join(pkg.release, 'validation.json'), bad);
    Object.assign(pkg.manifest.outputs[1]!, { bytes: bad.length, sha256: sha256(bad) });
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toThrow('validation');
    await rm(join(pkg.release, 'data/x.json'));
    await expect(preflightRelease(pkg)).rejects.toMatchObject({ code: 3 });
  });
  it('rejects packages whose manifest does not declare a JSON validation report', async () => {
    for (const kind of ['absent', 'empty', 'wrong-role', 'wrong-mime']) {
      const pkg = await makeRelease(directory, 'validation-' + kind);
      const report = pkg.manifest.outputs.find((file) => file.path === 'validation.json')!;
      if (kind === 'absent')
        pkg.manifest.outputs = pkg.manifest.outputs.filter((file) => file !== report);
      else if (kind === 'empty') pkg.manifest.outputs = [];
      else if (kind === 'wrong-role') report.role = 'data';
      else report.mime = 'text/plain';
      await writeManifest(pkg.release, pkg.manifest);
      await expect(preflightRelease(pkg), kind).rejects.toThrow(
        'Manifest must list a validation report',
      );
    }
  });
  it('rejects traversal, duplicate paths, unsupported schemas, noncanonical manifests and limits', async () => {
    const pkg = await makeRelease(directory, 'paths');
    pkg.manifest.format = 2;
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toThrow('Unknown release format: 2');
    pkg.manifest.format = 1;
    pkg.manifest.inputs[0]!.path = 'data/../outside';
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toMatchObject({ code: 2 });
    pkg.manifest.inputs[0]!.path = 'data/originals/source.bin';
    pkg.manifest.outputs.push({ ...pkg.manifest.outputs[0]! });
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toThrow('duplicate');
    pkg.manifest.outputs.pop();
    pkg.manifest.data_schema.execution = 'execution/999';
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toThrow('Unsupported');
    pkg.manifest.data_schema.execution = 'execution/2';
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease({ ...pkg, maxObjectBytes: 1 })).rejects.toThrow(
      'configured object limit 1',
    );
    await writeFile(join(pkg.release, 'manifest.json'), JSON.stringify(pkg.manifest, null, 2));
    await expect(preflightRelease(pkg)).rejects.toThrow('canonical');
  });
  for (const kind of ['symlink', 'hardlink', 'parent symlink'] as const)
    it(`rejects ${kind} in a release package`, async () => {
      const pkg = await makeRelease(directory, kind.replaceAll(' ', '-'));
      const file = join(pkg.release, 'data/x.json');
      if (kind === 'parent symlink') {
        await symlink(pkg.release, join(directory, 'aliased'), 'dir');
        pkg.release = join(directory, 'aliased');
      } else {
        const copy = join(directory, 'copy');
        await writeFile(copy, await readFile(file));
        await rm(file);
        if (kind === 'hardlink') await link(copy, file);
        else await symlink(copy, file);
      }
      await expect(preflightRelease(pkg)).rejects.toMatchObject({ code: 2 });
    });
});
