/** Explicit diagnostic scope; production validation remains Python. */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { captureInputPaths, Context, safePath } from './context.js';
import { budget2027 } from './budget-2027.js';
import { GROUP_ORDER, runGroups } from './runner.js';
import { writeValidationReport } from './report.js';

export const UNPORTED = [
  ...GROUP_ORDER.filter((name) => name !== 'BUDGET2027'),
  'INDIRECT',
  'CONTRACT',
  'REGISTRY',
];
export function main(argv: string[]): number {
  try {
    let root = '',
      report = '',
      only = 'BUDGET2027',
      list = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--root' || arg === '--report' || arg === '--only') {
        const value = argv[++i];
        if (!value) throw new Error(`missing value for ${arg}`);
        if (arg === '--root') root = value;
        else if (arg === '--report') report = value;
        else only = value;
      } else if (arg === '--list') list = true;
      else throw new Error(`unknown option: ${arg}`);
    }
    if (list) {
      process.stdout.write(
        JSON.stringify({ ported: ['BUDGET2027'], unported: UNPORTED }, null, 2) + '\n',
      );
      return 0;
    }
    if (!root) throw new Error('specify --root');
    if (only !== 'BUDGET2027') throw new Error(`unknown or unported group: ${only}`);
    if (report && (!report.startsWith('tmp/ts-migration/') || !report.endsWith('.json')))
      throw new Error('report must be a JSON path under tmp/ts-migration/');
    const context = new Context(resolve(root));
    const path = report ? safePath(process.cwd(), report) : '';
    const inputRoot = realpathSync(context.root);
    const fixedInputs = ['data', 'pipeline', 'apps', 'docs', 'tests', '.github', '.git'].map(
      (tree) => resolve(inputRoot, tree),
    );
    const protect = (inputs: string[]) => {
      for (const input of inputs) {
        const rel = relative(input, path);
        if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
          throw new Error('report must be outside validation input trees');
      }
    };
    if (report) {
      protect(fixedInputs);
      try {
        const entry = lstatSync(path);
        if (!entry.isFile() || entry.nlink !== 1)
          throw new Error('report must not overwrite a hard-linked or non-regular file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    let invalidDeclaration = false;
    const { value, paths } = captureInputPaths(context.root, () => {
      // Capture both declared archives even if the first input fails validation.
      // Invalid declarations cannot safely be used as report destinations.
      for (const name of ['budget_forecast_2027.json', 'budget_bill_2027.json']) {
        try {
          const input = context.proto(name) as { source?: { archive?: unknown } };
          if (!input || typeof input.source?.archive !== 'string')
            throw new Error('Invalid archive declaration');
          safePath(context.root, input.source.archive);
        } catch {
          invalidDeclaration = true;
        }
      }
      return runGroups(
        [
          {
            name: 'BUDGET2027',
            description: '2027 annual periods, frozen pointers and printed totals',
            run: budget2027,
          },
        ],
        context,
        [only],
      );
    });
    const result = {
      scope: 'wave15b',
      completeValidation: false,
      unported: UNPORTED,
      ...value,
      status: value.problems ? 'FAIL' : 'PASS',
    };
    const text = JSON.stringify(result, null, 2) + '\n';
    if (report) {
      if (invalidDeclaration) throw new Error('invalid archive declaration');
      protect(paths);
      writeValidationReport(process.cwd(), report, text);
    }
    process.stdout.write(text);
    return value.problems ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  process.exitCode = main(process.argv.slice(2));
