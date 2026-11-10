import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { clonePythonNumbers, pythonNumberAt } from '../common/numbers.js';
import { captureInputPaths, safePath, strictJson } from './context.js';
const oracle = JSON.parse(
  readFileSync(
    new URL('../../test/fixtures/validate17a/review/json-oracle.json', import.meta.url),
    'utf8',
  ),
);
for (const [index, test] of oracle.entries())
  it('matches frozen Python JSON decoding case ' + index, () => {
    let actual: unknown;
    try {
      actual = { value: strictJson(test.text) };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      actual = { error: error.name + ': ' + error.message };
    }
    expect(actual).toEqual(test.error ? { error: test.error } : { value: test.value });
  });
it('retains raw numeric kinds across cloning and ignores subsequently changed values', () => {
  const parsed = strictJson('{"x":[1,1.0,1e0],"b":true}') as any,
    copied = clonePythonNumbers(parsed);
  expect(copied).toEqual(parsed);
  expect(copied).not.toBe(parsed);
  expect([0, 1, 2].map((i) => pythonNumberAt(copied.x, String(i), copied.x[i]).kind)).toEqual([
    'int',
    'float',
    'float',
  ]);
  copied.x[1] = 2;
  expect(pythonNumberAt(copied.x, '1', 2).kind).toBe('int');
});
it('restores nested path observers while retaining rejected declarations', () => {
  const root = new URL('../../../../', import.meta.url).pathname;
  const outer = captureInputPaths(root, () => {
    const inner = captureInputPaths(root, () => {
      try {
        safePath(root, 'data/../report.json');
      } catch {
        /* captured rejection */
      }
    });
    expect(inner.rejectedPaths).toHaveLength(1);
    safePath(root, 'package.json');
  });
  expect(outer.rejectedPaths).toHaveLength(1);
  expect(outer.paths).toHaveLength(2);
  expect(captureInputPaths(root, () => 42).paths).toEqual([]);
});
