import { Check, isnum, pyRepr } from './checks.js';
import type { Context } from './context.js';
import { parseOrderedPythonJson } from './ordered-json.js';

/** These owners format large integers from sourceToken, rather than rounded JS values.
 * Keep Context's strict grammar/error handling; only its safe-integer guard differs.
 */
export function feedOwner(ctx: Context, rel: 'core.json' | 'debt.json' | 'expenditure.json'): any {
  try {
    return ctx.get(rel);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== 'JSON integer exceeds the safe numeric range'
    )
      throw error;
    return parseOrderedPythonJson(ctx.text(rel), JSON.parse);
  }
}

export function pyError(name: string, message: string): never {
  const e = new Error(message);
  e.name = name;
  throw e;
}
export function typeName(x: unknown): string {
  return x === null || x === undefined
    ? 'NoneType'
    : Array.isArray(x)
      ? 'list'
      : typeof x === 'boolean'
        ? 'bool'
        : typeof x === 'string'
          ? 'str'
          : typeof x === 'number'
            ? Number.isInteger(x)
              ? 'int'
              : 'float'
            : 'dict';
}
export function required(obj: any, key: string | number): any {
  if (obj === null || obj === undefined)
    return pyError('TypeError', `'NoneType' object is not subscriptable`);
  if (Array.isArray(obj) && typeof key !== 'number')
    return pyError('TypeError', `list indices must be integers or slices, not ${typeName(key)}`);
  if (typeof obj === 'string' && typeof key !== 'number')
    return pyError('TypeError', `string indices must be integers, not '${typeName(key)}'`);
  if (typeof obj === 'boolean' || typeof obj === 'number')
    return pyError('TypeError', `'${typeName(obj)}' object is not subscriptable`);
  if (!Object.hasOwn(Object(obj), key)) return pyError('KeyError', pyRepr(key));
  return obj[key];
}
export function mapping(obj: any): void {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
    pyError('AttributeError', `'${typeName(obj)}' object has no attribute 'get'`);
}
export function iterable(obj: any): void {
  if (obj === null || obj === undefined || typeof obj === 'boolean' || typeof obj === 'number')
    pyError('TypeError', `'${typeName(obj)}' object is not iterable`);
}
export function near(
  c: Check,
  a: unknown,
  b: unknown,
  tol: number,
  msg: string,
  floatA = false,
  floatB = false,
): void {
  const show = (x: unknown, fl = false) =>
    x === undefined || x === null
      ? 'None'
      : typeof x === 'boolean'
        ? x
          ? 'True'
          : 'False'
        : typeof x === 'number' && fl && Number.isInteger(x)
          ? String(x) + '.0'
          : typeof x === 'object'
            ? pyRepr(x)
            : String(x);
  c.ok(
    isnum(a) && isnum(b) && Math.abs(a - b) <= tol + 1e-9,
    `${msg}: ${show(a, floatA)} vs ${show(b, floatB)} (tolerance ${tol === 1e-9 ? '1e-09' : show(tol)})`,
  );
}
/** Source token preserves Python json's distinction between integer and float. */
export function monthToken(text: string): string | undefined {
  const tokens = new WeakMap<object, string>();
  const root = JSON.parse(text, function (this: any, key: string, value: any, context: any) {
    if (key === 'months' && typeof value === 'number') tokens.set(this, context.source);
    return value;
  } as any);
  return tokens.get(root?.data?.['2026']);
}

export function listLike(x: any): any[] {
  iterable(x);
  if (Array.isArray(x) || typeof x === 'string') return Array.from(x);
  return Object.keys(x);
}
export function sourceToken(text: string, path: (string | number)[]): string | undefined {
  const values = new WeakMap<object, Map<string, string>>();
  const root = JSON.parse(text, function (this: any, key: string, value: any, context: any) {
    if (typeof value === 'number') {
      let m = values.get(this);
      if (!m) {
        m = new Map();
        values.set(this, m);
      }
      m.set(key, context.source);
    }
    return value;
  } as any);
  let o = root;
  for (const key of path.slice(0, -1)) o = o?.[key];
  return o && typeof o === 'object' ? values.get(o)?.get(String(path.at(-1))) : undefined;
}
export function hashable(x: unknown): void {
  if (x && typeof x === 'object') pyError('TypeError', `unhashable type: '${typeName(x)}'`);
}
export function length(x: any): number {
  if (x === null || x === undefined || typeof x === 'boolean' || typeof x === 'number')
    pyError('TypeError', `object of type '${typeName(x)}' has no len()`);
  return Array.isArray(x) || typeof x === 'string' ? x.length : Object.keys(x).length;
}
export function contains(container: any, value: any): boolean {
  if (
    container === null ||
    container === undefined ||
    typeof container === 'boolean' ||
    typeof container === 'number'
  )
    pyError('TypeError', `argument of type '${typeName(container)}' is not iterable`);
  if (Array.isArray(container)) return container.some((x) => x === value);
  if (typeof container === 'string') return container.includes(value);
  hashable(value);
  return Object.hasOwn(container, value);
}
export function numeric(x: any, operation: string): number {
  if (typeof x === 'boolean') return Number(x);
  if (typeof x === 'number') return x;
  return pyError('TypeError', `bad operand type for ${operation}: '${typeName(x)}'`);
}
export function greaterZero(x: any): boolean {
  if (typeof x !== 'number' && typeof x !== 'boolean')
    pyError('TypeError', `'>' not supported between instances of '${typeName(x)}' and 'int'`);
  return Number(x) > 0;
}
export function monthId(x: any): string {
  if (typeof x !== 'number' && typeof x !== 'boolean')
    pyError('TypeError', `%d format: a real number is required, not ${typeName(x)}`);
  return `kfp-2026-${String(Math.trunc(Number(x))).padStart(2, '0')}`;
}
/** Python's %d formats a numeric owner value, never a numeric-looking string. */
export function integerText(value: unknown, token?: string): string {
  if (typeof value !== 'number' && typeof value !== 'boolean')
    pyError('TypeError', `%d format: a real number is required, not ${typeName(value)}`);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Number.isNaN(value)) pyError('ValueError', 'cannot convert float NaN to integer');
  if (!Number.isFinite(value)) pyError('OverflowError', 'cannot convert float infinity to integer');
  return token && !/[.eE]/.test(token)
    ? BigInt(token).toString()
    : BigInt(Math.trunc(value)).toString();
}
/** Match Python's UTF-8 decode exception without replacing invalid evidence bytes. */
export function decodeUtf8(raw: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    let i = 0,
      reason = 'invalid start byte',
      end = 0;
    while (i < raw.length) {
      const b = raw[i]!;
      if (b < 0x80) {
        i++;
        continue;
      }
      const count =
        b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
      if (!count) {
        reason = 'invalid start byte';
        end = i + 1;
        break;
      }
      let j = 1;
      for (; j < count && i + j < raw.length; j++) {
        const n = raw[i + j]!;
        if (
          n < 0x80 ||
          n > 0xbf ||
          (j === 1 &&
            ((b === 0xe0 && n < 0xa0) ||
              (b === 0xed && n > 0x9f) ||
              (b === 0xf0 && n < 0x90) ||
              (b === 0xf4 && n > 0x8f)))
        )
          break;
      }
      if (j < count) {
        reason = i + j >= raw.length ? 'unexpected end of data' : 'invalid continuation byte';
        end = i + j;
        break;
      }
      i += count;
    }
    const pos =
      end - i > 1
        ? `bytes in position ${i}-${end - 1}`
        : `byte 0x${raw[i]!.toString(16).padStart(2, '0')} in position ${i}`;
    return pyError('UnicodeDecodeError', `'utf-8' codec can't decode ${pos}: ${reason}`);
  }
}
/** Python compares booleans and numbers by numeric value, recursively in lists and mappings. */
export function equal(a: any, b: any): boolean {
  if (
    (typeof a === 'number' || typeof a === 'boolean') &&
    (typeof b === 'number' || typeof b === 'boolean')
  )
    return Number(a) === Number(b);
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
    );
  }
  return false;
}
