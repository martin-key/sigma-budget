import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { pyRepr } from './checks.js';
const oracle: { planes: { plane: number; sha256: string }[] } = JSON.parse(
  readFileSync(
    new URL('../../test/fixtures/validate15/unicode-oracle.json', import.meta.url),
    'utf8',
  ),
);
it.each(oracle.planes)(
  'matches Python repr for every codepoint in plane $plane',
  ({ plane, sha256 }) => {
    const hash = createHash('sha256');
    for (let code = plane * 0x10000; code < (plane + 1) * 0x10000; code++)
      hash.update(pyRepr(String.fromCodePoint(code)) + '\n');
    expect(hash.digest('hex')).toBe(sha256);
  },
);
