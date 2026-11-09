import {
  linkSync,
  mkdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  rmdirSync,
  mkdtempSync,
  cpSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregationBuildCli } from './aggregation-build.js';
const root = resolve(import.meta.dirname, '../../..'),
  original = process.cwd(),
  originalPwd = process.env.PWD;
const target = join(root, 'tmp/ts-migration/candidates/11'),
  data = join(target, 'data'),
  fixture = join(root, 'packages/ingest/test/fixtures/aggregation');
const args = (input = fixture, out = 'tmp/ts-migration/candidates/11') => [
  '--inputs',
  input,
  '--out',
  out,
  '--scope',
  'core,feed,feed-rss,search-index',
  '--build-date',
  '2026-11-08',
];
beforeAll(async () => {
  process.chdir(root);
  process.env.PWD = root;
  await aggregationBuildCli(args());
});
afterAll(() => {
  process.chdir(original);
  if (originalPwd === undefined) delete process.env.PWD;
  else process.env.PWD = originalPwd;
});
describe('candidate 11 safety', () => {
  it('rejects traversal, other targets and overlapping inputs', async () => {
    await expect(
      aggregationBuildCli(args(fixture, 'tmp/ts-migration/candidates/11/../11')),
    ).rejects.toThrow(/traversal/);
    await expect(
      aggregationBuildCli(args(fixture, 'tmp/ts-migration/candidates/110')),
    ).rejects.toThrow(/Output/);
    await expect(aggregationBuildCli(args(target))).rejects.toThrow(/overlap/);
    const nested = join(target, '..nested');
    mkdirSync(nested);
    try {
      await expect(aggregationBuildCli(args(nested))).rejects.toThrow(/overlap/);
    } finally {
      rmdirSync(nested);
    }
  });
  it('preflights a symlink or hardlink before building', async () => {
    const path = join(data, 'core.json'),
      saved = join(data, 'core.saved');
    renameSync(path, saved);
    try {
      symlinkSync(join(fixture, 'published/core.json'), path);
      await expect(aggregationBuildCli(args())).rejects.toThrow(/Unsafe output/);
      unlinkSync(path);
      linkSync(join(fixture, 'published/core.json'), path);
      await expect(aggregationBuildCli(args())).rejects.toThrow(/Unsafe output/);
      unlinkSync(path);
    } finally {
      try {
        unlinkSync(path);
      } catch {}
      renameSync(saved, path);
    }
  });
  it('rejects input aliases and altered pinned bytes', async () => {
    const dir = mkdtempSync(join(root, 'tmp/wave11-test-'));
    try {
      const alias = join(dir, 'alias');
      symlinkSync(fixture, alias);
      await expect(aggregationBuildCli(args(alias))).rejects.toThrow(/Symlink/);
      const copy = join(dir, 'fixture');
      cpSync(fixture, copy, { recursive: true });
      writeFileSync(join(copy, 'inputs/population.json'), '{}');
      await expect(aggregationBuildCli(args(copy))).rejects.toThrow(/hash mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('leaves the candidate absent when a fixture is missing or fails its hash', async () => {
    const dir = mkdtempSync(join(root, 'tmp/wave11-invalid-input-')),
      saved = join(dir, 'candidate'),
      empty = join(dir, 'empty'),
      altered = join(dir, 'altered');
    mkdirSync(empty);
    renameSync(target, saved);
    try {
      await expect(aggregationBuildCli(args(empty))).rejects.toThrow(/ENOENT/);
      expect(existsSync(target)).toBe(false);
      cpSync(fixture, altered, { recursive: true });
      writeFileSync(join(altered, 'inputs/population.json'), '{}');
      await expect(aggregationBuildCli(args(altered))).rejects.toThrow(/hash mismatch/);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
      renameSync(saved, target);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('does not confuse a sibling whose name begins with the output path', async () => {
    const sibling = target + '-other';
    mkdirSync(sibling, { recursive: true });
    try {
      await expect(aggregationBuildCli(args(sibling))).rejects.not.toThrow(/overlap/);
    } finally {
      rmdirSync(sibling);
    }
  });
});
