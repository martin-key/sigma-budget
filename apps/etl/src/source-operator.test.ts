import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceOperatorCli } from './source-operator.js';
import { sha256 } from '@sigma-budget/ingest/source-client';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sigma-source-operator-'));
  roots.push(root);
  const source = join(root, 'source'),
    out = join(root, 'out'),
    registry = join(root, 'registry.json'),
    pins = join(root, 'pins');
  const path = 'data/originals/a.json',
    url = 'https://cli.example.test/data',
    bytes = Buffer.from('{"a":1}');
  await mkdir(join(source, 'data/originals'), { recursive: true });
  await writeFile(join(source, path), bytes);
  await writeFile(
    registry,
    JSON.stringify({
      schema: 1,
      sources: [{ id: 'source', acquisition: 'fetch', files: [{ path, url }] }],
    }),
  );
  await writeFile(pins, sha256(bytes) + '  ' + path + '\n');
  return {
    root,
    source,
    out,
    registry,
    pins,
    path,
    url,
    bytes,
    common: [
      '--source-root',
      source,
      '--registry',
      registry,
      '--pins',
      pins,
      '--now',
      '2031-02-03T04:05:06Z',
    ],
  };
}
it('implements collect/status/refetch/import-source/drift through the standalone CLI contract', async () => {
  const f = await fixture();
  const log: string[] = [],
    errors: string[] = [];
  let calls = 0;
  const deps = {
    client: {
      transport: async () => {
        calls++;
        return { status: 200, body: f.bytes };
      },
    },
    write: (v: string) => log.push(v),
    error: (v: string) => errors.push(v),
  };
  expect(
    await sourceOperatorCli(['collect', ...f.common, '--out', f.out, '--check-drift'], deps),
  ).toBe(0);
  expect(await sourceOperatorCli(['collect', ...f.common, '--out', f.out, '--resume'], deps)).toBe(
    0,
  );
  expect(calls).toBe(1);
  expect(await sourceOperatorCli(['status', ...f.common], deps)).toBe(0);
  const report = join(f.root, 'drift.json');
  expect(
    await sourceOperatorCli(
      ['drift', ...f.common, '--snapshot', join(f.out, 'snapshot.json'), '--report', report],
      deps,
    ),
  ).toBe(0);
  expect(JSON.parse(await readFile(report, 'utf8')).pinMutation).toBe(false);
  const manifest = join(f.root, 'manifest.json');
  await writeFile(
    manifest,
    JSON.stringify({
      inputs: [
        {
          kind: 'source',
          source: 'source',
          path: f.path,
          url: f.url,
          via: null,
          acquisition: 'fetch',
          sha256: sha256(f.bytes),
        },
      ],
    }),
  );
  expect(
    await sourceOperatorCli(
      ['refetch', ...f.common, '--manifest', manifest, '--out', join(f.root, 'refetch')],
      deps,
    ),
  ).toBe(0);
  const download = join(f.root, 'download.json');
  await writeFile(download, f.bytes);
  expect(
    await sourceOperatorCli(
      [
        'import-source',
        ...f.common,
        '--source',
        'source',
        '--file',
        download,
        '--out',
        join(f.root, 'import'),
      ],
      deps,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
  expect(log).toHaveLength(6);
  expect(await readFile(join(f.source, f.path))).toEqual(f.bytes);
});
it.each([
  ['collect', '--out'],
  ['status', '--environment', 'dev'],
  ['status', '--pins', 'a', '--pins', 'b'],
  ['collect', '--sources', 'unknown'],
  ['collect', '--out', 'unused', '--attempts', '0'],
  ['status', '--now', '2031-02-30T00:00:00Z'],
  ['collect', '--out', 'unused', '--max-bytes', 'NaN'],
])('fails finite invalid arguments %j without calling transport', async (...args) => {
  const f = await fixture();
  let calls = 0;
  const errors: string[] = [];
  const [command, ...rest] = args;
  expect(
    await sourceOperatorCli([command!, ...f.common, ...rest], {
      client: {
        transport: async () => {
          calls++;
          throw new Error('must not execute');
        },
      },
      write: () => {},
      error: (v) => errors.push(v),
    }),
  ).toBe(2);
  expect(calls).toBe(0);
  expect(errors.length).toBe(1);
  expect(await readdir(f.root)).not.toContain('out');
});
