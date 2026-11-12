import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type * as SheetJS from 'xlsx';
import { readWorkbook, sha256 } from '../workbooks/index.js';
import {
  prepareExecutionFiles,
  convertExecutionMoney,
  type ExecutionInputConfig,
} from './producer.js';
import { readExecutionReport, parseExecutionReport } from './report.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const fixture = join(root, 'packages/ingest/test/fixtures/wave18');
const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8'));
const pinned = (path: string) => ({ path, sha256: sha256(readFileSync(path)) });
function config(): ExecutionInputConfig {
  return {
    schema: 'execution-inputs/1',
    reports: Object.entries<string>(manifest.sha256)
      .filter(([p]) => p.includes('/kfp_') && p.endsWith('.xls'))
      .map(([path, sha256]) => ({ path: join(fixture, path), sha256 })),
    annual: {
      forecast: pinned(join(fixture, 'data/inputs/budget_forecast_2027.json')),
      bill: pinned(join(fixture, 'data/inputs/budget_bill_2027.json')),
      forecastArchive: pinned(join(fixture, 'data/originals/budget_2027/ZDBRB-2027.zip')),
      billArchive: pinned(join(fixture, 'data/originals/budget_2027/ZDBRB-2027.zip')),
      historicalAnnex3: pinned(
        join(
          root,
          'packages/ingest/test/fixtures/fiscal/inputs/data/originals/asbp/asbp_tables.json',
        ),
      ),
    },
  };
}
const buildDate = JSON.parse(readFileSync(join(root, 'data/release/execution.json'), 'utf8')).meta
  .retrieved;
const build = (input = config()) => prepareExecutionFiles(input, buildDate);

describe('real monthly BIFF -> complete published execution contract', () => {
  it('rebuilds both entire published documents and their sparse law/provenance from all 33 originals', () => {
    const result = build();
    expect(result.execution).toEqual(
      JSON.parse(readFileSync(join(root, 'data/release/execution.json'), 'utf8')),
    );
    expect(result.provenance).toEqual(
      JSON.parse(readFileSync(join(root, 'data/release/execution-provenance.json'), 'utf8')),
    );
    expect(result.evidence.reports).toHaveLength(33);
    expect(result.evidence.reports.every((r) => r.dimensions.join(',') === '54,4')).toBe(true);
    expect(result.evidence.reports.every((r) => Object.keys(r.sourceCells).length === 216)).toBe(
      true,
    );
    expect(result.evidence.reports.at(-1)!.cachedFormulas).toBe(46);
    expect(result.evidence.reports.slice(0, 23).every((r) => r.cachedFormulas === 0)).toBe(true);
    expect(result.evidence.reports.slice(0, 24).every((r) => r.unit === 'BGN')).toBe(true);
    expect(result.evidence.reports.slice(24).every((r) => r.unit === 'EUR')).toBe(true);
    expect(result.evidence.warnings).toHaveLength(4);
    expect(result.evidence.annualBoundary).toMatchObject({
      kind: 'verified-prepared-annual-data',
      rawPdfDecoded: false,
    });
    expect(Object.keys(result.evidence.annualBoundary.preparedInputPins!)).toHaveLength(5);
    const ex = result.execution;
    expect(Object.keys(ex.pace as object)).toEqual(['2024', '2025']);
    expect(ex.plan2026.nat).toEqual({});
    expect(ex.plan2026.eu).toEqual({});
    expect(ex.latest.kfp['exp.reserve']).not.toHaveProperty('yoyPct');
    expect(ex.latest.kfp['exp.personnel']).not.toHaveProperty('plan');
    expect(build()).toEqual(result);
  });
  it('uses decimal conversion before quantizing and half-away rounding, including negative half cases', () => {
    expect(convertExecutionMoney(1.95583, 'BGN')).toBe(1);
    expect(convertExecutionMoney(1.2345, 'EUR')).toBe(1.235);
    expect(convertExecutionMoney(-1.2345, 'EUR')).toBe(-1.235);
    expect(Object.is(convertExecutionMoney(-0.000001, 'EUR'), -0)).toBe(false);
  });
  it('rejects inner/latest missing reports, duplicate months, stale releases and an unreviewed headline', () => {
    const c = config();
    c.reports.splice(4, 1);
    expect(() => build(c)).toThrow(/months 1\.\.n/);
    const end = config();
    end.reports.pop();
    expect(() => build(end)).toThrow(/missing\/stale/);
    const dup = config();
    dup.reports.push(dup.reports[0]!);
    expect(() => build(dup)).toThrow(/duplicate/);
    const ref = config();
    ref.headlines = [{ year: 2026, month: 9, values: [1, 2, 3] }];
    expect(() => build(ref)).toThrow(/headline mismatch/);
    expect(() => prepareExecutionFiles(config(), '2026-01-01')).toThrow(/after build date/);
  });
  it('rejects stale annual pins and invalid law vintage instead of using Annex 3 as a denominator', () => {
    const c = config();
    c.annual.forecast.sha256 = '0'.repeat(64);
    expect(() => build(c)).toThrow(/SHA-256 mismatch/);
    const temp = mkdtempSync(join(tmpdir(), 'sigma-execution-law-'));
    try {
      const c = config(),
        doc = JSON.parse(readFileSync(c.annual.forecast.path, 'utf8'));
      doc.tables.annex1_execution2026.columns[0].vintage = 'очаквано';
      const path = join(temp, 'forecast.json');
      writeFileSync(path, JSON.stringify(doc));
      c.annual.forecast = pinned(path);
      expect(() => build(c)).toThrow(/vintage/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it('rejects owned raw corruption, wrong labels/units, nonblank omitted rows and identity changes after re-pinning', () => {
    const temp = mkdtempSync(join(tmpdir(), 'sigma-execution-corrupt-'));
    const engine = createRequire(import.meta.url)('xlsx') as typeof SheetJS;
    try {
      const input = config().reports.at(-1)!,
        path = join(temp, '2026-EU_funds_0926_BG_WEB.xls');
      writeFileSync(path, '<html>not an XLS</html>');
      expect(() => readExecutionReport(pinned(path))).toThrow(/BIFF/);
      const bytes = readFileSync(input.path);
      writeFileSync(path, bytes.subarray(0, 700));
      expect(() => readExecutionReport(pinned(path))).toThrow();
      for (const [address, value, pattern] of [
        ['A11', 'Грешен ред', /label mismatch/],
        ['D4', 'млн.лв.', /currency/],
        ['B15', 1, /blank cell/],
        ['B11', 1, /identity/],
      ] as const) {
        const wb = engine.read(bytes, { type: 'buffer', cellFormula: true, sheetStubs: true });
        wb.Sheets['стартова']![address] = { t: typeof value === 'number' ? 'n' : 's', v: value };
        writeFileSync(path, engine.write(wb, { type: 'buffer', bookType: 'biff8' }));
        expect(() => readExecutionReport(pinned(path))).toThrow(pattern);
      }
      const decoded = readWorkbook({ ...input, format: 'xls' });
      decoded.sheets['стартова']!.cells.B11!.value = null;
      decoded.sheets['стартова']!.cells.B11!.cache = 'missing';
      expect(() => parseExecutionReport(decoded, '2026-EU_funds_0926_BG_WEB.xls')).toThrow(
        /numeric value\/cache/,
      );
      expect(() =>
        readExecutionReport({ path: resolve(temp, 'missing.xls'), sha256: input.sha256 }),
      ).toThrow(/ENOENT/);
      writeFileSync(path, bytes);
      expect(() => readExecutionReport({ path, sha256: '0'.repeat(64) })).toThrow(/SHA-256/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it('requires million EUR even when a repinned annual column and all its rows agree on another unit', () => {
    const temp = mkdtempSync(join(tmpdir(), 'sigma-execution-annual-unit-'));
    try {
      for (const unit of ['млн. лв.', 'хил. €']) {
        const input = config();
        const doc = JSON.parse(readFileSync(input.annual.forecast.path, 'utf8'));
        const table = doc.tables.annex1_execution2026;
        table.columns[0].unit = unit;
        for (const row of table.rows) row.units[0] = unit;
        const path = join(temp, 'forecast.json');
        writeFileSync(path, JSON.stringify(doc));
        input.annual.forecast = pinned(path);
        expect(() => build(input)).toThrow(/Wrong adopted-law unit/);
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
