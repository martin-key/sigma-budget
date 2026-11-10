/** Offline diagnostic only; production validation remains Python. */
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parseYaml } from '../io/registry.js';
import { captureInputPaths, Context, safePath } from './context.js';
import { writeValidationReport } from './report.js';
import { runWave17b } from './feed-runner.js';

const REPORT = 'tmp/ts-migration/candidates/17b/report.json';
const declared = [
  'data/release/feed.json',
  'data/release/feed.xml',
  'data/release/core.json',
  'data/release/execution.json',
  'data/release/law.json',
  'data/release/rates.json',
  'data/release/debt.json',
  'data/release/expenditure.json',
  'data/release/sebra.json',
  'data/release/budget2027.json',
  'apps/web/app/lib/routes.json',
  'data/datasets.yaml',
  'data/sources.yaml',
];
const inside = (base: string, path: string) => {
  const rel = relative(base, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
function registryPaths(root: string): string[] {
  const result: string[] = [];
  const add = (raw: string) => {
    // Validate the original spelling before considering its normalized or globbed form.
    const checked = safePath(root, raw);
    const glob = raw.search(/[?*\[]/);
    if (glob < 0) {
      result.push(checked);
      return;
    }
    const prefix = raw.slice(0, glob);
    const parent = prefix.endsWith('/') ? prefix.slice(0, -1) : dirname(prefix);
    result.push(parent && parent !== '.' ? safePath(root, parent) : root);
  };
  const walk = (value: unknown, key = '', depth = 0): void => {
    if (
      ['path', 'archive', 'schema'].includes(key) &&
      !(depth === 1 && key === 'schema') &&
      typeof value !== 'string'
    )
      throw new Error(`invalid declared ${key}`);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
      return;
    }
    if (typeof value !== 'string') return;
    if (['path', 'archive', 'schema', 'files'].includes(key)) add(value);
    else if (
      key === 'inputs' &&
      (value.includes('/') || value.includes('\\') || value.startsWith('.'))
    )
      add(value);
  };
  for (const name of ['data/datasets.yaml', 'data/sources.yaml']) {
    const path = safePath(root, name);
    if (!existsSync(path)) throw new Error(`missing registry: ${name}`);
    walk(parseYaml(readFileSync(path, 'utf8')));
  }
  return result;
}
function preflight(root: string, report: string, consulted: string[] = []): void {
  if (report !== REPORT) throw new Error(`report must be ${REPORT}`);
  const cwd = realpathSync(process.cwd()),
    physical = realpathSync(root),
    target = safePath(cwd, report);
  const protectedRoots =
    physical === cwd
      ? ['data', 'pipeline', 'apps', 'packages', 'docs', 'tests', '.github', '.git'].map((x) =>
          resolve(physical, x),
        )
      : [physical];
  // Preflight every declared path, including paths which would not be reached after a crash.
  for (const path of declared) protectedRoots.push(safePath(physical, path));
  protectedRoots.push(...registryPaths(physical), ...consulted);
  if (protectedRoots.some((path) => inside(path, target)))
    throw new Error('report must be outside validation input trees');
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error('report must not overwrite a hard-linked or non-regular file');
  }
}
export function main(argv: string[]): number {
  try {
    let root = '',
      report = '',
      only = '',
      accepted = true;
    const seen = new Set<string>();
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;
      if (seen.has(arg)) throw new Error(`duplicate option: ${arg}`);
      seen.add(arg);
      if (['--root', '--report', '--only'].includes(arg)) {
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
        if (arg === '--root') root = value;
        else if (arg === '--report') report = value;
        else only = value;
      } else if (arg === '--no-accepted') accepted = false;
      else throw new Error(`unknown option: ${arg}`);
    }
    if (!root || !report || !only) throw new Error('required: --root, --report, --only FEED');
    if (only.trim().toUpperCase() !== 'FEED')
      throw new Error('wave17b requires explicit --only FEED');
    root = resolve(root);
    preflight(root, report);
    const context = new Context(realpathSync(root), '2026-11-08');
    const { value: result, paths } = captureInputPaths(context.root, () =>
      runWave17b(context, ['FEED'], accepted),
    );
    preflight(root, report, paths);
    const text = JSON.stringify(result, null, 2) + '\n';
    writeValidationReport(process.cwd(), report, text);
    process.stdout.write(text);
    return result.status === 'PASS' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  process.exitCode = main(process.argv.slice(2));
