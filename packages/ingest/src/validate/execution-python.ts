import { pythonNumberAt } from '../common/numbers.js';
import { pyRepr } from './checks.js';
import { pythonKeys } from './ordered-json.js';

/** Runtime operations used by the execution projection and independent monthly checks. */

function type(value: unknown, holder?: object, key?: string): string {
  if (value === null || value === undefined) return 'NoneType';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number')
    return holder && key !== undefined
      ? pythonNumberAt(holder, key, value).kind
      : Number.isInteger(value)
        ? 'int'
        : 'float';
  const names: Record<string, string> = { boolean: 'bool', string: 'str', object: 'dict' };
  return names[typeof value] ?? typeof value;
}
function mapping(
  value: any,
  method: 'items' | 'values' | 'get',
  holder?: object,
  field?: string,
): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`'${type(value, holder, field)}' object has no attribute '${method}'`);
    error.name = 'AttributeError';
    throw error;
  }
  return value;
}
export const executionItems = (value: any): [string, any][] => {
  const dict = mapping(value, 'items');
  return pythonKeys(dict).map((key) => [key, dict[key]]);
};
export const executionValues = (value: any, holder?: object, field?: string): any[] => {
  const dict = mapping(value, 'values', holder, field);
  return pythonKeys(dict).map((key) => dict[key]);
};
export const executionGet = (value: any, key: string): any => {
  const dict = mapping(value, 'get');
  return Object.hasOwn(dict, key) ? dict[key] : null;
};
export function executionKeys(value: any): string[] {
  if (Array.isArray(value)) return [...value];
  if (typeof value === 'string') return Array.from(value);
  if (value === null || typeof value !== 'object')
    throw new TypeError(`'${type(value)}' object is not iterable`);
  return pythonKeys(value);
}
export function executionContains(value: any, key: string): boolean {
  if (typeof value === 'string' || Array.isArray(value)) return value.includes(key);
  if (value === null || typeof value !== 'object')
    throw new TypeError(`argument of type '${type(value)}' is not iterable`);
  return Object.hasOwn(value, key);
}
export function executionIterable(value: any): any[] {
  if (Array.isArray(value)) return value;
  return executionKeys(value);
}

/** Required subscriptions preserve the expected-law reader's missing-evidence failures. */
export function executionRequired(
  value: any,
  key: string | number,
  holder?: object,
  field?: string,
): any {
  if (value === null || value === undefined)
    throw new TypeError(`'NoneType' object is not subscriptable`);
  if (typeof value !== 'object' && typeof value !== 'string')
    throw new TypeError(`'${type(value, holder, field)}' object is not subscriptable`);
  const sequence = Array.isArray(value) || typeof value === 'string';
  if (sequence && typeof key !== 'number')
    throw new TypeError(
      Array.isArray(value)
        ? `list indices must be integers or slices, not ${type(key)}`
        : `string indices must be integers, not '${type(key)}'`,
    );
  if (sequence && typeof key === 'number' && key < 0) key += value.length;
  if ((!sequence && typeof key !== 'string') || !Object.hasOwn(value, key)) {
    const error = new Error(
      sequence ? `${Array.isArray(value) ? 'list' : 'string'} index out of range` : pyRepr(key),
    );
    error.name = sequence ? 'IndexError' : 'KeyError';
    throw error;
  }
  return value[key];
}

/** range() and list indexing accept integer JSON tokens, including bools, but never 12.0. */
export function executionInteger(
  value: unknown,
  operation: 'range' | 'index',
  raw?: object,
  key?: string,
): number {
  const kind = type(value, raw, key);
  if (kind === 'bool') return Number(value);
  if (kind !== 'int')
    throw new TypeError(
      operation === 'range'
        ? `'${kind}' object cannot be interpreted as an integer`
        : `list indices must be integers or slices, not ${kind}`,
    );
  return value as number;
}
