import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Check } from './checks.js';
import { amounts, cleanText, eurIn, moneyIn, pctIn } from './feed-text.js';

const fixture = fileURLToPath(new URL('../../test/fixtures/validate17b/', import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(`${fixture}/${name}`, 'utf8'));
const cases: unknown[] = read('helper-cases.json');
const oracle = read('helpers-oracle.json');

describe('FEED text helpers against Python 3.12', () => {
  for (const [index, value] of cases.entries()) {
    it(`matches donor case ${index}`, () => {
      const actual: Record<string, unknown> = {};
      for (const [name, fn] of [
        ['money', moneyIn],
        ['eur', eurIn],
        ['pct', pctIn],
      ] as const) {
        try {
          actual[name] = fn(value);
        } catch (e) {
          actual[name] = { crash: (e as Error).name };
        }
      }
      const c = new Check('TEXT');
      cleanText(c, 'text', value, true);
      actual.clean = {
        name: c.name,
        n: c.n,
        problems: c.problems,
        warnings: c.warnings,
        facts: c.facts,
      };
      try {
        const a = new Check('AMOUNTS');
        amounts(a, 'amount', value, [1]);
        actual.amounts = {
          name: a.name,
          n: a.n,
          problems: a.problems,
          warnings: a.warnings,
          facts: a.facts,
        };
      } catch (e) {
        actual.amounts = { crash: (e as Error).name };
      }
      expect(actual).toEqual(oracle[index]);
    });
  }
});

describe('additional printed precision and typography boundaries', () => {
  const cases = read('extra-helper-cases.json') as {
    text: unknown;
    money: unknown[];
    eur: unknown[];
    pct: unknown[];
  }[];
  const oracle = read('extra-helpers-oracle.json');
  for (const [index, value] of cases.entries())
    it(`matches donor boundary ${index}`, () => {
      const actual: Record<string, unknown> = {};
      for (const [name, fn] of [
        ['money', moneyIn],
        ['eur', eurIn],
        ['pct', pctIn],
      ] as const) {
        try {
          actual[name] = fn(value.text);
        } catch (e) {
          actual[name] = { crash: `${(e as Error).name}: ${(e as Error).message}` };
        }
      }
      try {
        const c = new Check('AMOUNTS');
        amounts(c, 'amount', value.text, value.money, value.eur, value.pct);
        actual.amounts = {
          name: c.name,
          n: c.n,
          problems: c.problems,
          warnings: c.warnings,
          facts: c.facts,
        };
      } catch (e) {
        actual.amounts = { crash: `${(e as Error).name}: ${(e as Error).message}` };
      }
      expect(actual).toEqual(oracle[index]);
    });
});
