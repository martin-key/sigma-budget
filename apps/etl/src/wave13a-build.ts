import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonStringify, loadWave13aFixture, parseRegistry } from '@sigma-budget/ingest';
const project = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const wave13aScope = 'outlook,revenue,expenditure,budget2027,budget2027-provenance,law';
const names = [
  'outlook.json',
  'revenue.json',
  'expenditure.json',
  'budget2027.json',
  'budget2027-provenance.json',
  'law.json',
];
const inside = (parent: string, child: string) => {
  const r = relative(parent, child);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep));
};
export async function wave13aBuildCli(args: string[], root = project): Promise<number> {
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
    flags['--scope'] !== wave13aScope ||
    flags['--build-date'] !== '2026-11-08'
  )
    throw new Error('Invalid Wave13a scope or build arguments');
  root = resolve(root);
  if ((await realpath(root)) !== root) throw new Error('Symlink in project root');
  for (const path of [flags['--inputs'], flags['--out']])
    if (path!.split(/[\\/]/).some((x) => x === '..' || x === '.'))
      throw new Error('Path traversal');
  const target = join(root, 'tmp/ts-migration/candidates/13a');
  if (resolve(flags['--out']!) !== target) throw new Error('Output must be candidate13a');
  const fixture = resolve(flags['--inputs']!);
  if (root === project && fixture !== join(project, 'packages/ingest/test/fixtures'))
    throw new Error('Wave13a uses the pinned fixture root');
  if (inside(fixture, target) || inside(target, fixture))
    throw new Error('Input and output overlap');
  const segments = ['tmp', 'ts-migration', 'candidates', '13a', 'data'];
  async function preflight(create: boolean) {
    let current = root;
    for (const part of segments) {
      current = join(current, part);
      try {
        const st = await lstat(current);
        if (st.isSymbolicLink() || !st.isDirectory() || (await realpath(current)) !== current)
          throw new Error('Unsafe output directory');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        if (create) {
          await mkdir(current);
          const st = await lstat(current);
          if (!st.isDirectory() || st.isSymbolicLink() || (await realpath(current)) !== current)
            throw new Error('Unsafe output directory');
        }
      }
    }
    for (const name of names)
      try {
        const path = join(target, 'data', name),
          st = await lstat(path);
        if (
          !st.isFile() ||
          st.isSymbolicLink() ||
          st.nlink !== 1 ||
          (await realpath(path)) !== path
        )
          throw new Error('Unsafe output file');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
  }
  await preflight(false);
  if ((await realpath(fixture)) !== fixture) throw new Error('Symlink in input path');
  const registryPath = join(root, 'data/datasets.yaml');
  const dataDir = await lstat(join(root, 'data'));
  const registryStat = await lstat(registryPath);
  if (
    !dataDir.isDirectory() ||
    dataDir.isSymbolicLink() ||
    !registryStat.isFile() ||
    registryStat.isSymbolicLink() ||
    registryStat.nlink !== 1 ||
    (await realpath(registryPath)) !== registryPath
  )
    throw new Error('Unsafe registry path');
  const registry = parseRegistry(await readFile(registryPath, 'utf8'));
  const derived = names.map((name) => {
    const matches = registry.filter((entry) => entry.files.includes(`data/release/${name}`));
    if (matches.length !== 1 || matches[0]!.files.length !== 1)
      throw new Error(`Invalid registry ownership: ${name}`);
    return matches[0]!.id;
  });
  if (derived.join(',') !== flags['--scope'])
    throw new Error('Scope differs from registry ownership');
  const result = await loadWave13aFixture(fixture, flags['--build-date']!);
  const serialized = Object.fromEntries(
    names.map((name) => [name, jsonStringify(result[name as keyof typeof result]) + '\n']),
  );
  try {
    const existing = await readdir(join(target, 'data'));
    if (existing.some((name) => !names.includes(name)))
      throw new Error('Unexpected candidate file');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await preflight(true);
  await preflight(false);
  for (const name of names) {
    const path = join(target, 'data', name),
      temp = join(target, 'data', `.wave13a-${randomUUID()}.tmp`);
    let created = false;
    try {
      const fh = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      try {
        await fh.writeFile(serialized[name]!, 'utf8');
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
