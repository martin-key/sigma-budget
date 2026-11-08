import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { json, type Json } from '@sigma-budget/dataset-schema';
import { isMap, isScalar, parseDocument } from 'yaml';

export async function readJson(path: string): Promise<Json> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!json(value)) throw new Error(`Invalid JSON value: ${path}`);
  return value;
}
export function clean(value: unknown, where = '$'): Json {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${where}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v, i) => clean(v, `${where}[${i}]`));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, clean(v, `${where}.${k}`)]),
    );
  throw new Error(`Invalid JSON value at ${where}`);
}
export const jsonStringify = (value: unknown): string => JSON.stringify(clean(value));
export async function writeText(path: string, text: string): Promise<boolean> {
  try {
    if ((await readFile(path, 'utf8')) === text) return false;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
  return true;
}
export async function writeJson(
  path: string,
  value: unknown,
): Promise<{ bytes: number; changed: boolean }> {
  const text = jsonStringify(value) + '\n';
  return { bytes: Buffer.byteLength(text), changed: await writeText(path, text) };
}
export async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
export function gzipSize(bytes: Uint8Array): number {
  return gzipSync(bytes, { level: 9 }).length;
}

export const EUR = 1.95583;
export function roundNumber(value: number | null, places = 3): number | null {
  if (value === null) return null;
  const scale = 10 ** places,
    scaled = value * scale,
    floor = Math.floor(scaled);
  const n = scaled - floor === 0.5 ? floor + (floor % 2 === 0 ? 0 : 1) : Math.round(scaled);
  return n === 0 ? 0 : n / scale;
}
export const toEur = (bgn: number, places = 3) => roundNumber(bgn / EUR, places);
export const pct = (part: number, whole: number, places = 2) => {
  if (whole === 0) throw new Error('division by zero');
  return roundNumber((100 * part) / whole, places);
};
export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export interface JsonStat {
  id: string[];
  size: number[];
  dimension: Record<string, { category: { index: Record<string, number> | string[] } }>;
  value: Record<string, number | null> | (number | null)[];
  status?: Record<string, string> | null;
}
const sparseOrder = new WeakMap<object, string[]>();
/** Parse JSON-stat from source text so sparse cell order follows the source. */
export function parseJsonStat(text: string): JsonStat {
  const value: unknown = JSON.parse(text);
  if (!json(value) || typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid JSON-stat');
  const doc = parseDocument(text, { uniqueKeys: false, schema: 'json' });
  if (doc.errors.length || !isMap(doc.contents)) throw new Error('Invalid JSON-stat');
  const pair = doc.contents.items.filter((p) => isScalar(p.key) && p.key.value === 'value').at(-1);
  const cells = (value as unknown as JsonStat).value;
  if (cells && !Array.isArray(cells) && isMap(pair?.value)) {
    const order: string[] = [];
    for (const item of pair.value.items) {
      if (!isScalar(item.key) || typeof item.key.value !== 'string')
        throw new Error('Invalid JSON-stat index');
      if (!order.includes(item.key.value)) order.push(item.key.value);
    }
    sparseOrder.set(cells, order);
  }
  return value as unknown as JsonStat;
}
export async function readJsonStat(path: string): Promise<JsonStat> {
  return parseJsonStat(await readFile(path, 'utf8'));
}
export function jsonstatCells(
  js: JsonStat,
): { coords: Record<string, string>; value: number; status: string | null }[] {
  const cats = js.id.map((id) => {
    const idx = js.dimension[id]!.category.index;
    return Array.isArray(idx)
      ? idx
      : Object.entries(idx)
          .sort((a, b) => a[1] - b[1])
          .map(([key]) => key);
  });
  const result: { coords: Record<string, string>; value: number; status: string | null }[] = [];
  const order = Array.isArray(js.value) ? Object.keys(js.value) : sparseOrder.get(js.value);
  if (!order)
    throw new Error(
      'Sparse JSON-stat must be read with parseJsonStat or readJsonStat to preserve source order',
    );
  for (const index of order) {
    const value = js.value[index as keyof typeof js.value] as number | null;
    if (value === null) continue;
    let rem = Number(index);
    const coords: Record<string, string> = {};
    for (let i = js.id.length - 1; i >= 0; i--) {
      const r = rem % js.size[i]!;
      rem = Math.floor(rem / js.size[i]!);
      coords[js.id[i]!] = cats[i]![r]!;
    }
    result.push({ coords, value, status: js.status?.[index] ?? null });
  }
  return result;
}
export function jsonstatSeries(
  js: JsonStat,
  dim = 'time',
  fixed: Record<string, string> = {},
): Record<string, [number, string | null]> {
  const out: Record<string, [number, string | null]> = {};
  for (const c of jsonstatCells(js))
    if (Object.entries(fixed).every(([k, v]) => c.coords[k] === v))
      out[c.coords[dim]!] = [c.value, c.status];
  return out;
}

/** Read an inventoried input only after its exact SHA-256 has been verified. */
export async function readPinned(path: string, expectedSha256: string): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid SHA-256 pin');
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedSha256)
    throw new Error(`Input hash mismatch: ${path}`);
  return bytes;
}
