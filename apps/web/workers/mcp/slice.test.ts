import { describe, expect, it } from 'vitest';
import { ArgError, MAX_BYTES, bytes, fit, outline, page, resolve, type Page } from './slice';

describe('resolve', () => {
  const doc = { a: { 'b/c': [10, 20], 'd~e': 'x' }, list: [{ id: 1 }] };
  it('follows an RFC 6901 pointer with escapes', () => {
    expect(resolve(doc, '')).toBe(doc);
    expect(resolve(doc, '/')).toBe(doc);
    expect(resolve(doc, '/a/b~1c/1')).toBe(20);
    expect(resolve(doc, '/a/d~0e')).toBe('x');
    expect(resolve(doc, '/list/0/id')).toBe(1);
  });
  it('rejects what is not in the file, with the keys there are', () => {
    expect(() => resolve(doc, 'a')).toThrow(ArgError);
    expect(() => resolve(doc, '/nope')).toThrow(/Ключовете на файла са: a, list/);
    expect(() => resolve(doc, '/list/1')).toThrow(/масив с 1 елемента/);
    expect(() => resolve(doc, '/list/01')).toThrow(ArgError);
    expect(() => resolve(doc, '/a/d~0e/x')).toThrow(/не е обект/);
    expect(() => resolve(doc, '/' + Array(13).fill('a').join('/'))).toThrow(/12 нива/);
  });
  it('never reaches the prototype of an object', () => {
    expect(() => resolve(doc, '/__proto__')).toThrow(ArgError);
    expect(() => resolve(doc, '/a/constructor')).toThrow(ArgError);
    expect(() => resolve(doc, '/list/length')).toThrow(ArgError);
  });
});

describe('page and outline', () => {
  it('pages arrays and objects with many keys', () => {
    expect(page([1, 2, 3, 4, 5], 1, 2)).toEqual({
      value: [2, 3],
      page: { offset: 1, limit: 2, total: 5, next: 3 },
    });
    expect(page([1, 2, 3], 2, 2).page?.next).toBeNull();
    expect(page({ a: 1, b: 2, c: 3 }, 0, 2)).toEqual({
      value: { a: 1, b: 2 },
      page: { offset: 0, limit: 2, total: 3, next: 2 },
    });
    expect(page({ a: 1 }, 0, 50)).toEqual({ value: { a: 1 } });
    expect(page('text', 0, 50)).toEqual({ value: 'text' });
  });
  it('outlines a value to a depth', () => {
    expect(outline({ rows: [{ id: 'x' }], s: 'y'.repeat(100) })).toEqual({
      type: 'object',
      keys: 2,
      fields: {
        rows: { type: 'array', length: 1, item: { type: 'object', keys: 1, names: ['id'] } },
        s: 'y'.repeat(80) + '…',
      },
    });
    expect(outline([], 2)).toEqual({ type: 'array', length: 0 });
  });
});

describe('fit', () => {
  const wrap = (p: { value: unknown; page?: Page }) => ({
    value: p.value,
    ...(p.page ? { page: p.page } : {}),
  });
  it('keeps a small part as it is', () => {
    expect(fit([1, 2], 0, 50, wrap)).toEqual({
      value: [1, 2],
      page: { offset: 0, limit: 50, total: 2, next: null },
      truncated: false,
    });
  });
  it('halves the page of a big array until it fits', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ i, text: 'т'.repeat(1000) }));
    const out = fit(rows, 0, 50, wrap);
    expect(out.truncated).toBe(true);
    expect(bytes(out)).toBeLessThanOrEqual(MAX_BYTES);
    expect((out.value as unknown[]).length).toBe(12);
    expect(out.note).toMatch(/offset 12/);
  });
  it('outlines a part that no page makes small enough', () => {
    const big = { text: 'а'.repeat(MAX_BYTES), more: { deep: [1] } };
    const out = fit(big, 0, 50, wrap);
    expect(out.truncated).toBe(true);
    expect(out.value).toEqual({
      type: 'object',
      keys: 2,
      fields: {
        text: 'а'.repeat(80) + '…',
        more: { type: 'object', keys: 1, fields: { deep: { type: 'array', length: 1 } } },
      },
    });
    const one = fit([{ text: 'б'.repeat(MAX_BYTES) }], 0, 1, wrap);
    expect(one.note).toMatch(/структурата/);
  });
  it('falls back to a shallower outline when the outline is still too big', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `k${i}`,
        Object.fromEntries(
          Array.from({ length: 40 }, (_, j) => [`ключ-${'д'.repeat(30)}-${j}`, 1]),
        ),
      ]),
    );
    const out = fit({ x: 'в'.repeat(MAX_BYTES), ...wide }, 0, 50, wrap);
    expect(bytes(out)).toBeLessThanOrEqual(MAX_BYTES);
  });
});
