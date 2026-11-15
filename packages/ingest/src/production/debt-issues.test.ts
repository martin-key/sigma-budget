import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { readPdf } from '../readers/pdf/index.js';
import { parseDebtIssues, validIsin } from './debt-issues.js';
import { isPublishedDataset } from '@sigma-budget/dataset-schema';
const path = resolve(
  import.meta.dirname,
  '../../../../data/originals/debt/Bulletin_GovDebt_09-2026_bg.pdf',
);
const pdf = readPdf(readFileSync(path));
const result = parseDebtIssues(pdf, '2026-11-14');
it('reads all pinned tables with exact units and source identities', () => {
  expect(isPublishedDataset('debt-issues.json', result)).toBe(true);
  expect(result.domestic).toHaveLength(13);
  expect(result.external).toHaveLength(17);
  expect(result.auctions).toHaveLength(12);
  expect(result.external.filter((r) => r.currency === 'USD')).toHaveLength(1);
  expect(result.external.every((r) => !Object.hasOwn(r, 'eur'))).toBe(true);
  expect(result.validation.every((r) => r.outcome === 'неизпълнимо')).toBe(true);
  expect(result.maturity[0]).not.toHaveProperty('originalTenths');
});
it('checks ISIN formats and check digits', () => {
  for (const isin of result.domestic
    .map((r) => r.isin)
    .concat(result.external.flatMap((r) => r.isins))) {
    expect(validIsin(isin)).toBe(true);
    expect(validIsin(isin.slice(0, -1) + ((Number(isin.at(-1)) + 1) % 10))).toBe(false);
  }
  expect(validIsin('invalid')).toBe(false);
});
for (const [name, page, from, to] of [
  ['domestic amount', 6, '450 000.00', '451 000.00'],
  ['auction amount', 7, '150 000.00', '151 000.00'],
  ['stock total', 4, '6 530.4', '6 531.4'],
  ['maturity bucket', 5, '27.1%', '27.2%'],
  ['reopening total', 13, '2 300 000 000', '2 400 000 000'],
  ['ISIN check digit', 6, 'BG2030026111', 'BG2030026112'],
  ['maturity date', 6, '21.01.2028', '21.01.2025'],
  ['issue count', 6, 'BG2030026111', 'XX2030026111'],
] as const)
  it('rejects changed PDF text: ' + name, () => {
    const d = structuredClone(pdf);
    let changed = false;
    for (const b of d.pages[page]!.blocks)
      for (const l of b.lines)
        for (const s of l.spans) {
          const chars = s.chars;
          if (name === 'stock total' && (chars[0]?.origin[1] ?? 0) < 300) continue;
          const text = chars.map((c) => c.text).join('');
          const at = text.indexOf(from);
          if (at >= 0 && !changed) {
            expect(from.length).toBe(to.length);
            for (let i = 0; i < from.length; i++) chars[at + i]!.text = to[i]!;
            changed = true;
          }
        }
    expect(changed, 'physical source token not found: ' + from).toBe(true);
    expect(() => parseDebtIssues(d, '2026-11-14')).toThrow();
  });
it('rejects a different source SHA and incomplete document', () => {
  expect(() => parseDebtIssues({ ...pdf, sha256: '0'.repeat(64) }, '2026-11-14')).toThrow(
    'Unregistered',
  );
  expect(() => parseDebtIssues({ ...pdf, pages: pdf.pages.slice(1) }, '2026-11-14')).toThrow(
    'page count',
  );
});
