import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Context } from './context.js';
import { search } from './search.js';
const fixture = new URL('../../test/fixtures/wave17c/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('sources/differential.json', fixture), 'utf8')).cases;
const cli = new URL('../../dist/validate/search-cli.js', import.meta.url).pathname;
for (const test of cases)
  it('preserves required and hashable SEARCH sources: ' + test.name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-sources-'));
    const root = join(dir, 'inputs');
    try {
      cpSync(new URL('corpus/', fixture), root, { recursive: true });
      for (const op of test.ops) {
        const path = join(root, 'data/release', op.file);
        const doc = JSON.parse(readFileSync(path, 'utf8'));
        let holder = doc;
        for (const key of op.path.slice(0, -1)) holder = holder[key];
        if (op.op === 'delete') delete holder[op.path.at(-1)];
        else holder[op.path.at(-1)] = op.value;
        writeFileSync(path, JSON.stringify(doc));
      }
      let actual: unknown;
      try {
        actual = JSON.parse(JSON.stringify(search(new Context(root))));
      } catch (error) {
        actual = { crash: `${(error as Error).name}: ${(error as Error).message}` };
      }
      expect(actual).toEqual(test.expected);
      const group = test.expected.crash
        ? {
            name: 'SEARCH',
            n: 1,
            problems: ['group crashed: ' + test.expected.crash],
            warnings: [],
            facts: [],
          }
        : test.expected;
      for (const mode of ['--raw', '--accepted']) {
        const run = spawnSync(
          process.execPath,
          [
            cli,
            '--root',
            root,
            '--only',
            'SEARCH',
            '--report',
            'tmp/ts-migration/candidates/17c/report.json',
            mode,
          ],
          {
            cwd: dir,
            encoding: 'utf8',
          },
        );
        const report = JSON.parse(run.stdout);
        expect(report.groups).toEqual([group]);
        expect(report.completeValidation).toBe(false);
        expect(report.status).toBe(group.problems.length ? 'FAIL' : 'PASS');
        expect(run.status, run.stderr).toBe(group.problems.length ? 1 : 0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
