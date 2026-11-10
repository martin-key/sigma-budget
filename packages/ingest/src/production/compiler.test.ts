import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionExecutor } from './compiler.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
it('compiles exported workspace aliases and locked dependencies identically across replay directory depths', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'production-compiler-'));
  try {
    const executor = await productionExecutor(root);
    const run = async (prefix: string) => {
      const exportRoot = join(owned, prefix, 'export'),
        scratchRoot = join(owned, prefix, 'scratch'),
        candidateRoot = join(owned, prefix, 'candidate');
      for (const p of [exportRoot, scratchRoot, candidateRoot]) await mkdir(p, { recursive: true });
      const put = async (p: string, s: string | Buffer) => {
        const path = join(exportRoot, p);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, s);
      };
      await put('pnpm-lock.yaml', await readFile(join(root, 'pnpm-lock.yaml')));
      await put('packages/dataset-schema/src/index.ts', 'export const marker="recorded-export";');
      // Synthetic compiler ABI probe only. It never enters release-build or emits a PASS package.
      await put(
        'packages/ingest/src/production/entry.ts',
        `import {parse} from 'yaml';import {marker} from '@sigma-budget/dataset-schema';export async function executeRelease(){return {validation:{completeValidation:true,groups:[]},datasets:[],extractions:[{syntheticCompilerProbe:true,value:parse('a: 1').a,marker}]};}`,
      );
      await put(
        'packages/ingest/src/readers/publication-documents/archive-worker.ts',
        'export {};',
      );
      return executor.execute({
        exportRoot,
        scratchRoot,
        candidateRoot,
        commit: 'a'.repeat(40),
        buildDate: '2026-11-10',
        inputs: [],
      });
    };
    const a = await run('build'),
      b = await run('nested/owned/replay');
    expect(a).toEqual(b);
    expect(a.extractions?.[0]).toEqual({
      syntheticCompilerProbe: true,
      value: 1,
      marker: 'recorded-export',
    });
    expect((a.extractions?.at(-1) as any).compiled).toHaveLength(2);
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
}, 90000);
