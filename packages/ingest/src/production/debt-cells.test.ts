import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { verifyDebtCells } from './debt-cells.js';
const root = resolve(import.meta.dirname, '../../../..');
const source = resolve(root, 'data/originals/debt/Bulletin_GovDebt_09-2026_bg.pdf');
const load = () => JSON.parse(readFileSync(resolve(root, 'data/release/debt-issues.json'), 'utf8'));
it('independently verifies every published debt table cell', () => {
  expect(() => verifyDebtCells(load(), source)).not.toThrow();
});
for (const [table, field] of [
  ['domestic', 'price'],
  ['auctions', 'price'],
  ['external', 'maturity'],
  ['domestic', 'coupon'],
  ['domestic', 'nominal'],
  ['domestic', 'isin'],
  ['auctions', 'yield'],
] as const)
  it(`rejects a changed ${table}.${field} through independent decoding`, () => {
    const d = load();
    const row = d[table][0];
    row[field] =
      typeof row[field] === 'number'
        ? field === 'nominal'
          ? row[field] + 1
          : Math.round(row[field] * 100 + 1) / 100
        : field === 'maturity'
          ? row[field].replace(/^\d{4}/, (y: string) => String(Number(y) + 1))
          : d.domestic[1].isin;
    expect(() => verifyDebtCells(d, source)).toThrow();
  });
