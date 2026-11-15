import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePythonJson } from '../common/numbers.js';
import {
  buildSearch,
  orderedKeysFromJson,
  SearchRows,
  type SearchInput,
} from './aggregation-search.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/aggregation');
const text = (name: string) => readFileSync(resolve(root, name), 'utf8');
const read = (name: string): any => JSON.parse(text(name));
const billText = text('upstream/budget2027.json'),
  billOrder = orderedKeysFromJson(billText, ['budgets', 'bill']),
  debtLimitOrder = orderedKeysFromJson(billText, ['debtLimits']);
const programCases: {
  field: string;
  token: string;
  row: number;
  href: string;
  expected: unknown;
}[] = read('mutants/acceptance-regressions.json').programs;
function tree(path: string): Record<string, any> {
  const base = resolve(root, path),
    out: Record<string, any> = {};
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = resolve(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.json')) out[relative(base, p)] = JSON.parse(readFileSync(p, 'utf8'));
    }
  }
  walk(base);
  return out;
}
function make(): SearchInput {
  const fallback = tree('upstream'),
    out: Record<string, any> = {
      ...fallback,
      'core.json': read('raw/core.json'),
      'feed.json': read('raw/feed.json'),
    };
  for (const name of [
    'glossary.json',
    'guide.json',
    'catalog.json',
    'dbp2027.json',
    'gva-sectors.json',
  ])
    delete out[name];
  return {
    buildDate: '2026-11-08',
    out,
    fallback,
    texts: { 'feed.xml': text('raw/feed.xml') },
    authored: read('authored.json'),
    billOrder: [...billOrder],
    debtLimitOrder: [...debtLimitOrder],
  };
}
describe('search donor', () => {
  it('matches complete donor rows, wording, order and byte budget', () => {
    const actual = buildSearch(make());
    expect(actual).toEqual(read('raw/search-index.json'));
    expect(Buffer.byteLength(JSON.stringify(actual) + '\n')).toBeLessThan(250000);
    expect(actual.items.filter((r) => r[6].includes('to=s12-II_')).length).toBe(114);
    const programme = actual.items.find((r) => r[0] === 1 && r[6].includes('per=2026.law'))!;
    expect(programme[4]).toBe('Проект 2026');
    const blank = actual.items.find(
      (r) => r[6].includes('2028.forecast') && r[0] === 3 && r[3] === '',
    )!;
    expect(blank[4]).toBe('Прогноза 2028');
    expect(blank[2]).toContain('Празна печатна клетка');
    expect(actual.items.some((r) => r[6].includes('per=2025.report'))).toBe(true);
  });
  it('matches changed source order, owner numbers, blank cells and Bulgarian wording', () => {
    const input = make();
    input.billOrder.reverse();
    const doc = input.out['budget2027.json'] as any;
    doc.municipal.art52[0].cells[0].value = 1234.5;
    delete doc.forecast.II_7[0].cells['1'];
    (input.out['measures.json'] as any).items[0].name = 'Мярка & <проект>';
    (input.out['outlook.json'] as any).meta.source = ['sebra', 'ec-oil', 'asbp'];
    expect(buildSearch(input)).toEqual(read('mutants/search-changed.json'));
  });
  it.each(programCases)('preserves the donor program $field for JSON token $token', (test) => {
    const input = make(),
      programs = input.out['programs.json'] as any,
      column = programs.fields.indexOf(test.field);
    programs.items[test.row][column] = '__numeric_identifier_token__';
    input.out['programs.json'] = parsePythonJson(
      JSON.stringify(programs).replace('"__numeric_identifier_token__"', test.token),
    );
    const actual = buildSearch(input).items;
    if (test.expected === null) expect(actual.find((row) => row[6] === test.href)).toBeUndefined();
    else expect(actual.find((row) => row[6] === test.href)).toEqual(test.expected);
  });
  it('matches Python truth, string and whitespace semantics', () => {
    const rows = new SearchRows();
    rows.add('indicators', 'Тест', '', [], '2026', 'real', '#/pari');
    rows.add(
      'datasets',
      true,
      '\u0085  текст  \u0085',
      ['кирилица', 2],
      { a: true },
      'real',
      '#/danni/test',
    );
    expect(rows.rows).toEqual(read('mutants/search-row-semantics.json'));
  });
  it('accepts exactly 249999 bytes and rejects 250000 bytes', () => {
    const edge = make(),
      measure = (edge.out['measures.json'] as any).items[0];
    measure.text += ' ' + 'a'.repeat(531);
    const doc = buildSearch(edge);
    expect(Buffer.byteLength(JSON.stringify(doc) + '\n')).toBe(249999);
    expect(doc).toEqual(read('mutants/search-edge.json'));
    measure.text += 'a';
    expect(() => buildSearch(edge)).toThrow(/250000 B raw/);
  });
  it('fails closed on missing owner, invalid ordering, and budget overflow', () => {
    const input = make();
    delete input.out['measures.json'];
    delete input.fallback['measures.json'];
    expect(() => buildSearch(input)).toThrow(/measures/);
    const order = make();
    order.billOrder.pop();
    expect(() => buildSearch(order)).toThrow(/order/);
    const big = make();
    (big.out['measures.json'] as any).items[0].text = 'ъ'.repeat(8000);
    expect(() => buildSearch(big)).toThrow(/budget/);
  });
});
