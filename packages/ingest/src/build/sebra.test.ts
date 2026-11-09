import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSebra, parseSebraDay, type SebraEvidence } from './sebra.js';
const root = fileURLToPath(new URL('../../test/fixtures/debt-local/', import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(root + name, 'utf8'));
const evidence = () => read('inputs/reader-captures.json') as SebraEvidence;
describe('SEBRA frozen source', () => {
  it.each([-1, 0, 0.5, NaN])('rejects an invalid present file size: %s', (bytes) => {
    const e = evidence();
    e.files['2026-08-27']!.bytes = bytes;
    e.listing.files[0]!.sizeKb = 0;
    expect(() => buildSebra(e, '2026-11-08')).toThrow(/size/);
  });
  it('requires the actually latest listed file, independently of the supplied summary', () => {
    const e = evidence();
    e.latest = '2026-08-27';
    const day = parseSebraDay(e.files[e.latest]!.rows);
    e.latestExpected = { count: day.count, eur: day.eur };
    delete e.files['2026-08-31'];
    expect(() => buildSebra(e, '2026-11-08')).toThrow(/Latest/);
  });
  it('accepts Python text whitespace in ministry and organisation titles', () => {
    const rows = evidence().files['2026-08-27']!.rows;
    const expected = parseSebraDay(structuredClone(rows));
    for (const row of rows)
      if (row.C?.startsWith('Период:')) row.A = row.A!.replaceAll(' ', '\u0085');
    expect(parseSebraDay(rows)).toEqual(expected);
  });
  it('rejects balanced negative counts', () => {
    const rows = evidence().files['2026-08-27']!.rows;
    for (const row of rows)
      if (/^\d+$/.test(row.C || '') && row.D !== undefined) row.C = '-' + row.C;
    expect(() => parseSebraDay(rows)).toThrow(/count/);
  });
  it('rejects different ministry codes even when ministry names are equal', () => {
    const e = evidence();
    const title = e.files['2026-08-27']!.rows.find((r) => r.A?.includes('075*******'))!;
    title.A = title.A!.replace('075*******', '999*******');
    expect(() => buildSebra(e, '2026-11-08')).toThrow(/ministry/);
  });
  it.each(['', '1 xxxx', '10 xxx', '10 xxxx extra'])(
    'rejects an invalid category code: %j',
    (code) => {
      const rows = evidence().files['2026-08-27']!.rows;
      for (const row of rows) if (row.A === '10 xxxx') row.A = code;
      expect(() => parseSebraDay(rows)).toThrow(/category code/);
    },
  );
  it('rejects an impossible calendar day in both rows and listing', () => {
    const rows = evidence().files['2026-08-27']!.rows;
    for (const row of rows)
      if (row.C?.startsWith('Период:')) row.C = 'Период: 31.02.2026 - 31.02.2026';
    expect(() => parseSebraDay(rows)).toThrow(/calendar/);
    const e = evidence();
    e.listing.files[0]!.day = '2026-02-31';
    expect(() => buildSebra(e, '2026-11-08')).toThrow(/listing/);
  });
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
  it.each([undefined, null, false, 0])('rejects present invalid optional evidence: %s', (value) => {
    const e = evidence();
    (e.files as Record<string, unknown>)['2026-08-27'] = value;
    expect(() => buildSebra(e, '2026-11-08')).toThrow(/Invalid SEBRA file/);
  });
  it('accepts Python whitespace and signed count spellings without changing totals', () => {
    const e = evidence();
    const expected = parseSebraDay(structuredClone(e.files['2026-08-31']!.rows));
    for (const row of e.files['2026-08-31']!.rows) {
      if (/^\d+$/.test(row.C || '') && /^[\d.]+$/.test(row.D || '')) {
        row.C = ' \u00a0+' + row.C + '\u00a0 ';
        row.D = ' \u00a0' + row.D + '\u00a0 ';
      }
    }
    expect(parseSebraDay(e.files['2026-08-31']!.rows)).toEqual(expected);
  });
  it('accepts Python digit separators and decimal digits without changing totals', () => {
    const rows = evidence().files['2026-08-31']!.rows;
    const expected = parseSebraDay(structuredClone(rows));
    for (const row of rows) {
      if (/^\d+$/.test(row.C || '') && /^[\d.]+$/.test(row.D || '')) {
        row.C = '+' + row.C!.replace(/(?<=\d)(?=\d)/g, '_');
        row.D = row.D!.replace(/\d/g, (digit) => String.fromCodePoint(0xff10 + Number(digit)));
      }
    }
    expect(parseSebraDay(rows)).toEqual(expected);
  });
  it('normalizes signed zero counts like Python int', () => {
    const rows = evidence().files['2026-08-31']!.rows;
    let changed = 0;
    for (const row of rows)
      if (/^\d+$/.test(row.C || '') && /^[\d.]+$/.test(row.D || '')) {
        row.C = '-0';
        row.D = '0';
        changed++;
      }
    expect(changed).toBeGreaterThan(0);
    const actual = parseSebraDay(rows);
    for (const item of [
      actual,
      ...actual.byCode,
      ...actual.byOrganisation,
      ...actual.byOrganisation.flatMap((o) => o.byCode),
    ])
      expect(item.count).toBe(0);
  });
  it.each(['', ' ', '0x10', 'nan', 'inf', '1__0', '\ufeff1', '\u001c1'])(
    'rejects invalid or non-finite amounts: %j',
    (text) => {
      const rows = evidence().files['2026-08-31']!.rows;
      rows.find((r) => r.A === '10 xxxx')!.D = text;
      expect(() => parseSebraDay(rows)).toThrow(/Invalid SEBRA amount/);
    },
  );
  it.each(['', ' ', '0x10', '1.0', '1e1', '1__0', '\ufeff1', '\u001c1'])(
    'rejects noninteger count tokens: %j',
    (text) => {
      const rows = evidence().files['2026-08-31']!.rows;
      rows.find((r) => r.A === '10 xxxx')!.C = text;
      expect(() => parseSebraDay(rows)).toThrow(/Invalid SEBRA count/);
    },
  );
});
