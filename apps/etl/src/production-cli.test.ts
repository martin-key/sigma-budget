import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { productionCli } from './production-cli.js';
import { locateManifest } from './manifest-location.js';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'production-commands-'));
  roots.push(root);
  const work = root;
  const source = join(root, 'source');
  await mkdir(join(source, 'data/originals'), { recursive: true });
  const bytes = Buffer.from('{"observation":12}'),
    path = 'data/originals/source.json';
  await writeFile(join(source, path), bytes);
  await writeFile(
    join(source, 'data/sources.yaml'),
    JSON.stringify({
      schema: 1,
      sources: [
        {
          id: 'owned',
          acquisition: 'fetch',
          files: [{ path, url: 'https://source.example.test/observation' }],
        },
      ],
    }),
  );
  await writeFile(join(source, 'data/originals.sha256'), hash(bytes) + '  ' + path + '\n');
  return { root: source, work, bytes, path };
}
it('routes global collect, source-status and import-source through owned fake transports', async () => {
  const f = await fixture(),
    messages: string[] = [],
    errors: string[] = [];
  let calls = 0;
  const deps = {
    root: f.root,
    write: (s: string) => messages.push(s),
    error: (s: string) => errors.push(s),
    source: {
      client: {
        transport: async () => {
          calls++;
          return { status: 200, body: f.bytes };
        },
      },
    },
  };
  expect(
    await productionCli(
      [
        'collect',
        '--out',
        join(f.work, 'acquired'),
        '--now',
        '2026-11-10T00:00:00Z',
        '--check-drift',
      ],
      deps,
    ),
  ).toBe(0);
  expect(calls).toBe(1);
  expect(await productionCli(['source-status', '--now', '2026-11-10T00:00:00Z'], deps)).toBe(0);
  expect(
    await productionCli(
      [
        'import-source',
        '--source',
        'owned',
        '--file',
        join(f.root, f.path),
        '--out',
        join(f.work, 'manual'),
        '--now',
        '2026-11-10T00:00:00Z',
      ],
      deps,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
  expect(await readFile(join(f.root, f.path))).toEqual(f.bytes);
  expect(messages.length).toBe(3);
});
it('uses the existing current-release protocol and verifies the manifest identity', async () => {
  const manifest = Buffer.from(
      '{"data_schema":{},"inputs":[],"manifest_schema":"budget-release/1","outputs":[{"bytes":2,"mime":"application/json","path":"validation.json","role":"validation","sha256":"' +
        'a'.repeat(64) +
        '"}],"processing":{"code":{"commit":"' +
        'b'.repeat(40) +
        '"}}}\n',
    ),
    rid = hash(manifest),
    requests: string[] = [];
  const transport = async (r: any) => {
    requests.push(r.url);
    return {
      status: 200,
      body: r.url.endsWith('/api/releases/current')
        ? Buffer.from(
            JSON.stringify({
              release_id: rid,
              revision: 3,
              manifest: `/data/releases/${rid}/manifest.json`,
            }),
          )
        : manifest,
    };
  };
  const result = await locateManifest({ current: 'http://127.0.0.1:9417' }, transport);
  expect(result.releaseId).toBe(rid);
  expect(requests).toEqual([
    'http://127.0.0.1:9417/api/releases/current',
    `http://127.0.0.1:9417/data/releases/${rid}/manifest.json`,
  ]);
  await expect(
    locateManifest({ current: 'http://127.0.0.1:9417' }, async () => ({
      status: 200,
      body: Buffer.from(JSON.stringify({ release_id: rid, revision: 3, manifest: '/escape' })),
    })),
  ).rejects.toThrow(/path differs/);
});
it('does not imply a build/replay from an old commit label or an incomplete command', async () => {
  const f = await fixture(),
    errors: string[] = [],
    deps = { root: f.root, error: (s: string) => errors.push(s), write: () => {} };
  expect(await productionCli(['build', '--out', join(f.root, 'candidate')], deps)).toBe(2);
  expect(await productionCli(['restore'], deps)).toBe(2);
  expect(await productionCli(['publish', '--environment', 'production'], deps)).toBe(3);
  expect(errors.length).toBe(3);
});
it('dispatches named release operations with explicit dry-run semantics through an owned fake client', async () => {
  const f = await fixture(),
    calls: any[] = [],
    messages: string[] = [];
  const deps = {
    root: f.root,
    write: (s: string) => messages.push(s),
    operator: {
      credentialEnvironment: {},
      client: (options: any) =>
        ({
          environment: options.environment,
          status: async () => {
            calls.push(['status']);
            return { revision: 0 };
          },
          upload: async (o: any) => {
            calls.push(['upload', o]);
            return { dryRun: o.dryRun };
          },
          publish: async (o: any) => {
            calls.push(['publish', o]);
            return { dryRun: o.dryRun };
          },
          rollback: async (o: any) => {
            calls.push(['rollback', o]);
            return { dryRun: o.dryRun };
          },
        }) as any,
    },
  };
  for (const command of ['status', 'upload', 'publish', 'rollback']) {
    const args = [command, '--environment', 'owned', '--url', 'https://owned.invalid'];
    if (command !== 'status')
      args.push(
        '--dry-run',
        ...(command === 'rollback'
          ? ['--release-id', 'a'.repeat(64)]
          : ['--release', join(f.work, 'candidate')]),
      );
    expect(await productionCli(args, deps)).toBe(0);
  }
  expect(calls.map((c) => c[0])).toEqual(['status', 'upload', 'publish', 'rollback']);
  expect(calls.slice(1).every((c) => c[1].dryRun === true)).toBe(true);
  expect(calls[1][1].originals).toBe(f.root);
});
