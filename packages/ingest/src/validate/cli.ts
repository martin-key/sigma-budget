/** Test/diagnostic-only entry point. Production continues to use Python validation. */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Context, safePath } from './context.js';
import { PORTED_GROUPS, UNPORTED_GROUPS, runWave14 } from './runner.js';
import { writeValidationReport } from './report.js';

export function main(argv: string[]): number {
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
        const value = argv[++i];
        if (!value) throw new Error(`missing value for ${arg}`);
        if (arg === '--root') root = value;
        else if (arg === '--report') report = value;
        else only = value;
      } else if (arg === '--live') live = true;
      else if (arg === '--no-accepted') accepted = false;
      else if (arg === '--list') list = true;
      else throw new Error(`unknown option: ${arg}`);
    }
    if (list) {
      process.stdout.write(
        JSON.stringify({ ported: PORTED_GROUPS, unported: UNPORTED_GROUPS }, null, 2) + '\n',
      );
      return 0;
    }
    if (live && root) throw new Error('--live and --root are mutually exclusive');
    if (!root && !live) throw new Error('specify --root or explicitly select --live');
    const context = new Context(
      resolve(live ? process.cwd() : root),
      process.env.BUILD_DATE || '2026-11-08',
    );
    const names = only
      ? only
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [...PORTED_GROUPS];
    const result = runWave14(context, names, accepted);
    const text =
      JSON.stringify(
        { ...result, inputMode: live ? 'live-diagnostic' : 'explicit-root' },
        null,
        2,
      ) + '\n';
    if (report) {
      if (!report.startsWith('tmp/ts-migration/') || !report.endsWith('.json'))
        throw new Error('report must be a JSON path under tmp/ts-migration/');
      const path = safePath(process.cwd(), report);
      const release = resolve(context.root, context.dataDir),
        rel = relative(release, path);
      if (
        !rel ||
        (!rel.startsWith(`..${sep}`) && !isAbsolute(rel)) ||
        path.split(sep).some((part, i, parts) => part === 'data' && parts[i + 1] === 'release')
      )
        throw new Error('report cannot be written inside a release tree');
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
  process.exitCode = main(process.argv.slice(2));
