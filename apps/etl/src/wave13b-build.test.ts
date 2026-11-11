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
import { afterAll, beforeAll, expect, it } from 'vitest';
import { wave13bBuildCli } from './wave13b-build.js';

const repository = resolve(import.meta.dirname, '../../..');
const fixture = join(repository, 'packages/ingest/test/fixtures');
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'wave13b-'));
  const target = join(root, 'tmp/ts-migration/candidates/candidate13b');
  const args = (inputs = fixture, out = target) => [
    '--inputs',
    inputs,
    '--out',
    out,
    '--scope',
    'wave13b',
    '--build-date',
    '2026-11-08',
  ];
  return { root, target, args };
}
let shared: ReturnType<typeof sandbox>;
// Audit: 70-file graph setup took 8.61s unloaded and exceeded 10s under load.
// Scoped integration setup budget; all six graph assertions remain.
beforeAll(async () => {
  shared = sandbox();
  mkdirSync(join(shared.target, 'data/ministries'), { recursive: true });
  writeFileSync(join(shared.target, 'data/ministries/stale.json'), '{}');
  expect(await wave13bBuildCli(shared.args(), shared.root)).toBe(0);
}, 30_000);
afterAll(() => {
  if (shared) rmSync(shared.root, { recursive: true, force: true });
});

it('writes the 70-file candidate and records every stage and evidence mode', () => {
  const report = JSON.parse(readFileSync(join(shared.target, 'report.json'), 'utf8'));
  expect(report.outcome).toBe('unverified');
  expect(report.stages.every((stage: { status: string }) => stage.status === 'success')).toBe(true);
  expect(report.parity.artifacts).toHaveLength(70);
  expect(report.parity.metadataValid).toBe(true);
});
it('rejects traversal, overlapping inputs and unsafe report paths before writing', async () => {
  const s = sandbox();
  try {
    await expect(wave13bBuildCli(s.args(fixture, s.target + '/..'), s.root)).rejects.toThrow();
    await expect(wave13bBuildCli(s.args(s.target), s.root)).rejects.toThrow(/overlap/);
    await expect(
      wave13bBuildCli([...s.args(), '--report', join(fixture, 'test.json')], s.root),
    ).rejects.toThrow();
    expect(existsSync(s.target)).toBe(false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
it('rejects linked output paths, report files and stale files without touching targets', async () => {
  const s = sandbox();
  try {
    const victim = join(s.root, 'victim');
    writeFileSync(victim, 'safe');
    mkdirSync(join(s.target, 'data/ministries'), { recursive: true });
    for (const [name, hard] of [
      ['data/ministries/9999.json', false],
      ['data/outlook.json', true],
      ['report.json', false],
    ] as const) {
      const path = join(s.target, name);
      if (hard) linkSync(victim, path);
      else symlinkSync(victim, path);
      await expect(wave13bBuildCli(s.args(), s.root)).rejects.toThrow(/Unsafe/);
      rmSync(path);
      expect(readFileSync(victim, 'utf8')).toBe('safe');
    }
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
it('rejects a symlinked input root or changed inventory before candidate creation', async () => {
  const s = sandbox();
  try {
    const alias = join(s.root, 'alias');
    symlinkSync(fixture, alias);
    await expect(wave13bBuildCli(s.args(alias), s.root)).rejects.toThrow(/Unsafe/);
    const bad = join(s.root, 'bad');
    mkdirSync(join(bad, 'wave13b'), { recursive: true });
    mkdirSync(join(bad, 'catalog/inputs'), { recursive: true });
    cpSync(
      join(fixture, 'catalog/inputs/datasets.yaml'),
      join(bad, 'catalog/inputs/datasets.yaml'),
    );
    writeFileSync(join(bad, 'wave13b/proof.json'), '{}');
    await expect(wave13bBuildCli(s.args(bad), s.root)).rejects.toThrow(/inventory/);
    expect(existsSync(s.target)).toBe(false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
it('rejects linked registry files and a linked candidate directory', async () => {
  const s = sandbox();
  try {
    const bad = join(s.root, 'bad');
    mkdirSync(join(bad, 'catalog/inputs'), { recursive: true });
    const localRegistry = join(s.root, 'registry-copy.yaml');
    cpSync(join(fixture, 'catalog/inputs/datasets.yaml'), localRegistry);
    linkSync(localRegistry, join(bad, 'catalog/inputs/datasets.yaml'));
    await expect(wave13bBuildCli(s.args(bad), s.root)).rejects.toThrow(/registry/);
    expect(existsSync(s.target)).toBe(false);
    mkdirSync(join(s.root, 'tmp/ts-migration/candidates'), { recursive: true });
    const outside = join(s.root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, s.target);
    await expect(wave13bBuildCli(s.args(), s.root)).rejects.toThrow(/Unsafe/);
    expect(existsSync(join(outside, 'report.json'))).toBe(false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
it('prunes only stale regular JSON files in owned directories', async () => {
  const stale = join(shared.target, 'data/ministries/stale.json');
  expect(existsSync(stale)).toBe(false);
  const unexpected = join(shared.target, 'data/unexpected.json');
  writeFileSync(unexpected, '{}');
  await expect(wave13bBuildCli(shared.args(), shared.root)).rejects.toThrow(/Unexpected/);
  expect(existsSync(unexpected)).toBe(true);
  rmSync(unexpected);
});
