import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAggregationFixture, jsonStringify } from '@sigma-budget/ingest';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const scope = 'core,feed,feed-rss,search-index';
const names = ['core.json', 'feed.json', 'feed.xml', 'search-index.json'];
const inside = (parent: string, child: string) => {
  const r = relative(parent, child);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep));
};
export async function aggregationBuildCli(args: string[]): Promise<number> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i],
      v = args[i + 1];
    if (
      !k ||
      !v ||
      v.startsWith('--') ||
      !['--inputs', '--out', '--scope', '--build-date'].includes(k) ||
      flags[k]
    )
      throw new Error('Invalid build arguments');
    flags[k] = v;
  }
  if (
    !flags['--inputs'] ||
    !flags['--out'] ||
    flags['--scope'] !== scope ||
    flags['--build-date'] !== '2026-11-08'
  )
    throw new Error(`Build requires --inputs, --out, --scope ${scope} and frozen build date`);
  if (
    process.cwd() !== root ||
    (await realpath(root)) !== root ||
    (process.env.PWD && resolve(process.env.PWD) !== root)
  )
    throw new Error('Run from the real project root');
  for (const value of [flags['--out'], flags['--inputs']])
    if (value!.split(/[\\/]/).some((x) => x === '..' || x === '.'))
      throw new Error('Path traversal or alias');
  const target = join(root, 'tmp/ts-migration/candidates/11');
  if (resolve(flags['--out']) !== target)
    throw new Error('Output must be tmp/ts-migration/candidates/11');
  const fixture = resolve(flags['--inputs']);
  if ((await realpath(fixture)) !== fixture) throw new Error('Symlink in input path');
  if (inside(fixture, target) || inside(target, fixture))
    throw new Error('Input and output paths overlap');
  const segments = ['tmp', 'ts-migration', 'candidates', '11', 'data'];
  async function preflight(create: boolean) {
    let current = root;
    for (const part of segments) {
      current = join(current, part);
      try {
        const s = await lstat(current);
        if (s.isSymbolicLink() || !s.isDirectory() || (await realpath(current)) !== current)
          throw new Error('Unsafe output directory');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        if (create) {
          await mkdir(current);
          const s = await lstat(current);
          if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(current)) !== current)
            throw new Error('Unsafe output directory');
        }
      }
    }
    for (const name of names) {
      const path = join(target, 'data', name);
      try {
        const s = await lstat(path);
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (await realpath(path)) !== path)
          throw new Error('Unsafe output file');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
  await preflight(false);
  const result = (await loadAggregationFixture(fixture, flags['--build-date']!)).projected;
  const outputs: Record<string, string> = {
    'core.json': jsonStringify(result.core) + '\n',
    'feed.json': jsonStringify(result.feed) + '\n',
    'feed.xml': result.rss,
    'search-index.json': jsonStringify(result.search) + '\n',
  };
  await preflight(true);
  await preflight(false);
  for (const name of names) {
    const path = join(target, 'data', name),
      temp = join(target, 'data', `.wave11-${randomUUID()}.tmp`);
    let created = false;
    try {
      const fh = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      try {
        await fh.writeFile(outputs[name]!, 'utf8');
      } finally {
        await fh.close();
      }
      await preflight(false);
      await rename(temp, path);
      created = false;
    } finally {
      if (created) await unlink(temp).catch(() => {});
    }
  }
  return 0;
}
