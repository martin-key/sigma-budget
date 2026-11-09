import { createHash } from 'node:crypto';
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
  make(root, 'pipeline/budget_pipeline/example.py', 'ok = True\n');
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
    producer: 'python -m budget_pipeline.example',
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
    const opts = { trackedPaths: ['pipeline/budget_pipeline/example.py'] };
    expect(inputs(new Context(root)).problems).toEqual([]);
    expect(validateRegistry(root, opts).errors).toEqual([]);
    make(root, 'data/inputs/seed.txt', 'changed');
    expect(inputs(new Context(root)).problems).toContain(
      'pinned input files changed: data/inputs/seed.txt',
    );
    make(root, 'pipeline/budget_pipeline/example.py', "a = '/home/test/private/file'\n");
    expect(validateRegistry(root, opts).errors).toContain(
      "pipeline/budget_pipeline/example.py:1: an absolute path of a machine: a = '/home/test/private/file'",
    );
    expect(script("python -m 'budget_pipeline.example' --flag")).toBe(
      'pipeline/budget_pipeline/example.py',
    );
    expect(() => script('python -m ../../outside')).toThrow('unsafe producer');
    const source = JSON.parse(readFileSync(join(root, 'data/sources.yaml'), 'utf8'));
    source.sources[0].files[0].path = '../outside';
    make(root, 'data/sources.yaml', JSON.stringify(source));
    expect(() => validateRegistry(root, opts)).toThrow('unsafe registry path');
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
