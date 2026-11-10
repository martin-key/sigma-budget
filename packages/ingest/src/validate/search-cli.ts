/** Scoped offline SEARCH diagnostic; the production validator remains unchanged. */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Context, safePath } from './context.js';
import { writeValidationReport } from './report.js';
import { runWave17c } from './search-runner.js';
const REPORT = 'tmp/ts-migration/candidates/17c/report.json';
const DATA = [
  'search-index',
  'ministries',
  'municipalities',
  'measures',
  'glossary',
  'catalog',
  'programs',
  'budget2027',
].map((x) => `data/release/${x}.json`);
const INPUTS = [...DATA, 'apps/web/app/lib/routes.json'];
const inside = (base: string, path: string) => {
  const rel = relative(base, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
function preflight(root: string, report: string): void {
  if (report !== REPORT) throw new Error(`report must be ${REPORT}`);
  const cwd = realpathSync(process.cwd()),
    physicalRoot = realpathSync(root),
    target = safePath(cwd, report);
  // Inspect every declared input even when the first read would fail, before any write.
  const inputs = INPUTS.map((p) => safePath(physicalRoot, p));
  const protectedPaths =
    physicalRoot === cwd
      ? [...inputs, resolve(physicalRoot, 'data/release')]
      : [physicalRoot, ...inputs];
  if (protectedPaths.some((p) => inside(p, target) || p === target))
    throw new Error('report must be outside validation input trees');
  if (existsSync(target)) {
    const st = lstatSync(target);
    if (!st.isFile() || st.nlink !== 1)
      throw new Error('report must not overwrite a hard-linked or non-regular file');
  }
}
export function main(argv: string[]): number {
  try {
    let root = '',
      report = '',
      only = '',
      mode = '';
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
      } else if (arg === '--raw' || arg === '--accepted') {
        if (mode) throw new Error('choose one mode');
        mode = arg;
      } else throw new Error(`unknown option: ${arg}`);
    }
    if (!root || !report || !only) throw new Error('required: --root, --report, --only SEARCH');
    if (only.trim().toUpperCase() !== 'SEARCH')
      throw new Error('candidate17c supports only the explicit SEARCH group');
    preflight(resolve(root), report);
    const result = runWave17c(new Context(resolve(root)), ['SEARCH'], mode !== '--raw');
    preflight(resolve(root), report);
    const text = JSON.stringify(result, null, 2) + '\n';
    writeValidationReport(process.cwd(), report, text);
    process.stdout.write(text);
    return result.status === 'PASS' ? 0 : 1;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  process.exitCode = main(process.argv.slice(2));
