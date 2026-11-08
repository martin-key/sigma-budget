#!/usr/bin/env node
import { parityCli } from '@sigma-budget/ingest';
import { lawBuildCli } from './law-build.js';
import { editorialBuildCli } from './editorial-build.js';
import { programmesBuildCli } from './programmes-build.js';
import { freshnessCli } from './freshness.js';
import { fiscalBuildCli } from './fiscal-build.js';

const USAGE = [
  'Usage: budget-ts parity --oracle <dir> --candidate <dir> --scope <ids> --policy <file> --report <file>',
  '       budget-ts build --inputs <fixture-root> --out <candidate-dir> --scope law|glossary,guide|ministries,ministries-programs,programs|outlook,revenue,expenditure,measures --build-date YYYY-MM-DD',
  '       budget-ts freshness [--release <dir>] [--today YYYY-MM-DD]',
].join('\n');

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build')
    process.exitCode = args.includes('outlook,revenue,expenditure,measures')
      ? await fiscalBuildCli(args)
      : args.includes('glossary,guide')
      ? await editorialBuildCli(args)
      : args.includes('ministries,ministries-programs,programs')
        ? await programmesBuildCli(args)
        : await lawBuildCli(args);
  else if (command === 'parity') process.exitCode = await parityCli(args);
  else if (command === 'freshness') process.exitCode = await freshnessCli(args);
  else throw new Error(USAGE);
} catch (e) {
  console.error(String(e));
  process.exitCode = 1;
}
