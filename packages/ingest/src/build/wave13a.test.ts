import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { loadWave13aFixture } from './wave13a-fixture.js';
import { validateProvenance } from './wave13a.js';
const fixtures = resolve(import.meta.dirname, '../../test/fixtures');
const read = (name: string) => JSON.parse(readFileSync(resolve(fixtures, 'wave13a', name), 'utf8'));
it('matches all six independent final and published owners and checks their complete provenance graph', async () => {
  const outputs = await loadWave13aFixture(fixtures, '2026-11-08');
  for (const [name, value] of Object.entries(outputs)) {
    expect(value).toEqual(read(`final/${name}`));
    expect(value).toEqual(read(`published/${name}`));
  }
  validateProvenance(outputs);
  const entries = outputs['budget2027-provenance.json'].entries;
  const [id, entry] = Object.entries(entries).find(
    ([, value]: any) => value.operands?.length > 1,
  ) as [string, any];
  const original = entry.operands;
  entry.operands = [original[0], original[0]];
  expect(() => validateProvenance(outputs)).toThrow(/operand/);
  entry.operands = ['missing'];
  expect(() => validateProvenance(outputs)).toThrow(/operand/);
  entry.operands = original;
  const output = entry.output;
  entry.output = 'outlook.json#/missing';
  expect(() => validateProvenance(outputs)).toThrow(/provenance/);
  entry.output = output;
  expect(id).toBeTruthy();
});
