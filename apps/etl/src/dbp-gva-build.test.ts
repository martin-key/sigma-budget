import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
const root = resolve(import.meta.dirname, '../../..');
const fixture = join(root, 'packages/ingest/test/fixtures/dbp-gva');
const out = join(root, 'tmp/ts-migration/candidates/10');
const exe = join(root, 'apps/etl/bin/budget-ts.js');
const args = (
  inputs = fixture,
  output = 'tmp/ts-migration/candidates/10',
  scope = 'dbp2027,gva-sectors',
) => ['build', '--inputs', inputs, '--out', output, '--scope', scope, '--build-date', '2026-11-08'];
const run = (a: string[], env = {}) =>
  spawnSync(process.execPath, [exe, ...a], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PWD: root, ...env },
  });
beforeAll(() => {
  execFileSync('pnpm', ['--filter', '@sigma-budget/etl...', 'build'], { cwd: root, stdio: 'pipe' });
}, 60000);
it('dispatches the exact scope and records the three distinct proof lanes', () => {
  const result = run(args());
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(readFileSync(join(out, 'proof-report.json'), 'utf8'));
  expect(report.dbp).toBe('reproduced-from-frozen-inputs');
  expect(report.gvaPublication).toBe('preserved-hash-pinned-artifact-only');
  expect(report.gvaPublishedSourceRegeneration).toMatch(/unverified/);
  expect(readFileSync(join(out, 'data/gva-sectors.json'))).toEqual(
    readFileSync(join(fixture, 'published/gva-sectors.json')),
  );
  expect(
    run(args(fixture, 'tmp/ts-migration/candidates/10', 'gva-sectors,dbp2027')).status,
  ).not.toBe(0);
});
it('rejects traversal, output aliases and cwd aliases', () => {
  expect(run(args(fixture, 'tmp/ts-migration/candidates/10/..')).status).not.toBe(0);
  expect(run(args(fixture + '/../dbp-gva')).status).not.toBe(0);
  expect(run(args(), { PWD: root + '/..' }).status).not.toBe(0);
});
it('rejects nested inputs with a double-dot prefix while accepting an unrelated prefixed directory', () => {
  const nested = mkdtempSync(join(out, '..review-inputs-'));
  const external = mkdtempSync(join(tmpdir(), '..ts10-inputs-'));
  try {
    cpSync(fixture, nested, { recursive: true });
    const result = run(args(nested));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/overlap/);
    cpSync(fixture, external, { recursive: true });
    expect(run(args(external)).status).toBe(0);
  } finally {
    rmSync(nested, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
it('rejects altered evidence and linked outputs without changing their target', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ts10-'));
  try {
    const input = join(temp, 'fixture');
    cpSync(fixture, input, { recursive: true });
    writeFileSync(join(input, 'inputs/figures.json'), '{}');
    expect(run(args(input)).status).not.toBe(0);
    expect(run(args()).status).toBe(0);
    const target = join(out, 'data/gva-sectors.json'),
      original = join(temp, 'original.json');
    copyFileSync(target, original);
    rmSync(target);
    symlinkSync(original, target);
    expect(run(args()).status).not.toBe(0);
    expect(readFileSync(original)).toEqual(
      readFileSync(join(fixture, 'published/gva-sectors.json')),
    );
    rmSync(target);
    const sameDevice = join(out, 'hardlink-test.json');
    copyFileSync(original, sameDevice);
    linkSync(sameDevice, target);
    expect(run(args()).status).not.toBe(0);
    expect(readFileSync(original)).toEqual(
      readFileSync(join(fixture, 'published/gva-sectors.json')),
    );
    rmSync(target);
    rmSync(sameDevice);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  expect(run(args()).status).toBe(0);
});
