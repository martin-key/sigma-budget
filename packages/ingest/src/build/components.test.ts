import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { transformState, type StateLaw } from './components.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/components-rates');
const read = (name: string): unknown => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const law = () => read('inputs/law.json') as StateLaw;
it('matches the independent Python state transformation', () => {
  expect(transformState(law())).toEqual(read('state.json'));
});
it('rejects an altered source label', () => {
  const source = law(),
    line = source.art1.lines.find((l) => l.sec === 'I' && l.no === '1' && l.level > 0)!;
  line.text = 'other';
  expect(() => transformState(source)).toThrow(/expected/);
});
it('rejects a changed total', () => {
  const source = law(),
    line = source.art1.lines.find((l) => l.sec === 'I' && !l.header)!;
  line.law += 1;
  expect(() => transformState(source)).toThrow(/differs/);
});
