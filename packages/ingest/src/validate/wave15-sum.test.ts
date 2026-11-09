import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parsePythonJson, pythonNumberAt } from '../common/numbers.js';
import { pySum } from './python-error.js';
const home = new URL('../../test/fixtures/validate15/', import.meta.url);
const cases: string[] = JSON.parse(readFileSync(new URL('sum-cases.json', home), 'utf8'));
const expected: number[] = JSON.parse(readFileSync(new URL('sum-oracle.json', home), 'utf8'));
it('uses donor sums for float, integer, exponent and boolean token mixtures', () => {
  for (const [index, raw] of cases.entries()) {
    const values = parsePythonJson<(number | boolean)[]>(raw);
    const operands = values.map((value, key) =>
      typeof value === 'boolean'
        ? { value: Number(value), kind: 'int' as const }
        : pythonNumberAt(values, String(key), value),
    );
    expect(pySum(operands), raw).toBe(expected[index]);
  }
});
