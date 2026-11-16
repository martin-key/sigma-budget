import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { stateDebtTable, type StateDebtTableInput } from './fiscal.js';

const fixture = resolve(import.meta.dirname, '../../test/fixtures/fiscal');
const bytes = (name: string) => readFileSync(resolve(fixture, name));
const input = (): StateDebtTableInput => JSON.parse(bytes('vi-1-input.json').toString());
it('rejects missing, non-numeric, and inconsistent debt cells', () => {
  const missing = input();
  missing.rows = missing.rows.filter((row) => row.label !== 'БВП, млн. евро');
  expect(() => stateDebtTable(missing)).toThrow(/incomplete/);
  const blank = input();
  blank.rows.find((row) => row.label === 'Външен дълг, млн. евро')!.values[0] = null;
  expect(() => stateDebtTable(blank)).toThrow(/incomplete/);
  const inconsistent = input();
  inconsistent.rows.find((row) => row.label === 'Външен дълг, млн. евро')!.values[0]! += 1;
  expect(() => stateDebtTable(inconsistent)).toThrow(/external \+ domestic/);
});
