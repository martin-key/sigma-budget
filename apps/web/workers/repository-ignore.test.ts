import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { resolve } from 'node:path';
import { getFileInfo } from 'prettier';

const root = resolve(import.meta.dirname, '../../..');
// Only the rules of the repository are under test: the developer's own global ignore file must not change the outcome.
const OWN_RULES = ['-c', `core.excludesFile=${devNull}`];
const git = (args: string[], input?: string) =>
  spawnSync('git', [...OWN_RULES, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    input,
  });
/** the paths among `paths` that the ignore rules match, whether or not they exist or are tracked */
function ignored(paths: string[]): string[] {
  const result = git(['check-ignore', '--no-index', '--stdin', '-z'], paths.join('\0') + '\0');
  // 0: some are ignored, 1: none is; anything else is an error of git itself
  expect(result.status === 0 || result.status === 1, result.stderr).toBe(true);
  return result.stdout.split('\0').filter(Boolean);
}
const prettierIgnored = async (path: string) =>
  (
    await getFileInfo(resolve(root, path), {
      ignorePath: [resolve(root, '.gitignore'), resolve(root, '.prettierignore')],
    })
  ).ignored;

/** a Semgrep ignore rule that is not tied to one place: no leading slash, or a `**` segment inside it */
const matchesAtAnyDepth = (rule: string) => !rule.startsWith('/') || /(^|\/)\*\*(\/|$)/.test(rule);

// Live source and frozen evidence folders that happen to carry the name of a generated folder.
const SOURCE = [
  'packages/ingest/src/build/new-builder.ts',
  'packages/ingest/src/build/new-builder.test.ts',
  'pipeline/budget_pipeline/build/new_builder.py',
  'packages/ingest/test/fixtures/wave13b/reference/build/new-builder.json',
  'apps/web/app/build/screen.ts',
  'packages/ingest/src/dist/reader.ts',
  'packages/ingest/src/coverage/rule.ts',
];
// Where the tools write their output (react-router build, tsc outDir, vitest coverage, setuptools, turbo, typegen, wrangler).
const GENERATED = [
  'apps/web/build/client/app.html',
  'apps/web/build/server/wrangler.json',
  'apps/etl/dist/cli.js',
  'packages/ingest/dist/build/law.js',
  'packages/dataset-schema/dist/index.js',
  'packages/test-support/dist/index.js',
  'apps/web/coverage/coverage-summary.json',
  'packages/ingest/coverage/coverage-summary.json',
  'coverage/coverage-summary.json',
  'coverage-summary.md',
  'pipeline/build/lib/budget_pipeline/cli.py',
  'pipeline/dist/budget_pipeline-1.0.0-py3-none-any.whl',
  'apps/web/.react-router/types/root.ts',
  'apps/web/.wrangler/state/v3/d1.sqlite',
  '.turbo/cookies/1.cookie',
  'packages/ingest/.turbo/turbo-build.log',
  'node_modules/.modules.yaml',
];

describe('repository ignore rules', () => {
  it('match no file that git tracks', () => {
    const result = git(['ls-files', '-z', '--cached', '--ignored', '--exclude-standard']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split('\0').filter(Boolean)).toEqual([]);
  });

  it('let a new file in a source folder named build, dist or coverage reach git', () => {
    expect(ignored(SOURCE)).toEqual([]);
  });

  it('still ignore the generated output where the tools write it', () => {
    expect(ignored(GENERATED)).toEqual(GENERATED);
  });

  it('bring every live builder under the Prettier check', async () => {
    const tracked = git(['ls-files', '-z', '--', 'packages/ingest/src/build']);
    expect(tracked.status, tracked.stderr).toBe(0);
    const files = tracked.stdout.split('\0').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    const skipped = [];
    for (const file of files) if (await prettierIgnored(file)) skipped.push(file);
    expect(skipped).toEqual([]);
    expect(await prettierIgnored(SOURCE[0]!)).toBe(false);
  });

  it('keep frozen evidence and generated output outside Prettier', async () => {
    for (const path of [
      'pipeline/budget_pipeline/build/core.py',
      'packages/ingest/test/fixtures/fiscal/policy.json',
      'packages/ingest/test/fixtures/catalog/policy.json',
      'apps/web/app/routes/__fixtures__/core.json',
      'data/release/core.json',
      'packages/ingest/src/production/historical/gva-sectors.json',
      'apps/web/public/vendor/echarts.min.js',
      ...GENERATED,
    ])
      expect(await prettierIgnored(path), path).toBe(true);
  });

  it('keep Semgrep off its built-in list of bare folder names', () => {
    // Without .semgrepignore Semgrep skips build/, dist/, test/, tests/ and vendor/ at any depth.
    const rules = readFileSync(resolve(root, '.semgrepignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    expect(rules.filter(matchesAtAnyDepth)).toEqual([]);
  });

  it('tell a rule anchored to the root from one that matches at any depth', () => {
    for (const rule of [
      'build/',
      'tests',
      '*.ts',
      '**/build/**',
      '/**/build/',
      '/packages/**/build/',
      'src/build/',
    ])
      expect(matchesAtAnyDepth(rule), rule).toBe(true);
    for (const rule of ['/apps/web/public/vendor/', '/packages/*/dist/', '/tmp/scan.json'])
      expect(matchesAtAnyDepth(rule), rule).toBe(false);
  });
});
