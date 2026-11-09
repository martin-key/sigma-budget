import { spawnSync } from 'node:child_process';
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
import { catalogBuildCli } from './catalog-build.js';
const root = resolve(import.meta.dirname, '../../..'),
  original = process.cwd(),
  originalPwd = process.env.PWD;
const target = join(root, 'tmp/ts-migration/candidates/12'),
  data = join(target, 'data'),
  fixture = join(root, 'packages/ingest/test/fixtures/catalog');
const args = (input = fixture, out = 'tmp/ts-migration/candidates/12') => [
  '--inputs',
  input,
  '--out',
  out,
  '--scope',
  'catalog',
  '--build-date',
  '2026-11-08',
];
beforeAll(async () => {
  process.chdir(root);
  process.env.PWD = root;
  await catalogBuildCli(args());
});
afterAll(() => {
  process.chdir(original);
  if (originalPwd === undefined) delete process.env.PWD;
  else process.env.PWD = originalPwd;
});
describe('candidate 12 safety', () => {
  it('rejects traversal, other targets and overlapping inputs', async () => {
    await expect(
      catalogBuildCli(args(fixture, 'tmp/ts-migration/candidates/12/../11')),
    ).rejects.toThrow(/traversal/);
    await expect(catalogBuildCli(args(fixture, 'tmp/ts-migration/candidates/120'))).rejects.toThrow(
      /Output/,
    );
    await expect(catalogBuildCli(args(target))).rejects.toThrow(/overlap/);
    const nested = join(target, '..nested');
    mkdirSync(nested);
    try {
      await expect(catalogBuildCli(args(nested))).rejects.toThrow(/overlap/);
    } finally {
      rmdirSync(nested);
    }
  });
  it('preflights a symlink or hardlink before building', async () => {
    const path = join(data, 'catalog.json'),
      saved = join(data, 'core.saved');
    renameSync(path, saved);
    try {
      symlinkSync(join(fixture, 'oracle/published.json'), path);
      await expect(catalogBuildCli(args())).rejects.toThrow(/Unsafe output/);
      unlinkSync(path);
      linkSync(join(fixture, 'oracle/published.json'), path);
      await expect(catalogBuildCli(args())).rejects.toThrow(/Unsafe output/);
      unlinkSync(path);
    } finally {
      try {
        unlinkSync(path);
      } catch {}
      renameSync(saved, path);
    }
  });
  it('rejects input aliases and altered pinned bytes', async () => {
    const dir = mkdtempSync(join(root, 'tmp/wave12-test-'));
    try {
      const alias = join(dir, 'alias');
      symlinkSync(fixture, alias);
      await expect(catalogBuildCli(args(alias))).rejects.toThrow(/Symlink/);
      const copy = join(dir, 'fixture');
      cpSync(fixture, copy, { recursive: true });
      writeFileSync(join(copy, 'inputs/manifest.json'), '{}');
      await expect(catalogBuildCli(args(copy))).rejects.toThrow(/hash mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('leaves the candidate absent when a fixture is missing or fails its hash', async () => {
    const dir = mkdtempSync(join(root, 'tmp/wave12-invalid-input-')),
      saved = join(dir, 'candidate'),
      empty = join(dir, 'empty'),
      altered = join(dir, 'altered');
    mkdirSync(empty);
    renameSync(target, saved);
    try {
      await expect(catalogBuildCli(args(empty))).rejects.toThrow(/ENOENT/);
      expect(existsSync(target)).toBe(false);
      cpSync(fixture, altered, { recursive: true });
      writeFileSync(join(altered, 'inputs/manifest.json'), '{}');
      await expect(catalogBuildCli(args(altered))).rejects.toThrow(/hash mismatch/);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
      renameSync(saved, target);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('does not confuse a sibling whose name begins with the output path', async () => {
    const reviewInput = join(root, 'tmp/ts-migration/candidates/..review-inputs');
    mkdirSync(reviewInput, { recursive: true });
    try {
      await expect(catalogBuildCli(args(reviewInput))).rejects.not.toThrow(/overlap|traversal/);
    } finally {
      rmdirSync(reviewInput);
    }
    const sibling = target + '-other';
    mkdirSync(sibling, { recursive: true });
    try {
      await expect(catalogBuildCli(args(sibling))).rejects.not.toThrow(/overlap/);
    } finally {
      rmdirSync(sibling);
    }
  });
  it('rejects dangling output parents and non-regular targets before loading inputs', async () => {
    const saved = join(target, 'data.saved');
    renameSync(data, saved);
    try {
      symlinkSync(join(target, 'missing-parent'), data);
      await expect(catalogBuildCli(args())).rejects.toThrow(/Unsafe output/);
      unlinkSync(data);
    } finally {
      if (existsSync(data)) unlinkSync(data);
      renameSync(saved, data);
    }
    const file = join(data, 'catalog.json'),
      keep = join(data, 'catalog.saved');
    renameSync(file, keep);
    try {
      mkdirSync(file);
      await expect(catalogBuildCli(args())).rejects.toThrow(/Unsafe output/);
      rmdirSync(file);
    } finally {
      if (existsSync(file)) rmdirSync(file);
      renameSync(keep, file);
    }
  });
  it('dispatches from the actual scope flag, not an unrelated value', () => {
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'apps/etl/dist/cli.js'),
        'build',
        '--inputs',
        'catalog',
        '--out',
        'tmp/ts-migration/candidates/12',
        '--scope',
        'bogus',
        '--build-date',
        '2026-11-08',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('scope catalog');
  });
});
