import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  cp,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildRelease,
  checkReleaseDirectory,
  reproduceRelease,
  validationReport,
} from './lifecycle.js';
import { exportCommit } from './export.js';
import { prepareInputs, stageInputs, transitiveInputClosure } from './inputs.js';
import { recordedNodeExecutor } from './node-executor.js';
import { jsonBytes, sha256 } from './files.js';
import {
  REQUIRED_VALIDATION_GROUPS,
  type BuildReleaseOptions,
  type ReleaseExecutor,
  type ExecutorResult,
  type ExecutionContext,
  type ValidationGroup,
} from './types.js';
import { readCandidate } from '../../../../apps/web/scripts/candidate-data.js';
import { preflightRelease } from '../release-client/package.js';

const exec = promisify(execFile);
const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true });
});
async function put(path: string, content: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const definitions = [
  ['core', 'core.json'],
  ['catalog', 'catalog.json'],
  ['execution', 'execution.json'],
  ['provenance', 'execution-provenance.json'],
] as const;
const groups = REQUIRED_VALIDATION_GROUPS.map((group) => ({
  group,
  status: 'OK',
  checks: 1,
  summary: 'synthetic lifecycle test only',
  problems: [],
  warnings: [],
}));
const producer = `import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {marker} from './helper.mjs';
export async function executeRelease(ctx){
  let inherited=false;try{await access(join(ctx.exportRoot,'data/release/old.json'));inherited=true}catch{}
  if(inherited)throw Error('Old release visible');
  const raw=await readFile(join(ctx.exportRoot,'data/originals/deep.txt'),'utf8');
  const committed=await readFile(join(ctx.exportRoot,'data/inputs/authored.json'),'utf8');
  await mkdir(join(ctx.candidateRoot,'data'));
  const output={core:{marker,raw,committed},catalog:{synthetic:true},execution:{meta:{schema:'execution/2'},contract:{provenance:'execution-provenance.json'},latest:{asOf:'2026-09-30'}},'execution-provenance':{schema:'execution-provenance/2'}};
  for(const [name,value] of Object.entries(output))await writeFile(join(ctx.candidateRoot,'data',name+'.json'),JSON.stringify(value)+'\\n');
  return {validation:{completeValidation:true,groups:${JSON.stringify(groups)}},datasets:${JSON.stringify(definitions.map(([id]) => ({ id, action: 'built' })))}};
}`;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'release-lifecycle-test-'));
  owned.push(root);
  const repo = join(root, 'repo'),
    input = join(root, 'snapshot');
  await mkdir(repo);
  await mkdir(input);
  await exec('git', ['init', '-q', repo]);
  const source = {
    schema: 1,
    sources: [
      {
        id: 'raw',
        acquisition: 'import',
        files: [{ path: 'data/originals/raw.txt' }, { path: 'data/originals/deep.txt' }],
      },
    ],
    intermediates: [
      {
        path: 'data/cache/intermediate.json',
        inputs: ['raw'],
        reproducible: false,
        note: 'test historical evidence gap',
      },
      {
        path: 'data/inputs/authored.json',
        inputs: ['data/cache/intermediate.json'],
        reproducible: false,
        note: 'test authored input',
      },
    ],
  };
  const datasets = {
    schema: 1,
    datasets: definitions.map(([id, file]) => ({
      id,
      status: 'real',
      files: ['data/release/' + file],
      inputs:
        id === 'core' ? ['catalog', 'data/inputs/authored.json'] : id === 'catalog' ? ['core'] : [],
    })),
  };
  const originals: Record<string, string> = {
    'data/originals/raw.txt': 'first raw\n',
    'data/originals/deep.txt': 'transitive raw\n',
    'data/cache/intermediate.json': '{"old":true}\n',
  };
  await put(join(repo, 'data/sources.yaml'), JSON.stringify(source));
  await put(join(repo, 'data/datasets.yaml'), JSON.stringify(datasets));
  await put(
    join(repo, 'data/originals.sha256'),
    Object.entries(originals)
      .map(([path, bytes]) => `${sha256(bytes)}  ${path}\n`)
      .join(''),
  );
  for (const [path, bytes] of Object.entries(originals)) await put(join(input, path), bytes);
  await put(join(repo, 'data/inputs/authored.json'), '{"authored":true}\n');
  await put(join(repo, 'data/release/old.json'), '{"finished":"must never be visible"}');
  await put(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await put(join(repo, 'executor.mjs'), producer);
  await put(join(repo, 'helper.mjs'), 'export const marker="recorded";\n');
  await exec('git', ['-C', repo, 'add', '.']);
  await exec('git', [
    '-C',
    repo,
    '-c',
    'user.name=Lifecycle Test',
    '-c',
    'user.email=lifecycle@example.invalid',
    'commit',
    '-qm',
    'test: finite recorded executor',
  ]);
  const commit = (await exec('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim();
  const executor = recordedNodeExecutor({ entry: 'executor.mjs', id: 'synthetic-lifecycle-test' });
  const options: BuildReleaseOptions = {
    repositoryRoot: repo,
    inputRoot: input,
    commit,
    buildDate: '2026-11-10',
    outputRoot: join(root, 'candidate'),
    executor,
  };
  return { root, repo, input, commit, executor, options, source, datasets };
}
async function withResult(
  f: Awaited<ReturnType<typeof fixture>>,
  mutate: (result: ExecutorResult, context: ExecutionContext) => Promise<void> | void,
): Promise<ReleaseExecutor> {
  return {
    identity: f.executor.identity,
    bridgeSha256: f.executor.bridgeSha256,
    async execute(context) {
      const result = await f.executor.execute(context);
      await mutate(result, context);
      return result;
    },
  };
}

describe('recorded Node build lifecycle (synthetic numeric executor)', () => {
  it('traverses dataset cycles and committed intermediates to every raw owner', async () => {
    const f = await fixture();
    const closure = transitiveInputClosure(f.source, f.datasets);
    expect([...closure.external.keys()].sort()).toEqual([
      'data/cache/intermediate.json',
      'data/originals/deep.txt',
      'data/originals/raw.txt',
    ]);
    expect(closure.external.get('data/originals/deep.txt')!.datasets).toEqual(['catalog', 'core']);
    expect([...closure.committed.keys()]).toEqual(['data/inputs/authored.json']);
  });
  it('builds twice and reproduces exactly from the recorded commit despite working-tree changes', async () => {
    const f = await fixture();
    const a = await buildRelease(f.options);
    await put(join(f.repo, 'helper.mjs'), 'export const marker="UNCOMMITTED";\n');
    await put(join(f.repo, 'data/inputs/authored.json'), '{"uncommitted":true}\n');
    await put(
      join(f.input, 'data/inputs/authored.json'),
      '{"external":"must not override commit"}',
    );
    await exec('git', ['-C', f.repo, 'add', '.']);
    await exec('git', [
      '-C',
      f.repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-qm',
      'test: newer working checkout',
    ]);
    class ParentAdapter implements ReleaseExecutor {
      identity = f.executor.identity;
      bridgeSha256 = f.executor.bridgeSha256;
      calls = 0;
      execute(context: ExecutionContext) {
        this.calls++;
        return f.executor.execute(context);
      }
    }
    const parentAdapter = new ParentAdapter();
    const b = await buildRelease({
      ...f.options,
      executor: parentAdapter,
      outputRoot: join(f.root, 'second'),
    });
    expect(parentAdapter.calls).toBe(1);
    expect(a.releaseId).toBe(b.releaseId);
    const reproduced = await reproduceRelease({
      ...f.options,
      releaseRoot: a.outputRoot,
      outputRoot: join(f.root, 'reproduced'),
    });
    expect(reproduced.releaseId).toBe(a.releaseId);
    const checked = await checkReleaseDirectory({ releaseRoot: a.outputRoot, inputRoot: f.input });
    expect(checked.releaseId).toBe(a.releaseId);
    expect(a.manifest.inputs).toHaveLength(3);
    expect(a.manifest.processing.code.commit).toBe(f.commit);
    expect(a.manifest.processing.committed_inputs as unknown[]).toHaveLength(1);
    expect(JSON.parse(await readFile(join(a.outputRoot, 'data/core.json'), 'utf8')).marker).toBe(
      'recorded',
    );
    for (const output of a.manifest.outputs) {
      const bytes = await readFile(join(a.outputRoot, output.path));
      expect(bytes.length).toBe(output.bytes);
      expect(sha256(bytes)).toBe(output.sha256);
      expect(bytes.equals(await readFile(join(b.outputRoot, output.path)))).toBe(true);
      expect(bytes.equals(await readFile(join(reproduced.outputRoot, output.path)))).toBe(true);
    }
    expect(await readFile(join(a.outputRoot, 'receipt.json'), 'utf8')).toBe(
      await readFile(join(b.outputRoot, 'receipt.json'), 'utf8'),
    );
    expect(a.manifest.coverage).toMatchObject({
      historicalReconstruction: 'unverified',
      missingInputs: [],
    });
    await preflightRelease({ release: a.outputRoot, originals: f.input });
    expect(readCandidate(a.outputRoot).releaseId).toBe(a.releaseId);
  });
  it.each(['wrong', 'missing', 'disagreement'])(
    'rejects %s committed pins before invoking executor',
    async (kind) => {
      const f = await fixture();
      const pins = join(f.repo, 'data/originals.sha256');
      if (kind === 'wrong') await put(join(f.input, 'data/originals/deep.txt'), 'changed');
      if (kind === 'missing')
        await put(
          pins,
          (await readFile(pins, 'utf8'))
            .split('\n')
            .filter((l) => !l.endsWith('data/originals/deep.txt'))
            .join('\n'),
        );
      if (kind === 'disagreement') {
        f.source.sources[0]!.files[0] = Object.assign(
          { path: 'data/originals/raw.txt' },
          { sha256: 'a'.repeat(64) },
        );
        await put(join(f.repo, 'data/sources.yaml'), JSON.stringify(f.source));
      }
      if (kind !== 'wrong') {
        await exec('git', ['-C', f.repo, 'add', '.']);
        await exec('git', [
          '-C',
          f.repo,
          '-c',
          'user.name=Test',
          '-c',
          'user.email=t@example.invalid',
          'commit',
          '-qm',
          'test: changed pins',
        ]);
        f.options.commit = 'HEAD';
      }
      const executor = {
        identity: f.executor.identity,
        execute: async () => {
          throw Error('MUST NOT EXECUTE');
        },
      };
      await expect(buildRelease({ ...f.options, executor })).rejects.toThrow(/pin/);
      await expect(readFile(join(f.options.outputRoot, 'receipt.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );
  it('fails a newly missing transitive raw input rather than recording a historical warning', async () => {
    const f = await fixture();
    await rm(join(f.input, 'data/originals/deep.txt'));
    await expect(buildRelease(f.options)).rejects.toThrow(
      'Missing declared input: data/originals/deep.txt',
    );
  });
  it('allows only explicitly bound reproducible intermediates and requires their completed scratch evidence', async () => {
    const f = await fixture(),
      path = 'data/cache/intermediate.json';
    await rm(join(f.input, path));
    await expect(prepareInputs(f.repo, f.input, [path])).rejects.toThrow(/Missing declared input/);
    f.source.intermediates[0]!.reproducible = true;
    await put(join(f.repo, 'data/sources.yaml'), JSON.stringify(f.source));
    const pending = await prepareInputs(f.repo, f.input, [path]);
    expect(pending.missingIntermediates).toEqual([
      {
        path,
        declaration: path,
        datasets: ['catalog', 'core'],
        legacyPin: sha256('{"old":true}\n'),
      },
    ]);
    await rm(join(f.input, 'data/originals/deep.txt'));
    await expect(prepareInputs(f.repo, f.input, [path, 'data/originals/deep.txt'])).rejects.toThrow(
      'Missing declared input: data/originals/deep.txt',
    );
    await put(join(f.input, 'data/originals/deep.txt'), 'transitive raw\n');
    await exec('git', ['-C', f.repo, 'add', '.']);
    await exec('git', [
      '-C',
      f.repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-qm',
      'test: explicit generator binding',
    ]);
    await expect(
      buildRelease({
        ...f.options,
        commit: 'HEAD',
        executor: { ...f.executor, generatedIntermediates: [path] },
      }),
    ).rejects.toThrow(/complete the declared intermediate closure/);
    await expect(readFile(join(f.options.outputRoot, 'receipt.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('records an unpinned generated cache separately and verifies its complete owned view', async () => {
    const f = await fixture(),
      path = 'data/cache/intermediate.json',
      bytes = Buffer.from('{"fresh":true}\n');
    Object.assign(f.source.intermediates[0]!, { reproducible: true, pinned: false });
    await put(join(f.repo, 'data/sources.yaml'), JSON.stringify(f.source));
    const pins = join(f.repo, 'data/originals.sha256');
    await put(
      pins,
      (await readFile(pins, 'utf8'))
        .split('\n')
        .filter((l) => !l.endsWith(path))
        .join('\n'),
    );
    await rm(join(f.input, path));
    await exec('git', ['-C', f.repo, 'add', '.']);
    await exec('git', [
      '-C',
      f.repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-qm',
      'test: generated cache without historical pin',
    ]);
    const executor = await withResult(f, async (result, context) => {
      const view = join(context.scratchRoot, 'prepared-inputs');
      await cp(context.exportRoot, view, { recursive: true });
      await put(join(view, path), bytes);
      result.generatedIntermediates = [
        {
          path,
          bytes: bytes.length,
          sha256: sha256(bytes),
          mime: 'application/json',
          kind: 'generated-intermediate',
          datasets: ['catalog', 'core'],
        },
      ];
    });
    const built = await buildRelease({
      ...f.options,
      commit: 'HEAD',
      executor: { ...executor, generatedIntermediates: [path] },
    });
    expect(built.manifest.inputs.some((f) => f.path === path)).toBe(false);
    expect(built.manifest.processing.generated_intermediates).toEqual([
      {
        path,
        bytes: bytes.length,
        sha256: sha256(bytes),
        mime: 'application/json',
        kind: 'generated-intermediate',
        datasets: ['catalog', 'core'],
        declaration: path,
        legacy_pin_sha256: null,
        origin: 'recorded-code-generation',
        originalPinVerified: false,
      },
    ]);
    await checkReleaseDirectory({ releaseRoot: built.outputRoot, inputRoot: f.input });
  });
  it.each(['FAIL', 'SKIP', 'absent', 'crash', 'empty', 'incomplete'])(
    'never installs a PASS package on %s validation',
    async (mode) => {
      const f = await fixture();
      const executor = await withResult(f, (result) => {
        if (mode === 'crash') throw Error('owned crash');
        if (mode === 'absent') result.validation.groups.pop();
        else if (mode === 'empty') result.validation.groups[0]!.checks = 0;
        else if (mode === 'incomplete')
          Object.assign(result.validation, { completeValidation: false });
        else result.validation.groups[0]!.status = mode as ValidationGroup['status'];
      });
      await expect(buildRelease({ ...f.options, executor })).rejects.toThrow();
      await expect(readFile(join(f.options.outputRoot, 'manifest.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );
  it('rejects absent output, output links, forged metadata and mutation of staged/code bytes', async () => {
    const f = await fixture();
    for (const mode of ['missing', 'symlink', 'hardlink', 'metadata', 'input', 'code']) {
      const executor = await withResult(f, async (_result, ctx) => {
        const path = join(ctx.candidateRoot, 'data/core.json');
        if (mode === 'missing') await rm(path);
        if (mode === 'symlink') {
          await rm(path);
          await symlink(join(f.input, 'data/originals/raw.txt'), path);
        }
        if (mode === 'hardlink') {
          await rm(path);
          await link(join(ctx.candidateRoot, 'data/catalog.json'), path);
        }
        if (mode === 'metadata')
          await put(join(ctx.candidateRoot, 'validation.json'), '{"passed":true}');
        if (mode === 'input' || mode === 'code') {
          const target = join(
            ctx.exportRoot,
            mode === 'input' ? 'data/originals/deep.txt' : 'helper.mjs',
          );
          await chmod(target, 0o600);
          await writeFile(target, 'tampered');
        }
      });
      await expect(
        buildRelease({ ...f.options, executor, outputRoot: join(f.root, mode) }),
      ).rejects.toThrow();
    }
    expect(await readFile(join(f.input, 'data/originals/deep.txt'), 'utf8')).toBe(
      'transitive raw\n',
    );
  });
  it('preflights source/checkout/output overlaps and every existing link before execution', async () => {
    const f = await fixture();
    for (const outputRoot of [
      f.input,
      join(f.input, 'new'),
      f.repo,
      join(f.repo, 'data/release/new'),
      f.root,
    ])
      await expect(buildRelease({ ...f.options, outputRoot })).rejects.toThrow('overlap');
    await symlink(join(f.root, 'missing'), join(f.root, 'broken'));
    await expect(
      buildRelease({ ...f.options, outputRoot: join(f.root, 'broken/child') }),
    ).rejects.toThrow(/Link/);
    const raw = join(f.input, 'data/originals/raw.txt');
    await link(raw, join(f.root, 'hardlink'));
    await expect(buildRelease(f.options)).rejects.toThrow(/link/);
  });
  it('never overwrites an earlier candidate or accepts receipt/output tampering', async () => {
    const f = await fixture();
    const result = await buildRelease(f.options);
    const receipt = join(result.outputRoot, 'receipt.json'),
      before = await readFile(receipt);
    await expect(buildRelease(f.options)).rejects.toThrow('already exists');
    expect(await readFile(receipt)).toEqual(before);
    const doc = JSON.parse(before.toString());
    doc.snapshot.sha256 = '0'.repeat(64);
    await writeFile(receipt, jsonBytes(doc));
    await expect(
      checkReleaseDirectory({ releaseRoot: result.outputRoot, inputRoot: f.input }),
    ).rejects.toThrow('receipt differs');
    await writeFile(receipt, before);
    await writeFile(join(result.outputRoot, 'data/core.json'), 'changed');
    await expect(
      checkReleaseDirectory({ releaseRoot: result.outputRoot, inputRoot: f.input }),
    ).rejects.toThrow();
  });
  it('refuses filesystem escape, network, child process and non-erasable/unsupported runtime work', async () => {
    const f = await fixture();
    for (const code of [
      "await import('node:https')",
      "await fetch('https://example.invalid')",
      "await import('node:child_process').then(m=>m.execFileSync('true'))",
      `await import('node:fs/promises').then(m=>m.writeFile(${JSON.stringify(join(f.root, 'escape'))},'no'))`,
    ]) {
      await put(
        join(f.repo, 'executor.mjs'),
        `export async function executeRelease(){${code};throw Error('unexpected')}`,
      );
      await exec('git', ['-C', f.repo, 'add', '.']);
      await exec('git', [
        '-C',
        f.repo,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=t@example.invalid',
        'commit',
        '-qm',
        'test: refused executor action',
      ]);
      await expect(buildRelease({ ...f.options, commit: 'HEAD' })).rejects.toThrow(
        'executor failed',
      );
    }
    await expect(readFile(join(f.root, 'escape'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('accepts authenticated source-client/1 version selection and rejects changed receipt/raw facts', async () => {
    const f = await fixture();
    const raw = 'data/originals/raw.txt',
      bytes = await readFile(join(f.input, raw)),
      version = 'versions/' + sha256(bytes) + '/' + raw;
    await put(join(f.input, version), bytes);
    await rm(join(f.input, raw));
    const payload = {
      schema: 'source-snapshot/1',
      identity: sha256(
        Buffer.concat([
          await readFile(join(f.repo, 'data/sources.yaml')),
          Buffer.from('\0'),
          await readFile(join(f.repo, 'data/originals.sha256')),
        ]),
      ),
      operation: 'collect',
      started: '2026-11-10T00:00:00Z',
      completed: '2026-11-10T00:00:00Z',
      complete: true,
      numericalValidation: 'not-run',
      historicalReconstruction: 'unverified',
      collected: [
        {
          source: 'raw',
          path: raw,
          status: 'ok',
          method: 'preserve',
          expected: sha256(bytes),
          file: version,
          sha256: sha256(bytes),
          bytes: bytes.length,
        },
      ],
    };
    const rawFile = 'raw/selected',
      wireFile = 'raw/wire';
    await put(join(f.input, rawFile), bytes);
    await put(join(f.input, wireFile), 'retained compressed response bytes');
    Object.assign(payload.collected[0]!, {
      raw: [
        {
          file: rawFile,
          sha256: sha256(bytes),
          bytes: bytes.length,
          wireFile,
          wireSha256: sha256('retained compressed response bytes'),
        },
      ],
    });
    const receiptBytes = Buffer.from(JSON.stringify(payload) + '\n'),
      receipt = 'receipts/' + sha256(receiptBytes) + '.json';
    await put(join(f.input, receipt), receiptBytes);
    await put(join(f.input, 'snapshot.json'), JSON.stringify({ ...payload, receipt }) + '\n');
    const built = await buildRelease(f.options);
    expect(built.manifest.processing.snapshot).toMatchObject({
      acquisitionSha256: sha256(await readFile(join(f.input, 'snapshot.json'))),
      acquisitionReceipt: receipt,
    });
    const replay = await reproduceRelease({
      ...f.options,
      releaseRoot: built.outputRoot,
      outputRoot: join(f.root, 'version-replay'),
    });
    expect(replay.releaseId).toBe(built.releaseId);
    await writeFile(join(f.input, wireFile), 'tampered wire');
    await expect(
      buildRelease({ ...f.options, outputRoot: join(f.root, 'bad-wire') }),
    ).rejects.toThrow('wire bytes changed');
    await writeFile(join(f.input, wireFile), 'retained compressed response bytes');
    await writeFile(join(f.input, receipt), 'changed');
    await expect(
      buildRelease({ ...f.options, outputRoot: join(f.root, 'bad-snapshot') }),
    ).rejects.toThrow('receipt mismatch');
  });
  it('requires all pinned wildcard members even when other glob matches remain', async () => {
    const f = await fixture();
    f.source.sources[0]!.files = [{ path: 'data/originals/*.txt' }];
    await put(join(f.repo, 'data/sources.yaml'), JSON.stringify(f.source));
    await exec('git', ['-C', f.repo, 'add', '.']);
    await exec('git', [
      '-C',
      f.repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-qm',
      'test: wildcard source',
    ]);
    await rm(join(f.input, 'data/originals/deep.txt'));
    await expect(buildRelease({ ...f.options, commit: 'HEAD' })).rejects.toThrow(
      'Missing declared input: data/originals/deep.txt',
    );
  });
  it('uses native Node 24 erasable TypeScript from the export without installing or compiling current code', async () => {
    const f = await fixture();
    await put(
      join(f.repo, 'executor.ts'),
      producer.replace(
        'executeRelease(ctx)',
        'executeRelease(ctx: {exportRoot:string;candidateRoot:string})',
      ),
    );
    await exec('git', ['-C', f.repo, 'add', '.']);
    await exec('git', [
      '-C',
      f.repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-qm',
      'test: recorded erasable TypeScript',
    ]);
    const executor = recordedNodeExecutor({ entry: 'executor.ts', id: 'native-typescript-test' });
    const built = await buildRelease({ ...f.options, commit: 'HEAD', executor });
    expect(built.manifest.processing.executor).toMatchObject({
      entry: 'executor.ts',
      entry_sha256: sha256(await readFile(join(f.repo, 'executor.ts'))),
    });
  });
  it('never installs a mismatching reproduction or silently changes dependency locks', async () => {
    const f = await fixture();
    const built = await buildRelease(f.options);
    const executor = await withResult(f, async (_result, ctx) => {
      await writeFile(join(ctx.candidateRoot, 'data/core.json'), '{}');
    });
    const outputRoot = join(f.root, 'mismatching-replay');
    await expect(
      reproduceRelease({ ...f.options, executor, releaseRoot: built.outputRoot, outputRoot }),
    ).rejects.toThrow('Reproduction differs');
    await expect(readFile(join(outputRoot, 'receipt.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await put(join(f.root, 'dependencies/pnpm-lock.yaml'), 'different lock');
    await expect(
      buildRelease({
        ...f.options,
        outputRoot: join(f.root, 'lock-mismatch'),
        executor: { ...f.executor, dependenciesRoot: join(f.root, 'dependencies') },
      }),
    ).rejects.toThrow('dependencies differ');
  });
  it.each(['unsafe-input', 'declared-overlap'])(
    'rejects %s before invoking the executor',
    async (mode) => {
      const f = await fixture();
      if (mode === 'unsafe-input') {
        const path = 'data/originals/raw:unsafe.txt',
          bytes = 'first raw\n';
        f.source.sources[0]!.files[0] = { path };
        await put(join(f.input, path), bytes);
        await writeFile(
          join(f.repo, 'data/originals.sha256'),
          (await readFile(join(f.repo, 'data/originals.sha256'), 'utf8')) +
            sha256(bytes) +
            '  ' +
            path +
            '\n',
        );
        await put(join(f.repo, 'data/sources.yaml'), JSON.stringify(f.source));
      } else {
        f.datasets.datasets[0]!.files = ['data/release/originals/raw.txt'];
        await put(join(f.repo, 'data/datasets.yaml'), JSON.stringify(f.datasets));
      }
      await exec('git', ['-C', f.repo, 'add', '.']);
      await exec('git', [
        '-C',
        f.repo,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=t@example.invalid',
        'commit',
        '-qm',
        'test: invalid input/output contract',
      ]);
      let invoked = false;
      const executor: ReleaseExecutor = {
        identity: f.executor.identity,
        async execute() {
          invoked = true;
          throw Error('must not execute');
        },
      };
      await expect(buildRelease({ ...f.options, commit: 'HEAD', executor })).rejects.toThrow();
      expect(invoked).toBe(false);
    },
  );
  it('keeps historical Python replay explicit and never invokes a Node executor for it', async () => {
    const f = await fixture();
    const built = await buildRelease(f.options);
    const m = structuredClone(built.manifest);
    delete m.processing.executor;
    await writeFile(join(built.outputRoot, 'manifest.json'), jsonBytes(m));
    await expect(
      reproduceRelease({
        ...f.options,
        releaseRoot: built.outputRoot,
        outputRoot: join(f.root, 'historical'),
      }),
    ).rejects.toThrow('Historical runtime unsupported');
  });
});
