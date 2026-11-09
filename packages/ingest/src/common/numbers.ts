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

export interface PythonNumber {
  value: number;
  kind: 'int' | 'float';
}
const floatTokens = new WeakMap<object, Map<string, number>>();

/** Preserve JSON float tokens such as 1.0 and 1e0, which JSON.parse normally loses.
 * Programmatic numbers use JSON.stringify semantics: safe whole numbers are ints.
 * Reparse source text after serialization/cloning to retain its numeric types.
 */
export function parsePythonJson<T>(text: string): T {
  return JSON.parse(
    text,
    function (this: object, key: string, value: unknown, context?: { source?: string }) {
      if (typeof value === 'number') {
        if (!context?.source) throw new Error('JSON numeric source text is unavailable');
        if (/[.eE]/.test(context.source)) {
          let tokens = floatTokens.get(this);
          if (!tokens) floatTokens.set(this, (tokens = new Map()));
          tokens.set(key, value);
        } else if (!Number.isSafeInteger(value)) {
          throw new Error('JSON integer exceeds the safe numeric range');
        }
      }
      return value;
    },
  ) as T;
}

export function pythonNumberAt(holder: object, key: string, value: number): PythonNumber {
  const tokens = floatTokens.get(holder);
  const float = tokens?.has(key) && Object.is(tokens.get(key), value);
  return { value, kind: float || !Number.isInteger(value) ? 'float' : 'int' };
}

/** CPython 3.12 sum over mixed JSON ints/floats (64-bit Linux).
 * The initial integer sum is exact; the first float starts float accumulation.
 * Later ints bypass Neumaier compensation, unlike later floats.
 */
export function pythonSum(values: Iterable<PythonNumber>): number {
  let integers = 0n;
  let floating = false;
  let total = 0;
  let correction = 0;
  let generic = false;
  for (const { value, kind } of values) {
    if (!Number.isFinite(value)) throw new Error('Non-finite sum operand');
    if (kind !== 'int' && kind !== 'float') throw new Error('Invalid numeric kind');
    if (kind === 'int') {
      if (!Number.isSafeInteger(value)) throw new Error('Unsafe integer sum operand');
      if (floating) total += value;
      else {
        integers += BigInt(value);
        // Overflow exits CPython's C-long fast path for the rest of the iterable.
        if (integers < -(1n << 63n) || integers >= 1n << 63n) generic = true;
      }
    } else if (!floating) {
      total = Number(integers) + value;
      floating = true;
    } else if (generic) total += value;
    else {
      const next = total + value;
      correction +=
        Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
      total = next;
    }
  }
  return floating
    ? correction !== 0 && Number.isFinite(correction)
      ? total + correction
      : total
    : Number(integers);
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
