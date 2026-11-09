import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBudgetPlan,
  buildGva,
  gvaSeries,
  type PlanInput,
  type PlanEditorial,
  type GvaStat,
  type GvaEditorial,
  type Outlook,
} from './dbp-gva.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/dbp-gva');
const read = <T>(name: string): T => JSON.parse(readFileSync(resolve(root, name), 'utf8')) as T;
const plan = () => read<PlanInput>('inputs/figures.json');
const editorial = read<PlanEditorial>('inputs/editorial.json');
const hash = '8c91cdf4778f2864e1eeb167f14b08d1f68a076ea4ad27a8a4305175a73f1182';
const nama = () => read<GvaStat>('inputs/nama.json');
const gdp = () => read<GvaStat>('inputs/gdp.json');
const outlook = () => read<Outlook>('inputs/outlook.json');
const gvaEd = read<GvaEditorial>('inputs/gva-editorial.json');

describe('DBP from frozen extracted evidence', () => {
  it('matches independent Python and published snapshots', () => {
    const actual = buildBudgetPlan(plan(), editorial, hash);
    expect(actual).toEqual(read('oracle/dbp2027.json'));
    expect(actual).toEqual(read('published/dbp2027.json'));
    expect(actual.doc.sha256).toBe(hash);
  });
  it('uses changed figure and derived values, provenance, filtering and unit normalization', () => {
    const p = plan();
    p.figures.push({
      id: 't4.synthetic',
      value: 123.4,
      unit: 'млрд. EUR',
      page: 17,
      basis: 'ESA_GG',
      year: 2027,
      table: 'Табл. 4',
    });
    p.figures.push({ id: 'n27.MOD', value: 9, unit: 'EUR', page: 22, basis: 'ESA_GG' });
    p.figures.push({ id: 'cash.synthetic', value: 42, page: 1, basis: 'KFP_CASH' });
    p.derived.find((f) => f.id === 'gdp.2027')!.value = 456;
    const actual = buildBudgetPlan(p, editorial, hash);
    expect(actual).toEqual(read('oracle/changed-dbp.json'));
    expect(actual.figures['t4.synthetic']).toEqual({
      v: 123.4,
      u: 'млрд. €',
      p: 17,
      b: 'ESA_GG',
      y: 2027,
      t: 'Табл. 4',
      k: 'reported',
    });
    expect(actual.figures['gdp.2027']!.v).toBe(456);
    expect(actual.figures['n27.MOD']).toBeUndefined();
    expect(actual.figures['cash.synthetic']).toBeUndefined();
    expect(actual.figures['deficit.2027.eur']!.f).toBe(editorial.deficitFormula);
  });
  it('rejects duplicate authored figures, missing deficit, and invalid document hash', () => {
    const p = plan();
    p.figures.push({ id: editorial.EXTRA[0]![0], value: 1, page: 1, basis: 'ESA_GG' });
    expect(() => buildBudgetPlan(p, editorial, hash)).toThrow(/duplicate/);
    const no = plan();
    no.derived = no.derived.filter((f) => f.id !== 'deficit.2027.eur');
    expect(() => buildBudgetPlan(no, editorial, hash)).toThrow(/deficit/);
    expect(() => buildBudgetPlan(plan(), editorial, 'wrong')).toThrow(/hash/);
  });
});

describe('GVA synthetic source and arithmetic', () => {
  it('matches independent Python for dimensions, dates, flags, subsector and intersections', () => {
    const actual = buildGva(nama(), gdp(), outlook(), gvaEd);
    expect(actual).toEqual(read('oracle/synthetic-gva.json'));
    expect(actual.years).toEqual([2019, 2020, 2021]);
    expect(actual.meta.asOf).toBe('2026-10-08');
    expect(actual.meta.provisionalYears).toEqual([2019]);
    expect(actual.parts[0]!.of).toBe('B-E');
  });
  it('propagates source updates, provisional flags and subsector values', () => {
    const n = nama();
    n.extension.annotation[0]!.date = '2026-10-11T00:00:00';
    n.status = { '6': 'p' };
    (n.value as Record<string, number>)['45'] = 17.5;
    const result = buildGva(n, gdp(), outlook(), gvaEd);
    expect(result.meta.asOf).toBe('2026-10-09');
    expect(result.meta.provisionalYears).toEqual([2020]);
    expect(result.parts[0]!.mln[0]).toBe(17.5);
  });
  it('reads zero and skips null and absent cells', () => {
    const n = nama();
    const values = n.value as Record<string, number | null>;
    values['4'] = 0;
    values['5'] = null;
    delete values['6'];
    const a = gvaSeries(n, 'nace_r2', 'A');
    expect(a.get(2018)?.[0]).toBe(0);
    expect(a.has(2019)).toBe(false);
    expect(a.has(2020)).toBe(false);
    expect(() => buildGva(n, gdp(), outlook(), gvaEd)).toThrow(/Missing observation/);
  });
  it('fails closed for branch, taxes, outlook, dates and missing cells', () => {
    const n = nama();
    (n.value as Record<string, number>)['5']! += 2;
    expect(() => buildGva(n, gdp(), outlook(), gvaEd)).toThrow(/branches/);
    const g = gdp();
    (g.value as Record<string, number>)['0']! += 2;
    expect(() => buildGva(nama(), g, outlook(), gvaEd)).toThrow(/taxes/);
    const o = outlook();
    o.gdp.mlnPrecise[0]! += 2;
    expect(() => buildGva(nama(), gdp(), o, gvaEd)).toThrow(/outlook/);
    const missing = nama();
    missing.extension.annotation = [];
    expect(() => buildGva(missing, gdp(), outlook(), gvaEd)).toThrow(/update date/);
    const bad = nama();
    bad.size[0] = 2;
    expect(() => buildGva(bad, gdp(), outlook(), gvaEd)).toThrow(/dimension/);
  });
  it('uses Python float rounding on changed observations', () => {
    const n = nama(),
      g = gdp(),
      o = outlook();
    (n.value as Record<string, number>)['5'] = 12.25;
    (n.value as Record<string, number>)['1']! += 1.25;
    (g.value as Record<string, number>)['4']! += 1.25;
    o.gdp.mlnPrecise[0]! += 1.25;
    const actual = buildGva(n, g, o, gvaEd);
    expect(actual).toEqual(read('oracle/changed-gva.json'));
    expect(actual.branches[0]!.mln[0]).toBe(12.2);
  });
});
