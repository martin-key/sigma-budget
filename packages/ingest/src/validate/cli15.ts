/** Explicit offline Wave15 validation. Production validation remains Python. */
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { captureInputPaths, Context } from './context.js';
import { preflightValidationReport, writeValidationReport } from './report.js';
import { WAVE15_GROUPS, WAVE15_UNPORTED, runWave15 } from './wave15.js';

function inside(base: string, path: string): boolean {
  const r = relative(base, path);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`));
}
export function main15(argv: string[]): number {
  try {
    let root = '',
      report = '',
      only = '',
      live = false,
      list = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--root' || arg === '--report' || arg === '--only') {
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
        if (arg === '--root') root = value;
        else if (arg === '--report') report = value;
        else only = value;
      } else if (arg === '--live') live = true;
      else if (arg === '--list') list = true;
      else throw new Error(`unknown option: ${arg}`);
    }
    const selected = only
      ? only
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : [...WAVE15_GROUPS];
    if (!selected.length) throw new Error('Explicit group selection is required');
    for (const name of selected)
      if (!(WAVE15_GROUPS as readonly string[]).includes(name))
        throw new Error(`unknown or unported group: ${name}`);
    if (list) {
      process.stdout.write(
        JSON.stringify({ ported: WAVE15_GROUPS, unported: WAVE15_UNPORTED }, null, 2) + '\n',
      );
      return 0;
    }
    if (live && root) throw new Error('--live and --root are mutually exclusive');
    if (!live && !root) throw new Error('specify --root or explicitly select --live');
    const input = realpathSync(resolve(live ? process.cwd() : root));
    const path = report ? preflightValidationReport(process.cwd(), report) : '';
    const protectedTrees = ['data', 'pipeline', 'apps', 'docs', 'tests', '.github', '.git'].map(
      (p) => resolve(input, p),
    );
    if (path && protectedTrees.some((p) => inside(p, path)))
      throw new Error('report must be outside validation input trees');
    const ctx = new Context(input, process.env.BUILD_DATE || '2026-11-08');
    const { value: result, paths } = captureInputPaths(input, () => runWave15(ctx, selected));
    if (path && paths.some((p) => inside(p, path)))
      throw new Error('report must be outside validation input trees');
    const text =
      JSON.stringify(
        { ...result, inputMode: live ? 'live-diagnostic' : 'explicit-root' },
        null,
        2,
      ) + '\n';
    if (report) writeValidationReport(process.cwd(), report, text);
    process.stdout.write(text);
    return result.status === 'PASS' ? 0 : 1;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  process.exitCode = main15(process.argv.slice(2));
