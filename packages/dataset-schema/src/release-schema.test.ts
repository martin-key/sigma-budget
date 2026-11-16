import { releaseSchema } from './index.js';
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
type S = Record<string, any>;
function validates(value: any, schema: S): boolean {
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.anyOf && !schema.anyOf.some((s: S) => validates(value, s))) return false;
  if (schema.type) {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (schema.type === 'integer' ? !Number.isSafeInteger(value) : type !== schema.type)
      return false;
    if (schema.type === 'number' && !Number.isFinite(value)) return false;
  }
  if (schema.type === 'object') {
    if (schema.required?.some((k: string) => !Object.hasOwn(value, k))) return false;
    for (const [k, v] of Object.entries(value)) {
      const s = schema.properties?.[k] ?? schema.additionalProperties;
      if (s && !validates(v, s)) return false;
    }
  }
  if (schema.items && !value.every((v: any) => validates(v, schema.items))) return false;
  return true;
}
it('validates every published JSON file against its release contract', () => {
  const root = new URL('../../../data/release/', import.meta.url).pathname;
  const schema = existsSync(join(root, 'schema.json'))
    ? JSON.parse(readFileSync(join(root, 'schema.json'), 'utf8'))
    : releaseSchema();
  function walk(dir: string): string[] {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  }
  for (const file of walk('').filter((p) => p.endsWith('.json'))) {
    const key = file.startsWith('ministries/')
      ? 'ministries/*.json'
      : file.replace(/^releases\/[a-f0-9]{64}\//, 'releases/*/');
    expect(schema.$defs[key], file).toBeDefined();
    expect(
      validates(JSON.parse(readFileSync(join(root, file), 'utf8')), schema.$defs[key]),
      file,
    ).toBe(true);
  }
});
