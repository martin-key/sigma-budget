import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildFiscal, jsonStringify, loadFiscalFixture } from '@sigma-budget/ingest';

const scope = 'outlook,revenue,expenditure,measures';
/** Offline test-only entry: only candidate03 can be written. */
export async function fiscalBuildCli(args: string[]): Promise<number> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !value ||
      !['--inputs', '--out', '--scope', '--build-date'].includes(key) ||
      flags[key]
    )
      throw new Error('Invalid build arguments');
    flags[key] = value;
  }
  if (
    !flags['--inputs'] ||
    !flags['--out'] ||
    flags['--scope'] !== scope ||
    !/^\d{4}-\d{2}-\d{2}$/.test(flags['--build-date'] ?? '')
  )
    throw new Error(`Build requires --inputs, --out, --scope ${scope} and --build-date`);
  const cwd = await realpath(process.cwd());
  if (cwd !== resolve(process.cwd())) throw new Error('Symlink in working directory');
  const target = join(cwd, 'tmp/ts-migration/candidates/candidate03');
  if (resolve(flags['--out']) !== target)
    throw new Error('Output must be candidate03 inside the migration candidate tree');
  let dir = cwd;
  for (const segment of ['tmp', 'ts-migration', 'candidates', 'candidate03', 'data']) {
    dir = join(dir, segment);
    try {
      await mkdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const stat = await lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(dir)) !== dir)
      throw new Error('Symlink or non-directory in output path');
  }
  const input = await loadFiscalFixture(flags['--inputs']);
  const output = buildFiscal(input, flags['--build-date']!);
  for (const [name, doc] of Object.entries(output)) {
    const path = join(dir, name);
    const file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Output is not a private regular file');
      await file.truncate(0);
      await file.writeFile(jsonStringify(doc) + '\n', 'utf8');
    } finally {
      await file.close();
    }
  }
  return 0;
}
