import { expect, it } from 'vitest';
import { pythonNumberAt, parsePythonJson } from '../common/numbers.js';
import { parseOrderedPythonJson, pythonKeys } from './ordered-json.js';

it('retains source dictionary order alongside raw float kinds', () => {
  const value = parseOrderedPythonJson('{"2":0.0,"1":1e0}') as Record<string, number>;
  expect(pythonKeys(value)).toEqual(['2', '1']);
  expect(pythonNumberAt(value, '2', value['2']!)).toEqual({ value: 0, kind: 'float' });
  expect(pythonNumberAt(value, '1', value['1']!)).toEqual({ value: 1, kind: 'float' });
  expect(Object.keys(parsePythonJson<object>('{"2":0,"1":1}'))).toEqual(['1', '2']);
});
it('handles nested arrays, braces and Unicode string values', () => {
  const value = parseOrderedPythonJson(
    '{"list":[{"2":"кирилица,}","1":[]},null,true],"2":{},"1":0}',
  ) as any;
  expect(pythonKeys(value)).toEqual(['list', '2', '1']);
  expect(pythonKeys(value.list[0])).toEqual(['2', '1']);
  expect(value.list[0]['2']).toBe('кирилица,}');
});
it('retains order after an escaped property name', () => {
  const source = JSON.stringify({ 'a"b': 'comma,}' }).slice(0, -1) + ',"2":0,"1":1}';
  const value = parseOrderedPythonJson(source) as any;
  expect(pythonKeys(value)).toEqual(['a"b', '2', '1']);
  expect(value['a"b']).toBe('comma,}');
});
it('uses final duplicate values with first-insertion key positions', () => {
  const value = parseOrderedPythonJson('{"2":{"2":0,"1":1},"1":true,"2":{"1":0,"2":1}}') as any;
  expect(pythonKeys(value)).toEqual(['2', '1']);
  expect(pythonKeys(value['2'])).toEqual(['1', '2']);
});
it('does not attach an overwritten duplicate object order to a primitive or array', () => {
  expect(parseOrderedPythonJson('{"x":{"2":0,"1":1},"x":null}')).toEqual({ x: null });
  expect(parseOrderedPythonJson('{"x":{"2":0,"1":1},"x":[1.0]}')).toEqual({ x: [1] });
});
it('preserves whitespace and empty containers and rejects malformed JSON before scanning', () => {
  for (const source of [' null ', ' [ ] ', ' { } ', ' "x" ', ' [1, {"2":[],"1":{}}, 3] '])
    expect(parseOrderedPythonJson(source)).toEqual(JSON.parse(source));
  for (const source of ['{', '[1,]', '{"a":}', 'undefined'])
    expect(() => parseOrderedPythonJson(source)).toThrow(SyntaxError);
});
