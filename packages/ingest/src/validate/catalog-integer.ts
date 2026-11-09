import { INTEGER_DIGIT_ZEROES, INTEGER_NONPRINTABLE } from './catalog-integer-data.js';

/** Numeric-string whitespace differs from both JavaScript trim and Python str.strip. */
export function catalogIntegerText(value: string): string {
  return catalogDecimalText(
    value.replace(
      /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
      '',
    ),
  );
}

/** Decimal repertoire normalization without integer parsing's whitespace removal. */
export function catalogDecimalText(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    const zero = INTEGER_DIGIT_ZEROES.find((start) => code >= start && code < start + 10);
    return zero === undefined ? character : String(code - zero);
  }).join('');
}

/** Invalid integer diagnostics retain the frozen Python Unicode repertoire. */
export function catalogIntegerRepr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let result = quote;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === quote || character === '\\') result += '\\' + character;
    else if (character === '\n') result += '\\n';
    else if (character === '\r') result += '\\r';
    else if (character === '\t') result += '\\t';
    else if (INTEGER_NONPRINTABLE.some(([start, end]) => code >= start! && code <= end!))
      result +=
        code <= 0xff
          ? '\\x' + code.toString(16).padStart(2, '0')
          : code <= 0xffff
            ? '\\u' + code.toString(16).padStart(4, '0')
            : '\\U' + code.toString(16).padStart(8, '0');
    else result += character;
  }
  return result + quote;
}
