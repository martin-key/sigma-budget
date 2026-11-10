import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, strictJson } from '../validate/context.js';
import { decodeKfp, logicalReceipt } from './loader.js';
it('keeps source/proto/routes rooted in the export and all dataset APIs in the candidate', () => {
  const root = mkdtempSync(join(tmpdir(), 'production-context-'));
  try {
    const source = join(root, 'source'),
      candidate = join(root, 'candidate');
    mkdirSync(join(source, 'data/inputs'), { recursive: true });
    mkdirSync(join(candidate, 'data/sub'), { recursive: true });
    writeFileSync(join(source, 'data/inputs/input.json'), '{"source":true}');
    writeFileSync(join(candidate, 'data/sub/output.json'), '{"candidate":true}');
    const ctx = new Context(source, '2026-11-10', 'data', candidate);
    expect(ctx.get('sub/output.json')).toEqual({ candidate: true });
    expect(ctx.exists('sub/output.json')).toBe(true);
    expect(ctx.dataFiles()).toEqual(['sub/output.json']);
    expect(ctx.dataDirectory('sub')).toEqual(['output.json']);
    expect(ctx.proto('input.json')).toEqual({ source: true });
    expect(() => ctx.bytes('../escape')).toThrow();
    expect(() => strictJson('\uFEFF{}')).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('normalizes only owned root paths in reader receipts', () => {
  expect(
    logicalReceipt(
      {
        registry: { path: '/owned/export/data/sources.yaml' },
        url: 'https://source.test/a',
        auxiliary: '/owned/scratch/outlook.json',
      },
      { root: '/owned/export', scratch: '/owned/scratch' },
    ),
  ).toEqual({
    registry: { path: 'export/data/sources.yaml' },
    url: 'https://source.test/a',
    auxiliary: 'scratch/outlook.json',
  });
});
it('does not accept magic-only XLS as an operational KFP decoder', () => {
  expect(() => decodeKfp(Buffer.from('d0cf11e0a1b11ae100000000', 'hex'))).toThrow();
});
