/** Restore only the reviewed CI archive, then authenticate every registered input. */
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  exportCommit,
  prepareInputs,
  preflightDestination,
} from '../packages/ingest/dist/release-build/index.js';
import { copyAuthenticated } from '../packages/ingest/dist/release-build/files.js';

const root = resolve(new URL('..', import.meta.url).pathname);
assert(
  process.argv.length === 4,
  'Usage: node scripts/restore-node-input-cache.mjs APPROVED_ARCHIVE NEW_OUTPUT',
);
const source = resolve(process.argv[2]);
const out = await preflightDestination(resolve(process.argv[3]), [root, source]);
const spec = JSON.parse(await readFile(join(root, 'scripts/registered-node-inputs.json'), 'utf8'));
assert.equal(spec.schema, 'registered-ci-input-archive/1');
assert.equal(spec.repository, 'midt-bg/sigma-budget');
assert(Number.isSafeInteger(spec.assetId) && spec.assetId > 0);
assert(Number.isSafeInteger(spec.bytes) && spec.bytes > 0 && spec.bytes <= 256 * 1024 * 1024);
assert(/^[a-f0-9]{64}$/.test(spec.sha256) && /^[a-f0-9]{64}$/.test(spec.snapshot));
assert(Number.isSafeInteger(spec.inputs) && spec.inputs > 0);

const work = await mkdtemp(join(dirname(out), '.registered-inputs-'));
try {
  const archive = join(work, 'approved.tar.gz');
  // Make a private, byte/hash-authenticated copy before extracting. This process
  // has no token and never requests network access.
  await copyAuthenticated(source, archive, { bytes: spec.bytes, sha256: spec.sha256 });
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
