import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonStringify, loadDebtLocalFixture } from '@sigma-budget/ingest';
const scope = 'debt,municipalities,geo-obshtini,sebra';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export async function debtLocalBuildCli(args: string[]): Promise<number> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !value ||
      value.startsWith('--') ||
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
    !/^\d{4}-\d\d-\d\d$/.test(flags['--build-date'] ?? '')
  )
    throw new Error(`Build requires --inputs, --out, --scope ${scope} and --build-date`);
  if (flags['--out'].split(/[\\/]/).includes('..')) throw new Error('Traversal in output path');
  if ((await realpath(projectRoot)) !== projectRoot) throw new Error('Symlink in project root');
  const allowed = join(projectRoot, 'tmp/ts-migration/candidates/07');
  if (resolve(flags['--out']) !== allowed)
    throw new Error('Output must be tmp/ts-migration/candidates/07 in this project');
  const output = await loadDebtLocalFixture(flags['--inputs'], flags['--build-date']!);
  let dir = projectRoot;
  for (const part of ['tmp', 'ts-migration', 'candidates', '07', 'data', 'geo']) {
    dir = join(dir, part);
    try {
      await mkdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const stat = await lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(dir)) !== dir)
      throw new Error('Unsafe output directory');
  }
  const data = join(allowed, 'data');
  for (const name of Object.keys(output)) {
    const target = join(data, name);
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
        throw new Error('Unsafe output file');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  for (const [name, value] of Object.entries(output)) {
    const target = join(data, name),
      temp = join(dirname(target), `.ts07-${process.pid}-${name.replaceAll('/', '-')}.tmp`);
    let created = false;
    try {
      const file = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      try {
        await file.writeFile(jsonStringify(value) + '\n', 'utf8');
      } finally {
        await file.close();
      }
      await rename(temp, target);
      created = false;
    } finally {
      if (created) await unlink(temp).catch(() => {});
    }
  }
  return 0;
}
