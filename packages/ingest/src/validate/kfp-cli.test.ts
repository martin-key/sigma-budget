import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { main } from './kfp-cli.js';

const fixture = fileURLToPath(new URL('../../test/fixtures/wave18', import.meta.url));
const previous = process.cwd();
let dir: string, root: string;
const report = 'tmp/ts-migration/candidates/18/report.json';
const args = () => [
  '--root',
  root,
  '--captures',
  'captures.json',
  '--manifest',
  'manifest.json',
  '--only',
  'KFP',
  '--report',
  report,
];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kfp18-'));
  root = join(dir, 'inputs');
  cpSync(fixture, root, { recursive: true });
  process.chdir(dir);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(previous);
  rmSync(dir, { recursive: true, force: true });
});
it('writes only the scoped incomplete report and rejects unsupported selection before creating directories', () => {
  const bad = args();
  bad[bad.indexOf('KFP')] = 'CORE';
  expect(main(bad)).toBe(2);
  expect(existsSync(join(dir, 'tmp'))).toBe(false);
  const supported = args();
  supported[supported.indexOf('KFP')] = 'kfp';
  expect(main(supported)).toBe(0);
  const value = JSON.parse(readFileSync(join(dir, report), 'utf8'));
  expect(value).toMatchObject({
    scope: 'wave18',
    completeValidation: false,
    rawEvidence: 'captured-originals',
    status: 'PASS',
    totals: { checks: 5436, problems: 0, warnings: 0 },
  });
});
it('rejects alternate paths, linked parents and linked destinations before reading inputs', () => {
  const bad = args();
  bad[bad.indexOf(report)] = 'tmp/ts-migration/candidates/18/../18/report.json';
  expect(main(bad)).toBe(2);
  expect(existsSync(join(dir, 'tmp'))).toBe(false);
  mkdirSync(join(dir, 'tmp/ts-migration/candidates'), { recursive: true });
  symlinkSync(root, join(dir, 'tmp/ts-migration/candidates/18'));
  expect(main(args())).toBe(2);
  unlinkSync(join(dir, 'tmp/ts-migration/candidates/18'));
  mkdirSync(join(dir, 'tmp/ts-migration/candidates/18'));
  const victim = join(root, 'data/release/execution.json'),
    before = readFileSync(victim);
  symlinkSync(victim, join(dir, report));
  expect(main(args())).toBe(2);
  unlinkSync(join(dir, report));
  linkSync(victim, join(dir, report));
  expect(main(args())).toBe(2);
  expect(readFileSync(victim)).toEqual(before);
});
it('protects explicitly selected inputs when the input root is the working directory', () => {
  mkdirSync(join(dir, 'tmp/ts-migration/candidates/18'), { recursive: true });
  writeFileSync(join(dir, report), 'sentinel');
  const bad = [
    '--root',
    dir,
    '--captures',
    report,
    '--manifest',
    'manifest.json',
    '--only',
    'KFP',
    '--report',
    report,
  ];
  expect(main(bad)).toBe(2);
  expect(readFileSync(join(dir, report), 'utf8')).toBe('sentinel');
});
it('distinguishes a missing month, extra report, corrupt evidence and corrupt available bytes', () => {
  const year = join(root, 'data/originals/kfp_2024'),
    name = '2024-EU_funds_0124_BG_WEB.xls';
  unlinkSync(join(year, name));
  expect(main(args())).toBe(1);
  let value = JSON.parse(readFileSync(join(dir, report), 'utf8'));
  expect(
    value.groups[0].problems.some((p: string) => p.includes('raw report') && p.includes('missing')),
  ).toBe(true);
  cpSync(join(fixture, 'data/originals/kfp_2024', name), join(year, name));
  writeFileSync(join(year, 'extra.xls'), 'extra');
  expect(main(args())).toBe(1);
  value = JSON.parse(readFileSync(join(dir, report), 'utf8'));
  expect(value.groups[0].problems.some((p: string) => p.includes('raw reports on disk'))).toBe(
    true,
  );
  cpSync(join(fixture, 'data/originals/kfp_2024', name), join(year, name));
  writeFileSync(join(year, name), 'bad bytes');
  expect(main(args())).toBe(2);
  cpSync(join(fixture, 'data/originals/kfp_2024', name), join(year, name));
  writeFileSync(join(root, 'captures.json'), '{}');
  expect(main(args())).toBe(2);
});
it('reports explicit raw absence with the donor warning, never as full raw parity', () => {
  for (const year of ['2024', '2025', '2026'])
    rmSync(join(root, `data/originals/kfp_${year}`), { recursive: true });
  expect(main([...args(), '--raw-absent'])).toBe(0);
  const value = JSON.parse(readFileSync(join(dir, report), 'utf8'));
  expect(value).toMatchObject({
    rawEvidence: 'absent',
    completeValidation: false,
    totals: { checks: 3353, warnings: 1, problems: 0 },
  });
  expect(value.groups[0].warnings[0]).toContain('independent re-read was skipped');
});

it('fails closed when an available report has no captured sheet', () => {
  const capturePath = join(root, 'captures.json'),
    manifestPath = join(root, 'manifest.json');
  const capture = JSON.parse(readFileSync(capturePath, 'utf8'));
  capture.reports.shift();
  const text = JSON.stringify(capture);
  writeFileSync(capturePath, text);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.capturesSha256 = createHash('sha256').update(text).digest('hex');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(main(args())).toBe(1);
  const result = JSON.parse(readFileSync(join(dir, report), 'utf8'));
  expect(result.groups[0].problems[0]).toContain('missing capture for available raw report');
  expect(result.groups[0].warnings).toEqual([]);
});

it('rechecks law archive bytes after a prior successful validation', () => {
  expect(main(args())).toBe(0);
  writeFileSync(join(root, 'data/originals/budget_2027/ZDBRB-2027.zip'), 'damaged');
  expect(main(args())).toBe(1);
  const result = JSON.parse(readFileSync(join(dir, report), 'utf8'));
  expect(result.groups[0].problems[0]).toContain('Archive checksum mismatch');
});
