import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { budget2027 } from './budget-2027.js';
import { Context } from './context.js';
import { runGroups } from './runner.js';
const fixtures = resolve(import.meta.dirname, '../../test/fixtures'),
  cli = resolve(import.meta.dirname, '../../dist/validate/budget-2027-cli.js'),
  observations = JSON.parse(
    readFileSync(join(fixtures, 'validate15b/source-methods.json'), 'utf8'),
  );
for (const [index, { case: test, result }] of observations.entries())
  it('matches donor ZIP lookup and raw source failures ' + index, () => {
    const root = mkdtempSync(join(tmpdir(), 'sigma-15b-methods-'));
    try {
      for (const file of [
        'data/inputs/budget_forecast_2027.json',
        'data/inputs/budget_bill_2027.json',
        'data/originals/budget_2027/ZDBRB-2027.zip',
      ]) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        copyFileSync(join(fixtures, 'fiscal/inputs', file), join(root, file));
      }
      const path = join(root, 'data/inputs/budget_' + test.document + '_2027.json'),
        doc = JSON.parse(readFileSync(path, 'utf8'));
      for (const op of test.ops) {
        let holder = doc;
        for (const key of op.path.slice(0, -1)) holder = holder[key];
        const key = op.path.at(-1);
        if (op.delete) delete holder[key];
        else holder[key] = op.raw !== undefined ? '__SOURCE_METHOD_TOKEN__' : op.value;
      }
      let text = JSON.stringify(doc);
      for (const op of test.ops)
        if (op.raw !== undefined) text = text.replace('"__SOURCE_METHOD_TOKEN__"', op.raw);
      writeFileSync(path, text);
      const actual = runGroups(
        [{ name: 'BUDGET2027', description: '', run: budget2027 }],
        new Context(root),
        ['BUDGET2027'],
      );
      expect(actual.groups).toEqual([result]);
      const command = spawnSync(process.execPath, [cli, '--root', root], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(command.status, command.stderr).toBe(1);
      expect(JSON.parse(command.stdout).groups).toEqual([result]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
