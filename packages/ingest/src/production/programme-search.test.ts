import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { programmeReferences } from '@sigma-budget/dataset-schema';
import { supplementBudgetFiles, withProductionProgrammes } from './programmes.js';
import { compactProgrammeSearch } from './programme-search.js';
const root = resolve(import.meta.dirname, '../../../..'),
  fixture = resolve(root, 'packages/ingest/test/fixtures/wave13b/oracle');
const load = (file: string) => JSON.parse(readFileSync(resolve(fixture, file), 'utf8'));
const budgets = supplementBudgetFiles(
  Object.fromEntries(
    ['ministries.json', 'programs.json', 'ministries/0200.json'].map((file) => [file, load(file)]),
  ),
  Object.values(programmeReferences),
);
const old = load('search-index.json');
const baseline = {
  ...old,
  items: old.items.filter((r: any[]) => !(r[0] === 1 && r[4] === 'Проект 2026')),
};
it('keeps every programme and source value below the unchanged search budget', () => {
  const d = compactProgrammeSearch(baseline, budgets['programs.json'], budgets['ministries.json']);
  expect(Buffer.byteLength(JSON.stringify(d) + '\n')).toBeLessThan(250000);
  const rows = d.items.filter(
    (r: any[]) => r[0] === 1 && (r[4] === 'Проект 2026' || r[4] === 'Прогноза 2026'),
  );
  expect(rows).toHaveLength(budgets['programs.json'].items.length);
  for (const original of old.items.filter((r: any[]) => r[0] === 1 && r[4] === 'Проект 2026')) {
    const compact = rows.find(
      (r: any[]) => r[6] === original[6] && r[2].endsWith(original[2].split(' ').at(-1)),
    );
    expect(compact).toBeDefined();
    expect(compact[3]).toBe(original[3]);
    expect(compact[2]).toContain(original[2].split(' ').at(-1));
  }
});
it('changes only the production search stage and never its owner datasets', () => {
  const original = structuredClone(budgets);
  const stage = {
    id: 'search',
    requires: ['budgets'],
    run: (read: (id: string) => any) => {
      expect(read('budgets')['programs.json'].items).toEqual([]);
      expect(read('core')).toBe(42);
      return baseline;
    },
  };
  const wrapped = withProductionProgrammes([stage], Object.values(programmeReferences))[0]!;
  const d = wrapped.run((id) => (id === 'budgets' ? budgets : 42)) as any;
  expect(d.items.length).toBeGreaterThan(baseline.items.length);
  expect(budgets).toEqual(original);
});
it('rejects missing names, unknown agencies, duplicate programmes and an oversized index', () => {
  const index = budgets['programs.json'],
    m = budgets['ministries.json'];
  const badAmount = structuredClone(index);
  badAmount.items[0][5] = 'bad';
  expect(() => compactProgrammeSearch(baseline, badAmount, m)).toThrow('non-numeric');
  const noName = structuredClone(index);
  noName.items[0][2] = '';
  expect(() => compactProgrammeSearch(baseline, noName, m)).toThrow('source name');
  expect(() => compactProgrammeSearch(baseline, index, { items: [] })).toThrow('known agency');
  const dup = structuredClone(index);
  dup.items.push(dup.items[0]);
  expect(() => compactProgrammeSearch(baseline, dup, m)).toThrow('duplicated');
  expect(() => compactProgrammeSearch({ ...baseline, items: [] }, index, m)).toThrow(
    'insertion point',
  );
  expect(() =>
    compactProgrammeSearch({ ...baseline, extra: 'x'.repeat(250000) }, index, m),
  ).toThrow('unchanged');
});
it('retains missing-value sentinels and small amounts', () => {
  const index = structuredClone(budgets['programs.json']);
  index.items[0][5] = index.sentinels.noData;
  const d = compactProgrammeSearch(baseline, index, budgets['ministries.json']);
  expect(d.items.find((r: any[]) => r[2].endsWith(index.items[0][1]))[3]).toBe('');
});
it('updates catalog wording before its derived metadata', () => {
  const stage = {
    id: 'catalog',
    requires: ['budgets'],
    run: () => ({
      description: 'За 0 от 46 бюджета програмите не са включени (P03).',
      index: 'Индекс на 312 програми от програмните бюджети:',
    }),
  };
  const value = withProductionProgrammes([stage], Object.values(programmeReferences))[0]!.run(
    () => null,
  ) as any;
  expect(value.description).not.toContain('P03');
  expect(value.description).toContain('всички 46 ведомства');
});
