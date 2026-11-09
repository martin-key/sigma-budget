import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { debtLocalBuildCli } from './debt-local-build.js';
const root = resolve(import.meta.dirname, '../../..'),
  fixture = join(root, 'packages/ingest/test/fixtures/debt-local'),
  candidate = join(root, 'tmp/ts-migration/candidates/07');
const args = (out = candidate, input = fixture) => [
  '--inputs',
  input,
  '--out',
  out,
  '--scope',
  'debt,municipalities,geo-obshtini,sebra',
  '--build-date',
  '2026-11-08',
];
afterEach(() => rmSync(candidate, { recursive: true, force: true }));
it('dispatches the exact scope from another working directory and compares all files', () => {
  const outside = mkdtempSync(join(tmpdir(), 'ts07-cwd-'));
  try {
    const cli = join(root, 'apps/etl/dist/cli.js');
    const result = spawnSync(process.execPath, [cli, 'build', ...args()], {
      cwd: outside,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/SZR36.*archived topology remains invalid/);
    for (const name of ['debt.json', 'municipalities.json', 'geo/obshtini.json', 'sebra.json'])
      expect(JSON.parse(readFileSync(join(candidate, 'data', name), 'utf8'))).toEqual(
        JSON.parse(readFileSync(join(fixture, 'projected', name), 'utf8')),
      );
    const bad = spawnSync(
      process.execPath,
      [
        cli,
        'build',
        ...args().map((x) => (x === 'debt,municipalities,geo-obshtini,sebra' ? 'debt,sebra' : x)),
      ],
      { cwd: outside, encoding: 'utf8' },
    );
    expect(bad.status).not.toBe(0);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
it('rejects traversal, outside paths, symlinks, hardlinks and changed fixture bytes', async () => {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const outside = mkdtempSync(join(root, 'tmp/ts07-guard-'));
  try {
    await expect(
      debtLocalBuildCli(args().map((value) => (value === '2026-11-08' ? '2026-02-31' : value))),
    ).rejects.toThrow(/build-date/);
    await expect(debtLocalBuildCli(args(join(candidate, '..', '07') + '/../07'))).rejects.toThrow(
      /Traversal/,
    );
    await expect(debtLocalBuildCli(args(outside))).rejects.toThrow(/Output/);
    await expect(debtLocalBuildCli(args(join(root, 'data/release')))).rejects.toThrow(/Output/);
    await expect(debtLocalBuildCli(args(join(fixture, 'inputs')))).rejects.toThrow(/Output/);
    mkdirSync(join(root, 'tmp/ts-migration/candidates'), { recursive: true });
    symlinkSync(outside, candidate);
    await expect(debtLocalBuildCli(args())).rejects.toThrow(/Unsafe/);
    expect(existsSync(join(outside, 'data'))).toBe(false);
    rmSync(candidate);
    mkdirSync(join(candidate, 'data/geo'), { recursive: true });
    const victim = join(outside, 'victim');
    writeFileSync(victim, 'unchanged');
    symlinkSync(victim, join(candidate, 'data/geo/obshtini.json'));
    await expect(debtLocalBuildCli(args())).rejects.toThrow(/Unsafe/);
    rmSync(join(candidate, 'data/geo/obshtini.json'));
    linkSync(victim, join(candidate, 'data/geo/obshtini.json'));
    await expect(debtLocalBuildCli(args())).rejects.toThrow(/Unsafe/);
    expect(readFileSync(victim, 'utf8')).toBe('unchanged');
    rmSync(join(candidate, 'data/geo/obshtini.json'));
    const copy = join(outside, 'fixture');
    cpSync(fixture, copy, { recursive: true });
    writeFileSync(join(copy, 'inputs/data/inputs/debt_gdp.json'), '{}');
    await expect(debtLocalBuildCli(args(candidate, copy))).rejects.toThrow(/hash mismatch/);
    const alias = join(outside, 'alias');
    symlinkSync(fixture, alias);
    await expect(debtLocalBuildCli(args(candidate, alias))).rejects.toThrow(/Symlink/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
