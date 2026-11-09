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
  observations = JSON.parse(readFileSync(join(fixtures, 'validate15b/source-order.json'), 'utf8'));
for (const { case: test, result } of observations)
  it('preserves required-field order directly and through the CLI: ' + JSON.stringify(test), () => {
    const root = mkdtempSync(join(tmpdir(), 'sigma-15b-order-'));
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
      if (test.damage !== 'none')
        doc.source[test.damage] = test.damage === 'archive' ? 'missing.zip' : '0'.repeat(64);
      if (test.missing === 'source') delete doc.source;
      else if (test.missing !== 'none')
        for (const key of test.missing.split('+')) delete doc.source[key];
      writeFileSync(path, JSON.stringify(doc));
      const actual = runGroups(
        [{ name: 'BUDGET2027', description: '', run: budget2027 }],
        new Context(root),
        ['BUDGET2027'],
      );
      expect(actual.groups).toEqual([result]);
      const process = spawnSync(globalThis.process.execPath, [cli, '--root', root], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(process.status, process.stderr).toBe(1);
      expect(JSON.parse(process.stdout).groups).toEqual([result]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
