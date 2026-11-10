import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, expect, it } from 'vitest';
import { Context } from './context.js';
import { wave15Groups, WAVE15_UNPORTED } from './wave15.js';
import { writeValidationReport } from './report.js';
const home = new URL('../../test/fixtures/validate15/', import.meta.url);
const load = (f: string): any => JSON.parse(readFileSync(new URL('iterable/' + f, home), 'utf8'));
const cases = load('cases.json'),
  oracle = load('oracle.json');
const repo = new URL('../../../../', import.meta.url).pathname,
  cli = join(repo, 'packages/ingest/dist/validate/cli15.js');
const evidence: any[] = [];
function wrap(name: string, value: any) {
  return value.crash
    ? { name, n: 1, problems: ['group crashed: ' + value.crash], warnings: [], facts: [] }
    : value;
}
for (const test of cases)
  it('matches iterable donor boundaries ' + test.name, () => {
    const root = mkdtempSync(join(tmpdir(), 'sigma-iterable-')),
      item = { name: test.name, status: 'FAIL', full: test.full };
    try {
      cpSync(new URL('corpus/', home), root, { recursive: true });
      for (const f of new Set<string>(test.ops.map((x: any) => x.file)))
        writeFileSync(
          join(root, 'data/release', f),
          readFileSync(new URL(`iterable/mutations/${test.name}/${f}`, home)),
        );
      const names = test.full ? wave15Groups.map((g) => g.name) : [test.group];
      const direct: Record<string, any> = {};
      for (const name of names) {
        try {
          const c = wave15Groups.find((g) => g.name === name)!.run(new Context(root));
          direct[name] = {
            name: c.name,
            n: c.n,
            problems: c.problems,
            warnings: c.warnings,
            facts: c.facts,
          };
        } catch (e) {
          if (!(e instanceof Error)) throw e;
          direct[name] = { crash: `${e.name}: ${e.message}`.replaceAll(root, '<sandbox>') };
        }
      }
      const variants = oracle[test.name];
      expect(
        variants.some((v: any) => isDeepStrictEqual(v.result, direct)),
        JSON.stringify(direct),
      ).toBe(true);
      const args = [cli, '--root', root];
      if (!test.full) args.push('--only', test.group);
      const run = spawnSync(process.execPath, args, { cwd: tmpdir(), encoding: 'utf8' }),
        report = JSON.parse(run.stdout);
      expect(report.completeValidation).toBe(false);
      expect(report.unported).toEqual(WAVE15_UNPORTED);
      const selected = report.groups.map((g: any) => ({
        name: g.name,
        n: g.n,
        problems: g.problems,
        warnings: g.warnings,
        facts: g.facts,
      }));
      expect(
        variants.some((v: any) =>
          isDeepStrictEqual(
            names.map((n: string) => wrap(n, v.result[n])),
            selected,
          ),
        ),
        JSON.stringify(selected),
      ).toBe(true);
      const totals = {
        checks: selected.reduce((n: number, g: any) => n + g.n, 0),
        problems: selected.reduce((n: number, g: any) => n + g.problems.length, 0),
        warnings: selected.reduce((n: number, g: any) => n + g.warnings.length, 0),
      };
      expect(report.totals).toEqual(totals);
      expect(report.status).toBe(totals.problems ? 'FAIL' : 'PASS');
      expect(run.status, run.stderr).toBe(selected.some((g: any) => g.problems.length) ? 1 : 0);
      item.status = 'PASS';
    } finally {
      evidence.push(item);
      rmSync(root, { recursive: true, force: true });
    }
  });
afterAll(() => {
  if (process.env.WAVE15_ITERABLE_REPORT)
    writeValidationReport(
      repo,
      process.env.WAVE15_ITERABLE_REPORT,
      JSON.stringify(
        {
          scope: 'wave15-iterable',
          completeValidation: false,
          unported: WAVE15_UNPORTED,
          scenarios: evidence,
        },
        null,
        2,
      ) + '\n',
    );
});
