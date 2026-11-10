import { parsePythonJson } from '../common/numbers.js';

const keyOrders = new WeakMap<object, readonly string[]>();

/** JSON dictionaries retain source insertion order, including integer-like keys. */
export function pythonKeys(value: object): string[] {
  const current = Object.keys(value),
    saved = keyOrders.get(value);
  if (!saved) return current;
  const known = new Set(saved);
  return [
    ...saved.filter((key) => Object.hasOwn(value, key)),
    ...current.filter((key) => !known.has(key)),
  ];
}

/** Preserve source key positions across the execution projection's deep copy. */
export function transferPythonKeyOrder(source: unknown, target: unknown): void {
  if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return;
  const order = keyOrders.get(source);
  if (order) keyOrders.set(target, order);
  for (const key of Object.keys(source))
    if (Object.hasOwn(target, key))
      transferPythonKeyOrder(
        (source as Record<string, unknown>)[key],
        (target as Record<string, unknown>)[key],
      );
}

/** Add validation-only key-order metadata without replacing raw numeric tokens. */
export function parseOrderedPythonJson(text: string): unknown {
  const result = parsePythonJson<unknown>(text);
  let i = 0;
  const space = () => {
    while (i < text.length && [9, 10, 13, 32].includes(text.charCodeAt(i))) i++;
  };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text.charCodeAt(i) === 92) i += 2;
      else if (text.charCodeAt(i++) === 34) break;
    }
    return JSON.parse(text.slice(start, i)) as string;
  };
  function visit(value: unknown): void {
    space();
    if (text[i] === '{') {
      i++;
      space();
      const obj =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : undefined;
      const keys: string[] = [],
        seen = new Set<string>();
      while (text[i] !== '}') {
        const key = string();
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
        space();
        i++;
        visit(obj && Object.hasOwn(obj, key) ? obj[key] : undefined);
        space();
        if (text[i] !== ',') break;
        i++;
        space();
      }
      i++;
      if (obj) {
        const native = Object.keys(obj);
        if (keys.some((key, at) => native[at] !== key)) keyOrders.set(obj, keys);
        else keyOrders.delete(obj);
      }
    } else if (text[i] === '[') {
      i++;
      space();
      let index = 0;
      while (text[i] !== ']') {
        visit(Array.isArray(value) ? value[index++] : undefined);
        space();
        if (text[i] !== ',') break;
        i++;
      }
      i++;
    } else if (text.charCodeAt(i) === 34) string();
    else while (i < text.length && ![9, 10, 13, 32, 44, 93, 125].includes(text.charCodeAt(i))) i++;
  }
  visit(result);
  return result;
}
