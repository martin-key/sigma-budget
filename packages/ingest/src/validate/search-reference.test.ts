import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { entry, lat, mag, norm, osa, parse, run, score } from './search-reference.js';
import { parseSearchJson } from './search-json.js';
const path = fileURLToPath(new URL('../../test/fixtures/wave17c/reference.json', import.meta.url));
const evidence = JSON.parse(readFileSync(path, 'utf8'));
const entries = evidence.entries.map((x: any[]) =>
  entry(x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]),
);
for (const q of evidence.queries)
  it(`search reference: ${q.raw}`, () => {
    expect(norm(q.raw)).toBe(q.norm);
    expect(lat(norm(q.raw))).toBe(q.lat);
    expect(parse(q.raw)).toEqual(q.tokens);
    expect(
      entries.map((e: any) => [score(e, parse(q.raw), false), score(e, parse(q.raw), true)]),
    ).toEqual(q.scores);
    const brief = (real: boolean) => {
      const r = run(entries, parse(q.raw), real);
      return { ...r, hits: r.hits.map((x) => x.href) };
    };
    expect(brief(false)).toEqual(q.results);
    expect(brief(true)).toEqual(q.real);
  });
it('matches OSA and printed magnitudes', () => {
  for (const x of evidence.osa) expect(osa(x.a, x.b, x.max)).toBe(x.distance);
  for (const [value, want] of evidence.magnitudes) expect(mag(value)).toBe(want);
});
it('preserves Python malformed JSON diagnostics', () => {
  for (const x of evidence.malformed) {
    try {
      parseSearchJson(x.raw);
      expect.fail('expected malformed JSON');
    } catch (e) {
      expect(`${(e as Error).name}: ${(e as Error).message}`).toBe(x.error);
    }
  }
});
it('matches the Python Unicode 15 normalization of every single code point', () => {
  const hash = createHash('sha256'),
    buffer = Buffer.allocUnsafe(8);
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const chars = Array.from(norm(String.fromCodePoint(cp)));
    buffer.writeUInt32BE(cp, 0);
    buffer.writeUInt32BE(chars.length, 4);
    hash.update(buffer);
    for (const ch of chars) {
      buffer.writeUInt32BE(ch.codePointAt(0)!, 0);
      hash.update(buffer.subarray(0, 4));
    }
  }
  expect(hash.digest('hex')).toBe(evidence.unicodeSinglesSha256);
}, 60000);
