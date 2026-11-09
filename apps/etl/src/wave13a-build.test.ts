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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wave13aBuildCli, wave13aScope } from './wave13a-build.js';
const repo = resolve(import.meta.dirname, '../../..');
const fixtures = join(repo, 'packages/ingest/test/fixtures');
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'sigma13a-cli-'));
  mkdirSync(join(root, 'data'));
  cpSync(join(repo, 'data/datasets.yaml'), join(root, 'data/datasets.yaml'));
  const target = join(root, 'tmp/ts-migration/candidates/13a');
  const args = (input = fixtures, out = target, scope = wave13aScope) => [
    '--inputs',
    input,
    '--out',
    out,
    '--scope',
    scope,
    '--build-date',
    '2026-11-08',
  ];
  return { root, target, args };
}
async function withSandbox(run: (value: ReturnType<typeof sandbox>) => Promise<void>) {
  const value = sandbox();
  try {
    await run(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}
describe('six owners using IDs derived from the registry', () => {
  let shared: ReturnType<typeof sandbox>;
  beforeAll(async () => {
    shared = sandbox();
    const { root, args } = shared;
    expect(await wave13aBuildCli(args(), root)).toBe(0);
  });
  afterAll(() => {
    if (shared) rmSync(shared.root, { recursive: true, force: true });
  });
  for (const name of [
    'outlook',
    'revenue',
    'expenditure',
    'budget2027',
    'budget2027-provenance',
    'law',
  ])
    it(name, () => {
      const actual = JSON.parse(readFileSync(join(shared.target, 'data', `${name}.json`), 'utf8'));
      const expected = JSON.parse(
        readFileSync(join(fixtures, 'wave13a/final', `${name}.json`), 'utf8'),
      );
      expect(actual).toEqual(expected);
    });
});
it('rejects scope collisions, traversal, overlap and links before building', () =>
  withSandbox(async ({ root, target, args }) => {
    await expect(wave13aBuildCli(args(fixtures, target, 'law'), root)).rejects.toThrow();
    await expect(wave13aBuildCli(args(fixtures, target + '/..'), root)).rejects.toThrow();
    mkdirSync(join(target, '..review-inputs'), { recursive: true });
    await expect(wave13aBuildCli(args(join(target, '..review-inputs')), root)).rejects.toThrow(
      /overlap/,
    );
    rmSync(join(target, '..review-inputs'), { recursive: true });
    const out = join(target, 'data/outlook.json'),
      victim = join(root, 'victim');
    mkdirSync(join(target, 'data'), { recursive: true });
    writeFileSync(victim, 'untouched');
    symlinkSync(join(root, 'missing'), out);
    await expect(wave13aBuildCli(args(), root)).rejects.toThrow(/Unsafe/);
    rmSync(out);
    linkSync(victim, out);
    await expect(wave13aBuildCli(args(), root)).rejects.toThrow(/Unsafe/);
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
  }));
it('leaves no candidate directory when frozen inputs fail verification', () =>
  withSandbox(async ({ root, target, args }) => {
    rmSync(target, { recursive: true, force: true });
    const bad = join(root, 'bad-inputs');
    mkdirSync(join(bad, 'wave13a'), { recursive: true });
    writeFileSync(join(bad, 'wave13a/inputs-sha256.json'), '{}');
    await expect(wave13aBuildCli(args(bad), root)).rejects.toThrow(/inventory/);
    expect(existsSync(target)).toBe(false);
  }));
it('rejects a dangling or linked candidate parent without following it', () =>
  withSandbox(async ({ root, target, args }) => {
    mkdirSync(join(root, 'tmp/ts-migration/candidates'), { recursive: true });
    symlinkSync(join(root, 'missing'), target);
    await expect(wave13aBuildCli(args(), root)).rejects.toThrow(/Unsafe/);
    rmSync(target);
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, target);
    await expect(wave13aBuildCli(args(), root)).rejects.toThrow(/Unsafe/);
    expect(existsSync(join(outside, 'data'))).toBe(false);
    rmSync(target);
  }));

it('protects every declared input root and registry from parity report writes', () =>
  withSandbox(async ({ root, target }) => {
    const { parityCli } = await import('@sigma-budget/ingest');
    const base = [
      '--oracle',
      join(fixtures, 'wave13a/final'),
      '--candidate',
      join(target, 'data'),
      '--scope',
      wave13aScope,
      '--policy',
      join(fixtures, 'wave13a/policy.json'),
      '--registry',
      join(fixtures, 'wave13a/datasets.yaml'),
    ];
    await expect(parityCli([...base, '--report', join(root, 'report.json')])).rejects.toThrow(
      /requires --protect/,
    );
    const reordered = base.map((value) =>
      value === wave13aScope ? wave13aScope.split(',').reverse().join(',') : value,
    );
    await expect(parityCli([...reordered, '--report', join(root, 'report.json')])).rejects.toThrow(
      /requires --protect/,
    );
    await expect(
      parityCli([
        ...base,
        '--protect',
        fixtures,
        '--report',
        join(fixtures, 'fiscal/donor/outlook.json'),
      ]),
    ).rejects.toThrow(/outside input roots/);
    const alias = join(root, 'fixture-alias');
    symlinkSync(fixtures, alias);
    await expect(
      parityCli([...base, '--protect', fixtures, '--report', join(alias, 'report.json')]),
    ).rejects.toThrow(/symlinks/);
    await expect(
      parityCli([
        ...base,
        '--protect',
        fixtures,
        '--report',
        join(fixtures, 'wave13a/datasets.yaml'),
      ]),
    ).rejects.toThrow(/outside input roots/);
  }));
