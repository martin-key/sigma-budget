import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { aggregationActive, projectAggregation } from './aggregation-layers.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/aggregation');
const text = (p: string) => readFileSync(resolve(root, p), 'utf8');
const read = (p: string): any => JSON.parse(text(p));
describe('aggregation final layers', () => {
  it('matches each independent donor projection and all four published snapshots', () => {
    const result = projectAggregation({
      core: read('raw/core.json'),
      feed: read('raw/feed.json'),
      rss: text('raw/feed.xml'),
      search: read('raw/search-index.json'),
      wording: read('inputs/wording.json'),
      sourceGlue: read('authored.json').sourceGlue,
    });
    for (const [name, value] of [
      ['core', result.core],
      ['feed', result.feed],
      ['search-index', result.search],
    ] as const) {
      expect(value).toEqual(read(`final/${name}.json`));
      expect(value).toEqual(read(`published/${name}.json`));
    }
    expect(result.rss).toBe(text('final/feed.xml'));
    expect(result.rss).toBe(text('published/feed.xml'));
  });
  it('adds the five source-glue terms when the donor input contains 64 terms', () => {
    const core = read('raw/core.json'),
      search = read('raw/search-index.json'),
      sourceGlue = read('authored.json').sourceGlue;
    core.counts.terms = 64;
    const removed = new Set(
      sourceGlue.terms.map((term: { slug: string }) => '#/rechnik/' + term.slug),
    );
    search.items = search.items.filter((row: string[]) => !removed.has(row[6]));
    const result = projectAggregation({
      core,
      feed: read('raw/feed.json'),
      rss: text('raw/feed.xml'),
      search,
      wording: read('inputs/wording.json'),
      sourceGlue,
    });
    expect(result.core).toEqual(read('mutants/glue-core.json'));
    expect(result.search).toEqual(read('mutants/glue-search.json'));
  });
  it('removes SEBRA from an optional highlights array as the Python layer does', () => {
    const feed = read('raw/feed.json');
    feed.highlights = ['keep', 'СЕБРА payment'];
    const result = aggregationActive({
      core: read('raw/core.json'),
      feed,
      rss: text('raw/feed.xml'),
      search: read('raw/search-index.json'),
    });
    expect(result.feed.highlights).toEqual(['keep']);
  });
});
