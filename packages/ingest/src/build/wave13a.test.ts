import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { loadWave13aFixture } from './wave13a-fixture.js';
import { validateProvenance } from './wave13a.js';
const fixtures = resolve(import.meta.dirname, '../../test/fixtures');
const read = (name: string) => JSON.parse(readFileSync(resolve(fixtures, 'wave13a', name), 'utf8'));
let outputs: Awaited<ReturnType<typeof loadWave13aFixture>>;
beforeAll(async () => {
  outputs = await loadWave13aFixture(fixtures, '2026-11-08');
});
const owners = [
  'outlook.json',
  'revenue.json',
  'expenditure.json',
  'budget2027.json',
  'budget2027-provenance.json',
  'law.json',
] as const;
it('contains exactly the six declared owners', () => {
  expect(Object.keys(outputs).sort()).toEqual([...owners].sort());
});
for (const name of owners)
  it(`matches the independent final and published ${name}`, () => {
    const value = outputs[name];
    expect(value).toEqual(read(`final/${name}`));
    expect(value).toEqual(read(`published/${name}`));
  });
it('checks the complete provenance graph and rejects altered references', () => {
  const changed = structuredClone(outputs);
  validateProvenance(changed);
  const entries = changed['budget2027-provenance.json'].entries;
  const [id, entry] = Object.entries(entries).find(
    ([, value]: any) => value.operands?.length > 1,
  ) as [string, any];
  const original = entry.operands;
  entry.operands = [original[0], original[0]];
  expect(() => validateProvenance(changed)).toThrow(/operand/);
  entry.operands = ['missing'];
  expect(() => validateProvenance(changed)).toThrow(/operand/);
  entry.operands = original;
  const output = entry.output;
  entry.output = 'outlook.json#/missing';
  expect(() => validateProvenance(changed)).toThrow(/provenance/);
  entry.output = output;
  expect(id).toBeTruthy();
});
