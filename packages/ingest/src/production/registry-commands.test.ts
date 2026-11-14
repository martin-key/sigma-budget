import { expect, it } from 'vitest';
import { script } from '../validate/registry.js';
it('accepts only the two explicit production TypeScript registry paths', () => {
  for (const p of [
    'packages/ingest/src/production/taxes.ts',
    'packages/ingest/src/production/taxes-reader.ts',
  ])
    expect(script(p)).toBe(p);
  for (const p of [
    'packages/ingest/src/production/other.ts',
    '../taxes.ts',
    'packages/ingest/src/production/../taxes.ts',
    'node packages/ingest/src/production/taxes.ts',
  ])
    expect(() => script(p)).toThrow();
  expect(script('python -m budget_pipeline.extract.kfp_full')).toBe(
    'pipeline/budget_pipeline/extract/kfp_full.py',
  );
});
