import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { budgetTablesGuard, stateBudgetGuard, kfpSubsectorsGuard } from './budget-tables.js';
import { budgetSourceCells } from './budget-source-cells.js';
import { isPublishedDataset } from './index.js';
const load = (name: string): any =>
  JSON.parse(readFileSync(new URL(`../../../data/release/${name}.json`, import.meta.url), 'utf8'));
const monthly = load('state-budget');
const quarterly = load('kfp-subsectors');
const reject = (name: string, change: (d: any) => void) => {
  for (const [label, original] of [
    ['monthly', monthly],
    ['quarterly', quarterly],
  ] as const)
    it(`rejects ${name}: ${label}`, () => {
      const d = structuredClone(original);
      change(d);
      expect(budgetTablesGuard(d)).toBe(false);
    });
};
it('accepts both complete published contracts and binds each filename', () => {
  expect(stateBudgetGuard(monthly)).toBe(true);
  expect(kfpSubsectorsGuard(quarterly)).toBe(true);
  expect(stateBudgetGuard(quarterly)).toBe(false);
  expect(kfpSubsectorsGuard(monthly)).toBe(false);
  expect(stateBudgetGuard(null)).toBe(false);
  expect(kfpSubsectorsGuard(null)).toBe(false);
  expect(isPublishedDataset('state-budget.json', quarterly)).toBe(false);
  expect(isPublishedDataset('kfp-subsectors.json', monthly)).toBe(false);
});
for (const value of [null, [], false, 'budget', 1])
  it(`rejects a non-object ${JSON.stringify(value)}`, () =>
    expect(budgetTablesGuard(value)).toBe(false));
for (const key of [
  'meta',
  'schema',
  'scope',
  'frequency',
  'tables',
  'sourceIntegerScale',
  'conversionRate',
  'unit',
  'notes',
  'limitations',
])
  reject('absent ' + key, (d) => delete d[key]);
for (const key of ['schema', 'scope', 'frequency', 'sourcePage', 'unit'])
  reject('wrong ' + key, (d) => (d[key] = 'unknown'));
for (const key of ['sourceIntegerScale', 'conversionRate'])
  reject('wrong ' + key, (d) => (d[key] = 1));
for (const key of ['notes', 'limitations']) reject('non-array ' + key, (d) => (d[key] = {}));
for (const [key, value] of [
  ['id', 'wrong'],
  ['status', 'pending'],
  ['mock', true],
])
  reject('wrong meta ' + key, (d) => (d.meta[key as string] = value));
reject('missing table', (d) => d.tables.pop());
reject('non-object table', (d) => (d.tables[0] = null));
for (const [key, value] of [
  ['file', '../source.xls'],
  ['sha256', 'bad'],
  ['scope', 'unknown'],
  ['year', 2023],
  ['period', 0],
  ['period', 13],
  ['columns', []],
  ['checks', { x: 0.1 }],
])
  reject('table ' + key + ' ' + JSON.stringify(value), (d) => (d.tables[0][key as string] = value));
reject('duplicate period', (d) => (d.tables[1] = structuredClone(d.tables[0])));
reject(
  'wrong table scope',
  (d) => (d.tables[0].scope = d.schema === 'state-budget/1' ? 'local' : 'state'),
);
reject('non-object column', (d) => (d.tables[0].columns[0] = null));
reject('wrong column unit', (d) => (d.tables[0].columns[0].unit = 'USD'));
reject('wrong column id', (d) => (d.tables[0].columns[0].id = 'unknown'));
reject('wrong source currency', (d) => (d.tables[0].columns[0].unit = 'EUR'));
reject('non-object row', (d) => (d.tables[0].rows[0] = false));
reject('duplicate row', (d) => (d.tables[0].rows[1] = structuredClone(d.tables[0].rows[0])));
reject(
  'missing required row',
  (d) => (d.tables[0].rows = d.tables[0].rows.filter((r: any) => r.row !== 10)),
);
reject('wrong row label', (d) => (d.tables[0].rows[0].label = 1));
for (const key of ['source', 'eur']) {
  reject('missing ' + key + ' cell', (d) => d.tables[0].rows[0][key].pop());
  reject('non-array ' + key, (d) => (d.tables[0].rows[0][key] = {}));
  reject('non-numeric ' + key, (d) => (d.tables[0].rows[0][key][0] = '0'));
}
reject('fractional source', (d) => (d.tables[0].rows[0].source[0] = 0.5));
reject('unsafe source', (d) => (d.tables[0].rows[0].source[0] = Number.MAX_SAFE_INTEGER + 1));
reject('wrong EUR conversion', (d) => (d.tables[0].rows[0].eur[0] += 1));
reject('null at a printed numeric position', (d) => {
  d.tables[0].rows[0].source[0] = null;
  d.tables[0].rows[0].eur[0] = null;
});
reject(
  'registered blank with different SHA',
  (d) =>
    (d.tables.find((t: any) => t.rows.some((r: any) => r.source.includes(null))).sha256 =
      '0'.repeat(64)),
);
reject('registered SHA with wrong file', (d) => (d.tables[0].file = 'different.xls'));
reject('registered SHA with wrong period', (d) => (d.tables[0].period = 2));
reject('registered SHA with wrong year', (d) => (d.tables[0].year = 2026));
reject('unregistered additional row', (d) =>
  d.tables[0].rows.push({ ...structuredClone(d.tables[0].rows[0]), row: 99 }),
);
reject(
  'replaced optional row',
  (d) => (d.tables[0].rows.find((r: any) => r.row === 53 || r.row === 54).row = 99),
);
reject(
  'blank with numeric EUR',
  (d) =>
    (d.tables
      .find((t: any) => t.rows.some((r: any) => r.source.includes(null)))
      .rows.find((r: any) => r.source.includes(null)).eur[0] = 1),
);
reject('numeric value at registered blank', (d) => {
  const t = d.tables.find((t: any) => t.rows.some((r: any) => r.source.includes(null)));
  const r = t.rows.find((r: any) => r.source.includes(null));
  const c = r.source.indexOf(null);
  r.source[c] = 0;
  r.eur[c] = 0;
});
it('rejects a fabricated central-government table for 2025', () => {
  const d = structuredClone(quarterly);
  const t = d.tables.find((t: any) => t.scope === 'central');
  t.year = 2025;
  expect(budgetTablesGuard(d)).toBe(false);
});
it('rejects a wrong registered subsector with otherwise valid period and columns', () => {
  const d = structuredClone(quarterly);
  d.tables[0].scope = 'local';
  d.tables[0].period = 4;
  d.tables = d.tables.filter(
    (t: any, i: number) => i === 0 || !(t.year === 2024 && t.scope === 'local'),
  );
  d.tables.push(structuredClone(quarterly.tables.at(-1)));
  expect(budgetTablesGuard(d)).toBe(false);
});
for (const missing of [
  undefined,
  {},
  [],
  [false],
  [{ year: 2024, scope: 'central', reason: 'missing' }],
  [{ year: 2025, scope: 'local', reason: 'missing' }],
  [{ year: 2025, scope: 'central' }],
])
  it('rejects malformed missing-table disclosure ' + JSON.stringify(missing), () => {
    const d = structuredClone(quarterly);
    d.missing = missing;
    expect(budgetTablesGuard(d)).toBe(false);
  });
it('binds every published null to the single physical-cell registry', () => {
  let total = 0,
    law = 0;
  for (const d of [monthly, quarterly])
    for (const t of d.tables) {
      const reg = budgetSourceCells[t.sha256]!;
      for (const r of t.rows)
        for (let c = 0; c < t.columns.length; c++) {
          const registered = reg.blanks.some((p) => p.row === r.row && p.column === reg.columns[c]);
          expect(r.source[c] === null).toBe(registered);
          if (registered) {
            total++;
            if (t.scope === 'state' && t.year === 2026 && t.period <= 6 && c === 0) law++;
          }
        }
    }
  expect({ total, law, other: total - law }).toEqual({ total: 394, law: 300, other: 94 });
});
