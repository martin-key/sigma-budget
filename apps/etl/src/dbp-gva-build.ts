import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  BuildContext,
  clean,
  buildBudgetPlan,
  buildGva,
  parseGvaStat,
  jsonStringify,
  readPinned,
  type PlanInput,
  type PlanEditorial,
  type GvaEditorial,
  type Outlook,
} from '@sigma-budget/ingest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INVENTORY_HASH = '93a0dda20cb3175a700c1c33df11d8829b7abd1a8f96452ded70cd91fbccfb3e';
/** Test-only candidate, with independent publication preservation and synthetic transform lanes. */
export async function dbpGvaBuildCli(args: string[]): Promise<number> {
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
    flags['--scope'] !== 'dbp2027,gva-sectors' ||
    flags['--build-date'] !== '2026-11-08'
  )
    throw new Error('Expected scoped DBP/GVA build and frozen build date');
  if (
    process.cwd() !== ROOT.replace(/\/$/, '') ||
    (await realpath(process.cwd())) !== process.cwd()
  )
    throw new Error('Run from the real project root');
  if (process.env.PWD && resolve(process.env.PWD) !== process.cwd())
    throw new Error('Cwd alias is not permitted');
  const target = join(ROOT, 'tmp/ts-migration/candidates/10');
  if (flags['--out'] !== 'tmp/ts-migration/candidates/10' && flags['--out'] !== target)
    throw new Error('Output must be tmp/ts-migration/candidates/10');
  if (flags['--inputs'].split(/[\\/]/).some((part) => part === '..' || part === '.'))
    throw new Error('Input traversal or alias');
  const fixture = resolve(flags['--inputs']);
  if ((await realpath(fixture)) !== fixture) throw new Error('Input path contains a symlink');
  const rel = relative(fixture, target),
    reverse = relative(target, fixture);
  const inside = (path: string) =>
    !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
  if (inside(rel) || inside(reverse)) throw new Error('Input and output paths overlap');
  const inventoryPath = join(fixture, 'provenance.json');
  const inventoryStat = await lstat(inventoryPath);
  if (
    !inventoryStat.isFile() ||
    inventoryStat.isSymbolicLink() ||
    inventoryStat.nlink !== 1 ||
    (await realpath(inventoryPath)) !== inventoryPath
  )
    throw new Error('Unsafe inventory file');
  const inventory = JSON.parse((await readPinned(inventoryPath, INVENTORY_HASH)).toString()) as {
    files: Record<string, string>;
  };
  const bytes = new Map<string, Buffer>();
  for (const [name, hash] of Object.entries(inventory.files)) {
    if (name.startsWith('/') || name.split('/').some((x) => x === '..' || x === '.'))
      throw new Error('Invalid inventory path');
    const file = join(fixture, name);
    const st = await lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || (await realpath(file)) !== file)
      throw new Error('Unsafe input file');
    bytes.set(name, await readPinned(file, hash));
  }
  const read = <T>(name: string): T => JSON.parse(bytes.get(name)!.toString()) as T;
  const dbp = buildBudgetPlan(
    read<PlanInput>('inputs/figures.json'),
    read<PlanEditorial>('inputs/editorial.json'),
    createHash('sha256').update(bytes.get('inputs/plan.pdf')!).digest('hex'),
  );
  const synthetic = buildGva(
    parseGvaStat(bytes.get('inputs/nama.json')!.toString()),
    parseGvaStat(bytes.get('inputs/gdp.json')!.toString()),
    read<Outlook>('inputs/outlook.json'),
    read<GvaEditorial>('inputs/gva-editorial.json'),
  );
  if (
    !isDeepStrictEqual(dbp, read('oracle/dbp2027.json')) ||
    !isDeepStrictEqual(dbp, read('published/dbp2027.json'))
  )
    throw new Error('DBP parity failed');
  if (!isDeepStrictEqual(synthetic, read('oracle/synthetic-gva.json')))
    throw new Error('Synthetic GVA parity failed');
  const context = new BuildContext({
    inputs: join(fixture, 'inputs'),
    originals: join(fixture, 'inputs'),
    cache: join(fixture, 'inputs'),
    release: target,
  });
  context.put('dbp2027.json', clean(dbp));
  context.put('synthetic-gva.json', clean(synthetic));
  let current = ROOT.replace(/\/$/, '');
  for (const part of ['tmp', 'ts-migration', 'candidates', '10', 'data']) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const s = await lstat(current);
    if (s.isSymbolicLink() || !s.isDirectory() || (await realpath(current)) !== current)
      throw new Error('Unsafe output directory');
  }
  const report = {
    scope: ['dbp2027', 'gva-sectors'],
    dbp: 'reproduced-from-frozen-inputs',
    dbpParity: 'exact-json-values-python-and-published',
    gvaTransform: 'verified-against-python-on-independent-synthetic-inputs',
    gvaPublication: 'preserved-hash-pinned-artifact-only',
    gvaPublishedSourceRegeneration: 'unverified-original-eurostat-responses-missing',
  };
  const output: [string, Buffer | string][] = [
    [join(current, 'dbp2027.json'), jsonStringify(context.get('dbp2027.json')) + '\n'],
    [join(current, 'gva-sectors.json'), bytes.get('published/gva-sectors.json')!],
    [join(target, 'synthetic-gva.json'), jsonStringify(context.get('synthetic-gva.json')) + '\n'],
    [join(target, 'proof-report.json'), JSON.stringify(report, null, 2) + '\n'],
  ];
  for (const [path] of output) {
    try {
      const s = await lstat(path);
      if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new Error('Unsafe output file');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  for (const [path, content] of output) {
    const temp = path + `.${process.pid}.tmp`;
    let created = false;
    try {
      await writeFile(temp, content, { flag: 'wx' });
      created = true;
      await rename(temp, path);
      created = false;
    } finally {
      if (created) await unlink(temp).catch(() => {});
    }
  }
  return 0;
}
