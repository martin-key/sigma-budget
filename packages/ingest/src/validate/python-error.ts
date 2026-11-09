import { pythonNumberAt, pythonSum, type PythonNumber } from '../common/numbers.js';

/** Donor-visible Python exception names for cases that terminate a validation group. */
export class PythonError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}
export function required<T>(object: Record<string, T>, key: string): T {
  if (!Object.hasOwn(object, key)) throw new PythonError('KeyError', `'${key}'`);
  return object[key]!;
}
export function divide(a: number, b: number): number {
  if (b === 0) throw new PythonError('ZeroDivisionError', 'float division by zero');
  return a / b;
}
/** Display a Python float in diagnostics, retaining the float token's `.0`. */
export function floatRepr(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf';
  if (Object.is(value, -0)) return '-0.0';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16)) {
    const [mantissa, exponent] = value.toExponential().split('e');
    const e = Number(exponent);
    return `${mantissa}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
/** Python str.strip() whitespace differs from JavaScript trim (notably NEL and BOM). */
export function pyStrip(value: string): string {
  return value.replace(
    /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
    '',
  );
}

/** Python equality treats bools as integers and numeric int/float values alike. */
export function pyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    (typeof a === 'boolean' || typeof a === 'number') &&
    (typeof b === 'boolean' || typeof b === 'number')
  )
    return Number(a) === Number(b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => pyEqual(x, b[i]));
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const x = a as Record<string, unknown>,
      y = b as Record<string, unknown>,
      keys = Object.keys(x);
    return (
      keys.length === Object.keys(y).length &&
      keys.every((k) => Object.hasOwn(y, k) && pyEqual(x[k], y[k]))
    );
  }
  return false;
}

export function pyIntAt(holder: any, key: string | number): boolean {
  const value = holder[key];
  return (
    typeof value === 'boolean' ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      pythonNumberAt(holder, String(key), value).kind === 'int')
  );
}

export function pythonType(value: unknown): string {
  if (value === null || value === undefined) return 'NoneType';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'str';
  return Array.isArray(value) ? 'list' : 'dict';
}

export function pySubtract(a: PythonNumber, b: PythonNumber): number {
  if (typeof a.value !== 'number' || typeof b.value !== 'number') {
    const left = typeof a.value === 'number' ? a.kind : pythonType(a.value),
      right = typeof b.value === 'number' ? b.kind : pythonType(b.value);
    throw new PythonError(
      'TypeError',
      "unsupported operand type(s) for -: '" + left + "' and '" + right + "'",
    );
  }
  return a.value - b.value;
}

/** Python booleans participate in the integer fast path of sum. */
export function pySum(values: Iterable<PythonNumber>): number {
  function* checked() {
    let left = 'int';
    for (const operand of values) {
      if (typeof operand.value !== 'number')
        throw new PythonError(
          'TypeError',
          "unsupported operand type(s) for +: '" +
            left +
            "' and '" +
            pythonType(operand.value) +
            "'",
        );
      if (operand.kind === 'float') left = 'float';
      yield operand;
    }
  }
  return pythonSum(checked());
}
