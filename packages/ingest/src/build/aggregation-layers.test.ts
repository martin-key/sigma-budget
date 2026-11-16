import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { aggregationActive } from './aggregation-layers.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/aggregation');
const text = (p: string) => readFileSync(resolve(root, p), 'utf8');
const read = (p: string): any => JSON.parse(text(p));
describe('aggregation final layers', () => {
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
