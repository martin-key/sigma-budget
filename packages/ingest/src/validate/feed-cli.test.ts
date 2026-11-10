import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
const fixture = fileURLToPath(new URL('../../test/fixtures/validate17b/corpus/', import.meta.url));
const cli = fileURLToPath(new URL('../../dist/validate/feed-cli.js', import.meta.url));
const report = 'tmp/ts-migration/candidates/17b/report.json';
let dir: string, root: string;
const args = () => ['--root', root, '--only', 'FEED', '--report', report];
const run = (a = args()) =>
  spawnSync(process.execPath, [cli, ...a], { cwd: dir, encoding: 'utf8' });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'feed17b-cli-'));
  root = join(dir, 'inputs');
  cpSync(fixture, root, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
it('compiled CLI writes repeatable PASS and FAIL reports with raw findings', () => {
  for (let i = 0; i < 2; i++) {
    expect(run().status).toBe(0);
    const result = JSON.parse(readFileSync(join(dir, report), 'utf8'));
    expect(result).toMatchObject({
      scope: 'wave17b',
      completeValidation: false,
      status: 'PASS',
      totals: { checks: 1300, problems: 0, warnings: 0 },
      exceptions: [],
    });
    expect(result.unported).toContain('SEARCH');
  }
  const p = join(root, 'data/release/feed.json'),
    f = JSON.parse(readFileSync(p, 'utf8'));
  f.events[0].kind = 'law';
  writeFileSync(p, JSON.stringify(f));
  for (const extra of [[], ['--no-accepted']]) {
    expect(run([...args(), ...extra]).status).toBe(1);
    const result = JSON.parse(readFileSync(join(dir, report), 'utf8'));
    expect(result.status).toBe('FAIL');
    expect(result.raw[0].problems).toHaveLength(3);
    expect(result.groups[0].problems).toEqual(result.raw[0].problems);
    expect(result.exceptions).toEqual([]);
  }
});
it('rejects invalid options and report aliases without creating directories', () => {
  for (const bad of ['SEARCH', 'FEED,SEARCH', '', 'FEED,FEED']) {
    const a = args();
    a[3] = bad;
    expect(run(a).status).toBe(2);
    expect(existsSync(join(dir, 'tmp'))).toBe(false);
  }
  for (const path of [
    resolve(dir, report),
    report.replace('/17b/', '/17b/./'),
    report.replace('/17b/', '/17b/x/../'),
    report.replaceAll('/', '\\'),
  ]) {
    const a = args();
    a[5] = path;
    expect(run(a).status).toBe(2);
    expect(existsSync(join(dir, 'tmp'))).toBe(false);
  }
  expect(run([...args(), '--unknown']).status).toBe(2);
  expect(run([...args(), '--only', 'FEED']).status).toBe(2);
  expect(existsSync(join(dir, 'tmp'))).toBe(false);
});
it('rejects symlink parents and linked report destinations without altering the input', () => {
  mkdirSync(join(dir, 'tmp/ts-migration/candidates'), { recursive: true });
  symlinkSync(root, join(dir, 'tmp/ts-migration/candidates/17b'), 'dir');
  expect(run().status).toBe(2);
  unlinkSync(join(dir, 'tmp/ts-migration/candidates/17b'));
  mkdirSync(join(dir, 'tmp/ts-migration/candidates/17b'));
  const victim = join(root, 'data/release/feed.xml'),
    before = readFileSync(victim),
    target = join(dir, report);
  symlinkSync(victim, target);
  expect(run().status).toBe(2);
  unlinkSync(target);
  linkSync(victim, target);
  expect(run().status).toBe(2);
  expect(readFileSync(victim)).toEqual(before);
});
it('preflights all declared files even if an earlier source would crash', () => {
  writeFileSync(join(root, 'data/release/feed.json'), 'bad json');
  const victim = join(dir, 'victim');
  writeFileSync(victim, 'unchanged');
  const p = join(root, 'data/release/feed.xml');
  unlinkSync(p);
  symlinkSync(victim, p);
  expect(run().status).toBe(2);
  expect(existsSync(join(dir, 'tmp'))).toBe(false);
  expect(readFileSync(victim, 'utf8')).toBe('unchanged');
});
it('protects physical input roots and permits a root alias with repeated writes', () => {
  const alias = join(dir, 'alias');
  symlinkSync(root, alias, 'dir');
  root = alias;
  expect(run().status).toBe(0);
  expect(run().status).toBe(0);
  cpSync(fixture, dir, { recursive: true });
  const a = args();
  a[1] = dir;
  expect(run(a).status).toBe(0); // report belongs to cwd and data trees are separate
});
it('rejects a report destination that falls inside a different input root', () => {
  const a = args();
  a[1] = join(dir, 'tmp');
  mkdirSync(a[1], { recursive: true });
  expect(run(a).status).toBe(2);
  expect(existsSync(join(dir, report))).toBe(false);
});
it('reports a caught group crash and preserves the donor wrapper evidence separately', () => {
  const oracle = JSON.parse(readFileSync(join(fixture, '..', 'oracle.json'), 'utf8'));
  expect(oracle.baseline.raw).toEqual(oracle.baseline.noAccepted);
  expect(oracle.baseline.default.exceptions).toEqual([]);
  expect(oracle.event_kind.default.exceptions).toHaveLength(1);
  expect(oracle.event_kind.noAccepted.check.problems).toHaveLength(3);
  const path = join(root, 'data/release/feed.json'),
    f = JSON.parse(readFileSync(path, 'utf8'));
  delete f.events;
  writeFileSync(path, JSON.stringify(f));
  expect(run().status).toBe(1);
  const value = JSON.parse(readFileSync(join(dir, report), 'utf8'));
  expect(value.status).toBe('FAIL');
  expect(value.totals).toEqual({ checks: 1, problems: 1, warnings: 0 });
  expect(value.raw[0].problems).toEqual(["group crashed: KeyError: 'events'"]);
  expect(run([...args(), '--no-accepted']).status).toBe(1);
});
it('rejects a symlinked declared route or registry before any report is made', () => {
  for (const path of ['apps/web/app/lib/routes.json', 'data/datasets.yaml', 'data/sources.yaml']) {
    const target = join(root, path),
      victim = join(dir, 'target');
    writeFileSync(victim, 'untouched');
    unlinkSync(target);
    symlinkSync(victim, target);
    expect(run().status).toBe(2);
    expect(existsSync(join(dir, 'tmp'))).toBe(false);
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    unlinkSync(target);
    writeFileSync(target, '{}');
  }
});

it('protects declared schemas, archives, globs and rejected spellings even after an earlier source failure', () => {
  cpSync(fixture, dir, { recursive: true });
  root = dir;
  const registry = join(dir, 'data/datasets.yaml'),
    original = readFileSync(registry, 'utf8');
  const target = join(dir, report);
  mkdirSync(join(dir, 'tmp/ts-migration/candidates/17b'), { recursive: true });
  writeFileSync(join(dir, 'data/release/feed.json'), 'bad json');
  for (const declared of [
    report,
    report.replace('/17b/', '/17b/../17b/'),
    report.replace('/17b/', '/17b/./'),
    resolve(dir, report),
    report.replaceAll('/', '\\'),
    'tmp/ts-migration/candidates/17b/*.json',
  ]) {
    const doc = parse(original);
    doc.datasets[0].schema = declared;
    writeFileSync(registry, stringify(doc));
    const sentinel = Buffer.from('protected schema evidence');
    writeFileSync(target, sentinel);
    expect(run().status).toBe(2);
    expect(readFileSync(target)).toEqual(sentinel);
  }
  const sources = join(dir, 'data/sources.yaml'),
    sourceDoc = parse(readFileSync(sources, 'utf8'));
  writeFileSync(registry, original);
  sourceDoc.sources[0].files[0].archive = report;
  writeFileSync(sources, stringify(sourceDoc));
  const sentinel = Buffer.from('protected archive evidence');
  writeFileSync(target, sentinel);
  expect(run().status).toBe(2);
  expect(readFileSync(target)).toEqual(sentinel);
});
it('rejects a missing declared report path without creating its parents', () => {
  cpSync(fixture, dir, { recursive: true });
  root = dir;
  const path = join(dir, 'data/datasets.yaml'),
    doc = parse(readFileSync(path, 'utf8'));
  doc.datasets[0].schema = report;
  writeFileSync(path, stringify(doc));
  expect(run().status).toBe(2);
  expect(existsSync(join(dir, 'tmp'))).toBe(false);
});

it('keeps an existing report intact when the atomic temporary write fails', () => {
  const parent = join(dir, 'tmp/ts-migration/candidates/17b');
  mkdirSync(parent, { recursive: true });
  const sentinel = Buffer.from('prior report');
  writeFileSync(join(dir, report), sentinel);
  chmodSync(parent, 0o555);
  try {
    expect(run().status).toBe(2);
    expect(readFileSync(join(dir, report))).toEqual(sentinel);
    expect(readdirSync(parent)).toEqual(['report.json']);
  } finally {
    chmodSync(parent, 0o755);
  }
});
