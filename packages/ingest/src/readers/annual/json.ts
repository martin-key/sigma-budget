import { parsePythonJson } from '../../common/numbers.js';
/** Preserve the existing builders' distinction between integral money floats
 * (e.g. 27573950.0) and integer metadata (page/table/year/row indices). */
export function serializeAnnual(value: unknown): string {
  const monetary = new Set([
    'value',
    'values',
    'khil',
    'headline',
    'policyTotal',
    'bodiesTotal',
    'commitments',
    'amounts',
    'lines',
    'expKhil',
    'revKhil',
  ]);
  const positions = new WeakMap<object, Set<string>>();
  function walk(node: unknown, money = false): void {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const isMoney = money || monetary.has(key);
      if (typeof child === 'number' && isMoney) {
        let keys = positions.get(node);
        if (!keys) {
          keys = new Set();
          positions.set(node, keys);
        }
        keys.add(key);
      } else if (child && typeof child === 'object') walk(child, isMoney);
    }
  }
  walk(value);
  return (
    JSON.stringify(
      value,
      function (this: object, key: string, child: unknown) {
        if (typeof child === 'number' && positions.get(this)?.has(key)) {
          if (!Number.isFinite(child)) throw new Error('Non-finite annual amount');
          const token = Object.is(child, -0)
            ? '-0.0'
            : Number.isInteger(child)
              ? String(child) + '.0'
              : String(child);
          return (JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON(token);
        }
        return child;
      },
      2,
    ) + '\n'
  );
}
export function annualValue<T>(value: T): T {
  return parsePythonJson<T>(serializeAnnual(value));
}
