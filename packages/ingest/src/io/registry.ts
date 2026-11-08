import { globSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseDocument, isAlias, isMap, isScalar, isSeq } from 'yaml';
import { json, object, type Json } from '@sigma-budget/dataset-schema';

// Resolve plain scalars using PyYAML's YAML 1.1 resolver, then enforce the
// registry's stricter JSON-only, string-key and duplicate-key constraints.
const pyInt =
  /^[-+]?(?:0b[0-1_]+|0[0-7_]+|0|[1-9][0-9_]*|0x[0-9a-fA-F_]+|[1-9][0-9_]*(?::[0-5]?[0-9])+)$/;
const pyFloat =
  /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const pyBool = /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const pyNull = /^(?:~|null|Null|NULL|)$/;
function pyNumber(source: string): number {
  const stripped = source.replaceAll('_', '');
  const sign = stripped.startsWith('-') ? -1 : 1;
  const unsigned = stripped.replace(/^[+-]/, '');
  if (unsigned.includes(':'))
    return sign * unsigned.split(':').reduce((n, part) => n * 60 + Number(part), 0);
  if (/^0b/i.test(unsigned)) return sign * parseInt(unsigned.slice(2), 2);
  if (/^0x/i.test(unsigned)) return sign * parseInt(unsigned.slice(2), 16);
  if (pyInt.test(source) && /^0[0-7]+$/.test(unsigned)) return sign * parseInt(unsigned, 8);
  if (/^\.inf$/i.test(unsigned)) return sign * Infinity;
  if (/^\.nan$/i.test(unsigned)) return NaN;
  return Number(stripped);
}
export function parseYaml(text: string): Json {
  const doc = parseDocument(text, { uniqueKeys: false, version: '1.1', schema: 'yaml-1.1' });
  if (doc.errors.length || doc.warnings.length)
    throw new Error([...doc.errors, ...doc.warnings].map((e) => e.message).join('\n'));
  function check(node: unknown): void {
    if (isAlias(node)) throw new Error('YAML aliases are not supported');
    if (isMap(node)) {
      const keys = new Set<string>();
      for (const pair of node.items) {
        check(pair.key);
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string')
          throw new Error('YAML keys must be strings');
        if (keys.has(pair.key.value)) throw new Error('Duplicate YAML key: ' + pair.key.value);
        keys.add(pair.key.value);
        check(pair.value);
      }
    } else if (isSeq(node)) for (const item of node.items) check(item);
    else if (isScalar(node)) {
      if (node.type === 'PLAIN' && !node.tag && typeof node.source === 'string') {
        const raw = node.source;
        if (pyBool.test(raw)) node.value = /^(?:yes|true|on)$/i.test(raw);
        else if (pyNull.test(raw)) node.value = null;
        else if (pyFloat.test(raw) || pyInt.test(raw)) node.value = pyNumber(raw);
        else if (typeof node.value !== 'object') node.value = raw;
      }
      const v = node.value;
      if (
        typeof v === 'number' &&
        (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))
      )
        throw new Error('Invalid YAML number');
      if (v !== null && !['string', 'boolean', 'number'].includes(typeof v))
        throw new Error('Invalid YAML scalar');
    } else if (node !== null) throw new Error('Invalid YAML node');
  }
  check(doc.contents);
  const result: unknown = doc.toJS();
  if (!json(result)) throw new Error('Invalid YAML document');
  return result;
}
export async function readYaml(path: string): Promise<Json> {
  return parseYaml(await readFile(path, 'utf8'));
}
export interface SourceEntry {
  id: string;
  acquisition: string;
  files?: { path: string; [key: string]: Json }[];
  [key: string]: Json | undefined;
}
export interface DatasetEntry {
  id: string;
  status: string;
  inputs?: string[];
  [key: string]: Json | undefined;
}
export interface SourceRegistry {
  sources: SourceEntry[];
  intermediates?: ({ path: string } & Record<string, Json>)[];
}
export interface DatasetRegistry {
  datasets: DatasetEntry[];
}
export function registries(s: Json, d: Json): [SourceRegistry, DatasetRegistry] {
  if (
    !object(s) ||
    s.schema !== 1 ||
    !Array.isArray(s.sources) ||
    !object(d) ||
    d.schema !== 1 ||
    !Array.isArray(d.datasets)
  )
    throw new Error('Invalid registry');
  const unique = (rows: unknown[], key: string) => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!object(row) || typeof row[key] !== 'string' || !row[key] || seen.has(row[key] as string))
        throw new Error(`Invalid or duplicate ${key}`);
      seen.add(row[key] as string);
    }
  };
  unique(s.sources, 'id');
  unique(d.datasets, 'id');
  if (s.intermediates !== undefined && !Array.isArray(s.intermediates))
    throw new Error('Invalid intermediates');
  unique((s.intermediates ?? []) as unknown[], 'path');
  for (const source of s.sources)
    if (
      !object(source) ||
      typeof source.acquisition !== 'string' ||
      (source.files !== undefined &&
        (!Array.isArray(source.files) ||
          !source.files.every((f) => object(f) && typeof f.path === 'string')))
    )
      throw new Error('Invalid source');
  for (const dataset of d.datasets)
    if (
      !object(dataset) ||
      typeof dataset.status !== 'string' ||
      (dataset.inputs !== undefined &&
        (!Array.isArray(dataset.inputs) || !dataset.inputs.every((x) => typeof x === 'string')))
    )
      throw new Error('Invalid dataset');
  return [s as unknown as SourceRegistry, d as unknown as DatasetRegistry];
}
export interface InputRecord {
  kind: 'source' | 'intermediate';
  source: string | null;
  datasets: string[];
  entry: Record<string, Json>;
}
export function registryInputs(
  s: SourceRegistry,
  d: DatasetRegistry,
  inputRoot: string,
): {
  found: Record<string, InputRecord>;
  missing: Record<string, string[]>;
  sources: Record<string, SourceEntry>;
} {
  const sources = Object.fromEntries(s.sources.map((x) => [x.id, x]));
  const intermediates = Object.fromEntries((s.intermediates ?? []).map((x) => [x.path, x]));
  const found: Record<string, InputRecord> = {},
    missing: Record<string, string[]> = {};
  for (const dataset of d.datasets) {
    if (dataset.status === 'pending') continue;
    for (const input of dataset.inputs ?? []) {
      const source = sources[input],
        intermediate = intermediates[input];
      if (source && ['reference', 'generated'].includes(source.acquisition)) continue;
      const entries = source ? (source.files ?? []) : intermediate ? [intermediate] : [];
      for (const entry of entries) {
        const pattern = entry.path;
        if (!/^(data\/originals|data\/cache)(\/|$)/.test(pattern)) continue;
        if (isAbsolute(pattern) || pattern.split('/').includes('..') || pattern.includes('\\'))
          throw new Error(`Invalid input path: ${pattern}`);
        const hits = globSync(pattern, { cwd: inputRoot })
          .filter((p) => {
            const rel = relative(inputRoot, resolve(inputRoot, p));
            return (
              !rel.startsWith('..') && !isAbsolute(rel) && statSync(resolve(inputRoot, p)).isFile()
            );
          })
          .sort();
        if (!hits.length) {
          const list = (missing[pattern] ??= []);
          if (!list.includes(dataset.id)) list.push(dataset.id);
        }
        for (const hit of hits) {
          const record = (found[hit] ??= {
            kind: source ? 'source' : 'intermediate',
            source: source ? input : null,
            datasets: [],
            entry,
          });
          if (!record.datasets.includes(dataset.id)) record.datasets.push(dataset.id);
        }
      }
    }
  }
  for (const ids of Object.values(missing)) ids.sort();
  for (const rec of Object.values(found)) rec.datasets.sort();
  return { found, missing, sources };
}
