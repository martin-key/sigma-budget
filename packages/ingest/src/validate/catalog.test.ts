import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runWave17a, applyWave17aExceptions, WAVE17A_REMAINING } from './wave17a.js';
import { writeValidationReport } from './report.js';
import { core, catalog } from './catalog.js';
import { Context } from './context.js';
const base = new URL('../../test/fixtures/validate17a/', import.meta.url);
const load = (p: string): any => JSON.parse(readFileSync(new URL(p, base), 'utf8'));
const originalCases: any[] = load('cases.json');
const cases: any[] = [
    ...originalCases,
    ...load('cases-extra.json'),
    ...load('review/cases.json'),
    ...load('key-whitespace/cases.json'),
    ...load('integer/cases.json'),
    ...load('integer-limit/cases.json'),
    ...load('reader/cases.json'),
    ...load('boundaries/cases.json'),
    ...load('containers/cases.json'),
    ...load('iterators/cases.json'),
    ...load('catalog-semantics/cases.json'),
    ...load('short-circuit/cases.json'),
    ...load('membership/cases.json'),
    ...load('year-keys/cases.json'),
    ...load('source-strings/cases.json'),
  ],
  oracle = {
    ...load('oracle.json'),
    ...load('oracle-extra.json'),
    ...load('review/oracle.json'),
    ...load('key-whitespace/oracle.json'),
    ...load('integer/oracle.json'),
    ...load('integer-limit/oracle.json'),
    ...load('reader/oracle.json'),
    ...load('boundaries/oracle.json'),
    ...load('containers/oracle.json'),
    ...load('iterators/oracle.json'),
    ...load('catalog-semantics/oracle.json'),
    ...load('short-circuit/oracle.json'),
    ...load('membership/oracle.json'),
    ...load('year-keys/oracle.json'),
    ...load('source-strings/oracle.json'),
  };
function mutate(root: string, op: any) {
  const p = join(root, op.file);
  mkdirSync(dirname(p), { recursive: true });
  if (op.op === 'deleteFile') unlinkSync(p);
  else if (op.op === 'write') writeFileSync(p, op.value);
  else if (op.op === 'append') appendFileSync(p, op.value);
  else if (op.op === 'replace') {
    const s = readFileSync(p, 'utf8');
    if (s.split(op.old).length !== 2) throw Error('replacement must be unique');
    writeFileSync(p, s.replace(op.old, op.value));
  } else {
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    let x = obj;
    for (const k of op.path.slice(0, -1)) x = x[k];
    if (op.op === 'deleteKey') delete x[op.path.at(-1)];
    else x[op.path.at(-1)] = op.op === 'rawSet' ? '__review_raw_number__' : op.value;
    let text = JSON.stringify(obj);
    if (op.op === 'rawSet') text = text.replace('"__review_raw_number__"', op.value);
    writeFileSync(p, text);
  }
}
const evidence: { name: string; status: string; groups: Record<string, unknown> }[] = [];
afterAll(() => {
  if (process.env.WAVE17A_PARITY_REPORT)
    writeValidationReport(
      new URL('../../../../', import.meta.url).pathname,
      process.env.WAVE17A_PARITY_REPORT,
      JSON.stringify(
        {
          scope: 'wave17a',
          completeValidation: false,
          unported: WAVE17A_REMAINING,
          scenarios: evidence,
        },
        null,
        2,
      ) + '\n',
    );
});
function capture(fn: (c: Context) => any, ctx: Context): any {
  try {
    const c = fn(ctx);
    return { name: c.name, n: c.n, problems: c.problems, warnings: c.warnings, facts: c.facts };
  } catch (e) {
    return {
      crash:
        e instanceof Error ? `${e.name}: ${e.message.replaceAll(ctx.root, '<ROOT>')}` : String(e),
    };
  }
}
describe('CORE and CATALOG frozen Python differential', () => {
  // Cold full-corpus CORE + CATALOG baseline measured 5.43s with V8 coverage.
  // Keep the default limit for the remaining differential scenarios.
  for (const test of cases)
    it(
      test.name,
      () => {
        const root = mkdtempSync(join(tmpdir(), 'sigma-17a-'));
        const item: (typeof evidence)[number] = { name: test.name, status: 'FAIL', groups: {} };
        try {
          cpSync(new URL('corpus/', base), root, { recursive: true });
          if (!originalCases.includes(test))
            cpSync(new URL('overlay/', base), root, { recursive: true });
          for (const op of test.ops) mutate(root, op);
          for (const group of test.groups) {
            const actual = capture(group === 'CORE' ? core : catalog, new Context(root));
            item.groups[group] = actual;
            expect(actual).toEqual(oracle[test.name][group]);
            if (test.compiled) {
              const run = spawnSync(
                process.execPath,
                [
                  new URL('../../dist/validate/cli17a.js', import.meta.url).pathname,
                  '--root',
                  root,
                  '--only',
                  group,
                ],
                { cwd: root, encoding: 'utf8' },
              );
              const output = JSON.parse(run.stdout),
                expected = actual.crash
                  ? {
                      name: group,
                      n: 1,
                      problems: ['group crashed: ' + actual.crash],
                      warnings: [],
                      facts: [],
                    }
                  : oracle[test.name][group],
                baseline = oracle['key-baseline'][group].problems,
                problems = expected.problems.filter((p: string) => !baseline.includes(p));
              expect(output.raw).toEqual([expected]);
              expect(output.groups[0].problems).toEqual(problems);
              expect(run.status, run.stderr).toBe(problems.length ? 1 : 0);
            }
          }
          item.status = 'PASS';
        } finally {
          evidence.push(item);
          rmSync(root, { recursive: true, force: true });
        }
      },
      test.name === 'baseline' ? 15_000 : undefined,
    );
});

describe('complete vintage-key CLI outcomes from the Python wrapper', () => {
  const outcomes = load('year-keys/wrapper-oracle.json');
  for (const test of cases.filter((item) => item.complete))
    it(test.name, () => {
      const root = mkdtempSync(join(tmpdir(), 'sigma-17a-years-'));
      try {
        cpSync(new URL('corpus/', base), root, { recursive: true });
        cpSync(new URL('overlay/', base), root, { recursive: true });
        for (const op of test.ops) mutate(root, op);
        for (const accepted of [true, false]) {
          const run = spawnSync(
            process.execPath,
            [
              new URL('../../dist/validate/cli17a.js', import.meta.url).pathname,
              '--root',
              root,
              '--only',
              'CORE,CATALOG',
              ...(accepted ? [] : ['--no-accepted']),
            ],
            { cwd: root, encoding: 'utf8' },
          );
          const output = JSON.parse(run.stdout);
          expect({
            raw: output.raw,
            groups: output.groups,
            exceptions: output.exceptions,
            totals: output.totals,
            status: output.status,
            exit: run.status,
          }).toEqual(outcomes[test.name][accepted ? 'default' : 'noAccepted']);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
});

it('matches the unchanged Python production wrapper on the frozen baseline and exposes raw findings', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-17a-wrap-'));
  try {
    cpSync(new URL('corpus/', base), root, { recursive: true });
    const accepted = runWave17a(new Context(root), ['CORE', 'CATALOG']);
    const raw = runWave17a(new Context(root), ['CORE', 'CATALOG'], false);
    const wrapper = load('wrapper/oracle.json').baseline,
      main = load('wrapper/main-oracle.json');
    for (const result of [accepted, raw]) {
      const donor = result.accepted ? main.default : main.noAccepted;
      expect(
        result.groups.map((x) => ({
          name: x.name,
          n: x.n,
          problems: x.problems,
          warnings: x.warnings,
          facts: x.facts,
        })),
      ).toEqual(Object.values(donor.groups));
      expect(result.status === 'PASS' ? 0 : 1).toBe(donor.exit);
    }
    for (const group of accepted.groups) {
      const w = wrapper[group.name];
      expect({
        name: group.name,
        n: group.n,
        problems: group.problems,
        warnings: group.warnings,
        facts: group.facts,
        exceptions: accepted.exceptions
          .filter((x) => x.group === group.name)
          .map((x) => [x.group, x.problem, x.reason]),
      }).toEqual(w);
    }
    expect(
      raw.groups.map((x) => ({
        name: x.name,
        n: x.n,
        problems: x.problems,
        warnings: x.warnings,
        facts: x.facts,
      })),
    ).toEqual(accepted.raw);
    expect(raw.status).toBe('FAIL');
    expect(accepted.status).toBe('PASS');
    expect(accepted.totals.warnings).toBe(17);
    expect(accepted.unported).toEqual(expect.arrayContaining(['SEARCH', 'FEED']));
    expect(() => runWave17a(new Context(root), ['SEARCH'])).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('does not accept new drift just because older production patterns are broad', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-17a-drift-'));
  try {
    cpSync(new URL('corpus/', base), root, { recursive: true });
    const op = load('cases-extra.json').find((x: any) => x.name === 'source-missing-key').ops[0];
    mutate(root, op);
    const check = core(new Context(root));
    const result = applyWave17aExceptions(check);
    expect(result).toHaveLength(0);
    expect(check.problems.some((x) => x.startsWith('sources: keys'))).toBe(true);
    const donor = load('wrapper/oracle.json')['source-missing-key'].CORE;
    expect(donor.exceptions.length).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('retains the dynamic release pointer read by page needs in the complete corpus', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-17a-complete-'));
  try {
    cpSync(new URL('corpus/', base), root, { recursive: true });
    cpSync(new URL('overlay/', base), root, { recursive: true });
    const result = runWave17a(new Context(root), ['CORE', 'CATALOG']);
    const wrapper = load('wrapper/oracle.json')['baseline-complete'];
    expect(result.totals.warnings).toBe(15);
    expect(result.status).toBe('PASS');
    for (const c of result.groups) {
      const expected = wrapper[c.name];
      expect({
        name: c.name,
        n: c.n,
        problems: c.problems,
        warnings: c.warnings,
        facts: c.facts,
        exceptions: result.exceptions
          .filter((x) => x.group === c.name)
          .map((x) => [x.group, x.problem, x.reason]),
      }).toEqual(expected);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
