/** Restore only the four SHA-bound programme PDFs from the approved CI archive.
 * Originals are never overwritten; archive and member bytes are authenticated
 * before any copy. No network, document parsing or metadata transcription.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = resolve(import.meta.dirname, '..');
const run = promisify(execFile);
const check = (value, reason) => {
  if (!value) throw new Error(reason);
};
const stat = async (path) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
export async function restoreProgrammeTestInputs(archive, repositoryRoot = root) {
  const spec = JSON.parse(
    await readFile(join(repositoryRoot, 'scripts/registered-node-inputs.json'), 'utf8'),
  );
  const refs = JSON.parse(
    await readFile(
      join(repositoryRoot, 'packages/dataset-schema/src/programme-references.json'),
      'utf8',
    ),
  );
  check(spec.schema === 'registered-ci-input-archive/1', 'Unexpected CI archive schema');
  check(
    Object.keys(refs).sort().join(',') === '0100,1800,2300,7400',
    'Unexpected programme source inventory',
  );
  const bytes = await readFile(archive);
  check(
    bytes.length === spec.bytes && sha(bytes) === spec.sha256,
    'CI archive bytes/hash mismatch',
  );
  const paths = Object.values(refs).map((ref) => {
    check(
      basename(ref.file) === ref.file && /^\d{4}_[^\r\n\\/]+\.pdf$/u.test(ref.file),
      'Unsafe programme source path',
    );
    return 'data/originals/program_budgets/' + ref.file;
  });
  const work = await mkdtemp(join(tmpdir(), 'programme-ci-'));
  try {
    const approved = join(work, 'approved.tar.gz'),
      staged = join(work, 'staged');
    await writeFile(approved, bytes, { flag: 'wx' });
    await mkdir(staged);
    const listing = await run('tar', ['-tzf', approved, '--quoting-style=literal'], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    const members = listing.stdout.trimEnd().split('\n');
    const selected = paths.map((path) => {
      const matches = members.filter((member) => member === path || member === './' + path);
      check(matches.length === 1, 'Missing/duplicate programme archive member');
      return matches[0];
    });
    await run(
      'tar',
      [
        '-xzf',
        approved,
        '-C',
        staged,
        '--no-same-owner',
        '--no-same-permissions',
        '--',
        ...selected,
      ],
      { timeout: 120000, maxBuffer: 65536 },
    );
    const verified = [];
    for (const [i, ref] of Object.values(refs).entries()) {
      const source = join(staged, paths[i]),
        target = join(repositoryRoot, paths[i]);
      check((await lstat(source)).isFile(), 'Programme archive member is not a regular file');
      const data = await readFile(source);
      check(sha(data) === ref.sourceSha256, 'Programme member SHA-256 mismatch');
      const current = await stat(target);
      if (current)
        check(
          current.isFile() && sha(await readFile(target)) === ref.sourceSha256,
          'Existing programme original differs; it is not overwritten',
        );
      verified.push({ target, data, exists: !!current });
    }
    let directory = repositoryRoot;
    for (const part of ['data', 'originals', 'program_budgets']) {
      directory = join(directory, part);
      const current = await stat(directory);
      if (current)
        check(
          current.isDirectory() && !current.isSymbolicLink(),
          'Unsafe programme destination directory',
        );
      else await mkdir(directory);
    }
    for (const file of verified)
      if (!file.exists) await writeFile(file.target, file.data, { flag: 'wx' });
    return {
      restored: verified.filter((file) => !file.exists).length,
      unchanged: verified.filter((file) => file.exists).length,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check(
    process.argv.length === 3,
    'Usage: node scripts/restore-programme-test-inputs.mjs APPROVED_ARCHIVE',
  );
  console.log(JSON.stringify(await restoreProgrammeTestInputs(resolve(process.argv[2]))));
}
