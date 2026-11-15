import { expect, it } from 'vitest';
import { historicalProducer, script } from '../validate/registry.js';
it('accepts repository TypeScript module paths and rejects commands, tests, built output and escapes', () => {
  for (const p of [
    'packages/ingest/src/production/taxes.ts',
    'packages/ingest/src/production/taxes-reader.ts',
    'apps/etl/src/production-cli.ts',
  ])
    expect(script(p)).toBe(p);
  for (const p of [
    '../taxes.ts',
    'packages/ingest/src/production/../taxes.ts',
    'node packages/ingest/src/production/taxes.ts',
    'python -m budget_pipeline.extract.kfp_full',
    'pipeline/budget_pipeline/extract/kfp_full.py',
    'packages/ingest/src/production/taxes.test.ts',
    'packages/ingest/src/production/taxes.spec.ts',
    'packages/ingest/src/production/taxes.d.ts',
    'packages/ingest/test/taxes.ts',
    'packages/ingest/tests/taxes.ts',
    'packages/ingest/fixtures/taxes.ts',
    'packages/ingest/__fixtures__/taxes.ts',
    'packages/ingest/node_modules/taxes/index.ts',
    'packages/test-support/producer.ts',
    'apps/web/build/server/index.js',
    'packages/ingest/dist/production/taxes.js',
    '/packages/ingest/src/production/taxes.ts',
    'scripts/ci-gates.test.mjs',
  ])
    expect(() => script(p)).toThrow('TypeScript module path');
});
it('names a retired producer only by an exact repository, full commit and relative path', () => {
  const past = {
    repository: 'https://github.com/midt-bg/sigma-budget',
    commit: '378453f28a2b48104b682a5218f19f72e651ecae',
    path: 'pipeline/budget_pipeline/extract/glossary.py',
  };
  expect(historicalProducer(past)).toEqual(past);
  expect(historicalProducer('packages/ingest/src/production/taxes.ts')).toBeNull();
  expect(historicalProducer(null)).toBeNull();
  expect(() => historicalProducer({ ...past, commit: '378453f2' })).toThrow('full commit');
  expect(() => historicalProducer({ ...past, path: 'a/../b.py' })).toThrow('unsafe');
  expect(() => historicalProducer({ ...past, repository: 'file:///tmp/repo' })).toThrow('unsafe');
  expect(() => historicalProducer({ commit: past.commit, path: past.path })).toThrow('exactly');
  expect(historicalProducer([past])).toBeNull();
});
