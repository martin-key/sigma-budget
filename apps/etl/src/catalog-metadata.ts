#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCatalogMetadata, loadCatalogFixture, parityCli } from '@sigma-budget/ingest';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const fixture = join(root, 'packages/ingest/test/fixtures/catalog');
const candidate = join(root, 'tmp/ts-migration/candidates/12/data/catalog.json');
const report = join(root, 'tmp/ts-migration/candidates/12/metadata-diff.json');
async function main() {
  if (process.argv.length !== 2 || process.cwd() !== root)
    throw new Error('Run catalog metadata audit from the project root without arguments');
  const state = await loadCatalogFixture(fixture, '2026-11-08'),
    raw = await readFile(candidate);
  const { computed, reported } = auditCatalogMetadata({
    catalogBytes: raw,
    ownerBytes: state.ownerBytes,
    registry: state.registry,
    activeRoutes: state.activeRoutes,
  });
  const tmp = await mkdtemp(join(tmpdir(), 'catalog-metadata-'));
  try {
    const { mkdir } = await import('node:fs/promises');
    const a = join(tmp, 'computed'),
      b = join(tmp, 'catalog');
    await mkdir(a);
    await mkdir(b);
    await writeFile(join(a, 'catalog.json'), JSON.stringify(computed));
    await writeFile(join(b, 'catalog.json'), JSON.stringify(reported));
    process.exitCode = await parityCli([
      '--oracle',
      a,
      '--candidate',
      b,
      '--scope',
      'catalog',
      '--registry',
      join(fixture, 'inputs/datasets.yaml'),
      '--policy',
      join(fixture, 'policy.json'),
      '--report',
      report,
    ]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
