import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context } from './context.js';
import { annex3, revenue, measures, expenditure } from './fiscal.js';

const home = new URL('../../test/fixtures/validate15/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases.json', home), 'utf8'));
const oracle = JSON.parse(readFileSync(new URL('oracle.json', home), 'utf8'));

describe('Fiscal frozen Python donor', () => {
  for (const name of [
    'baseline-missing-original',
    'annex-gdp',
    'annex-missing-note',
    'revenue-parent',
    'revenue-total',
    'baseline-revenue',
    'baseline-measures',
    'baseline-present-original',
    'measures-original-mismatch',
    'measures-sign',
    'measures-page',
    'measures-empty',
    'measures-count',
    'baseline-expenditure',
    'expenditure-total',
    'expenditure-memo',
  ])
    it(name, () => {
      const root = mkdtempSync(join(tmpdir(), 'sigma-annex3-'));
      try {
        cpSync(new URL('corpus/', home), root, { recursive: true });
        const caseName =
          name.startsWith('baseline-') &&
          !['baseline-missing-original', 'baseline-present-original'].includes(name)
            ? 'baseline-missing-original'
            : name;
        const scenario = cases.find((x: any) => x.name === caseName);
        for (const op of scenario.ops) {
          if (op.op === 'deleteOriginal') {
            unlinkSync(join(root, 'data/originals', op.file));
            continue;
          }
          const path = join(root, 'data/release', op.file);
          writeFileSync(path, readFileSync(new URL(`mutations/${caseName}/${op.file}`, home)));
        }
        const group =
          name.startsWith('expenditure-') || name === 'baseline-expenditure'
            ? 'EXPENDITURE'
            : name.startsWith('measures-') ||
                name === 'baseline-measures' ||
                name === 'baseline-present-original'
              ? 'MEASURES'
              : name.startsWith('revenue-') || name === 'baseline-revenue'
                ? 'REVENUE'
                : 'ANNEX3';
        const c = (
          group === 'ANNEX3'
            ? annex3
            : group === 'REVENUE'
              ? revenue
              : group === 'MEASURES'
                ? measures
                : expenditure
        )(new Context(root));
        expect({
          name: c.name,
          n: c.n,
          problems: c.problems,
          warnings: c.warnings,
          facts: c.facts,
        }).toEqual(oracle[caseName][group]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
});
