import { pythonNumberAt, pythonSum, type PythonNumber } from '../common/numbers.js';
import { pyRepr } from './checks.js';
import { pythonKeys } from './ordered-json.js';

/** Donor-visible Python exception names for cases that terminate a validation group. */
export class PythonError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}
export function required<T>(object: Record<string, T>, key: string): T {
  return pyItem(object, key) as T;
}

/** Subscription, length and iteration retain Python's first failing operation. */
export function pyItem(
  value: any,
  key: string | number | boolean,
  sourceType = pythonType(value),
): any {
  if (Array.isArray(value) || typeof value === 'string') {
    if ((typeof key !== 'number' || !Number.isInteger(key)) && typeof key !== 'boolean')
      throw new PythonError(
        'TypeError',
        Array.isArray(value)
          ? `list indices must be integers or slices, not ${pythonType(key)}`
          : `string indices must be integers, not '${pythonType(key)}'`,
      );
    const sequence = typeof value === 'string' ? Array.from(value) : value;
    const at = Number(key) < 0 ? sequence.length + Number(key) : Number(key);
    if (at < 0 || at >= sequence.length)
      throw new PythonError(
        'IndexError',
        Array.isArray(value) ? 'list index out of range' : 'string index out of range',
      );
    return sequence[at];
  }
  if (value && typeof value === 'object') {
    if (typeof key === 'string' && Object.hasOwn(value, key)) return value[key];
    throw new PythonError('KeyError', pyRepr(key));
  }
  throw new PythonError('TypeError', `'${sourceType}' object is not subscriptable`);
}
export function pyLen(value: unknown, sourceType = pythonType(value)): number {
  if (typeof value === 'string') return Array.from(value).length;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  throw new PythonError('TypeError', `object of type '${sourceType}' has no len()`);
}
export function pyIter(value: unknown, sourceType = pythonType(value)): unknown[] {
  if (typeof value === 'string') return Array.from(value);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return pythonKeys(value);
  throw new PythonError('TypeError', `'${sourceType}' object is not iterable`);
}
export function sourceTypeAt(holder: any, key: string | number): string {
  const value = pyItem(holder, key);
  return typeof value === 'number'
    ? pythonNumberAt(holder, String(key), value).kind
    : pythonType(value);
}
export function pyLenAt(holder: any, key: string | number): number {
  const value = pyItem(holder, key);
  return pyLen(value, sourceTypeAt(holder, key));
}
export function pyIterAt(holder: any, key: string | number): unknown[] {
  const value = pyItem(holder, key);
  return pyIter(value, sourceTypeAt(holder, key));
}
export function pyItemAt(holder: any, key: string | number, index: string | number | boolean): any {
  const value = pyItem(holder, key);
  return pyItem(value, index, sourceTypeAt(holder, key));
}
export function pyHas(mapping: any, key: any): boolean {
  if (key && typeof key === 'object')
    throw new PythonError('TypeError', `unhashable type: '${pythonType(key)}'`);
  return typeof key === 'string' && Object.hasOwn(mapping, key);
}
export function pyLessEqual(
  a: any,
  b: any,
  leftType = pythonType(a),
  rightType = pythonType(b),
): boolean {
  if (
    (typeof a === 'number' || typeof a === 'boolean') &&
    (typeof b === 'number' || typeof b === 'boolean')
  )
    return Number(a) <= Number(b);
  if (typeof a === 'string' && typeof b === 'string') return a <= b;
  throw new PythonError(
    'TypeError',
    `'<=' not supported between instances of '${leftType}' and '${rightType}'`,
  );
}
export function pyAddAssign(a: PythonNumber, b: PythonNumber): number {
  if (typeof a.value !== 'number' || typeof b.value !== 'number')
    throw new PythonError(
      'TypeError',
      `unsupported operand type(s) for +=: '${typeof a.value === 'number' ? a.kind : pythonType(a.value)}' and '${typeof b.value === 'number' ? b.kind : pythonType(b.value)}'`,
    );
  return a.value + b.value;
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

/** Scoped donor repr: nested dictionaries retain input order and numeric token kinds. */
export function pythonRepr(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((_, i) => pyReprAt(value, i)).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${pythonKeys(value)
      .map((key) => `${pyRepr(key)}: ${pyReprAt(value, key)}`)
      .join(', ')}}`;
  return pyRepr(value);
}
export function pyReprAt(holder: any, key: string | number): string {
  const value = holder[key];
  return typeof value === 'number' && pythonNumberAt(holder, String(key), value).kind === 'float'
    ? floatRepr(value)
    : pythonRepr(value);
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

/** Python generator comprehensions must stop at the first invalid operand. */
export function* pyMap<T, U>(
  values: Iterable<T>,
  project: (value: T, index: number) => U,
): Generator<U> {
  let index = 0;
  for (const value of values) yield project(value, index++);
}

/** The %d conversion is evaluated after a check's short-circuited condition. */
export function pyDecimalInteger(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'boolean')
    throw new PythonError(
      'TypeError',
      '%d format: a real number is required, not ' + pythonType(value),
    );
  const number = Number(value);
  if (Number.isNaN(number))
    throw new PythonError('ValueError', 'cannot convert float NaN to integer');
  if (!Number.isFinite(number))
    throw new PythonError('OverflowError', 'cannot convert float infinity to integer');
  return BigInt(Math.trunc(number)).toString();
}

export function pyTypedSum(values: Iterable<PythonNumber>): PythonNumber {
  let kind: PythonNumber['kind'] = 'int';
  const value = pySum(
    pyMap(values, (operand) => {
      if (operand.kind === 'float') kind = 'float';
      return operand;
    }),
  );
  return { value, kind };
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
