import { expect, it } from 'vitest';
import { pythonFloatSum } from './numbers.js';
import { pythonFloat } from '../build/context.js';

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
