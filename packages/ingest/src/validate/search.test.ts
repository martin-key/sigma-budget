import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parsePythonJson, pythonNumberAt } from '../common/numbers.js';
import { Context } from './context.js';
import { search } from './search.js';
const fixture = fileURLToPath(new URL('../../test/fixtures/wave17c', import.meta.url));
const corpus = `${fixture}/corpus`;
const cases = JSON.parse(readFileSync(`${fixture}/differential.json`, 'utf8')).cases;
for (const test of cases) {
  it(`SEARCH donor: ${test.name}`, () => {
    const ctx = new Context(corpus);
    const original = ctx.text.bind(ctx);
    const docs: Record<string, any> = {};
    for (const op of test.ops) {
      const doc = (docs[op.file] ??= parsePythonJson(original(op.file)));
      let parent = doc;
      for (const key of op.path.slice(0, -1)) parent = parent[key];
      const key = op.path.at(-1);
      if (op.op === 'delete') Array.isArray(parent) ? parent.splice(key, 1) : delete parent[key];
      else parent[key] = op.value;
    }
    ctx.text = (name: string) => {
      if (!(name in docs)) return original(name);
      let text = JSON.stringify(docs[name], function (key, value) {
        if (typeof value === 'number' && pythonNumberAt(this, key, value).kind === 'float')
          return `__search_float_${value}${Number.isInteger(value) ? '.0' : ''}__`;
        return value;
      }).replace(/"__search_float_([^"_]+)__"/g, '$1');
      if (test.name === 'float index' && name === 'search-index.json')
        text = text.replace('"items":[[0,', '"items":[[0.0,');
      if (test.name === 'exponent float index' && name === 'search-index.json')
        text = text.replace('"items":[[1,', '"items":[[1e0,');
      if (test.name === 'float title' && name === 'search-index.json')
        text = text.replace('"items":[[0,1,', '"items":[[0,1.0,');
      return text;
    };
    try {
      const actual = JSON.parse(JSON.stringify(search(ctx)));
      expect(actual).toEqual(test.expected);
    } catch (e) {
      if (!test.expected.crash) throw e;
      expect(`${(e as Error).name}: ${(e as Error).message}`).toBe(test.expected.crash);
    }
  });
}
