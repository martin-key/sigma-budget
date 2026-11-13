import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
import { readWorkbook } from '../readers/workbooks/index.js';
import { parseBudgetTable, assertBudgetChecks, readBudgetTable } from './taxes-reader.js';
import { readTaxDatasets, assertConsolidation } from './taxes.js';
import differences from './taxes-source-differences.json' with { type: 'json' };
import { isPublishedDataset } from '@sigma-budget/dataset-schema';
import type { ExecutionContext } from '../release-build/types.js';
const root = resolve(import.meta.dirname, '../../../..');
const acquisition = JSON.parse(
  readFileSync(join(root, 'data/originals/taxes-subsectors-acquisition.json'), 'utf8'),
);
const context = {
  exportRoot: root,
  buildDate: '2026-11-13',
  inputs: acquisition.files,
} as ExecutionContext;
const datasets = readTaxDatasets(context);
const tables = Object.values(datasets).flatMap((d) => d.tables);
it('reads and pins all 32 physical originals; publishes both strict contracts', () => {
  expect(tables).toHaveLength(32);
  for (const [name, d] of Object.entries(datasets))
    expect(isPublishedDataset(name, d), name).toBe(true);
  expect(acquisition.excluded).toHaveLength(1);
  expect(tables.some((t) => t.year === 2025 && t.scope === 'central')).toBe(false);
  for (const t of tables) assertBudgetChecks(t, differences);
});
it('keeps law blanks, currency and per-quarter flows without inferring data', () => {
  const early = tables.filter((t) => t.scope === 'state' && t.year === 2026 && t.period <= 6);
  expect(early).toHaveLength(6);
  for (const t of early)
    expect(t.rows.every((r) => r.source[0] === null && r.eur[0] === null)).toBe(true);
  for (const t of tables)
    for (const r of t.rows)
      r.source.forEach((v, c) => {
        expect(r.eur[c]).toBe(
          v === null
            ? null
            : Number((v / 1e7 / (t.columns[c]!.unit === 'BGN' ? 1.95583 : 1)).toFixed(6)),
        );
      });
});
// Every independently named identity must reject an unregistered signed change.
for (const id of new Set(
  tables.flatMap((t) => Object.keys(t.checks).map((k) => k.split('/')[0])),
)) {
  it('rejects an unregistered difference in ' + id, () => {
    const original = tables.find((t) => Object.keys(t.checks).some((k) => k.startsWith(id + '/')))!;
    const t = structuredClone(original),
      key = Object.keys(t.checks).find((k) => k.startsWith(id + '/'))!;
    t.checks[key]! += 1;
    expect(() => assertBudgetChecks(t, differences)).toThrow('Unregistered');
  });
}
it('detects mutated numeric source cells through the actual accounting equations', () => {
  for (const x of acquisition.files) {
    const path = join(root, x.path),
      w = readWorkbook({ path, sha256: x.sha256, format: 'xls' });
    const baseline = readBudgetTable({ path, sha256: x.sha256 });
    const s = w.sheets[baseline.sheet]!;
    const target = baseline.rows.find((r) => r.row === 10)!;
    const col = baseline.scope === 'social' ? 'C' : baseline.scope === 'state' ? 'D' : 'B';
    const cell = s.cells[col + target.row]!;
    cell.value = (cell.value as number) + 1;
    expect(
      () => assertBudgetChecks(parseBudgetTable(w, baseline.file), differences),
      baseline.file,
    ).toThrow('Unregistered');
  }
});
it('fails on missing files, altered pins, bad units, cached errors and incomplete periods', () => {
  expect(() => readTaxDatasets({ ...context, inputs: context.inputs.slice(1) })).toThrow('32');
  const x = acquisition.files[0],
    path = join(root, x.path);
  expect(() => readBudgetTable({ path, sha256: '0'.repeat(64) })).toThrow('SHA-256');
  for (const change of ['unit', 'date', 'error', 'cache']) {
    const w = readWorkbook({ path, sha256: x.sha256, format: 'xls' }),
      s = w.sheets[w.sheetNames[0]!]!;
    if (change === 'unit') s.cells.D7!.value = 'unknown';
    if (change === 'date') s.cells.B3!.value = 'КЪМ 30.02.2025';
    if (change === 'error') s.cells.D10!.type = 'error';
    if (change === 'cache') {
      s.cells.D10!.value = null;
      s.cells.D10!.formula = 'SUM(D11:D19)';
    }
    expect(() => parseBudgetTable(w, x.file.split('/').at(-1)!)).toThrow();
  }
});
it('checks every additive GFS row and refuses incomplete consolidation', () => {
  const quarterly = datasets['kfp-subsectors.json'].tables;
  assertConsolidation(quarterly);
  expect(() => assertConsolidation(quarterly.filter((t) => t.scope !== 'social'))).toThrow('scope');
  for (const original of quarterly.filter((t) => t.scope === 'consolidated' && t.year !== 2025))
    for (const r of original.rows) {
      const q = structuredClone(quarterly);
      q.find((t) => t.file === original.file)!.rows.find((x) => x.row === r.row)!.source[0]! += 1;
      expect(() => assertConsolidation(q)).toThrow('Consolidation');
    }
});
it('rejects stale difference identities, file labels and unused registry observations', () => {
  const t = tables.find((t) => Object.values(t.checks).some(Boolean))!;
  expect(() => assertBudgetChecks({ ...t, file: 'different.xls' }, differences)).toThrow(
    'file mismatch',
  );
  const d = structuredClone(differences) as Record<
    string,
    { file: string; differences: Record<string, number> }
  >;
  d[t.sha256]!.differences['unknown/execution'] = 1;
  expect(() => assertBudgetChecks(t, d)).toThrow('Unregistered');
});
it('rejects malformed published scope, coverage, currency, cells and missing-period declarations', () => {
  for (const [file, original] of Object.entries(datasets)) {
    for (const mutate of [
      (d: any) => d.tables.pop(),
      (d: any) => d.tables.push(d.tables[0]),
      (d: any) => (d.tables[0].sha256 = 'bad'),
      (d: any) => (d.tables[0].columns[0].unit = 'USD'),
      (d: any) => (d.tables[0].rows[0].source[0] = '1'),
      (d: any) => d.tables[0].rows[0].eur.pop(),
      (d: any) => (d.tables[0].scope = 'unknown'),
      (d: any) => (d.sourceIntegerScale = 1),
    ]) {
      const d = structuredClone(original);
      mutate(d);
      expect(isPublishedDataset(file, d)).toBe(false);
    }
  }
  const d = structuredClone(datasets['kfp-subsectors.json']);
  d.missing = [];
  expect(isPublishedDataset('kfp-subsectors.json', d)).toBe(false);
});
for (const [identity, label] of Object.entries({
  'tax-components': /^Данъчни приходи$/,
  revenue: /^(I\. ПРИХОДИ|Приходи и помощи)/,
  'non-tax': /^Неданъчни приходи$/,
  expenditure: /^(Разходи|Общо разходи)$/,
  interest: /^Лихви(?: - общо)?$/,
  'expenditure-transfers': /^II\./,
  'transfers-net': /^Трансфери \(нето\)$/,
  'transfers-paid': /^(Предоставени на:|Предоставени трансфери)$/,
  'transfers-received': /^(Получени от:|Получени трансфери)$/,
  balance: /^(IV\.|Бюджетно салдо)/,
  financing: /^(V\.|Финансиране$)/,
  'financing-balance': /^(V\.|Финансиране$)/,
  'current-expenditure': /^Текущи разходи$/,
  subsidies: /^Субсидии$/,
}))
  it('recomputes ' + identity + ' from mutated physical source cells', () => {
    const t = tables.find((t) => Object.keys(t.checks).some((k) => k.startsWith(identity + '/')))!;
    const x = acquisition.files.find((f: any) => f.sha256 === t.sha256),
      path = join(root, x.path);
    const w = readWorkbook({ path, sha256: t.sha256, format: 'xls' }),
      s = w.sheets[t.sheet]!;
    const target = t.rows.find((r) => label.test(r.label))!;
    const col = t.scope === 'state' ? 'D' : t.scope === 'social' ? 'C' : 'B';
    const cell = s.cells[col + target.row]!;
    cell.value = (cell.value as number) + 1;
    const changed = parseBudgetTable(w, t.file);
    const key = identity + '/' + (t.scope === 'state' ? 'execution' : 'Q1');
    expect(changed.checks[key]).not.toEqual(t.checks[key]);
    expect(() => assertBudgetChecks(changed, differences)).toThrow('Unregistered');
  });

import { numeric } from '../validate/foundations.js';
import type { Context } from '../validate/context.js';
it('allows only documented null source/converted cells in complete budget contracts', () => {
  for (const [file, doc] of Object.entries(datasets)) {
    const check = (value: unknown, name = file) =>
      numeric({ jsonFiles: () => [name], get: () => value } as unknown as Context);
    expect(check(doc).problems).toEqual([]);
    expect(
      check({ ...doc, unexpected: null }).problems.some((p) => p.includes('unexpected null')),
    ).toBe(true);
    expect(
      check({ ...doc, schema: 'unknown' }).problems.some((p) => p.includes('unexpected null')),
    ).toBe(true);
    expect(check(doc, 'other.json').problems.some((p) => p.includes('unexpected null'))).toBe(true);
  }
});
