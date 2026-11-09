import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAggregationFixture } from './aggregation-fixture.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/aggregation');
const text = (p: string) => readFileSync(resolve(root, p), 'utf8'),
  json = (p: string) => JSON.parse(text(p));
describe('complete aggregation fixture', () => {
  it('builds all four files from pinned dependencies with raw, final and published parity', async () => {
    const result = await loadAggregationFixture(root, '2026-11-08');
    for (const [stage, outputs] of [
      ['raw', result.raw],
      ['final', result.projected],
      ['published', result.projected],
    ] as const) {
      for (const [name, value] of [
        ['core', outputs.core],
        ['feed', outputs.feed],
        ['search-index', outputs.search],
      ] as const)
        expect(value).toEqual(json(`${stage}/${name}.json`));
      expect(outputs.rss).toBe(text(`${stage}/feed.xml`));
    }
  });
});
