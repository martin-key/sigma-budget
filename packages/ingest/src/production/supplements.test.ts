import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
import { sha256 } from '../readers/workbooks/index.js';
import { readExecutionReport } from '../readers/execution/report.js';
import { readHistoricalReport, resolveProductionPending } from './supplements.js';

const root = resolve(import.meta.dirname, '../../../..');
it('reads all 24 historical reports, checks exact source differences and preserves raw values', () => {
  const reports = [2022, 2023].flatMap((year) => {
    const dir = join(root, `data/originals/kfp_${year}`);
    return readdirSync(dir)
      .filter((f) => f.endsWith('.xls'))
      .map((file) => {
        const path = join(dir, file);
        return readHistoricalReport({ path, sha256: sha256(readFileSync(path)) });
      });
  });
  expect(reports).toHaveLength(24);
  expect(reports.every((r) => r.unit === 'BGN')).toBe(true);
  expect(reports.filter((r) => r.warnings.length)).toHaveLength(13);
  const january = reports.find((r) => r.year === 2023 && r.month === 1)!;
  expect(january.warnings).toHaveLength(2);
  const path = join(root, 'data/originals/kfp_2023', january.filename);
  expect(() => readExecutionReport({ path, sha256: january.sha256 })).toThrow('fin=-balance');
});
it('resolves pending before every consumer without mutating authored declarations', () => {
  const input = {
    P04: { reason: 'отчет' },
    P05: { reason: 'ориентир' },
    P07: { reason: 'връзки' },
  };
  expect(resolveProductionPending(input)).toEqual({ P04: input.P04, P07: input.P07 });
  expect(Object.keys(input)).toHaveLength(3);
});

it('rebuilds the complete production execution and provenance, preserving every pre-existing series and total', async () => {
  const { readExecutionAnnual } = await import('../readers/execution/annual.js');
  const { prepareExecutionFiles } = await import('../readers/execution/producer.js');
  const { prepareProductionExecution } = await import('./supplements.js');
  const fixture = join(root, 'packages/ingest/test/fixtures/wave18');
  const pin = (path: string) => ({ path, sha256: sha256(readFileSync(path)) });
  const annual = {
    forecast: pin(join(fixture, 'data/inputs/budget_forecast_2027.json')),
    bill: pin(join(fixture, 'data/inputs/budget_bill_2027.json')),
    forecastArchive: pin(join(fixture, 'data/originals/budget_2027/ZDBRB-2027.zip')),
    billArchive: pin(join(fixture, 'data/originals/budget_2027/ZDBRB-2027.zip')),
    historicalAnnex3: pin(
      join(
        root,
        'packages/ingest/test/fixtures/fiscal/inputs/data/originals/asbp/asbp_tables.json',
      ),
    ),
  };
  const reports = [2022, 2023, 2024, 2025, 2026].flatMap((year) => {
    const dir = join(root, `data/originals/kfp_${year}`);
    return readdirSync(dir)
      .filter((f) => f.endsWith('.xls'))
      .map((f) => pin(join(dir, f)));
  });
  const published = JSON.parse(readFileSync(join(root, 'data/release/execution.json'), 'utf8'));
  const options = {
    reports,
    annual: readExecutionAnnual(annual),
    buildDate: published.meta.retrieved,
  };
  const result = prepareProductionExecution(options);
  expect(result.execution).toEqual(published);
  expect(result.provenance).toEqual(
    JSON.parse(readFileSync(join(root, 'data/release/execution-provenance.json'), 'utf8')),
  );
  expect(result.evidence.reports).toHaveLength(57);
  const legacy = prepareExecutionFiles(
    {
      schema: 'execution-inputs/1',
      reports: reports.filter((r) => /kfp_202[456]/.test(r.path)),
      annual,
    },
    options.buildDate,
  ).execution;
  for (const block of ['data', 'monthly', 'pace']) {
    for (const year of Object.keys(legacy[block] as object))
      expect((result.execution[block] as any)[year]).toEqual((legacy[block] as any)[year]);
  }
  for (const key of ['rows', 'cols', 'latest', 'plan2026', 'reconcile', 'pendingMonths'])
    expect(result.execution[key]).toEqual(legacy[key]);
  expect(Object.keys(result.execution.data)).toEqual(['2022', '2023', '2024', '2025', '2026']);
  expect(() => prepareProductionExecution({ ...options, reports: reports.slice(1) })).toThrow(
    /months 1\.\.n/,
  );
});
