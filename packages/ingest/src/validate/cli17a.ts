/** Explicit offline Wave 17a diagnostic; production validation remains Python. */
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { captureInputPaths, Context, safePath } from './context.js';
import { writeValidationReport } from './report.js';
import { runWave17a, WAVE17A_GROUPS, WAVE17A_REMAINING } from './wave17a.js';

export function main17a(argv: string[]): number {
  try {
    let root = '',
      report = '',
      only = '',
      live = false,
      accepted = true,
      list = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--root' || arg === '--report' || arg === '--only') {
        const v = argv[++i];
        if (!v || v.startsWith('--')) throw Error(`missing value for ${arg}`);
        if (arg === '--root') root = v;
        else if (arg === '--report') report = v;
        else only = v;
      } else if (arg === '--live') live = true;
      else if (arg === '--no-accepted') accepted = false;
      else if (arg === '--list') list = true;
      else throw Error(`unknown option: ${arg}`);
    }
    if (list) {
      process.stdout.write(
        JSON.stringify({ ported: WAVE17A_GROUPS, unported: WAVE17A_REMAINING }, null, 2) + '\n',
      );
      return 0;
    }
    if (live && root) throw Error('--live and --root are mutually exclusive');
    if (!root && !live) throw Error('specify --root or explicitly select --live');
    if (!only) throw Error('Explicit group selection is required');
    const names = only
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      !names.length ||
      names.some((x) => !(WAVE17A_GROUPS as readonly string[]).includes(x.toUpperCase()))
    )
      throw Error('unknown or unported group');
    if (
      report &&
      (!report.startsWith('tmp/ts-migration/candidates/17a/') || !report.endsWith('.json'))
    )
      throw Error('report must be a JSON path under tmp/ts-migration/candidates/17a/');
    const ctx = new Context(
      resolve(live ? process.cwd() : root),
      process.env.BUILD_DATE || '2026-11-08',
    );
    const {
      value: result,
      paths: consulted,
      rejectedPaths,
    } = captureInputPaths(ctx.root, () => runWave17a(ctx, names, accepted));
    const text =
      JSON.stringify(
        { ...result, inputMode: live ? 'live-diagnostic' : 'explicit-root' },
        null,
        2,
      ) + '\n';
    if (report) {
      if (rejectedPaths.length) throw Error('cannot write a report after rejecting an input path');
      const path = safePath(process.cwd(), report),
        inputRoot = realpathSync(ctx.root);
      const protectedInputs = [
        ...[ctx.dataDir, 'data', 'pipeline', 'apps', 'docs', 'tests', '.github', '.git'].map((x) =>
          resolve(inputRoot, x),
        ),
        ...consulted,
      ];
      for (const input of protectedInputs) {
        const rel = relative(input, path);
        if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
          throw Error('report must be outside validation input trees');
      }
      writeValidationReport(process.cwd(), report, text);
    }
    process.stdout.write(text);
    return result.status === 'PASS' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  process.exitCode = main17a(process.argv.slice(2));
