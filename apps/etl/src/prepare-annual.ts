#!/usr/bin/env node
/** Standalone offline annual preparation; unified production dispatch is separate. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareAnnual, readAnnualRegistration } from '@sigma-budget/ingest/readers/annual';
export async function prepareAnnualCli(
  args: string[],
  log: (value: string) => void = console.log,
): Promise<number> {
  const flags: Record<string, string> = {};
  const allowed = ['--source-root', '--source-registry', '--pins', '--out', '--build-date'];
  if (args.length === 1 && args[0] === '--help') {
    log(
      'prepare-annual --source-root PATH --source-registry PATH --pins PATH --out OWNED_DIRECTORY --build-date YYYY-MM-DD',
    );
    return 0;
  }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !value ||
      value.startsWith('--') ||
      !allowed.includes(key) ||
      Object.hasOwn(flags, key)
    )
      throw new Error('Invalid annual preparation arguments');
    flags[key] = value;
  }
  if (allowed.some((k) => !flags[k])) throw new Error('Required: ' + allowed.join(', '));
  const registration = await readAnnualRegistration(
    resolve(flags['--source-registry']!),
    resolve(flags['--pins']!),
  );
  const receipt = await prepareAnnual({
    sourceRoot: resolve(flags['--source-root']!),
    registration,
    out: resolve(flags['--out']!),
    buildDate: flags['--build-date']!,
  });
  log(JSON.stringify(receipt));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareAnnualCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    });
}
