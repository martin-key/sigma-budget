import { object, json } from '@sigma-budget/dataset-schema';
import { parseDocument, isNode } from 'yaml';
import { parseJsonStat, jsonstatCells, jsonstatSeries, type JsonStat } from '../../io/data.js';
import { parseGvaStat } from '../../build/dbp-gva.js';
import { isIsoDay } from '../../common/dates.js';
import { parsePythonJson } from '../../common/numbers.js';

export type EurostatSnapshot = JsonStat & { updated: string };
export function parseSavedJson(text: string): unknown {
  const data = parsePythonJson<unknown>(text);
  if (!json(data)) throw new Error('Non-finite or unsupported saved JSON');
  return data;
}

/** Return the original nested JSON-stat text; JSON.stringify would destroy
 * sparse input order and float tokens such as 1.0 used by the GVA builder. */
function statText(text: string): string {
  const data = parseSavedJson(text);
  if (object(data) && object(data.jsonstat)) {
    const doc = parseDocument(text, { schema: 'json' });
    const node = doc.get('jsonstat', true);
    if (doc.errors.length || !isNode(node) || !node.range)
      throw new Error('Invalid JSON-stat wrapper');
    return text.slice(node.range[0], node.range[1]);
  }
  return text;
}

export function parseEurostatSnapshot(text: string): EurostatSnapshot {
  const source = statText(text),
    raw = parseSavedJson(source);
  if (
    !object(raw) ||
    raw.class !== 'dataset' ||
    raw.version !== '2.0' ||
    typeof raw.updated !== 'string' ||
    !isIsoDay(raw.updated.slice(0, 10)) ||
    !Array.isArray(raw.id) ||
    !raw.id.length ||
    !raw.id.every((d) => typeof d === 'string' && d) ||
    new Set(raw.id).size !== raw.id.length ||
    !Array.isArray(raw.size) ||
    raw.size.length !== raw.id.length ||
    !object(raw.dimension)
  )
    throw new Error('Invalid JSON-stat structure');
  let total = 1;
  for (let i = 0; i < raw.id.length; i++) {
    const id = raw.id[i] as string,
      size = raw.size[i],
      dim = raw.dimension[id];
    if (
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      !object(dim) ||
      !object(dim.category)
    )
      throw new Error('Invalid JSON-stat dimension');
    const idx = dim.category.index;
    if (Array.isArray(idx)) {
      if (
        idx.length !== size ||
        idx.some((c) => typeof c !== 'string') ||
        new Set(idx).size !== size
      )
        throw new Error('Invalid JSON-stat categories');
    } else if (
      !object(idx) ||
      Object.keys(idx).length !== size ||
      Object.values(idx).some(
        (n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n >= size,
      ) ||
      new Set(Object.values(idx)).size !== size
    )
      throw new Error('Invalid JSON-stat category index');
    total *= size;
    if (!Number.isSafeInteger(total))
      throw new Error('JSON-stat dimension product exceeds safe range');
  }
  if (!object(raw.value) && !Array.isArray(raw.value)) throw new Error('Invalid JSON-stat values');
  if (Array.isArray(raw.value) && raw.value.length !== total)
    throw new Error('JSON-stat dense value length mismatch');
  for (const [key, val] of Object.entries(raw.value)) {
    if (
      !/^(0|[1-9]\d*)$/u.test(key) ||
      Number(key) >= total ||
      (val !== null && (typeof val !== 'number' || !Number.isFinite(val)))
    )
      throw new Error('Invalid JSON-stat cell');
  }
  if (raw.status !== undefined && raw.status !== null) {
    if (!object(raw.status) && !Array.isArray(raw.status))
      throw new Error('Unsupported JSON-stat status');
    for (const [key, val] of Object.entries(raw.status))
      if (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= total || typeof val !== 'string')
        throw new Error('Invalid JSON-stat status');
  }
  return parseJsonStat(source) as EurostatSnapshot;
}

export function parseGvaSnapshot(text: string) {
  const source = statText(text);
  parseEurostatSnapshot(source);
  const data = parseGvaStat(source);
  if (
    Array.isArray(data.value) ||
    !Array.isArray(data.extension?.annotation) ||
    data.extension.annotation.some(
      (a) =>
        !a ||
        typeof a.type !== 'string' ||
        (a.type === 'UPDATE_DATA' && !isIsoDay(a.date?.slice(0, 10))),
    ) ||
    !data.extension.annotation.some((a) => a.type === 'UPDATE_DATA')
  )
    throw new Error('Invalid GVA annotations/values');
  return data;
}

/** Existing decoder and reducers, with raw null/missing cells retained in data. */
export function eurostatSeries(
  data: EurostatSnapshot,
  dimension = 'time',
  fixed: Record<string, string> = {},
) {
  if (!data.id.includes(dimension) || Object.keys(fixed).some((key) => !data.id.includes(key)))
    throw new Error('Unknown JSON-stat selector dimension');
  return jsonstatSeries(data, dimension, fixed);
}
export const eurostatCells = jsonstatCells;
