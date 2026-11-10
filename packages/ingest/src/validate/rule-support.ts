import { isDeepStrictEqual } from 'node:util';
import { Check, isnum, pyRepr } from './checks.js';

/** Dataset objects remain dynamic; the public boundary is the shared Context. */
export type Doc = Record<string, any>;
export const equal = isDeepStrictEqual;
export const keys = (o: Doc): string[] => Object.keys(o);
export const values = (o: Doc): any[] => Object.values(o);
export const allNumbers = (a: unknown[]): a is number[] => a.every(isnum);
export const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
export const text = (s: unknown): s is string => typeof s === 'string' && !!s.trim();
export const cleanText = (s: unknown): boolean => text(s) && !s.includes('  ');
export const sameSet = (a: unknown[], b: unknown[]): boolean =>
  equal([...new Set(a)].sort(), [...new Set(b)].sort());
export const dig = (o: any, ...path: (string | number)[]): any => {
  for (const p of path) o = o?.[p];
  return o ?? null;
};
export function ordered(c: Check, o: Doc, expected: string[], message: string): void {
  c.ok(equal(keys(o), expected), message);
}
export function rowIds(c: Check, rows: Doc[], ids: string[], what: string): void {
  const got = rows.map((r) => r.id);
  c.ok(equal(got, ids), `${what}: row ids ${pyRepr(got)}`);
}
export const rowsById = (rs: Doc[]): Doc => Object.fromEntries(rs.map((r) => [r.id, r.khil]));

/** Do not turn incomplete source evidence into an aggregate acceptance claim. */
export const INDEPENDENT_RULE_NAMES = ['COMPONENTS', 'RATES', 'INDIRECT', 'CONTRACT'] as const;
