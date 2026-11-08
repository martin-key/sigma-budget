import {
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { componentsRatesBuildCli } from './components-rates-build.js';
const fixture = resolve(
  import.meta.dirname,
  '../../../packages/ingest/test/fixtures/components-rates',
);
const dirs: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'wave06-cli-'));
  dirs.push(root);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  return root;
}
const flags = (out = 'tmp/ts-migration/candidates/06') => [
  '--inputs',
  fixture,
  '--out',
  out,
  '--scope',
  'components,rates',
  '--build-date',
  '2026-11-08',
];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it('builds both files only in the specified candidate directory', async () => {
  const root = setup();
  expect(await componentsRatesBuildCli(flags())).toBe(0);
  for (const name of ['components', 'rates'])
    expect(
      JSON.parse(
        readFileSync(join(root, 'tmp/ts-migration/candidates/06/data', `${name}.json`), 'utf8'),
      ),
    ).toEqual(JSON.parse(readFileSync(join(fixture, `${name}.json`), 'utf8')));
});
it('rejects an output outside candidate 06', async () => {
  setup();
  await expect(componentsRatesBuildCli(flags('tmp/ts-migration/candidates/other'))).rejects.toThrow(
    /Output must/,
  );
});
it('rejects a symlinked candidate parent', async () => {
  const root = setup(),
    outside = mkdtempSync(join(tmpdir(), 'wave06-outside-'));
  dirs.push(outside);
  mkdirSync(join(root, 'tmp/ts-migration'), { recursive: true });
  symlinkSync(outside, join(root, 'tmp/ts-migration/candidates'));
  await expect(componentsRatesBuildCli(flags())).rejects.toThrow(/Symlink/);
});
it('rejects a symlinked target file', async () => {
  const root = setup(),
    outside = join(root, 'outside.json');
  writeFileSync(outside, 'unchanged');
  mkdirSync(join(root, 'tmp/ts-migration/candidates/06/data'), { recursive: true });
  symlinkSync(outside, join(root, 'tmp/ts-migration/candidates/06/data/components.json'));
  await expect(componentsRatesBuildCli(flags())).rejects.toThrow(/Symlink/);
  expect(readFileSync(outside, 'utf8')).toBe('unchanged');
});

it('rejects a hard-linked output without changing its source', async () => {
  const root = setup(),
    outside = join(root, 'outside.json');
  writeFileSync(outside, 'unchanged');
  mkdirSync(join(root, 'tmp/ts-migration/candidates/06/data'), { recursive: true });
  linkSync(outside, join(root, 'tmp/ts-migration/candidates/06/data/components.json'));
  await expect(componentsRatesBuildCli(flags())).rejects.toThrow(/unsafe output/);
  expect(readFileSync(outside, 'utf8')).toBe('unchanged');
});
it('does not remove a pre-existing temporary file on collision', async () => {
  const root = setup(),
    dir = join(root, 'tmp/ts-migration/candidates/06/data');
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.components.json.${process.pid}.tmp`);
  writeFileSync(temp, 'untouched');
  await expect(componentsRatesBuildCli(flags())).rejects.toThrow();
  expect(readFileSync(temp, 'utf8')).toBe('untouched');
});
