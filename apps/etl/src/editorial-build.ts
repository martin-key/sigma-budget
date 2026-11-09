import { constants } from 'node:fs';
import { mkdir, readFile, realpath, lstat, open } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { loadEditorialRoutes, restoreEditorial, alignGuideLinks } from '@sigma-budget/ingest';

// Test-only build entry until the complete build DAG is ported. The destination
// is confined to the migration candidate tree and may not traverse symlinks.
export async function editorialBuildCli(args: string[]): Promise<number> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !value ||
      !['--inputs', '--out', '--scope', '--build-date', '--routes'].includes(key) ||
      flags[key]
    )
      throw new Error('Invalid build arguments');
    flags[key] = value;
  }
  if (
    !flags['--inputs'] ||
    !flags['--out'] ||
    flags['--scope'] !== 'glossary,guide' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(flags['--build-date'] ?? '')
  )
    throw new Error('Build requires --inputs, --out, --scope glossary,guide and --build-date');
  const root = resolve('tmp/ts-migration/candidates'),
    out = resolve(flags['--out']);
  const rel = relative(root, out);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Output must be inside the migration candidate tree');
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  if (realRoot !== root) throw new Error('Symlink in candidate root');
  let current = realRoot;
  for (const part of rel.split(/[\\/]/)) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    if ((await lstat(current)).isSymbolicLink() || (await realpath(current)) !== current)
      throw new Error('Symlink in output path');
  }
  const realOut = current,
    realRel = relative(realRoot, realOut);
  if (!realRel || realRel.startsWith('..') || isAbsolute(realRel))
    throw new Error('Output resolves outside candidate tree');
  const dataDir = join(realOut, 'data');
  await mkdir(dataDir, { recursive: true });
  if ((await realpath(dataDir)) !== dataDir) throw new Error('Symlink in output path');
  for (const name of ['glossary.json', 'guide.json']) {
    const target = join(dataDir, name);
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Symlink in output file');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  const inputs = resolve(flags['--inputs']);
  const routes = loadEditorialRoutes(
    JSON.parse(await readFile(join(inputs, 'routes.json'), 'utf8')),
  );
  const output = restoreEditorial(
    {
      'glossary.json': await readFile(join(inputs, 'glossary.json')),
      'guide.json': await readFile(join(inputs, 'guide.json')),
    },
    routes,
  );
  if (flags['--routes']) {
    const currentRoutes = loadEditorialRoutes(
      JSON.parse(await readFile(flags['--routes'], 'utf8')),
    );
    const guide = alignGuideLinks(
      JSON.parse(Buffer.from(output['guide.json']).toString('utf8')),
      currentRoutes,
    );
    output['guide.json'] = Buffer.from(JSON.stringify(guide), 'utf8');
  }
  for (const name of ['glossary.json', 'guide.json'] as const) {
    const file = await open(
      join(dataDir, name),
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Output is not a private regular file');
      await file.truncate(0);
      await file.writeFile(output[name]);
    } finally {
      await file.close();
    }
  }
  return 0;
}
