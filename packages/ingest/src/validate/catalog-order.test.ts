import { expect, it } from 'vitest';
import { clonePythonNumbers, pythonNumberAt } from '../common/numbers.js';
import { numbers } from './execution-contract.js';
import { parseOrderedPythonJson, pythonKeys, transferPythonKeyOrder } from './ordered-json.js';

it.each([
  ['0', 'int'],
  ['0.0', 'float'],
  ['0e0', 'float'],
])('retains numeric token metadata through ordered parsing: %s', (token, type) => {
  const value = parseOrderedPythonJson('{"2":' + token + ',"1":true}') as any;
  expect(pythonKeys(value)).toEqual(['2', '1']);
  expect(pythonNumberAt(value, '2', value['2']).kind).toBe(type);
});

it('retains nested order and number kinds through the execution projection', () => {
  const year = '{"kfp":{},"nat":{},"eu":{},"files":[]}';
  const source = parseOrderedPythonJson(
    '{"contract":{"schema":2},"data":{"2025":' +
      year +
      ',"2024":' +
      year +
      '},"monthly":{},"plan2026":{"kfp":{},"nat":{},"eu":{}},' +
      '"latest":{"kfp":{},"nat":{},"eu":{}},"reconcile":{},"extra":{"2":0.0,"1":1e0}}',
  ) as any;
  const copy = numbers(source);
  expect(copy).not.toBe(source);
  expect(pythonKeys(copy.data)).toEqual(['2025', '2024']);
  expect(pythonKeys(copy.extra)).toEqual(['2', '1']);
  expect(pythonNumberAt(copy.extra, '2', copy.extra['2']).kind).toBe('float');
  expect(pythonNumberAt(copy.extra, '1', copy.extra['1']).kind).toBe('float');
});

it('preserves nested array dictionaries and escaped string boundaries on copy', () => {
  const source = parseOrderedPythonJson('{"x":[{"2":"comma,}\\\"","1":0.0}]}') as any;
  const copy = clonePythonNumbers(source);
  transferPythonKeyOrder(source, copy);
  expect(pythonKeys(copy.x[0])).toEqual(['2', '1']);
  expect(copy.x[0]['2']).toBe('comma,}"');
  expect(pythonNumberAt(copy.x[0], '1', copy.x[0]['1']).kind).toBe('float');
});

it('keeps first key positions and the final duplicate value and child order', () => {
  const value = parseOrderedPythonJson('{"2":{"2":0,"1":1},"1":true,"2":{"1":0.0,"2":1}}') as any;
  expect(pythonKeys(value)).toEqual(['2', '1']);
  expect(pythonKeys(value['2'])).toEqual(['1', '2']);
  expect(pythonNumberAt(value['2'], '1', value['2']['1']).kind).toBe('float');
});

it('omits deleted keys and appends new fields without mutating the source copy', () => {
  const source = parseOrderedPythonJson('{"2":0,"1":1}') as any;
  const copy = clonePythonNumbers(source);
  transferPythonKeyOrder(source, copy);
  delete copy['2'];
  copy['3'] = 3;
  expect(pythonKeys(copy)).toEqual(['1', '3']);
  expect(pythonKeys(source)).toEqual(['2', '1']);
});

it('retains JSON values and parser errors before order scanning', () => {
  for (const text of [' null ', ' [ ] ', ' { } ', ' "x" ', '{"x":{},"x":[1.0]}'])
    expect(parseOrderedPythonJson(text)).toEqual(JSON.parse(text));
  for (const text of ['{', '[1,]', '{"a":}', 'undefined'])
    expect(() => parseOrderedPythonJson(text)).toThrow(SyntaxError);
});
