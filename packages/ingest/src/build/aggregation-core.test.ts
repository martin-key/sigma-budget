import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCore, zddTable, pendingFromExecution, type CoreInput } from './aggregation-core.js';
import { executionNumbers } from './context.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/aggregation');
const read = (name: string): any => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const make = (): CoreInput => {
  const authored = read('authored.json');
  const upstream = (name: string) => read(`upstream/${name}.json`);
  return {
    buildDate: '2026-11-08',
    outlook: upstream('outlook'),
    revenue: upstream('revenue'),
    expenditure: upstream('expenditure'),
    measures: upstream('measures'),
    execution: executionNumbers(upstream('execution')),
    law: read('archive/cache/law_bill.json'),
    ...authored,
    zdd: zddTable(read('archive/originals/asbp/asbp_tables.json').tables.VI_1.rows),
    ministries: upstream('ministries'),
    programs: upstream('programs'),
    municipalities: upstream('municipalities'),
    gisco: read('archive/cache/gisco_lau_bg.json'),
    glossaryDataset: upstream('glossary'),
    glossaryInput: read('inputs/glossary.json'),
    population: read('inputs/population.json'),
  };
};
describe('core donor aggregation', () => {
  it('reproduces the frozen donor stage', () =>
    expect(buildCore(make())).toEqual(read('raw/core.json')));
  it('propagates source counts and numbers and uses the documented glossary and GISCO fallbacks', () => {
    const input = make();
    input.glossaryDataset = null;
    input.municipalities = null;
    input.measures.items.pop();
    input.outlook.gdp.mln[2] = 12345;
    const result = buildCore(input);
    expect(result).toEqual(read('mutants/core-fallback.json'));
    expect(result.counts.terms).toBe(input.glossaryInput.terms.length);
    expect(result.counts.municipalities).toBe(input.gisco!.items.length);
    expect(result.counts.measures).toBe(input.measures.items.length);
    expect(result.kpis.gdp.mln).toBe(12345);
  });
  it('derives the next report wording from changed execution data', () => {
    const input = make();
    input.execution.pendingMonths[0] = { month: 11, asOf: '2026-11-30' };
    input.pending = pendingFromExecution(input.pending, input.execution);
    expect(buildCore(input)).toEqual(read('mutants/core-pending.json'));
  });
  it('rejects inconsistent law, population and VI-1 data', () => {
    const input = make();
    input.law.sums.budgets++;
    expect(() => buildCore(input)).toThrow(/budget/);
    const p = make();
    p.population.years[0] = 'bad';
    expect(() => buildCore(p)).toThrow();
    const z = make();
    z.zdd.totalMln[0]! += 100;
    expect(() => buildCore(z)).toThrow(/VI-1/);
    const rows = read('archive/originals/asbp/asbp_tables.json').tables.VI_1.rows;
    rows[0].values = [];
    expect(() => zddTable(rows)).toThrow();
  });
});
