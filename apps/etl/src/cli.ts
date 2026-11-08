#!/usr/bin/env node
import { parityCli } from '@sigma-budget/ingest';
import { lawBuildCli } from './law-build.js';
import { editorialBuildCli } from './editorial-build.js';
import { freshnessCli } from './freshness.js';

const USAGE = [
  'Usage: budget-ts parity --oracle <dir> --candidate <dir> --scope <ids> --policy <file> --report <file>',
  '       budget-ts build --inputs <fixture-root> --out <candidate-dir> --scope law|glossary,guide --build-date YYYY-MM-DD',
  '       budget-ts freshness [--release <dir>] [--today YYYY-MM-DD]',
].join('\n');

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build')
    process.exitCode = args.includes('glossary,guide')
      ? await editorialBuildCli(args)
      : await lawBuildCli(args);
  else if (command === 'parity') process.exitCode = await parityCli(args);
  else if (command === 'freshness') process.exitCode = await freshnessCli(args);
  else throw new Error(USAGE);
} catch (e) {
  console.error(String(e));
  process.exitCode = 1;
}
