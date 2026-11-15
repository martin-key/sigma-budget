import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// search-unicode-data.ts is a generated table (CPython 3.12, Unicode 15) that no formatter touches and no other test
// reads as bytes. Its SHA-256 is recorded with the frozen wave17c evidence; this test is the guard that a hand edit of
// the table is noticed, now that CI no longer re-runs the generator.
const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const key = '../../../src/validate/search-unicode-data.ts';

it('the generated search Unicode table matches the hash in the frozen wave17c evidence', () => {
  const evidence = JSON.parse(
    readFileSync(file('../../test/fixtures/wave17c/evidence.json'), 'utf8'),
  );
  expect(evidence[key]).toMatch(/^[0-9a-f]{64}$/);
  expect(
    createHash('sha256')
      .update(readFileSync(file('./search-unicode-data.ts')))
      .digest('hex'),
  ).toBe(evidence[key]);
});
