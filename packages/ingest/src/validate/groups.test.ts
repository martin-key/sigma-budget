import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseYaml } from '../io/registry.js';
import { Context, safePath } from './context.js';
import { envelope, glossary, inputs, numeric, privacy, sizes } from './foundations.js';
import { validateRegistry } from './registry.js';
import { applyExceptions, UNPORTED_GROUPS } from './runner.js';

const home = new URL('../../test/fixtures/validate14/', import.meta.url);
const load = (p: string): any => JSON.parse(readFileSync(new URL(p, home), 'utf8'));
const corpus = new URL('corpus/', home).pathname,
  tracked: string[] = load('tracked-paths.json'),
  cases: any[] = load('cases.json'),
  oracle = load('groups-oracle.json');
const functions: Record<string, (ctx: Context) => any> = {
  INPUTS: inputs,
  ENVELOPE: envelope,
  NUMBERS: numeric,
  SIZES: sizes,
  PRIVACY: privacy,
  GLOSSARY: glossary,
};
function prepare(root: string, ops: any[]): string[] {
  cpSync(corpus, root, { recursive: true });
  for (const rel of tracked) {
    if (!['pipeline/', 'apps/', 'tests/', '.github/', 'docs/'].some((p) => rel.startsWith(p)))
      continue;
    const p = join(root, rel);
    if (!existsSync(p)) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, '');
    }
  }
  const added: string[] = [];
  for (const op of ops) {
    const p = safePath(root, op.file);
    mkdirSync(dirname(p), { recursive: true });
    if (op.op === 'set') {
      const raw = readFileSync(p, 'utf8'),
        value: any = p.endsWith('.yaml') ? parseYaml(raw) : JSON.parse(raw);
      let dest = value;
      for (const key of op.path.slice(0, -1)) dest = dest[key];
      dest[op.path.at(-1)] = op.value;
      writeFileSync(p, JSON.stringify(value));
    } else if (op.op === 'deleteKey') {
      const raw = readFileSync(p, 'utf8'),
        value: any = p.endsWith('.yaml') ? parseYaml(raw) : JSON.parse(raw);
      let dest = value;
      for (const key of op.path.slice(0, -1)) dest = dest[key];
      delete dest[op.path.at(-1)];
      writeFileSync(p, JSON.stringify(value));
    } else if (op.op === 'write') {
      writeFileSync(p, op.text);
      added.push(op.file);
    } else if (op.op === 'append') appendFileSync(p, op.text);
    else if (op.op === 'deleteFile') unlinkSync(p);
    else if (op.op === 'duplicateFirstLine') {
      const lines = readFileSync(p, 'utf8').trimEnd().split('\n');
      writeFileSync(p, [...lines, lines[0], ''].join('\n'));
    } else if (op.op === 'repeat') writeFileSync(p, op.char.repeat(op.count));
    else if (op.op === 'hashNoise')
      writeFileSync(
        p,
        Array.from({ length: op.count }, (_, i) =>
          createHash('sha256').update(String(i)).digest('hex'),
        ).join(''),
      );
    else throw new Error(`Unknown mutation ${op.op}`);
  }
  return added;
}
function capture(c: any) {
  return {
    name: c.name,
    n: c.n,
    problems: [...c.problems],
    warnings: [...c.warnings],
    facts: [...c.facts],
  };
}
const evidence: { scenario: string; status: 'PASS' | 'FAIL'; groups: Record<string, unknown> }[] =
  [];
afterAll(() => {
  const report = process.env.WAVE14_PARITY_REPORT;
  if (!report) return;
  if (!report.startsWith('tmp/ts-migration/') || !report.endsWith('.json'))
    throw new Error('Unsafe parity report path');
  const repo = new URL('../../../../', import.meta.url).pathname;
  const file = safePath(repo, report);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        scope: 'wave14',
        completeValidation: false,
        unported: UNPORTED_GROUPS,
        scenarios: evidence,
      },
      null,
      2,
    ) + '\n',
  );
});
describe('frozen Python wave14 corpus', () => {
  for (const test of cases)
    it(
      test.name,
      () => {
        const root = mkdtempSync(join(tmpdir(), 'sigma-wave14-'));
        const item: (typeof evidence)[number] = { scenario: test.name, status: 'FAIL', groups: {} };
        try {
          const added = prepare(root, test.ops),
            ctx = new Context(root);
          for (const group of test.groups) {
            let result: unknown;
            if (group === 'REGISTRY')
              result = validateRegistry(root, { trackedPaths: [...tracked, ...added] });
            else if (oracle[test.name][group].crash) {
              try {
                functions[group]!(ctx);
                result = { crash: 'no error' };
              } catch (error) {
                result = {
                  crash: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
                };
              }
            } else {
              const raw = functions[group]!(ctx),
                before = capture(raw),
                exceptions = applyExceptions(raw).map((e) => [e.group, e.problem, e.reason]);
              result = { raw: before, accepted: capture(raw), exceptions };
            }
            item.groups[group] = result;
            expect(result).toEqual(oracle[test.name][group]);
          }
          item.status = 'PASS';
        } finally {
          evidence.push(item);
          rmSync(root, { recursive: true, force: true });
        }
      },
      30000,
    );
});
