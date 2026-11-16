import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { canonicalJson } from '@sigma-budget/ingest/release-client';
import { sitePackage, productionCli } from './production-cli.js';
import * as releaseBuild from '@sigma-budget/ingest/release-build';
import * as production from '@sigma-budget/ingest/production';

vi.mock('@sigma-budget/ingest/release-build', async (importOriginal) => {
  const actual = await importOriginal<typeof releaseBuild>();
  return {
    ...actual,
    exportCommit: vi.fn(actual.exportCommit),
    prepareInputs: vi.fn(actual.prepareInputs),
    stageInputs: vi.fn(actual.stageInputs),
    checkReleaseDirectory: vi.fn(actual.checkReleaseDirectory),
  };
});
vi.mock('@sigma-budget/ingest/production', async (importOriginal) => {
  const actual = await importOriginal<typeof production>();
  return {
    ...actual,
    loadProduction: vi.fn(actual.loadProduction),
    validateProduction: vi.fn(actual.validateProduction),
  };
});

const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'site-package-'));
  roots.push(root);
  const data = join(root, 'data/release');
  const manifest = Buffer.from(
    canonicalJson({
      manifest_schema: 'budget-release/1',
      data_schema: {},
      processing: { code: { commit: 'a'.repeat(40) } },
      inputs: [],
      outputs: ['validation.json', 'data/nested/value.json'].map((path) => ({
        path,
        bytes: 2,
        sha256: createHash('sha256').update('{}').digest('hex'),
        mime: 'application/json',
        ...(path === 'validation.json' ? { role: 'validation' } : {}),
      })),
    }) + '\n',
  );
  const id = createHash('sha256').update(manifest).digest('hex');
  const metadata = join(data, 'releases', id);
  await mkdir(metadata, { recursive: true });
  await mkdir(join(data, 'nested'));
  await writeFile(join(data, 'nested/value.json'), '{}');
  await writeFile(join(metadata, 'manifest.json'), manifest);
  for (const file of ['validation.json', 'receipt.json'])
    await writeFile(join(metadata, file), '{}');
  await writeFile(
    join(data, 'releases/current.json'),
    JSON.stringify({ release_id: id, manifest: `data/releases/${id}/manifest.json` }),
  );
  return { root, data, metadata, out: join(root, 'package') };
}
it('packages listed nested outputs and retains historical metadata outside the selected package', async () => {
  const f = await fixture();
  await mkdir(join(f.data, 'releases/historical'));
  await writeFile(join(f.data, 'releases/historical/manifest.json'), '{}');
  expect(await sitePackage(f.root, f.out)).toBe(f.out);
  expect(await readFile(join(f.out, 'data/nested/value.json'), 'utf8')).toBe('{}');
  expect(await readFile(join(f.out, 'manifest.json'))).toEqual(
    await readFile(join(f.metadata, 'manifest.json')),
  );
  await expect(readFile(join(f.out, 'data/releases/current.json'))).rejects.toThrow(/ENOENT/);
});
it.each(['extra.json', 'nested/extra.txt', 'nested/extra/value.json'])(
  'rejects an unlisted checkout file %s before copying',
  async (path) => {
    const f = await fixture();
    if (path.includes('extra/')) await mkdir(join(f.data, 'nested/extra'));
    await writeFile(join(f.data, path), '{}');
    await expect(sitePackage(f.root, f.out)).rejects.toThrow(
      'Site contains an unlisted or unsafe file: data/' + path,
    );
    await expect(readFile(join(f.out, 'manifest.json'))).rejects.toThrow(/ENOENT/);
  },
);
it('rejects a symlink in place of a listed file', async () => {
  const f = await fixture();
  await rm(join(f.data, 'nested/value.json'));
  await symlink(join(f.metadata, 'validation.json'), join(f.data, 'nested/value.json'));
  await expect(sitePackage(f.root, f.out)).rejects.toThrow(/unsafe file/);
});
it('rejects a pointer to another manifest identity', async () => {
  const f = await fixture();
  const other = 'b'.repeat(64);
  await mkdir(join(f.data, 'releases', other));
  await writeFile(
    join(f.data, 'releases', other, 'manifest.json'),
    await readFile(join(f.metadata, 'manifest.json')),
  );
  await writeFile(
    join(f.data, 'releases/current.json'),
    JSON.stringify({ release_id: other, manifest: `data/releases/${other}/manifest.json` }),
  );
  await expect(sitePackage(f.root, f.out)).rejects.toThrow('Site identity mismatch');
});
it('requires an explicit snapshot and rejects replay options on check-site', async () => {
  for (const args of [[], ['--inputs', '/unused', '--skip-published']]) {
    const errors: string[] = [];
    expect(await productionCli(['check-site', ...args], { error: (s) => errors.push(s) })).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Required option --inputs|Unknown option --skip-published/);
  }
});
it('exits 2 when the current production rules reject the committed site semantically', async () => {
  const f = await fixture();
  // Use installed archive-reader assets; no input decoding is needed for this failure-injection test.
  await symlink(
    resolve(import.meta.dirname, '../../../packages/ingest/node_modules'),
    join(f.root, 'node_modules'),
  );
  vi.mocked(releaseBuild.exportCommit).mockResolvedValueOnce({
    commit: 'a'.repeat(40),
    files: {},
  } as never);
  vi.mocked(releaseBuild.prepareInputs).mockResolvedValueOnce({ inputs: [] } as never);
  vi.mocked(releaseBuild.stageInputs).mockResolvedValueOnce(undefined);
  vi.mocked(releaseBuild.checkReleaseDirectory).mockResolvedValueOnce({
    manifest: { processing: { parameters: { build_date: '2026-11-14' } } },
  } as never);
  const prepared = {} as Awaited<ReturnType<typeof production.loadProduction>>;
  vi.mocked(production.loadProduction).mockResolvedValueOnce(prepared);
  vi.mocked(production.validateProduction).mockImplementationOnce(() => {
    throw new Error('Production validation failed: semantic negative control');
  });
  const errors: string[] = [],
    messages: string[] = [];
  const code = await productionCli(['check-site', '--inputs', join(f.root, 'inputs')], {
    root: f.root,
    error: (s) => errors.push(s),
    write: (s) => messages.push(s),
  });
  expect(production.validateProduction).toHaveBeenCalledWith(
    expect.objectContaining({
      buildDate: '2026-11-14',
      candidateRoot: expect.stringContaining('site-package'),
    }),
    prepared,
  );
  expect(code).toBe(2);
  expect(messages).toEqual([]);
  expect(errors.map((s) => JSON.parse(s))).toEqual([
    { exit: 2, error: 'Production validation failed: semantic negative control' },
  ]);
});
