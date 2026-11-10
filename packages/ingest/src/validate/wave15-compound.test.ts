import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, expect, it } from 'vitest';
import { Context } from './context.js';
import { parseOrderedPythonJson } from './ordered-json.js';
import { pyDict, pyEqual, pySortedTuples, pyTupleAt, pythonRepr } from './python-error.js';
import { wave15Groups } from './wave15.js';
import { writeValidationReport } from './report.js';

const home = new URL('../../test/fixtures/validate15/', import.meta.url),
  load = (file: string): any => JSON.parse(readFileSync(new URL('compound/' + file, home), 'utf8')),
  cases = load('cases.json'),
  oracle = load('oracle.json'),
  repo = new URL('../../../../', import.meta.url).pathname,
  cli = join(repo, 'packages/ingest/dist/validate/cli15.js'),
  evidence: any[] = [];
function result(fn: () => unknown, root = ''): any {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { crash: (error.name + ': ' + error.message).replaceAll(root || '\0', '<sandbox>') };
  }
}
function wrapped(group: string, observation: any): any {
  return observation.crash
    ? {
        name: group,
        n: 1,
        problems: ['group crashed: ' + observation.crash],
        warnings: [],
        facts: [],
      }
    : observation;
}
for (const test of cases)
  it('matches complete donor and compiled CLI outcomes for ' + test.name, () => {
    const root = mkdtempSync(join(tmpdir(), 'sigma-compound-'));
    try {
      cpSync(new URL('corpus/', home), root, { recursive: true });
      for (const file of new Set<string>(test.ops.map((op: any) => op.file)))
        writeFileSync(
          join(root, 'data/release', file),
          readFileSync(new URL('compound/mutations/' + test.name + '/' + file, home)),
        );
      const actual = result(() => {
        const c = wave15Groups.find((group) => group.name === test.group)!.run(new Context(root));
        return { name: c.name, n: c.n, problems: c.problems, warnings: c.warnings, facts: c.facts };
      }, root);
      const variants = oracle[test.name];
      expect(
        variants.some((v: any) => isDeepStrictEqual(v.result, actual)),
        JSON.stringify(actual),
      ).toBe(true);
      const run = spawnSync(process.execPath, [cli, '--root', root, '--only', test.group], {
        cwd: tmpdir(),
        encoding: 'utf8',
      });
      const report = JSON.parse(run.stdout);
      expect(report.completeValidation).toBe(false);
      expect(report.groups).toHaveLength(1);
      const group = report.groups[0],
        observed = {
          name: group.name,
          n: group.n,
          problems: group.problems,
          warnings: group.warnings,
          facts: group.facts,
        };
      expect(
        variants.some((v: any) => isDeepStrictEqual(wrapped(test.group, v.result), observed)),
        JSON.stringify(observed),
      ).toBe(true);
      expect(run.status, run.stderr).toBe(observed.problems.length ? 1 : 0);
      evidence.push({
        name: test.name,
        group: test.group,
        status: 'PASS',
        exactVariants: variants.length,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
const vectors = parseOrderedPythonJson(
  readFileSync(new URL('compound/tuple-oracle.json', home), 'utf8'),
) as any[];
for (const [index, test] of vectors.entries())
  it('matches native Python tuple dictionaries and ordering ' + index, () => {
    const actual = result(() => {
      const a = pyTupleAt(test.first, [0, 1]),
        b = pyTupleAt(test.second, [0, 1]),
        mapping = pyDict<ReturnType<typeof pyTupleAt>, number>();
      mapping.set(a, 1);
      mapping.set(b, 2);
      return {
        keys: [...mapping.keys()].map(pythonRepr),
        values: [...mapping.values()],
        equal: pyEqual(a, b),
        sorted: pySortedTuples([a, b]).map(pythonRepr),
      };
    });
    expect(actual).toEqual(test.result);
  });
afterAll(() => {
  if (process.env.WAVE15_COMPOUND_REPORT)
    writeValidationReport(
      repo,
      process.env.WAVE15_COMPOUND_REPORT,
      JSON.stringify(
        { scope: 'wave15-compound', completeValidation: false, scenarios: evidence },
        null,
        2,
      ) + '\n',
    );
});
