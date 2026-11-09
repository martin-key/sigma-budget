import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSebra, parseSebraDay, type SebraEvidence } from './sebra.js';
const root = fileURLToPath(new URL('../../test/fixtures/debt-local/', import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(root + name, 'utf8'));
const evidence = () => read('inputs/reader-captures.json') as SebraEvidence;
describe('SEBRA frozen source', () => {
  it('matches the independent Python output completely', () => {
    expect(buildSebra(evidence(), '2026-11-08')).toEqual(read('donor/sebra.json'));
  });
  it('rejects damaged categories, sizes and periods and a missing latest file', () => {
    const e = evidence();
    e.files['2026-08-31']!.rows.find((r) => r.A === '10 xxxx')!.D = '1';
    expect(() => buildSebra(e, '2026-11-08')).toThrow();
    const size = evidence();
    size.files['2026-08-31']!.bytes += 1024;
    expect(() => buildSebra(size, '2026-11-08')).toThrow();
    const period = evidence();
    period.files['2026-08-31']!.rows.find((r) => r.C?.startsWith('Период:'))!.C =
      'Период: 30.08.2026 - 31.08.2026';
    expect(() => buildSebra(period, '2026-11-08')).toThrow();
    const missing = evidence();
    delete missing.files['2026-08-31'];
    expect(() => buildSebra(missing, '2026-11-08')).toThrow();
  });
  it('leaves missing optional days unavailable', () => {
    const e = evidence();
    delete e.files['2026-08-27'];
    const result = buildSebra(e, '2026-11-08') as any;
    expect(result.check.daysParsed).toBe(2);
    expect(result.publication.files[0]).toMatchObject({ bytes: null, parsed: false });
  });
  it('rejects an unfinished section', () =>
    expect(() => parseSebraDay([{ A: 'x', C: 'Период: 31.08.2026 - 31.08.2026' }])).toThrow());
});
