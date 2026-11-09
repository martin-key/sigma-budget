/** CPython 3.12 float-iterable sum, with Neumaier compensation.
 * Reference: https://github.com/python/cpython/blob/v3.12.14/Python/bltinmodule.c
 * Integer counts used here are bounded to safe integers by their callers.
 */
export function pythonFloatSum(values: Iterable<number>): number {
  let total = 0;
  let correction = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('Non-finite sum operand');
    const next = total + value;
    correction += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }
  return correction !== 0 && Number.isFinite(correction) ? total + correction : total;
}

/** Decimal digits and surrounding whitespace accepted by Python numeric strings. */
export function pythonNumericText(value: string): string {
  const whitespace =
    /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
  const digit = /\p{Decimal_Number}/u;
  return Array.from(value.replace(whitespace, ''), (ch) => {
    if (!digit.test(ch)) return ch;
    const code = ch.codePointAt(0)!;
    let first = code;
    while (first > 0 && digit.test(String.fromCodePoint(first - 1))) first--;
    return String((code - first) % 10);
  }).join('');
}
