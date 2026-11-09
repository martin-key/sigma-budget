import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadWave13bFixture,
  loadWave13bReference,
  runWave13b,
  compareWave13b,
  parseRegistry,
} from '@sigma-budget/ingest';

const project = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const wave13bScope = 'wave13b';
const inside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
};
const validPart = (name: string) => name && name !== '.' && name !== '..' && !name.includes('\\');

export async function wave13bBuildCli(args: string[], root = project): Promise<number> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !value ||
      value.startsWith('--') ||
      !['--inputs', '--out', '--scope', '--build-date', '--report', '--registry'].includes(key) ||
      flags[key]
    )
      throw new Error('Invalid build arguments');
    flags[key] = value;
  }
  if (
    !flags['--inputs'] ||
    !flags['--out'] ||
    flags['--scope'] !== wave13bScope ||
    flags['--build-date'] !== '2026-11-08'
  )
    throw new Error('Invalid Wave13b build arguments');
  root = resolve(root);
  if ((await realpath(root)) !== root) throw new Error('Unsafe project root');
  for (const path of Object.values(flags))
    if (path.split(/[\\/]/).some((p) => p === '.' || p === '..')) throw new Error('Path traversal');
  const target = join(root, 'tmp/ts-migration/candidates/candidate13b'),
    data = join(target, 'data');
  const fixture = resolve(flags['--inputs']!),
    reportPath = resolve(flags['--report'] ?? join(target, 'report.json'));
  const registry = resolve(flags['--registry'] ?? join(fixture, 'catalog/inputs/datasets.yaml'));
  if (resolve(flags['--out']!) !== target || reportPath !== join(target, 'report.json'))
    throw new Error('Output and report must be inside candidate13b');
  if (root === project && fixture !== join(root, 'packages/ingest/test/fixtures'))
    throw new Error('Wave13b requires the pinned fixture root');
  if (registry !== join(fixture, 'catalog/inputs/datasets.yaml'))
    throw new Error('Wave13b requires the pinned registry');
  if (
    inside(fixture, target) ||
    inside(target, fixture) ||
    inside(target, registry) ||
    inside(registry, target) ||
    inside(fixture, reportPath) ||
    inside(reportPath, fixture)
  )
    throw new Error('Input, registry and output overlap');
  if ((await realpath(fixture)) !== fixture) throw new Error('Unsafe input root');
  const registryStat = await lstat(registry);
  if (!registryStat.isFile() || registryStat.nlink !== 1 || (await realpath(registry)) !== registry)
    throw new Error('Unsafe registry');
  const parsedRegistry = parseRegistry(await readFile(registry, 'utf8'));
  const reference = await loadWave13bReference(fixture);
  const expected = new Set(reference.inventory.map((item) => item.file));
  for (const item of reference.inventory) {
    const entry = parsedRegistry.find((row) => row.id === item.dataset);
    const full = 'data/release/' + item.file;
    if (
      !entry ||
      !entry.files.some((pattern) =>
        pattern.endsWith('/*')
          ? full.startsWith(pattern.slice(0, -1)) && !full.slice(pattern.length - 1).includes('/')
          : pattern.endsWith('/*.json')
            ? full.startsWith(pattern.slice(0, -6)) &&
              full.endsWith('.json') &&
              !full.slice(pattern.length - 6).includes('/')
            : pattern === full,
      )
    )
      throw new Error(`Registry ownership mismatch: ${item.file}`);
  }
  async function directory(path: string, create = false): Promise<boolean> {
    if (!inside(root, path)) throw new Error('Unsafe directory path');
    let current = root,
      missing = false;
    const parts = relative(root, path).split(sep).filter(Boolean);
    for (const part of parts) {
      if (!validPart(part)) throw new Error('Unsafe directory component');
      current = join(current, part);
      try {
        const s = await lstat(current);
        if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(current)) !== current)
          throw new Error('Unsafe output directory');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        missing = true;
        if (create) {
          await mkdir(current);
          const s = await lstat(current);
          if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(current)) !== current)
            throw new Error('Unsafe output directory');
        }
      }
    }
    return !missing || create;
  }
  async function safeFile(path: string): Promise<boolean> {
    try {
      const st = await lstat(path);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || (await realpath(path)) !== path)
        throw new Error(`Unsafe output file: ${path}`);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  async function preflight(): Promise<string[]> {
    const stale: string[] = [];
    for (const dir of [
      target,
      data,
      join(data, 'ministries'),
      join(data, 'geo'),
      join(data, 'releases'),
    ])
      await directory(dir);
    await safeFile(reportPath);
    if (await directory(target)) {
      for (const entry of await readdir(target))
        if (!['data', 'report.json'].includes(entry))
          throw new Error(`Unexpected candidate entry: ${entry}`);
    }
    if (await directory(data)) {
      async function scan(path: string, prefix = ''): Promise<void> {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (!validPart(entry.name)) throw new Error('Unsafe output name');
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name,
            dest = join(data, rel);
          if (entry.isDirectory()) {
            if (prefix || !['ministries', 'geo', 'releases'].includes(entry.name))
              throw new Error(`Unexpected output directory: ${rel}`);
            await directory(dest);
            await scan(dest, rel);
          } else {
            await safeFile(dest);
            if (!expected.has(rel)) {
              if ((prefix === 'ministries' || prefix === 'geo') && entry.name.endsWith('.json'))
                stale.push(dest);
              else throw new Error(`Unexpected output file: ${rel}`);
            }
          }
        }
      }
      await scan(data);
    }
    for (const name of expected) await safeFile(join(data, name));
    return stale;
  }
  await preflight();
  const input = await loadWave13bFixture(fixture);
  const built = runWave13b(input);
  const failedStages = built.states.some((state) => state.status !== 'success');
  const final = built.outputs.get('publication-layers') as
    | { streams: Map<string, Uint8Array> }
    | undefined;
  const parity = final
    ? compareWave13b({
        streams: final.streams,
        reference,
        registry: input.layers.registry,
        activeRoutes: input.layers.activeRoutes,
      })
    : null;
  const report = {
    baseline: '027a262288c0b0ca4b188482a8b8da43bb378047',
    buildDate: '2026-11-08',
    outcome: failedStages || !parity || parity.outcome === 'fail' ? 'fail' : parity.outcome,
    dependencies: built.dependencies,
    stages: built.states,
    parity,
  };
  await preflight();
  await directory(target, true);
  async function atomic(path: string, content: Uint8Array): Promise<void> {
    const parent = resolve(path, '..');
    await directory(parent);
    await safeFile(path);
    const temp = join(parent, `.wave13b-${randomUUID()}.tmp`);
    let created = false;
    try {
      const fh = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      try {
        await fh.writeFile(content);
      } finally {
        await fh.close();
      }
      await directory(parent);
      await safeFile(path);
      await rename(temp, path);
      created = false;
    } finally {
      if (created) await unlink(temp).catch(() => {});
    }
  }
  if (report.outcome !== 'fail' && final) {
    const stale = await preflight();
    for (const dir of [data, join(data, 'ministries'), join(data, 'geo'), join(data, 'releases')])
      await directory(dir, true);
    for (const path of stale) {
      await directory(resolve(path, '..'));
      await safeFile(path);
      await unlink(path);
    }
    for (const [name, bytes] of final.streams) {
      if (!expected.has(name) || name.split('/').some((part) => !validPart(part)))
        throw new Error(`Unsafe artifact name: ${name}`);
      await atomic(join(data, name), bytes);
    }
  }
  await atomic(reportPath, Buffer.from(JSON.stringify(report, null, 2) + '\n'));
  return report.outcome === 'fail' ? 1 : 0;
}
