import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readKfpCapture, type KfpCapture } from './kfp-capture.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../test/fixtures/wave18/captures.json', import.meta.url), 'utf8'),
);

describe('independent xlrd sheet captures', () => {
  it('reproduces the donor reader for every original month and column', () => {
    const execution = JSON.parse(
      readFileSync(
        new URL('../../test/fixtures/wave18/data/release/execution.json', import.meta.url),
        'utf8',
      ),
    );
    const months = Object.values(execution.data).reduce(
      (sum: number, year: any) => sum + year.months,
      0,
    );
    expect(fixture.reports).toHaveLength(months);
    for (const capture of fixture.reports) {
      expect(readKfpCapture(capture, capture.publishedRows)).toEqual(capture.report);
    }
  });
  it('selects changed rows from the grid and rejects broken evidence', () => {
    const capture = structuredClone(fixture.reports[0]) as KfpCapture & {
      publishedRows: Record<string, number>;
    };
    const rows = { ...capture.publishedRows, rev: capture.publishedRows.rev! + 1 };
    expect(readKfpCapture(capture, rows).a.rev).not.toEqual(
      readKfpCapture(capture, capture.publishedRows).a.rev,
    );
    capture.cells.pop();
    expect(() => readKfpCapture(capture, rows)).toThrow(/dimensions/);
  });
});
