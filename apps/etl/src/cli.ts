#!/usr/bin/env node
import { productionCli, PRODUCTION_USAGE } from './production-cli.js';
import { wave13aBuildCli, wave13aScope } from './wave13a-build.js';
import { wave13bBuildCli, wave13bScope } from './wave13b-build.js';
import { wave13bLiveDiagnostic } from './wave13b-live.js';
import { catalogBuildCli } from './catalog-build.js';
import { aggregationBuildCli } from './aggregation-build.js';
import { dbpGvaBuildCli } from './dbp-gva-build.js';
import { parityCli } from '@sigma-budget/ingest';
import { lawBuildCli } from './law-build.js';
import { editorialBuildCli } from './editorial-build.js';
import { programmesBuildCli } from './programmes-build.js';
import { componentsRatesBuildCli } from './components-rates-build.js';
import { freshnessCli } from './freshness.js';
import { fiscalBuildCli } from './fiscal-build.js';
import { debtLocalBuildCli } from './debt-local-build.js';

const USAGE = [
  'Usage: budget-ts parity --oracle <dir> --candidate <dir> --scope <ids> --policy <file> --report <file>',
  '       budget-ts build --inputs <fixture-root> --out <candidate-dir> --scope wave13b|outlook,revenue,expenditure,budget2027,budget2027-provenance,law|catalog|core,feed,feed-rss,search-index|law|glossary,guide|ministries,ministries-programs,programs|outlook,revenue,expenditure,measures|components,rates|debt,municipalities,geo-obshtini,sebra|dbp2027,gva-sectors --build-date YYYY-MM-DD',
  '       budget-ts freshness [--release <dir>] [--today YYYY-MM-DD]',
  '       budget-ts wave13b-live',
].join('\n');

try {
  const argv = process.argv.slice(2);
  if (argv[0] === '--json') {
    argv.shift();
    argv.push('--json');
  }
  const [command, ...args] = argv;
  const scopeIndex = args.findIndex((value, index) => index % 2 === 0 && value === '--scope');
  const scope = scopeIndex < 0 ? undefined : args[scopeIndex + 1];
  if (command === 'build')
    process.exitCode =
      scope === undefined
        ? await productionCli([command, ...args])
        : scope === wave13bScope
          ? await wave13bBuildCli(args)
          : scope === wave13aScope
            ? await wave13aBuildCli(args)
            : scope === 'catalog'
              ? await catalogBuildCli(args)
              : scope === 'core,feed,feed-rss,search-index'
                ? await aggregationBuildCli(args)
                : scope === 'debt,municipalities,geo-obshtini,sebra'
                  ? await debtLocalBuildCli(args)
                  : scope === 'dbp2027,gva-sectors'
                    ? await dbpGvaBuildCli(args)
                    : scope === 'outlook,revenue,expenditure,measures'
                      ? await fiscalBuildCli(args)
                      : scope === 'glossary,guide'
                        ? await editorialBuildCli(args)
                        : scope === 'components,rates'
                          ? await componentsRatesBuildCli(args)
                          : scope === 'ministries,ministries-programs,programs'
                            ? await programmesBuildCli(args)
                            : await lawBuildCli(args);
  else if (
    [
      'validate',
      'reproduce',
      'collect',
      'refetch',
      'import-source',
      'status',
      'source-status',
      'drift',
      'upload',
      'publish',
      'rollback',
      'preflight',
      'prepare',
      '--help',
      '-h',
    ].includes(command ?? '')
  )
    process.exitCode = await productionCli([command!, ...args]);
  else if (command === 'parity') process.exitCode = await parityCli(args);
  else if (command === 'freshness') process.exitCode = await freshnessCli(args);
  else if (command === 'wave13b-live') process.exitCode = await wave13bLiveDiagnostic(args);
  else throw new Error(PRODUCTION_USAGE + '\n' + USAGE);
} catch (e) {
  console.error(String(e));
  process.exitCode = 1;
}
