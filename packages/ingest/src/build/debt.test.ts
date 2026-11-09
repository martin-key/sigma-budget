import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJsonStat } from '../io/data.js';
import { loadAnnex } from './annex.js';
import { buildDebt, type DebtInput } from './debt.js';
const root = fileURLToPath(new URL('../../test/fixtures/debt-local/', import.meta.url));
const text = (n: string) => readFileSync(root + n, 'utf8');
const read = (n: string) => JSON.parse(text(n));
const input = (): DebtInput => {
  const t = read('inputs/data/originals/asbp/asbp_tables.json').tables,
    cap = read('inputs/reader-captures.json');
  return {
    table: t.VI_1,
    gdp: loadAnnex(t).gdp as number[],
    pages: read('inputs/data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json'),
    paragraphs: read('inputs/dv-blocks.json')
      .zdb.filter((b: [string, string]) => b[0] === 'p')
      .map((b: [string, string]) => b[1]),
    stock: read('inputs/data/inputs/debt_stock.json'),
    gdpCopy: read('inputs/data/inputs/debt_gdp.json'),
    annual: parseJsonStat(
      text('inputs/data/originals/eurostat/gov_10dd_edpt1_BG_EU.json'),
    ) as DebtInput['annual'],
    quarterly: parseJsonStat(
      text('inputs/data/originals/eurostat/gov_10q_ggdebt_BG.json'),
    ) as DebtInput['quarterly'],
    bnbGg: cap.bnbGg,
    bnbCg: cap.bnbCg,
    revisions: cap.revisions,
    execution: read('inputs/execution.json'),
  };
};
describe('Debt frozen sources', () => {
  it('matches the complete independent Python output', () =>
    expect(buildDebt(input(), '2026-11-08')).toEqual(read('donor/debt.json')));
  it('rejects discrepancies in copies, unlisted revisions, quarter coverage and law evidence', () => {
    const a = input();
    a.stock.state_debt.mln_eur[0]! += 1;
    expect(() => buildDebt(a, '2026-11-08')).toThrow();
    const b = input();
    b.gdpCopy.BG!['2020']! += 1;
    expect(() => buildDebt(b, '2026-11-08')).toThrow();
    const c = input();
    c.bnbGg.mln[0]! += 1;
    expect(() => buildDebt(c, '2026-11-08')).toThrow();
    const d = input();
    d.paragraphs = [];
    expect(() => buildDebt(d, '2026-11-08')).toThrow();
  });
});
