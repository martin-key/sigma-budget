import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { gzipSize } from './checks.js';

interface Evidence {
  name: string;
  group: string;
  hex: string;
  repeats: number;
  sha256: string;
  bytes: number;
  gzip: number;
}
const oracle: Evidence[] = JSON.parse(
  readFileSync(
    new URL('../../test/fixtures/validate17a/gzip-cache/oracle.json', import.meta.url),
    'utf8',
  ),
);
function data(test: Evidence): Buffer {
  const pattern = Buffer.from(test.hex, 'hex');
  const value = Buffer.alloc(pattern.length * test.repeats);
  if (pattern.length) value.fill(pattern);
  expect(value.length).toBe(test.bytes);
  expect(createHash('sha256').update(value).digest('hex')).toBe(test.sha256);
  return value;
}
function item(name: string): Evidence {
  return oracle.find((test) => test.name === name)!;
}

it('preserves frozen Python sizes for repeated content and distinct copies', () => {
  for (const test of oracle.filter((test) => test.group === 'small')) {
    const raw = data(test);
    expect(gzipSize(raw)).toBe(test.gzip);
    expect(gzipSize(raw)).toBe(test.gzip);
    expect(gzipSize(new Uint8Array(raw))).toBe(test.gzip);
  }
});

it('recomputes the size when the same mutable buffer changes', () => {
  const a = item('invalid-uniform'),
    b = item('invalid-varied');
  expect(a.gzip).not.toBe(b.gzip);
  const raw = data(a);
  expect(gzipSize(raw)).toBe(a.gzip);
  raw.set(data(b));
  expect(gzipSize(raw)).toBe(b.gzip);
  raw.set(data(a));
  expect(gzipSize(raw)).toBe(a.gzip);
});

it('distinguishes byte sequences that have identical decoded UTF-8 text', () => {
  const a = item('invalid-uniform'),
    b = item('invalid-varied');
  const first = data(a),
    second = data(b);
  expect(first.toString('utf8')).toBe(second.toString('utf8'));
  expect(a.gzip).not.toBe(b.gzip);
  expect(gzipSize(first)).toBe(a.gzip);
  expect(gzipSize(second)).toBe(b.gzip);
});

it('uses only the bytes of an offset view of a shared backing buffer', () => {
  const a = item('invalid-uniform'),
    b = item('invalid-varied');
  const backing = Buffer.concat([Buffer.from('prefix'), data(a), Buffer.from('suffix'), data(b)]);
  const first = new Uint8Array(backing.buffer, backing.byteOffset + 6, a.bytes);
  const second = new Uint8Array(backing.buffer, backing.byteOffset + 6 + a.bytes + 6, b.bytes);
  expect(gzipSize(first)).toBe(a.gzip);
  expect(gzipSize(second)).toBe(b.gzip);
});

// Preserve cache population/eviction order, but measure each 16 MiB compression
// separately: the combined stress case took 5.14s with V8 coverage.
describe('preserves sizes after many distinct inputs and cache-sized replacements', () => {
  it('processes all 300 distinct inputs', () => {
    for (const test of oracle.filter((test) => test.group === 'distinct'))
      expect(gzipSize(data(test))).toBe(test.gzip);
  });
  for (const test of oracle.filter((test) => test.group === 'limit'))
    it(`replaces the cache with ${test.name}`, () => {
      expect(gzipSize(data(test))).toBe(test.gzip);
    });
  it('rechecks both original byte sequences after eviction', () => {
    for (const name of ['invalid-uniform', 'invalid-varied']) {
      const test = item(name);
      expect(gzipSize(data(test))).toBe(test.gzip);
    }
  });
});

describe('preserves the size of inputs larger than the cache budget', () => {
  const test = item('over-limit');
  let raw: Buffer;
  beforeAll(() => {
    raw = data(test);
  });
  it('compresses the over-limit buffer', () => {
    expect(gzipSize(raw)).toBe(test.gzip);
  });
  it('recompresses the same over-limit buffer', () => {
    expect(gzipSize(raw)).toBe(test.gzip);
  });
});
