import { expect, it } from 'vitest';
import { pythonTextSpace } from './text.js';

it.each(['\u0085', '\u001c', '\u001d', '\u001e', '\u001f', '\u00a0', '\u2003', '\u3000'])(
  'matches Python text whitespace %j',
  (space) => expect(pythonTextSpace(`${space}едно${space}${space}две${space}`)).toBe('едно две'),
);
it('does not treat a BOM as Python whitespace', () =>
  expect(pythonTextSpace('\ufeffедно\ufeff')).toBe('\ufeffедно\ufeff'));
