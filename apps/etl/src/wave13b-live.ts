import { lstat, readFile, realpath, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, loadWave13bReference } from '@sigma-budget/ingest';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
/** Optional read-only diagnostic; the published release is never a CI oracle. */
export async function wave13bLiveDiagnostic(args: string[]): Promise<number> {
  if (args.length) throw new Error('wave13b-live takes no arguments');
  const reference = await loadWave13bReference(join(root, 'packages/ingest/test/fixtures'));
  const live = join(root, 'data/release'),
    candidate = join(root, 'tmp/ts-migration/candidates/candidate13b/data');
  const read = async (dir: string, name: string): Promise<Buffer | null> => {
    const path = join(dir, name);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.nlink !== 1 || (await realpath(path)) !== path)
        throw new Error(`Unsafe diagnostic input: ${path}`);
      return readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const missing: string[] = [],
    changed: { file: string; count: number }[] = [],
    stale: string[] = [];
  for (const item of reference.inventory) {
    const expected = await read(live, item.file),
      actual = await read(candidate, item.file);
    if (!expected || !actual) {
      missing.push(item.file);
      continue;
    }
    const count = item.file.endsWith('.xml')
      ? Number(!expected.equals(actual))
      : compare(JSON.parse(expected.toString()), JSON.parse(actual.toString()), {
          dataset: item.dataset,
          file: item.file,
        }).length;
    if (count) changed.push({ file: item.file, count });
  }
  for (const dir of ['ministries', 'geo']) {
    const expected = new Set(
      reference.inventory
        .filter((item) => item.file.startsWith(dir + '/'))
        .map((item) => item.file.slice(dir.length + 1)),
    );
    for (const side of [live, candidate]) {
      const path = join(side, dir);
      if ((await realpath(path)) !== path) throw new Error('Unsafe diagnostic directory');
      for (const name of await readdir(path))
        if (name.endsWith('.json') && !expected.has(name))
          stale.push(`${side === live ? 'release' : 'candidate'}/${dir}/${name}`);
    }
  }
  console.log(
    JSON.stringify(
      {
        outcome: missing.length || changed.length || stale.length ? 'different' : 'same',
        missing,
        changed,
        stale,
        gvaRegeneration: 'unverified',
      },
      null,
      2,
    ),
  );
  return missing.length || changed.length || stale.length ? 1 : 0;
}
