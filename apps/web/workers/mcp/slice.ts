// A part of a data file for the MCP tools (apps/web/workers/mcp/tools.ts): a JSON Pointer into the file, a page of an array or of the keys of an
// object, and a cap on the size of an answer, because a model reads the answer into its context. A part that is still too big becomes its
// outline (the keys, the types and the lengths), so the model can ask for a narrower path instead of getting a cut-off half of the data.

/** the size of a tool answer the model reads at most (about 8k tokens of JSON) */
export const MAX_BYTES = 32 * 1024;
export const MAX_DEPTH = 12;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** a mistake in the arguments of a tool: the model reads the message and calls again */
export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgError';
  }
}

const encoder = new TextEncoder();
/** the UTF-8 size of the JSON of a value (Cyrillic letters take two bytes) */
export const bytes = (v: unknown) => encoder.encode(JSON.stringify(v) ?? '').length;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const keysOf = (v: unknown) => (isObject(v) ? Object.keys(v) : []);

/** the value at an RFC 6901 pointer ('' is the whole file); an own key of an object or an index of an array, never a prototype */
export function resolve(root: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return root;
  if (!pointer.startsWith('/'))
    throw new ArgError('Пътят е JSON Pointer и започва с „/“, например /rows/0.');
  const parts = pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.length > MAX_DEPTH) throw new ArgError(`Пътят е по-дълбок от ${MAX_DEPTH} нива.`);
  let v = root;
  let at = '';
  for (const part of parts) {
    if (Array.isArray(v)) {
      const i = /^(0|[1-9]\d*)$/.test(part) ? Number(part) : -1;
      if (i < 0 || i >= v.length)
        throw new ArgError(
          `${at || 'Файлът'} е масив с ${v.length} елемента: индекс „${part}“ няма.`,
        );
      v = v[i];
    } else if (isObject(v) && Object.hasOwn(v, part)) {
      v = v[part];
    } else {
      const keys = keysOf(v);
      throw new ArgError(
        `„${at}/${escape(part)}“ няма в този файл.` +
          (keys.length
            ? ` Ключовете на ${at || 'файла'} са: ${keys.slice(0, 40).join(', ')}${keys.length > 40 ? ' …' : ''}.`
            : ` ${at || 'Файлът'} не е обект.`),
      );
    }
    at += '/' + escape(part);
  }
  return v;
}

export interface Page {
  offset: number;
  limit: number;
  total: number;
  /** the offset of the next page, or null on the last one */
  next: number | null;
}

/** a page of an array, or of the keys of an object with more than `limit` keys; anything else as it is */
export function page(v: unknown, offset: number, limit: number): { value: unknown; page?: Page } {
  let value: unknown, total: number;
  if (Array.isArray(v)) {
    total = v.length;
    value = v.slice(offset, offset + limit);
  } else if (isObject(v) && (offset > 0 || Object.keys(v).length > limit)) {
    const keys = Object.keys(v);
    total = keys.length;
    value = Object.fromEntries(keys.slice(offset, offset + limit).map((k) => [k, v[k]]));
  } else return { value: v };
  return {
    value,
    page: { offset, limit, total, next: offset + limit < total ? offset + limit : null },
  };
}

/** the shape of a value: the keys, types and lengths to a depth, with short texts and the numbers as they are */
export function outline(v: unknown, depth = 2): unknown {
  if (Array.isArray(v))
    return {
      type: 'array',
      length: v.length,
      ...(v.length && depth > 0 ? { item: outline(v[0], depth - 1) } : {}),
    };
  if (isObject(v)) {
    const keys = Object.keys(v);
    return {
      type: 'object',
      keys: keys.length,
      ...(depth > 0
        ? {
            fields: Object.fromEntries(keys.slice(0, 40).map((k) => [k, outline(v[k], depth - 1)])),
          }
        : { names: keys.slice(0, 40) }),
    };
  }
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
  return v;
}

/** the answer of get_data within MAX_BYTES: a shorter page first (halving the limit), then the outline of the part */
export function fit<T extends { value: unknown; page?: Page }>(
  part: unknown,
  offset: number,
  limit: number,
  wrap: (p: { value: unknown; page?: Page }) => T,
): T & { truncated: boolean; note?: string } {
  for (let n = limit; n >= 1; n = n === 1 ? 0 : Math.max(1, Math.floor(n / 2))) {
    const answer = wrap(page(part, offset, n));
    if (bytes(answer) <= MAX_BYTES)
      return {
        ...answer,
        truncated: n < limit,
        ...(n < limit
          ? {
              note: `Отговорът е съкратен до ${n} елемента; следващите са от offset ${offset + n}.`,
            }
          : {}),
      };
    if (!answer.page) break; // not a page: a shorter one does not exist
  }
  const note =
    'Частта е по-голяма от 32 KB: дадена е структурата ѝ. Поискай по-тесен път (path) или по-малко елементи (limit).';
  let answer = wrap({ value: outline(part, 2) });
  if (bytes(answer) > MAX_BYTES) answer = wrap({ value: outline(part, 1) });
  if (bytes(answer) > MAX_BYTES) answer = wrap({ value: outline(part, 0) });
  return { ...answer, truncated: true, note };
}
