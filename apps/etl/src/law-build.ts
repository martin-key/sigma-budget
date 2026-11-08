import { mkdir, readFile, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildLaw, writeJson, type LawEvidence } from '@sigma-budget/ingest';

// Test-only build entry until the complete build DAG is ported. The destination
// is confined to the migration candidate tree and may not traverse symlinks.
export async function lawBuildCli(args: string[]): Promise<number> {
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
    flags['--scope'] !== 'law' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(flags['--build-date'] ?? '')
  )
    throw new Error('Build requires --inputs, --out, --scope law and --build-date');
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
  const target = join(dataDir, 'law.json');
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Symlink in output file');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const evidence: LawEvidence = JSON.parse(
    await readFile(join(resolve(flags['--inputs']), 'evidence.json'), 'utf8'),
  );
  await writeJson(target, buildLaw(evidence, flags['--build-date']!));
  return 0;
}
