import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { restoreProgrammeTestInputs } from './restore-programme-test-inputs.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), 'programme-restore-test-')),
    root = join(temp, 'repo'),
    source = join(temp, 'source'),
    refs = {};
  for (const folder of ['scripts', 'packages/dataset-schema/src'])
    await mkdir(join(root, folder), { recursive: true });
  for (const code of ['0100', '1800', '2300', '7400']) {
    const file = code + '_Test.pdf',
      data = Buffer.from('%PDF-test-' + code),
      path = join(source, 'data/originals/program_budgets', file);
    await mkdir(join(source, 'data/originals/program_budgets'), { recursive: true });
    await writeFile(path, data);
    refs[code] = { file, sourceSha256: hash(data) };
  }
  const archive = join(temp, 'approved.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, '.']);
  const bytes = await readFile(archive),
    spec = { schema: 'registered-ci-input-archive/1', bytes: bytes.length, sha256: hash(bytes) };
  await writeFile(join(root, 'scripts/registered-node-inputs.json'), JSON.stringify(spec));
  await writeFile(
    join(root, 'packages/dataset-schema/src/programme-references.json'),
    JSON.stringify(refs),
  );
  return { root, archive, refs, temp, spec };
}
test('authenticates and restores every selected member without rewriting originals', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await restoreProgrammeTestInputs(f.archive, f.root), {
      restored: 4,
      unchanged: 0,
    });
    const before = await Promise.all(
      Object.values(f.refs).map((ref) =>
        readFile(join(f.root, 'data/originals/program_budgets', ref.file)),
      ),
    );
    assert.deepEqual(await restoreProgrammeTestInputs(f.archive, f.root), {
      restored: 0,
      unchanged: 4,
    });
    const after = await Promise.all(
      Object.values(f.refs).map((ref) =>
        readFile(join(f.root, 'data/originals/program_budgets', ref.file)),
      ),
    );
    assert.deepEqual(after, before);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});
for (const kind of [
  'archive hash',
  'archive size',
  'member hash',
  'missing member',
  'unsafe path',
  'source inventory',
  'schema',
  'existing original',
])
  test('rejects ' + kind, async () => {
    const f = await fixture();
    try {
      if (kind === 'archive hash') f.spec.sha256 = '0'.repeat(64);
      if (kind === 'archive size') f.spec.bytes++;
      if (kind === 'member hash') f.refs['0100'].sourceSha256 = '0'.repeat(64);
      if (kind === 'missing member') f.refs['0100'].file = '0100_Missing.pdf';
      if (kind === 'unsafe path') f.refs['0100'].file = '../outside.pdf';
      if (kind === 'source inventory') delete f.refs['0100'];
      if (kind === 'schema') f.spec.schema = 'bad';
      if (kind === 'existing original') {
        await mkdir(join(f.root, 'data/originals/program_budgets'), { recursive: true });
        await writeFile(
          join(f.root, 'data/originals/program_budgets', f.refs['0100'].file),
          'unchanged conflict',
        );
      }
      await writeFile(join(f.root, 'scripts/registered-node-inputs.json'), JSON.stringify(f.spec));
      await writeFile(
        join(f.root, 'packages/dataset-schema/src/programme-references.json'),
        JSON.stringify(f.refs),
      );
      await assert.rejects(restoreProgrammeTestInputs(f.archive, f.root));
      if (kind === 'existing original')
        assert.equal(
          await readFile(
            join(f.root, 'data/originals/program_budgets', f.refs['0100'].file),
            'utf8',
          ),
          'unchanged conflict',
        );
    } finally {
      await rm(f.temp, { recursive: true, force: true });
    }
  });
