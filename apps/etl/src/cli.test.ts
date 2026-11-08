import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = resolve(import.meta.dirname, '../../../packages/ingest/test/fixtures/law');
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const dirs: string[] = [];

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it.each([
  'components,rates',
  'glossary,guide',
  'ministries,ministries-programs,programs',
  'outlook,revenue,expenditure,measures',
])('builds the requested law scope when an input directory is named %s', async (inputDir) => {
  const root = mkdtempSync(join(tmpdir(), 'build-dispatch-'));
  dirs.push(root);
  mkdirSync(join(root, inputDir));
  copyFileSync(join(fixture, 'evidence.json'), join(root, inputDir, 'evidence.json'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.argv = [
    'node',
    'budget-ts',
    'build',
    '--inputs',
    inputDir,
    '--out',
    'tmp/ts-migration/candidates/law',
    '--scope',
    'law',
    '--build-date',
    '2026-11-08',
  ];
  process.exitCode = undefined;
  vi.resetModules();
  await import('./cli.js');
  expect(error).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(0);
  expect(
    JSON.parse(readFileSync(join(root, 'tmp/ts-migration/candidates/law/data/law.json'), 'utf8')),
  ).toEqual(JSON.parse(readFileSync(join(fixture, 'oracle.json'), 'utf8')));
});
