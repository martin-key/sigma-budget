import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { json, type Json } from '@sigma-budget/dataset-schema';
import { loadAnnex, type AnnexTables } from './annex.js';

export interface BuildRoots {
  inputs: string;
  originals: string;
  cache: string;
  release: string;
  research?: string;
}
export function roots(root: string): BuildRoots {
  return {
    inputs: join(root, 'data/inputs'),
    originals: join(root, 'data/originals'),
    cache: join(root, 'data/cache'),
    release: join(root, 'data/release'),
  };
}
function read(path: string): any {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!json(value)) throw new Error(`Invalid JSON: ${path}`);
  return value;
}
// Match float() on JSON scalar inputs, including whitespace, digit separators,
// Unicode decimal digits and non-finite spellings. Serialization rejects non-finite values.
export function pythonFloat(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') throw new Error('Invalid execution money');
  const whitespace =
    /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
  const digit = /\p{Decimal_Number}/u;
  const normalized = Array.from(v.replace(whitespace, ''), (ch) => {
    if (!digit.test(ch)) return ch;
    const code = ch.codePointAt(0)!;
    let first = code;
    while (first > 0 && digit.test(String.fromCodePoint(first - 1))) first--;
    return String((code - first) % 10);
  }).join('');
  if (/^[+-]?(?:inf(?:inity)?|nan)$/i.test(normalized)) {
    return /nan/i.test(normalized) ? NaN : normalized.startsWith('-') ? -Infinity : Infinity;
  }
  const digits = '[0-9](?:_?[0-9])*';
  const decimal = new RegExp(
    `^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`,
  );
  if (!decimal.test(normalized)) throw new Error('Invalid execution money');
  return Number(normalized.replaceAll('_', ''));
}
// Convert only execution/2 money fields; percentage fields remain numbers.
export function executionNumbers(doc: any): any {
  if (!doc || doc.contract?.schema !== 2) return doc;
  const out = structuredClone(doc),
    convert = pythonFloat;
  for (const blockName of ['data', 'monthly'])
    for (const block of Object.values(out[blockName]) as any[])
      for (const col of ['kfp', 'nat', 'eu'])
        for (const [id, values] of Object.entries(block[col]) as [string, unknown[]][])
          block[col][id] = values.map(convert);
  for (const col of ['kfp', 'nat', 'eu']) {
    for (const [id, v] of Object.entries(out.plan2026[col])) out.plan2026[col][id] = convert(v);
    for (const item of Object.values(out.latest[col]) as any[])
      for (const key of ['cum', 'plan', 'prevYearCum'])
        if (key in item) item[key] = convert(item[key]);
  }
  for (const [key, rec] of Object.entries(out.reconcile) as [string, any][])
    if (rec && typeof rec === 'object' && key.startsWith('dec'))
      for (const item of Object.values(rec) as any[])
        for (const k of ['kfp', 'annex3', 'diff']) item[k] = convert(item[k]);
  return out;
}
export class BuildContext {
  readonly out: Record<string, Json> = {};
  readonly texts: Record<string, string> = {};
  readonly notes: string[] = [];
  private memo = new Map<string, any>();
  constructor(readonly paths: BuildRoots) {}
  private getMemo<T>(key: string, fn: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, fn());
    return this.memo.get(key) as T;
  }
  get annex() {
    return this.getMemo('annex', () => loadAnnex(this.tables as AnnexTables));
  }
  get tables() {
    return this.getMemo(
      'tables',
      () => read(join(this.paths.originals, 'asbp/asbp_tables.json')).tables,
    );
  }
  get docxCheck() {
    return this.getMemo(
      'docx_check',
      () => read(join(this.paths.originals, 'asbp/asbp_tables.json')).docx_check,
    );
  }
  get pdfPages() {
    return this.getMemo('pdf_pages', () =>
      read(
        join(
          this.paths.research ?? join(this.paths.cache, 'research'),
          'mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
        ),
      ),
    );
  }
  src(name: string) {
    return this.getMemo('src:' + name, () => read(join(this.paths.inputs, name + '.json')));
  }
  raw(path: string) {
    return this.getMemo('raw:' + path, () => read(join(this.paths.originals, path)));
  }
  cache(name: string) {
    return this.getMemo('cache:' + name, () => read(join(this.paths.cache, name)));
  }
  cacheExists(name: string) {
    return existsSync(join(this.paths.cache, name));
  }
  get execution() {
    return this.getMemo('execution', () => {
      const p = join(this.paths.release, 'execution.json');
      if (!existsSync(p))
        throw new Error(
          'data/release/execution.json is missing: run pipeline/budget_pipeline/extract/kfp_full.py first',
        );
      return executionNumbers(read(p));
    });
  }
  get law() {
    return this.getMemo('law', () => read(join(this.paths.cache, 'law_bill.json')));
  }
  get gdp() {
    const a = this.annex;
    return {
      mlnPrecise: [...a.gdp],
      mlnPrinted: a.gdp.map((v) => {
        if (v === null) throw new Error('Missing GDP');
        const floor = Math.floor(v);
        return v - floor === 0.5 ? floor + (floor % 2 === 0 ? 0 : 1) : Math.round(v);
      }),
    };
  }
  put<T extends Json>(rel: string, obj: T): T {
    this.out[rel] = obj;
    return obj;
  }
  get(rel: string, fallback: Json = null): Json {
    return Object.hasOwn(this.out, rel) ? this.out[rel]! : fallback;
  }
  putText(rel: string, text: string): string {
    this.texts[rel] = text;
    return text;
  }
}
