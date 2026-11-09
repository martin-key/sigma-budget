import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { Context } from './context.js';
const base = new URL('../../test/fixtures/validate17a/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('reader/cases.json', base), 'utf8'));
const { queries, results } = JSON.parse(readFileSync(new URL('reader/routes.json', base), 'utf8'));
for (const test of cases.filter((c: any) => c.name in results))
  it('preserves expanded route semantics: ' + test.name, () => {
    const root = mkdtempSync(join(tmpdir(), 'route-catalogue-'));
    try {
      const relative = 'apps/web/app/lib/routes.json';
      const change = test.ops.find((op: any) => op.file === relative);
      const data = change
        ? change.value
        : readFileSync(new URL('corpus/' + relative, base), 'utf8');
      mkdirSync(dirname(join(root, relative)), { recursive: true });
      writeFileSync(join(root, relative), data);
      let actual: unknown;
      try {
        const routes = new Context(root).routes();
        actual = { ids: [...routes.ids], matches: queries.map((q: string) => routes.match(q)) };
      } catch (error) {
        actual = { crash: `${(error as Error).name}: ${(error as Error).message}` };
      }
      expect(actual).toEqual(results[test.name]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
