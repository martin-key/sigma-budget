import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { object } from '@sigma-budget/dataset-schema';
import { buildMeasures, type MeasureSource, type MeasureExcerpts } from './measures.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/fiscal');
const read = (s: string) => JSON.parse(readFileSync(resolve(root, s), 'utf8'));
const source = (): MeasureSource => read('inputs/data/inputs/measures_2026.json');
const excerpts = (): MeasureExcerpts => read('inputs/data/inputs/measure_excerpts.json');
it('reproduces the independent measures donor and published result', () => {
  const result = buildMeasures(source(), excerpts(), '2026-11-08');
  expect(result).toEqual(read('donor/measures.json'));
  expect(result).toEqual(read('oracle/measures.json'));
});
it('rejects changed sign and unsupported excerpt evidence', () => {
  const input = source();
  input.intro.revenue[0]!.signed_2026 *= -1;
  expect(() => buildMeasures(input, excerpts(), '2026-11-08')).toThrow(/sign contradicts/);
  const evidence = excerpts();
  evidence.kr1!.excerptEvidence.since!.quote = 'непотвърден текст';
  expect(() => buildMeasures(source(), evidence, '2026-11-08')).toThrow(/unverified/);
});
it('retains Part VIII legal quotations without inferring effective dates', () => {
  const input = source();
  input.part8.items[0]!.quote += ' считано от 1 януари 2027 г.';
  const result = buildMeasures(input, excerpts(), '2026-11-08');
  if (!Array.isArray(result.items)) throw new Error('Missing measures');
  const law = result.items.find((item) => object(item) && item.id === 'p8-1');
  expect(law).toMatchObject({ quote: input.part8.items[0]!.quote });
  expect(law).not.toHaveProperty('from');
});
