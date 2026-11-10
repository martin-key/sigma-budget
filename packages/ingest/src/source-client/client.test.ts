import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SourceClient, validateKfpGrid } from './client.js';
import { inspectDrift } from './drift.js';
import { sha256 } from './files.js';
import type { SourceTransport } from './transport.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const now = () => new Date('2031-02-03T04:05:06Z');
const path = 'data/originals/example/value.json';
const url = 'https://data.example.test/value';
const original = Buffer.from('{"value":1}\n');
async function fixture(
  sources: unknown[] = [
    { id: 'example', acquisition: 'auto', format: 'json', files: [{ path, url }] },
  ],
  pins = new Map([[path, sha256(original)]]),
) {
  const root = await mkdtemp(join(tmpdir(), 'sigma-source-client-'));
  roots.push(root);
  const source = join(root, 'source'),
    out = join(root, 'snapshot');
  await mkdir(join(source, 'data/originals/example'), { recursive: true });
  await writeFile(join(source, path), original);
  const registryPath = join(root, 'sources.yaml'),
    pinsPath = join(root, 'originals.sha256');
  await writeFile(registryPath, JSON.stringify({ schema: 1, sources }));
  await writeFile(pinsPath, [...pins].map(([p, h]) => h + '  ' + p + '\n').join(''));
  const baseline = [
    await readFile(registryPath),
    await readFile(pinsPath),
    await readFile(join(source, path)),
  ];
  const options = { sourceRoot: source, registryPath, pinsPath, clock: now };
  return {
    root,
    source,
    out,
    options,
    baseline,
    assertBaseline: async () =>
      expect([
        await readFile(registryPath),
        await readFile(pinsPath),
        await readFile(join(source, path)),
      ]).toEqual(baseline),
  };
}
const transport =
  (body: Buffer, status = 200): SourceTransport =>
  async () => ({ status, body });

describe('operational acquisition and provenance', () => {
  it('preserves a seed, versions changed bytes, reports drift and keeps every old receipt', async () => {
    const f = await fixture();
    let body = original;
    const calls: string[] = [];
    const client = await SourceClient.open({
      ...f.options,
      attempts: 1,
      transport: async (r) => {
        calls.push(r.url);
        return { status: 200, body };
      },
    });
    const first = await client.collect({ snapshotRoot: f.out, checkDrift: true });
    expect(first.code).toBe(0);
    expect(first.snapshot.collected[0]).toMatchObject({
      drift: 'same',
      method: 'fetch',
      sha256: sha256(original),
      retrieved: now().toISOString(),
    });
    const receipt = await readFile(join(f.out, first.snapshot.receipt!));
    body = Buffer.from('{"value":2}');
    const second = await client.collect({ snapshotRoot: f.out, checkDrift: true });
    expect(second.code).toBe(1);
    expect(second.snapshot.collected[0]!.file).toBe('versions/' + sha256(body) + '/' + path);
    expect(await readFile(join(f.out, path))).toEqual(original);
    expect(await readFile(join(f.out, first.snapshot.receipt!))).toEqual(receipt);
    expect(await client.readSnapshot(join(f.out, 'snapshot.json'))).toEqual(second.snapshot);
    body = Buffer.from('<html>Login</html>');
    const bad = await client.collect({ snapshotRoot: f.out });
    expect(bad.code).toBe(3);
    expect(bad.snapshot.collected[0]).toMatchObject({ status: 'unavailable' });
    expect(await readFile(join(f.out, second.snapshot.collected[0]!.file!))).toEqual(
      Buffer.from('{"value":2}'),
    );
    expect(calls).toEqual([url, url, url]);
    await f.assertBaseline();
  });
  it('resumes successes after checking bytes, retries failed rows, and never accepts corrupt raw objects', async () => {
    const secondPath = 'data/originals/example/second.json';
    const f = await fixture([
      {
        id: 'example',
        acquisition: 'fetch',
        files: [
          { path, url },
          { path: secondPath, url: url + '/second' },
        ],
      },
    ]);
    let fail = true;
    const calls: string[] = [];
    const client = await SourceClient.open({
      ...f.options,
      attempts: 1,
      transport: async (r) => {
        calls.push(r.url);
        return { status: r.url.endsWith('/second') && fail ? 503 : 200, body: original };
      },
    });
    expect((await client.collect({ snapshotRoot: f.out })).code).toBe(3);
    fail = false;
    const resumed = await client.collect({ snapshotRoot: f.out, resume: true });
    expect(resumed.code).toBe(0);
    expect(resumed.snapshot.collected[0]!.resumed).toBe(true);
    expect(calls).toEqual([url, url + '/second', url + '/second']);
    await writeFile(join(f.out, resumed.snapshot.collected[0]!.raw![0]!.file), 'tampered');
    await expect(client.collect({ snapshotRoot: f.out, resume: true })).rejects.toThrow(
      /raw bytes changed/,
    );
    expect(calls).toHaveLength(3);
    await f.assertBaseline();
  });
  it('produces deterministic receipts with an injected clock and byte-identical transport', async () => {
    const f = await fixture();
    const client = await SourceClient.open({ ...f.options, transport: transport(original) });
    const a = await client.collect({ snapshotRoot: f.out });
    const b = await client.collect({ snapshotRoot: join(f.root, 'other') });
    expect(a).toEqual(b);
    await f.assertBaseline();
  });
  it('resumes a genuinely interrupted partial checkpoint without refetching its completed first row', async () => {
    const secondPath = 'data/originals/example/second.json';
    const f = await fixture([
      {
        id: 'example',
        acquisition: 'fetch',
        files: [
          { path, url },
          { path: secondPath, url: url + '/second' },
        ],
      },
    ]);
    const calls: string[] = [];
    let ticks = 0;
    const options = {
      ...f.options,
      transport: async (r: { url: string }) => {
        calls.push(r.url);
        return { status: 200, body: original };
      },
    };
    const interrupted = await SourceClient.open({
      ...options,
      clock: () => {
        if (++ticks === 5) throw new Error('simulated process interruption');
        return now();
      },
    });
    await expect(interrupted.collect({ snapshotRoot: f.out })).rejects.toThrow(/interruption/);
    const pointer = JSON.parse(await readFile(join(f.out, 'snapshot.json'), 'utf8'));
    expect(pointer.complete).toBe(false);
    expect(pointer.collected).toHaveLength(1);
    const resumed = await (
      await SourceClient.open(options)
    ).collect({ snapshotRoot: f.out, resume: true });
    expect(resumed.code).toBe(0);
    expect(resumed.snapshot.complete).toBe(true);
    expect(calls).toEqual([url, url + '/second', url + '/second']);
    await f.assertBaseline();
  });
  it('treats valid changed live bytes separately from wrong-format data', async () => {
    const f = await fixture(
      [{ id: 'example', acquisition: 'fetch', live: true, files: [{ path, url }] }],
      new Map([[path, 'a'.repeat(64)]]),
    );
    const client = await SourceClient.open(f.options);
    const result = await client.status();
    expect(result.code).toBe(0);
    expect(result.rows[0]!.state).toBe('live-changed');
    await writeFile(join(f.source, path), '<html>captcha</html>');
    const bad = await client.status();
    expect(bad.code).toBe(1);
    expect(bad.rows[0]!.state).toBe('wrong-format');
    await writeFile(join(f.source, path), original);
    await f.assertBaseline();
  });
  it('refetch uses manifest pins, honors manual inputs and rejects unregistered URLs before transport', async () => {
    const kfp = {
      id: 'kfp',
      acquisition: 'import',
      format: 'xls',
      files: [{ path: 'data/originals/kfp_2031/*.xls' }],
    };
    const f = await fixture([{ id: 'example', acquisition: 'auto', files: [{ path, url }] }, kfp]);
    const manifestPath = join(f.root, 'manifest.json');
    const inputs = [
      {
        kind: 'source',
        source: 'example',
        path,
        url,
        via: null,
        acquisition: 'auto',
        sha256: sha256(original),
      },
      {
        kind: 'source',
        source: 'kfp',
        path: 'data/originals/kfp_2031/2031-EU_funds_0131_BG_WEB.xls',
        url: null,
        via: null,
        acquisition: 'import',
        sha256: 'a'.repeat(64),
      },
    ];
    await writeFile(manifestPath, JSON.stringify({ inputs }));
    let calls = 0;
    const client = await SourceClient.open({
      ...f.options,
      transport: async () => {
        calls++;
        return { status: 200, body: original };
      },
    });
    const result = await client.refetch({ manifestPath, snapshotRoot: f.out });
    expect(result.code).toBe(0);
    expect(result.snapshot.collected[1]!.status).toBe('manual');
    expect(calls).toBe(1);
    await client.refetch({ manifestPath, snapshotRoot: f.out, resume: true });
    expect(calls).toBe(1);
    inputs[0]!.url = 'https://unregistered.test/';
    await writeFile(manifestPath, JSON.stringify({ inputs }));
    await expect(client.refetch({ manifestPath, snapshotRoot: f.out })).rejects.toThrow(
      /identity mismatch/,
    );
    expect(calls).toBe(1);
    await f.assertBaseline();
  });
  it('reports missing pinned historical inputs without making up recovery data', async () => {
    const f = await fixture(
      undefined,
      new Map([
        [path, sha256(original)],
        ['data/originals/missing.pdf', 'a'.repeat(64)],
      ]),
    );
    const result = await (await SourceClient.open(f.options)).status();
    expect(result.code).toBe(1);
    expect(result.rows.find((r) => r.path.endsWith('missing.pdf'))!.state).toBe(
      'historical-unverified',
    );
    expect(result.historicalReconstruction).toBe('unverified');
    await f.assertBaseline();
  });
  it('retains the donor non-blocking status of optional data.europa reference metadata', async () => {
    const path = 'data/originals/data_europa/kfp.json';
    const f = await fixture(
      [{ id: 'dataeuropa', acquisition: 'fetch', files: [{ path, url }] }],
      new Map([[path, 'a'.repeat(64)]]),
    );
    const status = await (await SourceClient.open(f.options)).status();
    expect(status.code).toBe(0);
    expect(status.rows.find((r) => r.path === path)).toMatchObject({
      optional: true,
      state: 'historical-unverified',
    });
    await f.assertBaseline();
  });
});

describe('source identity and output guards', () => {
  it.each([
    '../escape.json',
    '/tmp/escape.json',
    'data/originals/../pins',
    'data//a.json',
    'data/originals/a\\b.json',
  ])('rejects unsafe registry path %s', async (bad) => {
    const f = await fixture([{ id: 'bad', acquisition: 'auto', files: [{ path: bad, url }] }]);
    await expect(SourceClient.open(f.options)).rejects.toThrow(/path/);
    await f.assertBaseline();
  });
  it('rejects automatic wildcards and registry/pin disagreement', async () => {
    const f = await fixture([
      { id: 'bad', acquisition: 'fetch', files: [{ path: 'data/originals/*.json', url }] },
    ]);
    await expect(SourceClient.open(f.options)).rejects.toThrow(/exact/);
    await writeFile(
      f.options.registryPath,
      JSON.stringify({
        schema: 1,
        sources: [
          { id: 'bad', acquisition: 'fetch', files: [{ path, url, sha256: 'f'.repeat(64) }] },
        ],
      }),
    );
    await expect(SourceClient.open(f.options)).rejects.toThrow(/disagreement/);
  });
  it.each(['source', 'originals', 'parent', 'pins', 'registry'])(
    'refuses overlapping snapshot destination %s',
    async (which) => {
      const f = await fixture();
      let calls = 0;
      const client = await SourceClient.open({
        ...f.options,
        transport: async () => {
          calls++;
          return { status: 200, body: original };
        },
      });
      const targets: Record<string, string> = {
        source: f.source,
        originals: join(f.source, 'data/originals/new'),
        parent: f.root,
        pins: f.options.pinsPath,
        registry: f.options.registryPath,
      };
      await expect(client.collect({ snapshotRoot: targets[which]! })).rejects.toThrow(/overlap/);
      expect(calls).toBe(0);
      await f.assertBaseline();
    },
  );
  it('rejects links in seed/output/report and hard-linked receipts before acquisition', async () => {
    const f = await fixture();
    const client = await SourceClient.open({ ...f.options, transport: transport(original) });
    await symlink(f.source, join(f.root, 'linked'));
    await expect(client.collect({ snapshotRoot: join(f.root, 'linked/out') })).rejects.toThrow(
      /link/i,
    );
    await expect(
      client.collect({ snapshotRoot: f.out, summaryPath: f.options.pinsPath }),
    ).rejects.toThrow(/overlap/);
    const report = join(f.root, 'report.json');
    await link(f.options.pinsPath, report);
    await expect(client.collect({ snapshotRoot: f.out, summaryPath: report })).rejects.toThrow(
      /aliases/,
    );
    await symlink(join(f.source, path), join(f.source, 'data/originals/evil.json'));
    await expect(client.collect({ snapshotRoot: f.out })).rejects.toThrow(/link/i);
    await f.assertBaseline();
  });
  it('rejects manifest/report aliases and protects existing unrelated snapshot pointers', async () => {
    const f = await fixture();
    const client = await SourceClient.open({ ...f.options, transport: transport(original) });
    await expect(
      client.refetch({
        manifestPath: f.options.pinsPath,
        snapshotRoot: f.out,
        summaryPath: f.options.pinsPath,
      }),
    ).rejects.toThrow(/overlap/);
    await mkdir(f.out);
    await writeFile(join(f.out, 'snapshot.json'), '{"important":"keep"}');
    await expect(client.collect({ snapshotRoot: f.out })).rejects.toThrow(/unrelated/);
    expect(await readFile(join(f.out, 'snapshot.json'), 'utf8')).toBe('{"important":"keep"}');
    await f.assertBaseline();
  });
});

describe('controlled manual imports and review', () => {
  const xls = Buffer.concat([
    Buffer.from('d0cf11e0a1b11ae1', 'hex'),
    Buffer.from('finite fake workbook; decoder injected'),
  ]);
  const grid = {
    sheet: 'стартова',
    rows: 54,
    columns: 4,
    title: 'КЪМ 31.01.2031 ГОДИНА',
    unitText: 'млн. евро',
  };
  async function kfpFixture() {
    return fixture(
      [
        {
          id: 'kfp',
          acquisition: 'import',
          page: 'https://www.minfin.bg/bg/statistics/5',
          format: 'xls',
          files: [{ path: 'data/originals/kfp_2031/*.xls' }],
        },
      ],
      new Map(),
    );
  }
  it('restores known hashes without a decoder and never changes source files or pins', async () => {
    const f = await fixture();
    const input = join(f.root, 'download.json');
    await writeFile(input, original);
    const client = await SourceClient.open(f.options);
    const result = await client.importSource({
      source: 'example',
      file: input,
      snapshotRoot: f.out,
    });
    expect(result.code).toBe(0);
    expect(result.snapshot.collected[0]!.checks).toMatchObject({ match: 'registered-sha256' });
    expect(await readFile(join(f.out, path))).toEqual(original);
    await f.assertBaseline();
  });
  it('requires physical decoding for a new KFP, validates units/date and records a pin proposal only', async () => {
    const f = await kfpFixture();
    const input = join(f.root, 'download_BG_WEB_2.xls');
    await writeFile(input, xls);
    const client = await SourceClient.open(f.options);
    await expect(
      client.importSource({ source: 'kfp', file: input, snapshotRoot: f.out }),
    ).rejects.toThrow(/decoder is required/);
    const result = await client.importSource({
      source: 'kfp',
      file: input,
      snapshotRoot: f.out,
      decodeKfp: () => grid,
      url: 'https://www.minfin.bg/upload/report.xls',
    });
    const row = result.snapshot.collected[0]!;
    expect(row.path).toBe('data/originals/kfp_2031/2031-EU_funds_0131_BG_WEB_2.xls');
    expect(row.checks).toMatchObject({
      asOf: '2031-01-31',
      unit: 'EUR',
      numericalValidation: 'not-run',
    });
    expect(row.proposedPins).toEqual([{ path: row.path, sha256: sha256(xls) }]);
    await f.assertBaseline();
  });
  it('rejects unknown source, URL, wrong-format bytes and invalid decode before writing', async () => {
    const f = await kfpFixture();
    const input = join(f.root, 'report.xls');
    await writeFile(input, xls);
    const client = await SourceClient.open(f.options);
    for (const extra of [
      { source: 'unknown' },
      { url: 'https://attacker.test/report' },
      { decodeKfp: () => ({ ...grid, unitText: 'млн. лв.' }) },
    ])
      await expect(
        client.importSource({
          source: 'kfp',
          file: input,
          snapshotRoot: f.out,
          decodeKfp: () => grid,
          ...extra,
        }),
      ).rejects.toThrow();
    await writeFile(input, '<html>captcha</html>');
    await expect(
      client.importSource({ source: 'kfp', file: input, snapshotRoot: f.out }),
    ).rejects.toThrow(/Unknown hash/);
    expect(await readdir(f.root)).not.toContain('snapshot');
    await f.assertBaseline();
  });
  it('requires --replace even when the different pinned version is missing; preserves it in a correction receipt', async () => {
    const p = 'data/originals/kfp_2031/2031-EU_funds_0131_BG_WEB.xls';
    const f = await fixture(
      [
        {
          id: 'kfp',
          acquisition: 'import',
          format: 'xls',
          files: [{ path: 'data/originals/kfp_2031/*.xls' }],
        },
      ],
      new Map([[p, 'a'.repeat(64)]]),
    );
    const input = join(f.root, 'report.xls');
    await writeFile(input, xls);
    const client = await SourceClient.open(f.options);
    await expect(
      client.importSource({
        source: 'kfp',
        file: input,
        snapshotRoot: f.out,
        decodeKfp: () => grid,
      }),
    ).rejects.toThrow(/--replace/);
    const result = await client.importSource({
      source: 'kfp',
      file: input,
      snapshotRoot: f.out,
      decodeKfp: () => grid,
      replace: true,
    });
    expect(result.snapshot.collected[0]!.replaces).toEqual([{ path: p, sha256: 'a'.repeat(64) }]);
    await f.assertBaseline();
  });
  it.each(['absent SHA file', 'empty SHA file', 'matching SHA file'])(
    'authenticates registry-pinned corrections and restores with %s',
    async (mode) => {
      const path = 'data/originals/kfp_2031/2031-EU_funds_0131_BG_WEB.xls';
      const previous = sha256(xls),
        revised = Buffer.concat([xls, Buffer.from('revision')]);
      const f = await fixture(
        [{ id: 'kfp', acquisition: 'import', format: 'xls', files: [{ path, sha256: previous }] }],
        mode === 'matching SHA file' ? new Map([[path, previous]]) : new Map(),
      );
      const client = await SourceClient.open({
        ...f.options,
        ...(mode === 'absent SHA file' ? { pinsPath: undefined } : {}),
      });
      const input = join(f.root, 'download.xls');
      await writeFile(input, revised);
      const options = { source: 'kfp', file: input, snapshotRoot: f.out, decodeKfp: () => grid };
      await expect(client.importSource(options)).rejects.toThrow(/--replace/);
      await expect(client.importSource({ ...options, dryRun: true })).rejects.toThrow(/--replace/);
      const correction = await client.importSource({ ...options, replace: true });
      expect(correction.snapshot.collected[0]).toMatchObject({
        expected: previous,
        drift: 'changed',
        sha256: sha256(revised),
        replaces: [{ path, sha256: previous }],
        proposedPins: [{ path, sha256: sha256(revised) }],
      });
      expect(await client.readSnapshot(join(f.out, 'snapshot.json'))).toEqual(correction.snapshot);
      await writeFile(input, xls);
      const restoredRoot = join(f.root, 'restored');
      const restored = await client.importSource({
        source: 'kfp',
        file: input,
        snapshotRoot: restoredRoot,
      });
      expect(restored.snapshot.collected[0]).toMatchObject({ expected: previous, drift: 'same' });
      expect(restored.snapshot.collected[0]).not.toHaveProperty('replaces');
      expect(restored.snapshot.collected[0]).not.toHaveProperty('proposedPins');
      expect(
        await inspectDrift(client, { snapshotPath: join(restoredRoot, 'snapshot.json') }),
      ).toMatchObject({ code: 0, report: { pending: 0 } });
      expect(await readFile(join(restoredRoot, path))).toEqual(xls);
      await f.assertBaseline();
    },
  );
  it('retains a registry-pinned prior month version with a different filename suffix', async () => {
    const path = 'data/originals/kfp_2031/2031-EU_funds_0131_BG_WEB_2.xls';
    const f = await fixture(
      [
        {
          id: 'kfp',
          acquisition: 'import',
          format: 'xls',
          files: [{ path, sha256: sha256(xls) }, { path: 'data/originals/kfp_2031/*.xls' }],
        },
      ],
      new Map(),
    );
    const input = join(f.root, 'download.xls');
    await writeFile(input, Buffer.concat([xls, Buffer.from('new version')]));
    const client = await SourceClient.open(f.options);
    const options = { source: 'kfp', file: input, snapshotRoot: f.out, decodeKfp: () => grid };
    await expect(client.importSource(options)).rejects.toThrow(/--replace/);
    const corrected = await client.importSource({ ...options, replace: true });
    expect(corrected.snapshot.collected[0]!.replaces).toEqual([{ path, sha256: sha256(xls) }]);
    await f.assertBaseline();
  });
  it('restores a non-KFP registry-only pin without pending drift', async () => {
    const f = await fixture(
      [
        {
          id: 'example',
          acquisition: 'manual',
          format: 'json',
          files: [{ path, sha256: sha256(original) }],
        },
      ],
      new Map(),
    );
    const input = join(f.root, 'download.json');
    await writeFile(input, original);
    const client = await SourceClient.open({ ...f.options, pinsPath: undefined });
    const restored = await client.importSource({
      source: 'example',
      file: input,
      snapshotRoot: f.out,
    });
    expect(restored.snapshot.collected[0]).toMatchObject({
      expected: sha256(original),
      drift: 'same',
    });
    expect(
      await inspectDrift(client, { snapshotPath: join(f.out, 'snapshot.json') }),
    ).toMatchObject({ code: 0, report: { pending: 0 } });
    await f.assertBaseline();
  });
  it('dry-run validates without creating any destination', async () => {
    const f = await kfpFixture();
    const input = join(f.root, 'report.xls');
    await writeFile(input, xls);
    const result = await (
      await SourceClient.open(f.options)
    ).importSource({
      source: 'kfp',
      file: input,
      snapshotRoot: f.out,
      decodeKfp: () => grid,
      dryRun: true,
    });
    expect(result.code).toBe(0);
    expect(await readdir(f.root)).not.toContain('snapshot');
    await f.assertBaseline();
  });
  it('keeps a conflicting pin visible when the same path already holds the unpinned revision', async () => {
    const path = 'data/originals/kfp_2031/2031-EU_funds_0131_BG_WEB.xls';
    const f = await fixture(
      [
        {
          id: 'kfp',
          acquisition: 'import',
          format: 'xls',
          files: [{ path: 'data/originals/kfp_2031/*.xls' }],
        },
      ],
      new Map([[path, 'a'.repeat(64)]]),
    );
    await mkdir(join(f.source, 'data/originals/kfp_2031'), { recursive: true });
    await writeFile(join(f.source, path), xls);
    const input = join(f.root, 'download.xls');
    await writeFile(input, xls);
    const client = await SourceClient.open(f.options);
    await expect(
      client.importSource({
        source: 'kfp',
        file: input,
        snapshotRoot: f.out,
        decodeKfp: () => grid,
      }),
    ).rejects.toThrow(/--replace/);
    await f.assertBaseline();
  });
  it.each([
    { rows: 53 },
    { columns: 5 },
    { sheet: 'other' },
    { title: 'КЪМ 30.01.2031 ГОДИНА' },
    { title: 'КЪМ 28.02.2032 ГОДИНА' },
    { title: 'КЪМ 31.13.2031 ГОДИНА' },
    { title: 'not a report' },
    { unitText: 'EUR' },
    { unitText: 'млн. лв.' },
  ])('rejects a malformed KFP identification %j', (extra) =>
    expect(() => validateKfpGrid({ ...grid, ...extra })).toThrow(),
  );
  it('applies the donor BGN/EUR year boundary and leap-month rule', () => {
    expect(
      validateKfpGrid({ ...grid, title: 'КЪМ 31.12.2025 ГОДИНА', unitText: 'млн. лв.' }).unit,
    ).toBe('BGN');
    expect(validateKfpGrid({ ...grid, title: 'КЪМ 29.02.2032 ГОДИНА' }).asOf).toBe('2032-02-29');
  });
  it('binds review decisions to the exact snapshot/source/bytes and never promotes pins', async () => {
    const f = await fixture();
    const client = await SourceClient.open({
      ...f.options,
      transport: transport(Buffer.from('{"revised":true}')),
    });
    const result = await client.collect({ snapshotRoot: f.out });
    const snapshotPath = join(f.out, 'snapshot.json'),
      reviewPath = join(f.root, 'review.json');
    expect((await inspectDrift(client, { snapshotPath })).code).toBe(1);
    const review = {
      schema: 'source-drift-review/1',
      snapshotSha256: result.snapshotSha256,
      reviewer: 'Fixture reviewer',
      decisions: [
        {
          source: 'example',
          path,
          sha256: result.snapshot.collected[0]!.sha256,
          decision: 'preserve-historical',
          reason: 'New response does not establish historical reproduction',
        },
      ],
    };
    await writeFile(reviewPath, JSON.stringify(review));
    const report = await inspectDrift(client, {
      snapshotPath,
      reviewPath,
      reportPath: join(f.root, 'drift.json'),
    });
    expect(report.code).toBe(0);
    expect(report.report.pinMutation).toBe(false);
    expect(report.report.historicalReconstruction).toBe('unverified');
    review.snapshotSha256 = '0'.repeat(64);
    await writeFile(reviewPath, JSON.stringify(review));
    await expect(inspectDrift(client, { snapshotPath, reviewPath })).rejects.toThrow(
      /exact snapshot/,
    );
    await expect(
      inspectDrift(client, { snapshotPath, reportPath: f.options.pinsPath }),
    ).rejects.toThrow(/overlap/);
    await f.assertBaseline();
  });
});

it('reads the actual registry and pinned supplied XLS/PDF/ZIP bytes without network or fixture-only paths', async () => {
  const sourceRoot = resolve('../..');
  const client = await SourceClient.open({
    sourceRoot,
    registryPath: join(sourceRoot, 'data/sources.yaml'),
    pinsPath: join(sourceRoot, 'data/originals.sha256'),
    clock: now,
  });
  const status = await client.status();
  expect(status.rows.filter((r) => r.state === 'present' && /\/kfp_/.test(r.path))).toHaveLength(
    33,
  );
  expect(status.rows.some((r) => r.state === 'historical-unverified')).toBe(true);
  expect(status.latestAsOf).toBe('2026-09-30');
  const f = await fixture();
  const actual = join(sourceRoot, 'data/originals/kfp_2026/2026-EU_funds_0926_BG_WEB.xls');
  const baseline = await readFile(actual);
  const imported = await client.importSource({ source: 'kfp', file: actual, snapshotRoot: f.out });
  const row = imported.snapshot.collected[0]!;
  expect(row.sha256).toBe('34a01ba7d55c029c1b5bc2cf312fc383f3bc125b3d77955767cd045da3ee03ec');
  expect(await readFile(join(f.out, row.file!))).toEqual(baseline);
  expect(await readFile(actual)).toEqual(baseline);
});

it('collects recorded real XLS/PDF/ZIP/XLSX/XML bytes unchanged through a fake transport', async () => {
  const root = resolve('../..');
  const files = [
    ['xls', 'data/originals/kfp_2026/2026-EU_funds_0926_BG_WEB.xls'],
    ['pdf', 'data/originals/asbp/UMTBF-2026-2028-motivi.pdf'],
    ['zip', 'data/originals/budget_2027/ZDBRB-2027.zip'],
    [
      'xlsx',
      'packages/ingest/test/fixtures/debt-local/inputs/data/originals/sebra/midt_sebra_31.08.2026.xlsx',
    ],
    ['xml', 'packages/ingest/test/fixtures/debt-local/inputs/data/originals/bnb_sdmx/ggd.xml'],
  ];
  const originals = await Promise.all(
    files.map(async ([kind, file]) => ({
      kind: kind!,
      file: file!,
      bytes: await readFile(join(root, file!)),
    })),
  );
  const f = await fixture(
    originals.map(({ kind }) => ({
      id: kind,
      acquisition: 'auto',
      files: [
        { path: 'data/originals/real.' + kind, url: 'https://recorded.example.test/' + kind },
      ],
    })),
    new Map(originals.map(({ kind, bytes }) => ['data/originals/real.' + kind, sha256(bytes)])),
  );
  const client = await SourceClient.open({
    ...f.options,
    transport: async ({ url }) => ({
      status: 200,
      body: originals.find(({ kind }) => url.endsWith('/' + kind))!.bytes,
    }),
  });
  const result = await client.collect({ snapshotRoot: f.out, checkDrift: true });
  expect(result.code).toBe(0);
  expect(result.snapshot.collected).toHaveLength(5);
  for (const row of result.snapshot.collected) {
    const original = originals.find(({ kind }) => row.source === kind)!;
    expect((await readFile(join(f.out, row.file!))).equals(original.bytes)).toBe(true);
    expect((await readFile(join(root, original.file))).equals(original.bytes)).toBe(true);
  }
  await f.assertBaseline();
});
