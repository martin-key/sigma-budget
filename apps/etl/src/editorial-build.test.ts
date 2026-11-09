import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { editorialBuildCli } from './editorial-build.js';

const fixture = resolve(
  import.meta.dirname,
  '../../../packages/ingest/test/fixtures/editorial/inputs',
);
const dirs: string[] = [];
const flags = [
  '--inputs',
  fixture,
  '--out',
  'tmp/ts-migration/candidates/08',
  '--scope',
  'glossary,guide',
  '--build-date',
  '2026-11-08',
];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'editorial-projection-'));
  dirs.push(root);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it('preserves registered bytes without a route override', async () => {
  const root = setup();
  expect(await editorialBuildCli(flags)).toBe(0);
  expect(readFileSync(join(root, 'tmp/ts-migration/candidates/08/data/guide.json'))).toEqual(
    readFileSync(join(fixture, 'guide.json')),
  );
});
it('projects explicitly supplied route labels after frozen restoration', async () => {
  const root = setup();
  const catalogue = JSON.parse(readFileSync(join(fixture, 'routes.json'), 'utf8'));
  const guide = JSON.parse(readFileSync(join(fixture, 'guide.json'), 'utf8'));
  catalogue.routes.find((row: any[]) => row[0] === guide.steps[3].screen.id)[4] =
    'Проверено ново заглавие';
  const routes = join(root, 'routes.json');
  writeFileSync(routes, JSON.stringify(catalogue));
  expect(await editorialBuildCli([...flags, '--routes', routes])).toBe(0);
  const output = JSON.parse(
    readFileSync(join(root, 'tmp/ts-migration/candidates/08/data/guide.json'), 'utf8'),
  );
  expect(output.steps[3].screen.label).toBe('Проверено ново заглавие');
  expect(output.steps[2].next.title).toBe(output.steps[3].title);
  expect(output.steps.map((step: any) => step.blocks)).toEqual(
    guide.steps.map((step: any) => step.blocks),
  );
});
it('rejects a hard-linked output without overwriting its source', async () => {
  const root = setup();
  const out = join(root, 'tmp/ts-migration/candidates/08/data');
  mkdirSync(out, { recursive: true });
  const outside = join(root, 'outside.json');
  writeFileSync(outside, 'unchanged');
  linkSync(outside, join(out, 'guide.json'));
  await expect(editorialBuildCli(flags)).rejects.toThrow(/private regular file/);
  expect(readFileSync(outside, 'utf8')).toBe('unchanged');
});
