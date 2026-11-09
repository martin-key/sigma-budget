import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
