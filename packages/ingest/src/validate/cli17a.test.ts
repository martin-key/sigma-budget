import { spawnSync } from 'node:child_process';
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
import { dirname, join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';
const repo = resolve(new URL('../../../../', import.meta.url).pathname);
const cli = join(repo, 'packages/ingest/dist/validate/cli17a.js');
const fixture = new URL('../../test/fixtures/validate17a/corpus/', import.meta.url);
const overlay = new URL('../../test/fixtures/validate17a/overlay/', import.meta.url);
const candidates = join(repo, 'tmp/ts-migration/candidates/17a');
function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: 'utf8' });
}
it('compiled CLI rejects unsupported selections without making report directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-17a-cli-'));
  try {
    cpSync(fixture, root, { recursive: true });
    cpSync(overlay, root, { recursive: true });
    const target = `tmp/ts-migration/candidates/17a/invalid-${process.pid}/report.json`;
    expect(run(['--root', root, '--only', 'SEARCH', '--report', target]).status).toBe(2);
    expect(run(['--root', root, '--only', ',', '--report', target]).status).toBe(2);
    expect(run(['--root', root, '--report', target]).status).toBe(2);
    expect(existsSync(join(repo, dirname(target)))).toBe(false);
    expect(
      run([
        '--root',
        root,
        '--only',
        'CORE',
        '--report',
        'tmp/ts-migration/candidates/other/out.json',
      ]).status,
    ).toBe(2);
    expect(
      run([
        '--root',
        root,
        '--only',
        'CORE',
        '--report',
        'tmp/ts-migration/candidates/17a/../../release.json',
      ]).status,
    ).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('compiled CLI writes reports for accepted and failed raw validations, and refuses aliases and links', () => {
  mkdirSync(candidates, { recursive: true });
  const own = mkdtempSync(join(candidates, 'guard-'));
  const root = join(own, 'input');
  const aliases = mkdtempSync(join(tmpdir(), 'sigma-17a-alias-'));
  try {
    cpSync(fixture, root, { recursive: true });
    cpSync(overlay, root, { recursive: true });
    const rootAlias = join(aliases, 'root');
    symlinkSync(root, rootAlias);
    const out = join(own, 'report.json'),
      rel = relative(repo, out),
      args = ['--root', rootAlias, '--only', 'CORE,CATALOG', '--report', rel];
    expect(run(args).status).toBe(0);
    const accepted = JSON.parse(readFileSync(out, 'utf8'));
    expect(accepted.status).toBe('PASS');
    expect(accepted.completeValidation).toBe(false);
    expect(accepted.raw.flatMap((x: any) => x.problems)).toHaveLength(3);
    expect(accepted.totals.warnings).toBe(15);
    expect(run([...args, '--no-accepted']).status).toBe(1);
    expect(JSON.parse(readFileSync(out, 'utf8')).status).toBe('FAIL');
    const target = join(root, 'data/release/core.json'),
      bytes = readFileSync(target);
    expect(
      run(['--root', rootAlias, '--only', 'CORE', '--report', relative(repo, target)]).status,
    ).toBe(2);
    expect(readFileSync(target)).toEqual(bytes);
    const fixed = join(root, 'apps/web/app/lib/routes.json'),
      fixedBytes = readFileSync(fixed);
    expect(
      run(['--root', root, '--only', 'CORE', '--no-accepted', '--report', relative(repo, fixed)])
        .status,
    ).toBe(2);
    expect(readFileSync(fixed)).toEqual(fixedBytes);
    const sentinel = join(own, 'sentinel.json');
    writeFileSync(sentinel, 'unchanged');
    const hard = join(own, 'hard.json'),
      sym = join(own, 'sym.json');
    linkSync(sentinel, hard);
    symlinkSync(sentinel, sym);
    for (const p of [hard, sym])
      expect(run(['--root', root, '--only', 'CORE', '--report', relative(repo, p)]).status).toBe(2);
    const dir = join(own, 'link-dir');
    symlinkSync(aliases, dir);
    expect(
      run(['--root', root, '--only', 'CORE', '--report', relative(repo, join(dir, 'report.json'))])
        .status,
    ).toBe(2);
    expect(readFileSync(sentinel, 'utf8')).toBe('unchanged');
  } finally {
    rmSync(own, { recursive: true, force: true });
    rmSync(aliases, { recursive: true, force: true });
  }
});
