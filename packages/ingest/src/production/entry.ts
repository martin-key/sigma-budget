import { readProductionProgrammes, withProductionProgrammes } from './programmes.js';
import { readDebtIssues, registerDebtCatalog } from './debt-issues.js';
import { mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { runGraph } from '../build/graph.js';
import { wave13bStages } from '../build/wave13b.js';
import type { ExecutionContext, ExecutorResult } from '../release-build/types.js';
import { reviseLaunchTexts, reviseProgrammeSources } from './launch-texts.js';
import { loadProduction } from './loader.js';
import { readTaxDatasets, withProductionBudgets, registerTaxCatalog } from './taxes.js';
import { validateProduction } from './validation.js';
/** This is the committed entry loaded by the offline exported-code compiler. */
export async function executeRelease(context: Readonly<ExecutionContext>): Promise<ExecutorResult> {
  if (context.missingIntermediates?.length) {
    const view = join(context.scratchRoot, 'prepared-inputs');
    await cp(context.exportRoot, view, { recursive: true, errorOnExist: true, force: false });
    context = Object.freeze({ ...context, preparedInputRoot: view });
  }
  const prepared = await loadProduction(context);
  const generatedIntermediates = await Promise.all(
    (context.missingIntermediates ?? []).map(async (i) => {
      const b = await readFile(join(context.preparedInputRoot!, i.path));
      return {
        path: i.path,
        bytes: b.length,
        sha256: createHash('sha256').update(b).digest('hex'),
        mime: i.path.endsWith('.pdf')
          ? 'application/pdf'
          : i.path.endsWith('.7z')
            ? 'application/x-7z-compressed'
            : i.path.endsWith('.zip')
              ? 'application/zip'
              : 'application/json',
        kind: 'generated-intermediate',
        datasets: i.datasets,
      };
    }),
  );
  context = Object.freeze({ ...context, generatedIntermediates });
  registerTaxCatalog(prepared.input, context);
  registerDebtCatalog(prepared.input, context);
  prepared.input.core.sources = reviseProgrammeSources(
    prepared.input.core.sources,
  ) as typeof prepared.input.core.sources;
  const graph = runGraph(
    withProductionBudgets(
      withProductionProgrammes(
        reviseLaunchTexts(wave13bStages(prepared.input)),
        readProductionProgrammes(context),
      ),
      {
        ...readTaxDatasets(context),
        'debt-issues.json': readDebtIssues(context),
      },
    ),
  );
  const failed = graph.states.filter((s) => s.status !== 'success');
  if (failed.length) throw new Error('Production graph failed: ' + JSON.stringify(failed));
  const publication = graph.outputs.get('publication-layers') as {
    streams: Map<string, Uint8Array>;
  };
  if (!publication?.streams.size) throw new Error('Production graph did not publish outputs');
  for (const [path, bytes] of publication.streams) {
    if (path.startsWith('releases/'))
      throw new Error('Lifecycle metadata must not be produced by the graph');
    const destination = join(context.candidateRoot, 'data', path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  const validation = validateProduction(context, prepared);
  const { parse } = await import('yaml');
  const registry = parse(
    (await readFile(join(context.exportRoot, 'data/datasets.yaml'))).toString(),
  );
  return {
    validation,
    ...(generatedIntermediates.length ? { generatedIntermediates } : {}),
    datasets: registry.datasets
      .filter((d: any) => d.status !== 'pending' && d.id !== 'releases')
      .map((d: any) => ({
        id: d.id,
        action: d.id === 'gva-sectors' ? 'preserved-input' : 'built',
      })),
    extractions: [
      ...prepared.extractions,
      { schema: 'production-graph/1', stages: graph.states, rawReconstruction: 'unverified' },
    ],
  };
}
