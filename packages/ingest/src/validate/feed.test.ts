import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Context } from './context.js';
import { feed } from './feed.js';
import { runWave17b } from './feed-runner.js';
const fixture = fileURLToPath(new URL('../../test/fixtures/validate17b/', import.meta.url));
const cases = [
  ...JSON.parse(readFileSync(fixture + 'cases.json', 'utf8')),
  ...JSON.parse(readFileSync(fixture + 'extra-cases.json', 'utf8')),
];
const oracle = {
  ...JSON.parse(readFileSync(fixture + 'oracle.json', 'utf8')),
  ...JSON.parse(readFileSync(fixture + 'extra-oracle.json', 'utf8')),
};
for (const scenario of cases)
  it(`donor FEED ${scenario.name}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'feed-parity-'));
    try {
      cpSync(fixture + 'corpus', root, { recursive: true });
      for (const op of scenario.ops) {
        const path = join(root, 'data/release', op.file);
        if (op.op === 'root') {
          writeFileSync(path, JSON.stringify(op.value));
          continue;
        }
        if (op.op === 'bytes') {
          writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from(op.append)]));
          continue;
        }
        if (op.op === 'text') {
          const text = readFileSync(path, 'utf8');
          writeFileSync(path, text.replace(op.old, op.new));
          continue;
        }
        const tokens = new WeakMap<object, Map<string, { value: number; source: string }>>();
        const value = JSON.parse(readFileSync(path, 'utf8'), function (
          this: any,
          key: string,
          v: any,
          context: any,
        ) {
          if (typeof v === 'number') {
            let m = tokens.get(this);
            if (!m) {
              m = new Map();
              tokens.set(this, m);
            }
            m.set(key, { value: v, source: context.source });
          }
          return v;
        } as any);
        let target = value;
        for (const key of op.path.slice(0, -1)) target = target[key];
        const key = op.path.at(-1);
        if (op.op === 'set') {
          target[key] = op.value;
          tokens.get(target)?.delete(String(key));
        } else if (op.op === 'delete')
          Array.isArray(target) ? target.splice(key, 1) : delete target[key];
        else if (op.op === 'append') target[key].push(op.value);
        else if (op.op === 'reverse') target[key].reverse();
        writeFileSync(
          path,
          JSON.stringify(value, function (this: any, key: string, v: any) {
            const original = tokens.get(this)?.get(key);
            return original && Object.is(v, original.value)
              ? (JSON as any).rawJSON(original.source)
              : v;
          }),
        );
      }
      let actual: any;
      try {
        const c = feed(new Context(root));
        actual = {
          check: {
            name: c.name,
            n: c.n,
            problems: c.problems,
            warnings: c.warnings,
            facts: c.facts,
          },
          exceptions: [],
        };
      } catch (e) {
        actual = { crash: `${(e as Error).name}: ${(e as Error).message}` };
      }
      if (scenario.name === 'coherent_month_end_drift') {
        expect(oracle[scenario.name].raw.check.problems).toEqual([]);
        const result = runWave17b(new Context(root), ['FEED']);
        expect(result.status).toBe('FAIL');
        expect(result.independent?.problems).toEqual([
          'report kfp-2026-09: dataset and event must use month end 2026-09-30',
        ]);
      }
      if (scenario.name === 'xml_dtd') {
        expect(oracle[scenario.name].raw.check.problems).toEqual([]);
        expect(actual.check.problems).toEqual([
          'feed.xml is not well-formed XML: DTD and external entities are forbidden',
        ]);
      } else expect(actual).toEqual(oracle[scenario.name].raw);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
