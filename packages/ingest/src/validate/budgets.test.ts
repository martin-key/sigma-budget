import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context } from './context.js';
import { budgets, programs } from './budgets.js';
const home = new URL('../../test/fixtures/validate15/', import.meta.url),
  cases = JSON.parse(readFileSync(new URL('cases.json', home), 'utf8')),
  oracle = JSON.parse(readFileSync(new URL('oracle.json', home), 'utf8'));
describe('budget and programme frozen Python donor', () => {
  for (const [name, group] of [
    ['baseline-missing-original', 'BUDGETS'],
    ['baseline-missing-original', 'PROGRAMS'],
    ['budgets-total', 'BUDGETS'],
    ['programs-sentinel', 'PROGRAMS'],
    ['programs-row', 'PROGRAMS'],
  ] as const)
    it(`${name} ${group}`, () => {
      const root = mkdtempSync(join(tmpdir(), 'sigma-programmes-'));
      try {
        cpSync(new URL('corpus/', home), root, { recursive: true });
        for (const op of cases.find((x: any) => x.name === name).ops)
          if (op.op === 'set' || op.op === 'delete')
            writeFileSync(
              join(root, 'data/release', op.file),
              readFileSync(new URL(`mutations/${name}/${op.file}`, home)),
            );
        const c = (group === 'BUDGETS' ? budgets : programs)(new Context(root));
        expect({
          name: c.name,
          n: c.n,
          problems: c.problems,
          warnings: c.warnings,
          facts: c.facts,
        }).toEqual(oracle[name][group]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
});
