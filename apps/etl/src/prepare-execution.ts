import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  prepareExecutionFiles,
  type ExecutionInputConfig,
} from '@sigma-budget/ingest/readers/execution';
import { sha256, type PinnedFile } from '@sigma-budget/ingest/readers/workbooks';

const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return !part || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep));
};
const exists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
function realDirectory(path: string): void {
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path)
    throw new Error(`Unsafe directory: ${path}`);
}
function resolveFile(input: PinnedFile, root: string): PinnedFile {
  if (!input || typeof input.path !== 'string' || !input.path || typeof input.sha256 !== 'string')
    throw new Error('Invalid pinned file');
  const path = resolve(root, input.path),
    stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path)
    throw new Error(`Unsafe input: ${path}`);
  return { path, sha256: input.sha256 };
}
/** Creates a fresh owned output directory. Existing paths are never modified or pruned. */
export function prepareExecutionCli(args: string[]): number {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !['--config', '--build-date', '--out'].includes(key) ||
      flags[key] ||
      !value ||
      value.startsWith('--')
    )
      throw new Error(
        'Usage: prepare-execution --config inputs.json --build-date YYYY-MM-DD --out NEW_DIRECTORY',
      );
    flags[key] = value;
  }
  if (!flags['--config'] || !flags['--build-date'] || !flags['--out'])
    throw new Error('Required: --config, --build-date, --out');
  const configPath = resolve(flags['--config']);
  if (!lstatSync(configPath).isFile() || realpathSync(configPath) !== configPath)
    throw new Error('Unsafe config file');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as ExecutionInputConfig;
  if (config.schema !== 'execution-inputs/1' || !Array.isArray(config.reports) || !config.annual)
    throw new Error('Invalid execution input config');
  const root = dirname(configPath);
  config.reports = config.reports.map((file) => resolveFile(file, root));
  for (const key of [
    'forecast',
    'bill',
    'forecastArchive',
    'billArchive',
    'historicalAnnex3',
  ] as const)
    config.annual[key] = resolveFile(config.annual[key], root);
  const sources = [...config.reports, ...Object.values(config.annual)];
  const out = resolve(flags['--out']),
    parent = dirname(out);
  realDirectory(parent);
  if (exists(out)) throw new Error(`Output must be a new owned directory: ${out}`);
  if (
    out
      .split(sep)
      .some((part) =>
        [
          'originals',
          'release',
          'releases',
          'releaseddata',
          'registry',
          'registries',
          'fixtures',
          '.git',
        ].includes(part),
      ) ||
    sources.some((file) => inside(dirname(file.path), out) || inside(out, file.path)) ||
    inside(out, configPath)
  )
    throw new Error('Output overlaps protected source data');
  // Complete every read, pin and fiscal check before creating anything.
  const result = prepareExecutionFiles(config, flags['--build-date']);
  const outputs = {
    'execution.json': JSON.stringify(result.execution) + '\n',
    'execution-provenance.json': JSON.stringify(result.provenance) + '\n',
    'execution-reader-evidence.json': JSON.stringify(result.evidence) + '\n',
  };
  const temp = mkdtempSync(join(parent, '.prepare-execution-'));
  let reserved = false,
    published = false;
  try {
    for (const [name, text] of Object.entries(outputs))
      writeFileSync(join(temp, name), text, { flag: 'wx', mode: 0o600 });
    // mkdir reserves the destination without replacing any existing directory or symlink.
    mkdirSync(out);
    reserved = true;
    renameSync(temp, out);
    published = true;
  } finally {
    if (!published) {
      rmSync(temp, { recursive: true, force: true });
      if (reserved) rmdirSync(out);
    }
  }
  process.stdout.write(
    JSON.stringify({
      out,
      reports: result.evidence.reports.length,
      files: Object.fromEntries(
        Object.entries(outputs).map(([name, text]) => [
          name,
          { bytes: Buffer.byteLength(text), sha256: sha256(text) },
        ]),
      ),
      warnings: result.evidence.warnings,
      annualBoundary: result.evidence.annualBoundary,
    }) + '\n',
  );
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = prepareExecutionCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
