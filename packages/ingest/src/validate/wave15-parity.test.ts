import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Context } from './context.js';
import { annex3, expenditure, measures, revenue } from './fiscal.js';
import { law } from './law.js';
import { budgets, programs } from './budgets.js';
import { writeValidationReport } from './report.js';
import { WAVE15_UNPORTED } from './wave15.js';
const home = new URL('../../test/fixtures/validate15/', import.meta.url),
  cases = JSON.parse(readFileSync(new URL('cases.json', home), 'utf8')),
  oracle = JSON.parse(readFileSync(new URL('oracle.json', home), 'utf8'));
const groups: Record<string, (ctx: Context) => any> = {
  ANNEX3: annex3,
  REVENUE: revenue,
  EXPENDITURE: expenditure,
  MEASURES: measures,
  LAW: law,
  BUDGETS: budgets,
  PROGRAMS: programs,
};
const evidence: any[] = [];
afterAll(() => {
  if (process.env.WAVE15_PARITY_REPORT)
    writeValidationReport(
      new URL('../../../../', import.meta.url).pathname,
      process.env.WAVE15_PARITY_REPORT,
      JSON.stringify(
        {
          scope: 'wave15',
          completeValidation: false,
          unported: WAVE15_UNPORTED,
          scenarios: evidence,
        },
        null,
        2,
      ) + '\n',
    );
});
describe('Wave15 frozen donor comparisons', () => {
  for (const test of cases)
    for (const group of test.groups)
      it(`${test.name} ${group}`, () => {
        const root = mkdtempSync(join(tmpdir(), 'sigma-wave15-')),
          item = { scenario: test.name, group, status: 'FAIL' };
        try {
          cpSync(new URL('corpus/', home), root, { recursive: true });
          for (const op of test.ops) {
            if (op.op === 'deleteOriginal') unlinkSync(join(root, 'data/originals', op.file));
            else if (op.op === 'deleteFile') unlinkSync(join(root, 'data/release', op.file));
            else if (op.op === 'copyFile')
              copyFileSync(
                join(root, 'data/release', op.file),
                join(dirname(join(root, 'data/release', op.file)), op.name),
              );
            else
              writeFileSync(
                join(root, 'data/release', op.file),
                readFileSync(new URL(`mutations/${test.name}/${op.file}`, home)),
              );
          }
          let actual: any;
          try {
            const c = groups[group]!(new Context(root));
            actual = {
              name: c.name,
              n: c.n,
              problems: c.problems,
              warnings: c.warnings,
              facts: c.facts,
            };
          } catch (e) {
            actual = {
              crash: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).replaceAll(
                root,
                '<sandbox>',
              ),
            };
          }
          expect(actual).toEqual(oracle[test.name][group]);
          item.status = 'PASS';
        } finally {
          evidence.push(item);
          rmSync(root, { recursive: true, force: true });
        }
      });
});
