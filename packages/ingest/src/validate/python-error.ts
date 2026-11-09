import { pythonNumberAt, pythonSum, type PythonNumber } from '../common/numbers.js';
import { pyRepr, fmt, isnum } from './checks.js';
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
  if (value instanceof Map) {
    if (value.has(key)) return value.get(key);
    throw new PythonError('KeyError', pythonRepr(key));
  }
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
  if (mapping instanceof Map) return mapping.has(key);
  return typeof key === 'string' && Object.hasOwn(mapping, key);
}

/** Dict.get supplies its default only for an absent key, preserving explicit None. */
export function pyGet(mapping: any, key: any, fallback: any = undefined): any {
  if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping))
    throw new PythonError(
      'AttributeError',
      `'${pythonType(mapping)}' object has no attribute 'get'`,
    );
  return pyHas(mapping, key)
    ? mapping instanceof Map
      ? mapping.get(key)
      : mapping[key]
    : fallback;
}

export function pyIterGet(mapping: any, key: string): unknown[] {
  const value = pyGet(mapping, key, []);
  return pyIter(
    value,
    typeof value === 'number' ? pythonNumberAt(mapping, key, value).kind : pythonType(value),
  );
}

class PythonDict<K, V> extends Map<K, V> {
  private readonly representations = new Map<K, string>();
  private storedKey(key: K): K {
    if (key !== null && typeof key === 'object')
      throw new PythonError('TypeError', `unhashable type: '${pythonType(key)}'`);
    if (super.has(key)) return key;
    const equal = (typeof key === 'boolean' ? Number(key) : Boolean(key)) as K;
    return (typeof key === 'boolean' || key === 0 || key === 1) && super.has(equal) ? equal : key;
  }
  override has(key: K): boolean {
    return super.has(this.storedKey(key));
  }
  override get(key: K): V | undefined {
    return super.get(this.storedKey(key));
  }
  override set(key: K, value: V, representation = pythonRepr(key)): this {
    const stored = this.storedKey(key);
    if (!super.has(stored)) this.representations.set(stored, representation);
    return super.set(stored, value);
  }
  keyRepr(key: K): string {
    return this.representations.get(this.storedKey(key))!;
  }
}

export function pyDict<K, V>(entries: Iterable<readonly [K, V]> = []): PythonDict<K, V> {
  const result = new PythonDict<K, V>();
  for (const [key, value] of entries) result.set(key, value);
  return result;
}

/** Scoped by_id keeps Python dictionary keys instead of JavaScript property coercion. */
export function pyById(rows: unknown, key = 'id'): any {
  const result = pyDict<unknown, unknown>();
  for (const row of pyIter(rows))
    if (row && typeof row === 'object' && !Array.isArray(row) && Object.hasOwn(row, key))
      result.set((row as Record<string, unknown>)[key], row, pyReprAt(row, key));
  return result;
}

/** Python string formatting after a prefix slice, including list repr and source float kinds. */
export function pyPrefixStringAt(holder: any, key: string, end: number): string {
  const value = pyGet(holder, key, '');
  if (typeof value === 'string') return Array.from(value).slice(0, end).join('');
  if (Array.isArray(value))
    return `[${value
      .slice(0, end)
      .map((_, i) => pyReprAt(value, i))
      .join(', ')}]`;
  if (value && typeof value === 'object')
    throw new PythonError('KeyError', `slice(None, ${end}, None)`);
  const type =
    typeof value === 'number' ? pythonNumberAt(holder, key, value).kind : pythonType(value);
  throw new PythonError('TypeError', `'${type}' object is not subscriptable`);
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
export function pyGreaterThan(
  a: any,
  b: any,
  leftType = pythonType(a),
  rightType = pythonType(b),
): boolean {
  if (
    (typeof a === 'number' || typeof a === 'boolean') &&
    (typeof b === 'number' || typeof b === 'boolean')
  )
    return Number(a) > Number(b);
  if (typeof a === 'string' && typeof b === 'string') return a > b;
  throw new PythonError(
    'TypeError',
    `'>' not supported between instances of '${leftType}' and '${rightType}'`,
  );
}
/** The donor's dictionary methods visit source insertion order, including numeric keys. */
export function pyDictKeys(
  value: any,
  method: 'values' | 'items' = 'values',
  sourceType = pythonType(value),
): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new PythonError('AttributeError', `'${sourceType}' object has no attribute '${method}'`);
  return pythonKeys(value);
}
export function pyDictKeysAt(holder: any, key: string | number): string[] {
  return pyDictKeys(pyItem(holder, key), 'values', sourceTypeAt(holder, key));
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
function operandType(operand: PythonNumber): string {
  return typeof operand.value === 'number' ? operand.kind : pythonType(operand.value);
}
export function pyAdd(a: PythonNumber, b: PythonNumber): any {
  const av: unknown = a.value,
    bv: unknown = b.value;
  if (typeof av === 'string' && typeof bv === 'string') return av + bv;
  if (Array.isArray(av) && Array.isArray(bv)) return [...av, ...bv];
  if (typeof a.value !== 'number' || typeof b.value !== 'number') {
    const left = operandType(a),
      right = operandType(b);
    if (left === 'str' || left === 'list')
      throw new PythonError(
        'TypeError',
        `can only concatenate ${left} (not "${right}") to ${left}`,
      );
    throw new PythonError(
      'TypeError',
      `unsupported operand type(s) for +: '${left}' and '${right}'`,
    );
  }
  return a.value + b.value;
}
export function pyMultiply(a: PythonNumber, b: PythonNumber): number {
  if (typeof a.value !== 'number' || typeof b.value !== 'number') {
    const left = operandType(a),
      right = operandType(b);
    if (
      (['str', 'list'].includes(left) && right === 'float') ||
      (['str', 'list'].includes(right) && left === 'float')
    )
      throw new PythonError('TypeError', "can't multiply sequence by non-int of type 'float'");
    throw new PythonError(
      'TypeError',
      `unsupported operand type(s) for *: '${left}' and '${right}'`,
    );
  }
  return a.value * b.value;
}
export function pyDivide(a: PythonNumber, b: PythonNumber): number {
  if (typeof a.value !== 'number' || typeof b.value !== 'number')
    throw new PythonError(
      'TypeError',
      `unsupported operand type(s) for /: '${operandType(a)}' and '${operandType(b)}'`,
    );
  if (b.value === 0)
    throw new PythonError(
      'ZeroDivisionError',
      a.kind === 'float' || b.kind === 'float' ? 'float division by zero' : 'division by zero',
    );
  return a.value / b.value;
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
  if (value instanceof Map)
    return `{${[...value].map(([key, item]) => `${value instanceof PythonDict ? value.keyRepr(key) : pythonRepr(key)}: ${pythonRepr(item)}`).join(', ')}}`;
  if (Array.isArray(value)) return `[${value.map((_, i) => pyReprAt(value, i)).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${pythonKeys(value)
      .map((key) => `${pyRepr(key)}: ${pyReprAt(value, key)}`)
      .join(', ')}}`;
  return pyRepr(value);
}

/** The donor's fmt uses Python str for values outside its numeric domain. */
export function pythonFormat(value: unknown, digits = 1): string {
  return isnum(value) ? fmt(value, digits) : typeof value === 'string' ? value : pythonRepr(value);
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

export function pyAbs(operand: PythonNumber): number {
  if (typeof operand.value !== 'number')
    throw new PythonError('TypeError', `bad operand type for abs(): '${operandType(operand)}'`);
  return Math.abs(operand.value);
}

class PythonSet<T> extends Set<T> {
  constructor(values: Iterable<T>) {
    super();
    for (const value of values) this.add(value);
  }
  override has(value: T): boolean {
    if (value !== null && typeof value === 'object')
      throw new PythonError('TypeError', `unhashable type: '${pythonType(value)}'`);
    if (super.has(value)) return true;
    if (typeof value === 'boolean') return super.has(Number(value) as T);
    return (value === 0 || value === 1) && super.has(Boolean(value) as T);
  }
  override add(value: T): this {
    if (!this.has(value)) super.add(value);
    return this;
  }
  override delete(value: T): boolean {
    if (!this.has(value)) return false;
    if (super.delete(value)) return true;
    return super.delete((typeof value === 'boolean' ? Number(value) : Boolean(value)) as T);
  }
}

/** Sets reject JSON lists/mappings and equate boolean and numeric keys like Python. */
export function pySet<T>(values: Iterable<T> = []): Set<T> {
  return new PythonSet(values);
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
