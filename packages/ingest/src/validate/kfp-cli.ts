/** Scoped offline diagnostic; production validation remains Python. */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Context, safePath } from './context.js';
import { loadKfpEvidence } from './kfp-input.js';
import { runWave18 } from './kfp-runner.js';
import { writeValidationReport } from './report.js';
const REPORT = 'tmp/ts-migration/candidates/18/report.json';
const inside = (base: string, path: string) => {
  const rel = relative(base, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
function preflight(root: string, report: string, captures: string, manifest: string): void {
  if (report !== REPORT) throw new Error(`report must be ${REPORT}`);
  const cwd = realpathSync(process.cwd()),
    physicalRoot = realpathSync(root),
    path = safePath(cwd, report);
  const protectedRoots =
    physicalRoot === cwd
      ? ['data', 'pipeline', 'apps', 'packages', 'docs', 'tests', '.github', '.git'].map((p) =>
          resolve(physicalRoot, p),
        )
      : [physicalRoot];
  protectedRoots.push(safePath(physicalRoot, captures), safePath(physicalRoot, manifest));
  if (protectedRoots.some((p) => inside(p, path)))
    throw new Error('report must be outside validation input trees');
  if (existsSync(path)) {
    const st = lstatSync(path);
    if (!st.isFile() || st.nlink !== 1)
      throw new Error('report must not overwrite a hard-linked or non-regular file');
  }
}
export function main(argv: string[]): number {
  try {
    let root = '',
      captures = '',
      manifest = '',
      report = '',
      only = '',
      absent = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (['--root', '--captures', '--manifest', '--report', '--only'].includes(arg!)) {
        const v = argv[++i];
        if (!v || v.startsWith('--')) throw new Error(`missing value for ${arg}`);
        if (arg === '--root') root = v;
        else if (arg === '--captures') captures = v;
        else if (arg === '--manifest') manifest = v;
        else if (arg === '--report') report = v;
        else only = v;
      } else if (arg === '--raw-absent') absent = true;
      else throw new Error(`unknown option: ${arg}`);
    }
    if (!root || !captures || !manifest || !report || !only)
      throw new Error('required: --root, --captures, --manifest, --report, --only KFP');
    const selected = only
      .split(',')
      .map((name) => name.trim().toUpperCase())
      .filter(Boolean);
    if (!selected.length || selected.some((name) => name !== 'KFP'))
      throw new Error('wave18 supports only the explicit KFP group');
    preflight(resolve(root), report, captures, manifest);
    const context = new Context(resolve(root), '2026-11-08');
    const evidence = loadKfpEvidence(context.root, captures, manifest, absent);
    const result = runWave18(context, evidence, ['KFP']);
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
