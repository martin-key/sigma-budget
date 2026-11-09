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
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
const fixture = fileURLToPath(new URL('../../test/fixtures/wave17c/corpus', import.meta.url));
const cli = resolve(fileURLToPath(new URL('../../dist/validate/search-cli.js', import.meta.url)));
const report = 'tmp/ts-migration/candidates/17c/report.json';
let dir: string, root: string;
const args = () => ['--root', root, '--only', 'SEARCH', '--report', report];
function invoke(options = args(), cwd = dir) {
  return spawnSync(process.execPath, [cli, ...options], { cwd, encoding: 'utf8' });
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sigma-search17c-'));
  root = join(dir, 'inputs');
  cpSync(fixture, root, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
it('compiled CLI reports PASS in raw and accepted modes, and atomically replaces the report', () => {
  for (const mode of ['--raw', '--accepted']) {
    const proc = invoke([...args(), mode]);
    expect(proc.status).toBe(0);
    const result = JSON.parse(proc.stdout);
    expect(result).toMatchObject({
      scope: 'candidate17c',
      completeValidation: false,
      mode: mode.slice(2),
      status: 'PASS',
      totals: { checks: 11309, problems: 0, warnings: 0 },
    });
    expect(JSON.parse(readFileSync(join(dir, report), 'utf8'))).toEqual(result);
  }
  expect(existsSync(join(dir, 'tmp/ts-migration/candidates/17c'))).toBe(true);
});
it('reports failures and crashes without losing the input', () => {
  const file = join(root, 'data/release/search-index.json'),
    text = readFileSync(file, 'utf8'),
    data = JSON.parse(text);
  data.items[0][6] = '#/bad-route';
  writeFileSync(file, JSON.stringify(data));
  const fail = invoke();
  expect(fail.status).toBe(1);
  expect(JSON.parse(fail.stdout).groups[0].problems[0]).toContain('opens no screen');
  data.items[0].pop();
  writeFileSync(file, JSON.stringify(data));
  const crash = invoke();
  expect(crash.status).toBe(1);
  expect(JSON.parse(crash.stdout).groups[0].problems[0]).toBe(
    'group crashed: IndexError: list index out of range',
  );
  expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(data));
});
it('supports cwd and physical alias roots', () => {
  const alias = join(dir, 'alias');
  symlinkSync(root, alias, 'dir');
  for (const inputRoot of [root, alias]) {
    root = inputRoot;
    const result = invoke(args(), realpath(root));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('PASS');
  }
});
function realpath(path: string) {
  return requireRealpath(path);
}
import { realpathSync as requireRealpath } from 'node:fs';
it('rejects bad requests before creating output directories', () => {
  for (const options of [
    [],
    ['--root', root, '--only', 'FEED', '--report', report],
    [...args(), '--raw', '--accepted'],
    [...args(), '--wat'],
    [
      '--root',
      root,
      '--only',
      'SEARCH',
      '--report',
      'tmp/ts-migration/candidates/17c/../17c/report.json',
    ],
  ]) {
    const p = invoke(options);
    expect(p.status).toBe(2);
    expect(existsSync(join(dir, 'tmp'))).toBe(false);
  }
});
it('rejects symlink and hardlink report targets without touching inputs', () => {
  const target = join(dir, report),
    input = join(root, 'data/release/search-index.json'),
    before = readFileSync(input);
  mkdirSync(join(dir, 'tmp/ts-migration/candidates/17c'), { recursive: true });
  symlinkSync(input, target);
  expect(invoke().status).toBe(2);
  unlinkSync(target);
  linkSync(input, target);
  expect(invoke().status).toBe(2);
  expect(readFileSync(input)).toEqual(before);
});
it('rejects linked parents and declared input symlinks before writing', () => {
  mkdirSync(join(dir, 'tmp/ts-migration/candidates'), { recursive: true });
  symlinkSync(root, join(dir, 'tmp/ts-migration/candidates/17c'), 'dir');
  expect(invoke().status).toBe(2);
  unlinkSync(join(dir, 'tmp/ts-migration/candidates/17c'));
  const input = join(root, 'data/release/search-index.json');
  unlinkSync(input);
  symlinkSync(join(root, 'data/release/catalog.json'), input);
  expect(invoke().status).toBe(2);
  expect(existsSync(join(dir, report))).toBe(false);
});
it('checks every declared input before an earlier input crash can write a report', () => {
  writeFileSync(join(root, 'data/release/search-index.json'), '{');
  const route = join(root, 'apps/web/app/lib/routes.json');
  unlinkSync(route);
  symlinkSync(join(root, 'data/release/catalog.json'), route);
  expect(invoke().status).toBe(2);
  expect(existsSync(join(dir, report))).toBe(false);
});
it('protects a root enclosing the report', () => {
  root = join(dir, 'tmp/ts-migration/candidates/17c');
  mkdirSync(root, { recursive: true });
  expect(invoke().status).toBe(2);
  expect(existsSync(join(dir, report))).toBe(false);
});
