import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  linkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { fiscalBuildCli } from './fiscal-build.js';
const fixture = resolve(import.meta.dirname, '../../../packages/ingest/test/fixtures/fiscal');
const candidate = 'tmp/ts-migration/candidates/candidate03';
const args = (out = candidate) => [
  '--inputs',
  fixture,
  '--out',
  out,
  '--scope',
  'outlook,revenue,expenditure,measures',
  '--build-date',
  '2026-11-08',
];
it('builds only the scoped outputs in the confined candidate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fiscal-cli-'));
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  try {
    expect(await fiscalBuildCli(args())).toBe(0);
    for (const name of ['outlook', 'revenue', 'expenditure', 'measures'])
      expect(
        JSON.parse(readFileSync(join(dir, candidate, 'data', name + '.json'), 'utf8')),
      ).toEqual(JSON.parse(readFileSync(join(fixture, 'oracle', name + '.json'), 'utf8')));
    await expect(fiscalBuildCli(args('../escape'))).rejects.toThrow(/candidate03/);
  } finally {
    spy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
it('rejects symlinked directories and output files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fiscal-cli-')),
    outside = mkdtempSync(join(tmpdir(), 'fiscal-outside-'));
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  try {
    mkdirSync(join(dir, 'tmp/ts-migration/candidates'), { recursive: true });
    symlinkSync(outside, join(dir, candidate));
    await expect(fiscalBuildCli(args())).rejects.toThrow(/Symlink/);
    expect(existsSync(join(outside, 'data'))).toBe(false);
    rmSync(join(dir, candidate));
    mkdirSync(join(dir, candidate, 'data'), { recursive: true });
    const victim = join(outside, 'victim');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, join(dir, candidate, 'data/outlook.json'));
    await expect(fiscalBuildCli(args())).rejects.toThrow();
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    rmSync(join(dir, candidate, 'data/outlook.json'));
    linkSync(victim, join(dir, candidate, 'data/outlook.json'));
    await expect(fiscalBuildCli(args())).rejects.toThrow(/private regular file/);
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
  } finally {
    spy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
