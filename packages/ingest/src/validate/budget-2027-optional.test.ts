import { spawnSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { budget2027 } from './budget-2027.js';
import { Context } from './context.js';
const fixtures = resolve(import.meta.dirname, '../../test/fixtures');
const cases = JSON.parse(readFileSync(join(fixtures, 'validate15b/optional-values.json'), 'utf8'));
const cli = resolve(import.meta.dirname, '../../dist/validate/budget-2027-cli.js');
for (const test of cases)
  it('preserves optional EU contribution: ' + test.name, () => {
    const root = mkdtempSync(join(tmpdir(), 'budget-optional-'));
    try {
      cpSync(join(fixtures, 'fiscal/inputs/data'), join(root, 'data'), { recursive: true });
      for (const name of [
        'outlook',
        'revenue',
        'expenditure',
        'budget2027',
        'budget2027-provenance',
      ]) {
        const target = join(root, 'data/release', name + '.json');
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(fixtures, 'wave13a/published', name + '.json'), target);
      }
      const cells = join(root, 'pipeline/budget_pipeline/validate/fixtures/budget_2027_cells.json');
      mkdirSync(dirname(cells), { recursive: true });
      copyFileSync(
        join(
          fixtures,
          'validate15b/donor/budget_pipeline/validate/fixtures/budget_2027_cells.json',
        ),
        cells,
      );
      const path = join(root, 'data/inputs/budget_bill_2027.json');
      const tokens = new WeakMap<object, Map<string, { value: number; source: string }>>();
      const bill = JSON.parse(readFileSync(path, 'utf8'), function (
        this: any,
        key: string,
        value: any,
        context: any,
      ) {
        if (typeof value === 'number') {
          let fields = tokens.get(this);
          if (!fields) {
            fields = new Map();
            tokens.set(this, fields);
          }
          fields.set(key, { value, source: context.source });
        }
        return value;
      } as any);
      bill.bill['2'].headline.eucontrib = test.value;
      writeFileSync(
        path,
        JSON.stringify(bill, function (this: any, key: string, value: any) {
          const token = tokens.get(this)?.get(key);
          return token && Object.is(value, token.value)
            ? (JSON as any).rawJSON(token.source)
            : value;
        }),
      );
      expect(budget2027(new Context(root))).toEqual(test.result);
      const run = spawnSync(process.execPath, [cli, '--root', root], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout).groups).toEqual([test.result]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
