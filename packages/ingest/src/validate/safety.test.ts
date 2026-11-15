import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  linkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { main } from './cli.js';
import { Context, safePath, strictJson } from './context.js';
import { inputs } from './foundations.js';
import { script, validateRegistry } from './registry.js';
import { runWave14 } from './runner.js';

function make(root: string, rel: string, bytes: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, bytes);
}
function fixture(root: string): void {
  const seed = 'independent real file\n',
    hash = createHash('sha256').update(seed).digest('hex');
  make(root, 'data/inputs/seed.txt', seed);
  make(root, 'data/originals.sha256', `${hash}  data/inputs/seed.txt\n`);
  make(root, 'apps/example/src/producer.ts', 'export const ok = true;\n');
  make(root, 'docs/schema.md', 'schema');
  const source = {
    schema: 1,
    sources: [
      {
        id: 'src',
        title: 'source',
        access: 'supplied',
        acquisition: 'supplied',
        files: [{ path: 'data/inputs/seed.txt' }],
      },
    ],
    intermediates: [],
  };
  const base = {
    status: 'real',
    producer: 'apps/example/src/producer.ts',
    inputs: ['src'],
    schema: 'docs/schema.md',
    scope: 'test',
    rebuild: 'yes',
    sources: ['src'],
  };
  const datasets = {
    schema: 1,
    datasets: [
      {
        ...base,
        id: 'item',
        files: ['data/release/item.json'],
        catalogId: 'D01',
        screens: ['S01'],
      },
      { ...base, id: 'catalog', files: ['data/release/catalog.json'] },
    ],
  };
  const catalog = {
    meta: { status: 'real' },
    datasets: [
      { slug: 'item', id: 'D01', status: 'real', file: 'data/item.json', screens: ['S01'] },
    ],
    files: [],
  };
  make(root, 'data/sources.yaml', JSON.stringify(source));
  make(root, 'data/datasets.yaml', JSON.stringify(datasets));
  make(root, 'data/release/catalog.json', JSON.stringify(catalog));
  make(root, 'data/release/item.json', JSON.stringify({ meta: { status: 'real' } }));
}
it('checks real file hashes, producer paths, ownership and tracked code', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-registry-'));
  try {
    fixture(root);
    const opts = { trackedPaths: ['apps/example/src/producer.ts'] };
    expect(inputs(new Context(root)).problems).toEqual([]);
    expect(validateRegistry(root, opts).errors).toEqual([]);
    for (const place of ['parser', 'producer', 'layer', 'intermediate']) {
      fixture(root);
      const sources = JSON.parse(readFileSync(join(root, 'data/sources.yaml'), 'utf8'));
      const datasets = JSON.parse(readFileSync(join(root, 'data/datasets.yaml'), 'utf8'));
      const path = 'apps/example/src/untracked.ts';
      make(root, path, 'export const ok = true;\n');
      if (place === 'parser') sources.sources[0].parser = path;
      else if (place === 'producer') datasets.datasets[0].producer = path;
      else if (place === 'layer') datasets.datasets[0].layers = [path];
      else
        sources.intermediates.push({
          path: 'data/inputs/seed.txt',
          producer: path,
          reproducible: true,
        });
      make(root, 'data/sources.yaml', JSON.stringify(sources));
      make(root, 'data/datasets.yaml', JSON.stringify(datasets));
      expect(validateRegistry(root, opts).errors).toContain(
        `registry module is not tracked: ${path}`,
      );
    }
    fixture(root);
    make(root, 'data/inputs/seed.txt', 'changed');
    expect(inputs(new Context(root)).problems).toContain(
      'pinned input files changed: data/inputs/seed.txt',
    );
    make(root, 'apps/example/src/producer.ts', "const a = '/home/test/private/file';\n");
    expect(validateRegistry(root, opts).errors).toContain(
      "apps/example/src/producer.ts:1: an absolute path of a machine: const a = '/home/test/private/file';",
    );
    expect(script('apps/example/src/producer.ts')).toBe('apps/example/src/producer.ts');
    for (const entry of [
      "python -m 'budget_pipeline.example' --flag",
      'apps/../../outside.ts',
      'node apps/example/src/producer.ts',
    ])
      expect(() => script(entry)).toThrow('TypeScript module path');
    const source = JSON.parse(readFileSync(join(root, 'data/sources.yaml'), 'utf8'));
    source.sources[0].files[0].path = '../outside';
    make(root, 'data/sources.yaml', JSON.stringify(source));
    expect(() => validateRegistry(root, opts)).toThrow('unsafe registry path');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('names current TypeScript producers by path and retired ones by repository and commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-registry-producers-'));
  // the developer's own Git configuration (signing, hooks) stays out of the temporary repository
  const git = (args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    }).trim();
  let commit: string;
  const past = (extra: Record<string, unknown> = {}) => ({
    repository: 'https://github.com/midt-bg/sigma-budget',
    commit,
    path: 'pipeline/budget_pipeline/extract/example.py',
    ...extra,
  });
  try {
    fixture(root);
    const historicalPath = past().path;
    make(root, historicalPath, '# frozen producer\n');
    git(['init', '-q']);
    git(['add', '.']);
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'test fixture',
    ]);
    commit = git(['rev-parse', 'HEAD']);
    rmSync(join(root, historicalPath));
    make(root, 'data/inputs/frozen.json', '{}\n');
    const opts = { trackedPaths: ['apps/example/src/producer.ts'] };
    const read = (name: string) => JSON.parse(readFileSync(join(root, name), 'utf8'));
    const edit = (
      change: (sources: any, datasets: any) => void,
    ): ReturnType<typeof validateRegistry> => {
      fixture(root);
      const sources = read('data/sources.yaml'),
        datasets = read('data/datasets.yaml');
      sources.intermediates.push({
        path: 'data/inputs/frozen.json',
        producer: past(),
        inputs: ['src'],
        reproducible: false,
        pinned: false,
      });
      change(sources, datasets);
      make(root, 'data/sources.yaml', JSON.stringify(sources));
      make(root, 'data/datasets.yaml', JSON.stringify(datasets));
      return validateRegistry(root, opts);
    };
    expect(edit(() => {}).errors).toEqual([]);
    expect(edit(() => {}).notes).toBeUndefined();
    for (const extra of [{ commit: '0'.repeat(40) }, { path: 'pipeline/missing.py' }]) {
      const producer = past(extra);
      for (const owner of ['intermediate', 'dataset']) {
        const result = edit((s, d) => {
          if (owner === 'intermediate') s.intermediates[0].producer = producer;
          else Object.assign(d.datasets[0], { producer, rebuild: null, notRebuilt: 'retired' });
        });
        expect(result.errors).toEqual([
          `historical producer commit/path does not exist: ${producer.commit}:${producer.path}`,
        ]);
      }
    }
    // a commit that holds the file but is on no branch (a loose object, a branch squashed away) is not history
    const loose = git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit-tree',
      commit + '^{tree}',
      '-m',
      'not on a branch',
    ]);
    expect(edit((s) => (s.intermediates[0].producer = past({ commit: loose }))).errors).toEqual([
      `historical producer commit is not in the history of HEAD: ${loose}`,
    ]);
    expect(
      edit((s) => (s.sources[0].parser = 'apps/example/src/producer.ts, apps/example/src/gone.ts'))
        .errors,
    ).toEqual(['source src: parser apps/example/src/gone.ts does not exist']);
    expect(edit((s) => (s.sources[0].parser = ['apps/example/src/producer.ts'])).errors).toEqual([
      'source src: parser must be text',
    ]);
    expect(edit((_, d) => (d.datasets[0].producer = 'apps/example/src/gone.ts')).errors).toEqual([
      'dataset item: producer apps/example/src/gone.ts does not exist',
    ]);
    expect(edit((_, d) => (d.datasets[0].layers = ['apps/example/src/gone.ts'])).errors).toEqual([
      'dataset item: layer apps/example/src/gone.ts does not exist',
    ]);
    expect(edit((s) => (s.intermediates[0].reproducible = true)).errors).toEqual([
      'intermediate data/inputs/frozen.json: reproducible, but its producer exists only in history',
    ]);
    expect(
      edit((s) => {
        s.intermediates[0].producer = null;
        s.intermediates[0].historical_producer = 'reference/prototype/tools/example.py';
      }).errors,
    ).toEqual([
      'intermediate data/inputs/frozen.json: historical_producer is replaced by a producer with repository, commit and path',
    ]);
    expect(edit((_, d) => (d.datasets[0].producer = past())).errors).toEqual([
      'dataset item: a producer that exists only in history cannot rebuild it (rebuild null, notRebuilt says why)',
    ]);
    expect(
      edit((_, d) =>
        Object.assign(d.datasets[0], {
          producer: past(),
          rebuild: null,
          notRebuilt: 'the producer is retired',
        }),
      ).errors,
    ).toEqual([]);
    for (const [producer, message] of [
      ['python -m budget_pipeline.example', 'TypeScript module path'],
      ['packages/ingest/src/production/taxes.test.ts', 'TypeScript module path'],
      ['packages/ingest/dist/production/taxes.js', 'TypeScript module path'],
      ['docs/schema.md', 'TypeScript module path'],
      [past({ commit: commit.slice(0, 8) }), 'full commit'],
      [past({ repository: 'http://github.com/midt-bg/sigma-budget' }), 'repository'],
      [past({ repository: 'https://github.com/example/unrelated' }), 'repository'],
      [past({ path: '../outside.py' }), 'unsafe historical producer path'],
      [past({ path: '/abs/outside.py' }), 'unsafe historical producer path'],
      [past({ note: 'extra' }), 'exactly repository, commit and path'],
    ] as const)
      expect(() => edit((s) => (s.intermediates[0].producer = producer))).toThrow(message);
    // Real shallow Git metadata: missing older objects cannot be distinguished from typos here.
    make(root, '.git/shallow', commit + '\n');
    const shallow = edit((s) => (s.intermediates[0].producer = past({ commit: '0'.repeat(40) })));
    expect(shallow.errors).toEqual([]);
    expect(shallow.notes).toEqual([
      'Historical producer commit/path verification skipped: shallow checkout',
    ]);
    rmSync(join(root, '.git'), { recursive: true });
    const exported = edit(() => {});
    expect(exported.errors).toEqual([]);
    expect(exported.notes).toEqual([
      'Historical producer commit/path verification skipped: exported tree has no Git history',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('rejects path traversal and symlink escapes, including dangling symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-path-'));
  try {
    symlinkSync('/does-not-exist', join(root, 'link'));
    for (const path of ['../elsewhere', '/etc/passwd', 'data/../../elsewhere', 'link/child'])
      expect(() => safePath(root, path)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('treats nonfinite JSON constants as errors while leaving strings alone', () => {
  expect(strictJson('{"x":"NaN"}')).toEqual({ x: 'NaN' });
  for (const v of ['NaN', 'Infinity', '-Infinity'])
    expect(() => strictJson(`{"x":${v}}`)).toThrow(`non-finite number ${v} in JSON`);
});
it('refuses linked reports without changing their external targets', () => {
  mkdirSync(resolve('tmp/ts-migration'), { recursive: true });
  const root = mkdtempSync(join(tmpdir(), 'sigma-report-input-'));
  const reports = mkdtempSync(resolve('tmp/ts-migration/wave14-report-'));
  const external = mkdtempSync(resolve('tmp/wave14-external-'));
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    fixture(root);
    const sentinel = join(external, 'sentinel.json');
    writeFileSync(sentinel, 'external sentinel\n');
    for (const [name, makeLink] of [
      ['hard.json', linkSync],
      ['symbolic.json', symlinkSync],
    ] as const) {
      const target = join(reports, name);
      makeLink(sentinel, target);
      expect(
        main(['--root', root, '--only', 'INPUTS', '--report', relative(process.cwd(), target)]),
      ).toBe(2);
      expect(readFileSync(sentinel, 'utf8')).toBe('external sentinel\n');
    }
  } finally {
    out.mockRestore();
    err.mockRestore();
    rmSync(reports, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
it('writes new and existing regular reports without changing unrelated files', () => {
  mkdirSync(resolve('tmp/ts-migration'), { recursive: true });
  const root = mkdtempSync(join(tmpdir(), 'sigma-report-regular-'));
  const reports = mkdtempSync(resolve('tmp/ts-migration/wave14-regular-'));
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    fixture(root);
    const target = join(reports, 'nested/report.json');
    const args = ['--root', root, '--only', 'INPUTS', '--report', relative(process.cwd(), target)];
    expect(main(args)).toBe(0);
    expect(JSON.parse(readFileSync(target, 'utf8')).status).toBe('PASS');
    writeFileSync(target, 'old report');
    expect(main(args)).toBe(0);
    expect(JSON.parse(readFileSync(target, 'utf8')).status).toBe('PASS');
  } finally {
    out.mockRestore();
    err.mockRestore();
    rmSync(reports, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
it('preserves pinned inputs and other context input trees, including an aliased root', () => {
  mkdirSync(resolve('tmp/ts-migration'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/ts-migration/wave14-input-trees-'));
  const aliases = mkdtempSync(join(tmpdir(), 'sigma-input-alias-'));
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    fixture(root);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', 'apps/example/src/producer.ts'], { cwd: root });
    const seed = '{"value":1}\n';
    make(root, 'data/inputs/seed.json', seed);
    const pins = join(root, 'data/originals.sha256');
    writeFileSync(
      pins,
      readFileSync(pins, 'utf8') +
        `${createHash('sha256').update(seed).digest('hex')}  data/inputs/seed.json\n`,
    );
    expect(main(['--root', root, '--only', 'INPUTS'])).toBe(0);
    const alias = join(aliases, 'root');
    symlinkSync(root, alias);
    for (const contextRoot of [root, alias]) {
      const target = join(root, 'data/inputs/seed.json');
      expect(
        main([
          '--root',
          contextRoot,
          '--only',
          'INPUTS',
          '--report',
          relative(process.cwd(), target),
        ]),
      ).toBe(2);
      expect(readFileSync(target, 'utf8')).toBe(seed);
    }
    const schema = 'tmp/ts-migration/custom-schema.json';
    make(root, schema, 'schema sentinel\n');
    const sourcesPath = join(root, 'data/sources.yaml');
    const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
    sources.sources[0].files.push({ path: 'data/inputs/seed.json' });
    writeFileSync(sourcesPath, JSON.stringify(sources));
    const registryPath = join(root, 'data/datasets.yaml');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.datasets[0].schema = schema;
    writeFileSync(registryPath, JSON.stringify(registry));
    const registryCode = main(['--root', root, '--only', 'REGISTRY']);
    expect(registryCode, String(out.mock.calls.at(-1)?.[0])).toBe(0);
    expect(
      main([
        '--root',
        root,
        '--only',
        'REGISTRY',
        '--report',
        relative(process.cwd(), join(root, schema)),
      ]),
    ).toBe(2);
    expect(readFileSync(join(root, schema), 'utf8')).toBe('schema sentinel\n');
    for (const tree of ['data/originals', 'pipeline', 'apps', 'docs', 'tests', '.github', '.git']) {
      const target = join(root, tree, 'sentinel.json');
      make(root, `${tree}/sentinel.json`, 'unchanged sentinel\n');
      expect(
        main(['--root', root, '--only', 'INPUTS', '--report', relative(process.cwd(), target)]),
      ).toBe(2);
      expect(readFileSync(target, 'utf8')).toBe('unchanged sentinel\n');
    }
  } finally {
    out.mockRestore();
    err.mockRestore();
    rmSync(aliases, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
it('reports explicit scope, unknown groups and safe CLI output paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-runner-'));
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    fixture(root);
    const ctx = new Context(root),
      result = runWave14(ctx, ['INPUTS']);
    expect(result.status).toBe('PASS');
    expect(result.completeValidation).toBe(false);
    expect(result.unported).toContain('CORE');
    expect(() => runWave14(ctx, ['CORE'])).toThrow('unknown or unported');
    expect(main(['--root', root, '--only', 'CORE'])).toBe(2);
    expect(
      main([
        '--root',
        root,
        '--only',
        'INPUTS',
        '--report',
        'tmp/ts-migration/../../data/release/bad.json',
      ]),
    ).toBe(2);
    expect(main(['--root', root, '--only', 'INPUTS'])).toBe(0);
  } finally {
    out.mockRestore();
    err.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
