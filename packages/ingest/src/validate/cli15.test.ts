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
import { dirname, join, relative, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { main15 } from './cli15.js';
import { Context } from './context.js';
import { runWave15, WAVE15_UNPORTED } from './wave15.js';
const corpus = new URL('../../test/fixtures/validate15/corpus/', import.meta.url);
it('runs the seven groups with exact scope and refuses unsupported selection', () => {
  const ctx = new Context(corpus.pathname),
    result = runWave15(ctx, [
      'PROGRAMS',
      'ANNEX3',
      'REVENUE',
      'EXPENDITURE',
      'MEASURES',
      'LAW',
      'BUDGETS',
    ]);
  expect(result.groups.map((c) => [c.name, c.n])).toEqual([
    ['ANNEX3', 169],
    ['REVENUE', 602],
    ['EXPENDITURE', 619],
    ['MEASURES', 324],
    ['LAW', 1826],
    ['BUDGETS', 935],
    ['PROGRAMS', 12499],
  ]);
  expect(result.status).toBe('PASS');
  expect(result.completeValidation).toBe(false);
  expect(result.unported).toContain('BUDGET2027');
  expect(result.unported).toContain('KFP');
  for (const name of WAVE15_UNPORTED)
    expect(() => runWave15(ctx, [name])).toThrow('unknown or unported');
  expect(() => runWave15(ctx, [])).toThrow('Explicit group selection');
});
it('guards paths and parses flag values, preserves sentinels, writes PASS and FAIL atomically', () => {
  mkdirSync(resolve('tmp/ts-migration'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/ts-migration/wave15-input-')),
    reports = mkdtempSync(resolve('tmp/ts-migration/wave15-reports-')),
    ext = mkdtempSync(resolve('tmp/wave15-external-'));
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
    err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    cpSync(corpus, root, { recursive: true });
    const alias = join(ext, 'alias');
    symlinkSync(root, alias);
    const input = join(root, 'data/release/outlook.json'),
      original = readFileSync(input);
    for (const r of [root, alias])
      expect(
        main15(['--root', r, '--only', 'ANNEX3', '--report', relative(process.cwd(), input)]),
      ).toBe(2);
    expect(readFileSync(input)).toEqual(original);
    const sentinel = join(ext, 'sentinel.json');
    writeFileSync(sentinel, 'sentinel');
    for (const [name, link] of [
      ['hard.json', linkSync],
      ['link.json', symlinkSync],
    ] as const) {
      const dest = join(reports, name);
      link(sentinel, dest);
      expect(
        main15(['--root', root, '--only', 'ANNEX3', '--report', relative(process.cwd(), dest)]),
      ).toBe(2);
      expect(readFileSync(sentinel, 'utf8')).toBe('sentinel');
    }
    const dangling = join(reports, 'dangling');
    symlinkSync(join(ext, 'absent'), dangling);
    expect(
      main15([
        '--root',
        root,
        '--only',
        'ANNEX3',
        '--report',
        relative(process.cwd(), join(dangling, 'x.json')),
      ]),
    ).toBe(2);
    const invalid = join(reports, 'no-create', 'report.json');
    expect(
      main15([
        '--root',
        root,
        '--only',
        'BUDGET2027',
        '--report',
        relative(process.cwd(), invalid),
      ]),
    ).toBe(2);
    expect(existsSync(dirname(invalid))).toBe(false);
    expect(main15(['--root', root, '--only', '--live'])).toBe(2);
    expect(main15(['--list', '--only', 'BUDGET2027'])).toBe(2);
    expect(
      main15([
        '--root',
        root,
        '--report',
        'tmp/ts-migration/../../data/release/bad.json',
        '--only',
        'ANNEX3',
      ]),
    ).toBe(2);
    const report = join(reports, 'valid', 'report.json'),
      args = ['--root', root, '--only', 'ANNEX3', '--report', relative(process.cwd(), report)];
    expect(main15(args)).toBe(0);
    expect(JSON.parse(readFileSync(report, 'utf8')).status).toBe('PASS');
    const bad = JSON.parse(original.toString());
    bad.years[0] = 2000;
    writeFileSync(input, JSON.stringify(bad));
    expect(main15(args)).toBe(1);
    expect(JSON.parse(readFileSync(report, 'utf8')).status).toBe('FAIL');
    delete bad.years;
    writeFileSync(input, JSON.stringify(bad));
    expect(main15(args)).toBe(1);
    const crashed = JSON.parse(readFileSync(report, 'utf8'));
    expect(crashed.groups[0].n).toBe(1);
    expect(crashed.groups[0].problems).toEqual(["group crashed: KeyError: 'years'"]);
    const flagWords = join(ext, 'PROGRAMS');
    symlinkSync(root, flagWords);
    expect(main15(['--root', flagWords, '--only', 'MEASURES'])).toBe(0);
  } finally {
    out.mockRestore();
    err.mockRestore();
    rmSync(root, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
    rmSync(ext, { recursive: true, force: true });
  }
});
