/** Restore only the reviewed CI archive, then authenticate every registered input. */
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  exportCommit,
  prepareInputs,
  preflightDestination,
} from '../packages/ingest/dist/release-build/index.js';

const root = resolve(new URL('..', import.meta.url).pathname);
assert(process.argv.length === 3, 'Usage: node scripts/restore-node-input-cache.mjs NEW_OUTPUT');
const out = await preflightDestination(resolve(process.argv[2]), [root]);
const spec = JSON.parse(await readFile(join(root, 'scripts/registered-node-inputs.json'), 'utf8'));
assert.equal(spec.schema, 'registered-ci-input-archive/1');
assert.equal(spec.repository, 'midt-bg/sigma-budget');
assert(Number.isSafeInteger(spec.assetId) && spec.assetId > 0);
assert(Number.isSafeInteger(spec.bytes) && spec.bytes > 0 && spec.bytes <= 256 * 1024 * 1024);
assert(/^[a-f0-9]{64}$/.test(spec.sha256) && /^[a-f0-9]{64}$/.test(spec.snapshot));
assert(Number.isSafeInteger(spec.inputs) && spec.inputs > 0);

const work = await mkdtemp(join(dirname(out), '.registered-inputs-'));
try {
  // The draft asset is repository-owned CI storage, not a public fiscal endpoint.
  // gh uses the existing read-only workflow token; no credential enters the archive.
  const { stdout } = await promisify(execFile)(
    'gh',
    [
      'api',
      '--hostname',
      'github.com',
      `repos/${spec.repository}/releases/assets/${spec.assetId}`,
      '-H',
      'Accept: application/octet-stream',
    ],
    { encoding: 'buffer', maxBuffer: spec.bytes + 65536, timeout: 300000 },
  );
  assert.equal(stdout.length, spec.bytes, 'CI input archive byte count differs');
  assert.equal(
    createHash('sha256').update(stdout).digest('hex'),
    spec.sha256,
    'CI input archive SHA-256 differs',
  );
  const archive = join(work, 'approved.tar.gz');
  await writeFile(archive, stdout, { flag: 'wx', mode: 0o600 });
  const staged = join(work, 'inputs');
  await mkdir(staged);
  // The exact archive digest above authenticates the reviewed regular-file inventory.
  await promisify(execFile)(
    'tar',
    ['-xzf', archive, '-C', staged, '--no-same-owner', '--no-same-permissions'],
    { timeout: 120000, maxBuffer: 65536 },
  );
  const exported = join(work, 'export');
  await exportCommit(root, 'HEAD', exported);
  const prepared = await prepareInputs(exported, staged);
  assert.equal(prepared.inputs.length, spec.inputs, 'CI input inventory differs');
  assert.equal(prepared.snapshot.sha256, spec.snapshot, 'Authenticated CI input snapshot differs');
  await preflightDestination(out, [root]);
  await rename(staged, out);
  console.log(JSON.stringify({ out, inputs: prepared.inputs.length, snapshot: spec.snapshot }));
} finally {
  await rm(work, { recursive: true, force: true });
}
