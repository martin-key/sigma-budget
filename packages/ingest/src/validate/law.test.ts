import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context } from './context.js';
import { law } from './law.js';
const base = new URL('../../test/fixtures/validate15/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases.json', base), 'utf8'));
const oracle = JSON.parse(readFileSync(new URL('oracle.json', base), 'utf8'));
describe('LAW frozen Python donor', () => {
  for (const name of [
    'baseline-missing-original',
    'law-article',
    'law-timeline',
    'law-status',
    'law-proposal',
  ])
    it(name, () => {
      const root = mkdtempSync(join(tmpdir(), 'sigma-law-'));
      try {
        cpSync(new URL('corpus/', base), root, { recursive: true });
        for (const op of cases.find((x: any) => x.name === name).ops)
          if (op.op === 'set' || op.op === 'delete')
            writeFileSync(
              join(root, 'data/release', op.file),
              readFileSync(new URL(`mutations/${name}/${op.file}`, base)),
            );
        const c = law(new Context(root));
        expect({
          name: c.name,
          n: c.n,
          problems: c.problems,
          warnings: c.warnings,
          facts: c.facts,
        }).toEqual(oracle[name].LAW);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
});
