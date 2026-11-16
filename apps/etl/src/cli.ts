#!/usr/bin/env node
import { productionCli } from './production-cli.js';
import { freshnessCli } from './freshness.js';

try {
  const argv = process.argv.slice(2);
  if (argv[0] === '--json') {
    argv.shift();
    argv.push('--json');
  }
  const [command, ...args] = argv;
  process.exitCode = command === 'freshness' ? await freshnessCli(args) : await productionCli(argv);
} catch (e) {
  console.error(String(e));
  process.exitCode = 1;
}
