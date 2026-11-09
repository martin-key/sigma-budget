import { expect, it } from 'vitest';
import { parsePythonJson, pythonFloatSum, pythonNumberAt, pythonSum } from './numbers.js';
import { pythonFloat } from '../build/context.js';

// Independently evaluated with sum(json.loads(raw)) on CPython 3.12.14.
it.each([
  ['[1,15,6,28.99,0.34,23.21,3,27.61,8.08,3.22]', 116.44999999999999],
  ['[1.0,15.0,6.0,28.99,0.34,23.21,3.0,27.61,8.08,3.22]', 116.45],
  ['[1e0,15e0,6e0,28.99,0.34,23.21,3e0,27.61,8.08,3.22]', 116.45],
  ['[1e16,1,-1e16]', 0],
  ['[1e16,1.0,-1e16]', 1],
  ['[1,2,3]', 6],
  ['[9007199254740991,1,-9007199254740991]', 1],
] as const)('preserves Python mixed numeric tokens: %s', (raw, expected) => {
  const values = parsePythonJson<number[]>(raw);
  expect(pythonSum(values.map((v, i) => pythonNumberAt(values, String(i), v)))).toBe(expected);
});
it('does not reuse numeric type evidence after a cell value changes', () => {
  const values = parsePythonJson<number[]>('[1.0]');
  values[0] = 2;
  expect(pythonNumberAt(values, '0', values[0])).toEqual({ value: 2, kind: 'int' });
});
it('rejects integer source tokens that JavaScript would silently round', () => {
  expect(() => parsePythonJson('[9007199254740993]')).toThrow(/safe numeric range/);
});

// Expected values were evaluated with sum(map(float, values)) on Python 3.12.
it.each([
  [[0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], 1],
  [[1e16, 1, -1e16], 1],
  [[1e16, 1, 1, -1e16], 2],
] as [number[], number][])('matches Python 3.12 compensated sums: %j', (values, expected) => {
  expect(pythonFloatSum(values)).toBe(expected);
});
it.each(['\u001c28', '28\u001f', '\ufeff28'])(
  'rejects nonnumeric control characters accepted by generic trimming: %j',
  (text) => {
    expect(() => pythonFloat(text)).toThrow();
  },
);
