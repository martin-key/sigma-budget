import { readFileSync, rmSync, lstatSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
  'yaml',
);

// The coverage job env is the sole definition of report names and paths.
export function reportPaths(definitions, env, root) {
  const entries = Object.entries(definitions).filter(([name]) => name.endsWith('_REPORT'));
  if (!entries.length) throw new Error('No mandatory parity reports configured');
  return entries.map(([name, definition]) => {
    const expected = definition.replaceAll('${{ github.workspace }}', root);
    if (env[name] !== expected)
      throw new Error(`${name}: missing or mismatched report environment`);
    const path = resolve(root, env[name]);
    if (!path.startsWith(resolve(root, 'tmp/ts-migration') + sep) || !path.endsWith('.json'))
      throw new Error(`${name}: report must stay in owned tmp/ts-migration JSON paths`);
    for (let ancestor = path; ; ancestor = dirname(ancestor)) {
      try {
        if (lstatSync(ancestor).isSymbolicLink()) throw new Error(`${name}: symlinked report path`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (ancestor === resolve(root)) break;
    }
    return { name, path };
  });
}

export function checkReports(reports) {
  for (const { name, path } of reports) {
    try {
      JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`${name}: mandatory parity report missing or invalid`, { cause: error });
    }
  }
  return reports.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const definitions = parse(readFileSync(resolve(ROOT, '.github/workflows/site.yml'), 'utf8')).jobs
    .coverage.env;
  const reports = reportPaths(definitions, process.env, ROOT);
  if (process.argv.includes('--clean')) {
    for (const { path } of reports) rmSync(path, { force: true });
    console.log(`Cleared ${reports.length} stale parity reports before testing`);
  } else {
    console.log(`Validated ${checkReports(reports)} mandatory parity reports`);
  }
}
