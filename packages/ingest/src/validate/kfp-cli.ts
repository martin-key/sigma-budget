/** Scoped offline diagnostic; production validation remains Python. */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { captureInputPaths, Context, safePath } from './context.js';
import { loadKfpEvidence } from './kfp-input.js';
import { runWave18 } from './kfp-runner.js';
import { writeValidationReport } from './report.js';
const REPORT = 'tmp/ts-migration/candidates/18/report.json';
const inside = (base: string, path: string) => {
  const rel = relative(base, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
function preflight(
  root: string,
  report: string,
  captures: string,
  manifest: string,
  consultedInputs: string[] = [],
): void {
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
  protectedRoots.push(
    safePath(physicalRoot, captures),
    safePath(physicalRoot, manifest),
    ...consultedInputs,
  );
  if (protectedRoots.some((p) => inside(p, path)))
    throw new Error('report must be outside validation input trees');
  if (existsSync(path)) {
    const st = lstatSync(path);
    if (!st.isFile() || st.nlink !== 1)
      throw new Error('report must not overwrite a hard-linked or non-regular file');
  }
}
function referencedArchives(context: Context): string[] {
  const paths: string[] = [];
  for (const name of ['budget_forecast_2027.json', 'budget_bill_2027.json']) {
    const doc = context.proto(name) as { source?: { archive?: unknown } } | null;
    const archive = doc?.source?.archive;
    if (typeof archive !== 'string')
      throw new Error('archive path must be a repository-relative string');
    // A rejected spelling must abort before a failure report can replace the declared input.
    paths.push(safePath(realpathSync(context.root), archive));
  }
  return paths;
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
    // Also protect declared archives if an earlier rule prevents reaching the law checks.
    preflight(context.root, report, captures, manifest, referencedArchives(context));
    const { value: result, paths: consultedInputs } = captureInputPaths(context.root, () => {
      const evidence = loadKfpEvidence(context.root, captures, manifest, absent);
      return runWave18(context, evidence, ['KFP']);
    });
    // Validation also reads dynamically referenced ZIPs. Protect those on PASS and FAIL alike.
    preflight(context.root, report, captures, manifest, consultedInputs);
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
