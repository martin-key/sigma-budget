import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { INTEGER_DIGIT_ZEROES, INTEGER_NONPRINTABLE } from './catalog-integer-data.js';
import { catalogIntegerRepr, catalogIntegerText } from './catalog-integer.js';

it('uses the independently captured Python 3.12 Unicode repertoire', () => {
  const donor = JSON.parse(
    readFileSync(
      new URL('../../test/fixtures/validate17a/integer/data.json', import.meta.url),
      'utf8',
    ),
  );
  expect(INTEGER_DIGIT_ZEROES).toEqual(donor.zeroes);
  expect(INTEGER_NONPRINTABLE).toEqual(donor.nonprintable);
});

it('distinguishes numeric whitespace from string whitespace and later Unicode digits', () => {
  expect(catalogIntegerText('\u0085+２_０２０\u0085')).toBe('+2_020');
  for (const character of ['\ufeff', '\u001c', '\u001f', '\u{10d43}', '\u{1ccf2}'])
    expect(catalogIntegerText(character + '2020')).toBe(character + '2020');
  expect(catalogIntegerRepr('\ufeff2020')).toBe("'\\ufeff2020'");
  expect(catalogIntegerRepr('\u00852020')).toBe("'\\x852020'");
});
