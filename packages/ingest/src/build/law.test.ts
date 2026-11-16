import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, expectTypeOf, it } from 'vitest';
import { buildLaw, type LawEvidence, type LawDataset } from './law.js';
const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../test/fixtures/law', name), 'utf8'));
it('rejects wrong dates', () => {
  const e = fixture('evidence.json');
  e.parliament.zdb.L_Act_date = '2026-07-02';
  expect(() => buildLaw(e, '2026-11-08')).toThrow();
});
it('checks the optional Parliament archive size when present', () => {
  const evidence = fixture('evidence.json');
  evidence.archiveBytes = 63_000_000;
  expect(() => buildLaw(evidence, '2026-11-08')).not.toThrow();
  evidence.archiveBytes = 62_500_000;
  expect(() => buildLaw(evidence, '2026-11-08')).toThrow();
});

it('rejects a missing law amount in article 1 interest', () => {
  const evidence = fixture('evidence.json');
  const line = evidence.law.law['1'].lines.find(
    (row: [string, string]) => row[0] === 'II' && row[1] === '1.3',
  );
  expect(line).toBeDefined();
  line[3] = null;
  expect(() => buildLaw(evidence, '2026-11-08')).toThrow(/difference is not numeric/);
});

it('exposes structured input and output types', () => {
  expectTypeOf<LawEvidence['parliament']['zdb']['L_Act_sign']>().toEqualTypeOf<string>();
  expectTypeOf<LawEvidence['law']['sums']['budgets']>().toEqualTypeOf<number>();
  expectTypeOf<ReturnType<typeof buildLaw>>().toEqualTypeOf<LawDataset>();
  expectTypeOf<LawDataset['budgets'][number]['art']>().toEqualTypeOf<number>();
});
