import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Context } from './context.js';
import { feed } from './feed.js';
const fixture = new URL('../../test/fixtures/validate17b/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('years/oracle.json', fixture), 'utf8'));
const cli = new URL('../../dist/validate/feed-cli.js', import.meta.url).pathname;
for (const test of cases)
  it('preserves Python owner-year formatting: ' + test.name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-year-'));
    const root = join(dir, 'inputs');
    try {
      cpSync(new URL('corpus/', fixture), root, { recursive: true });
      writeFileSync(
        join(root, 'data/release', test.file),
        readFileSync(new URL('years/mutations/' + test.name + '.json', fixture)),
      );
      let actual: unknown;
      try {
        const check = JSON.parse(JSON.stringify(feed(new Context(root))));
        actual = { check, exceptions: [] };
      } catch (error) {
        actual = { crash: `${(error as Error).name}: ${(error as Error).message}` };
      }
      expect(actual).toEqual(test.expected);
      const group = test.expected.crash
        ? {
            name: 'FEED',
            n: 1,
            problems: ['group crashed: ' + test.expected.crash],
            warnings: [],
            facts: [],
          }
        : test.expected.check;
      for (const mode of [[], ['--no-accepted']]) {
        const run = spawnSync(
          process.execPath,
          [
            cli,
            '--root',
            root,
            '--only',
            'FEED',
            '--report',
            'tmp/ts-migration/candidates/17b/report.json',
            ...mode,
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
