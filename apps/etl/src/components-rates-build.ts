import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  buildComponents,
  buildRates,
  jsonStringify,
  verifyComponentsRatesInputs,
  type ComponentEvidence,
  type RatesEvidence,
} from '@sigma-budget/ingest';

/** Temporary, strictly scoped candidate builder. */
export async function componentsRatesBuildCli(args: string[]): Promise<number> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !value ||
      value.startsWith('--') ||
      !['--inputs', '--out', '--scope', '--build-date'].includes(key) ||
      flags[key]
    )
      throw new Error('Invalid build arguments');
    flags[key] = value;
  }
  if (
    !flags['--inputs'] ||
    !flags['--out'] ||
    flags['--scope'] !== 'components,rates' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(flags['--build-date'] ?? '')
  )
    throw new Error('Build requires --inputs, --out, --scope components,rates and --build-date');
  const allowed = resolve('tmp/ts-migration/candidates/06');
  if (resolve(flags['--out']) !== allowed)
    throw new Error('Output must be tmp/ts-migration/candidates/06');
  const fixture = resolve(flags['--inputs']);
  await verifyComponentsRatesInputs(fixture);
  const read = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(fixture, 'inputs', name), 'utf8'));
  const [law, doo, nzok, tables, pages, execution, municipalities, outlook, summary, nap, bill] =
    await Promise.all(
      [
        'law.json',
        'doo-blocks.json',
        'nzok-blocks.json',
        'tables.json',
        'pages.json',
        'execution.json',
        'municipalities.json',
        'outlook.json',
        'kfp-components.json',
        'nap-rows.json',
        'bill-blocks.json',
      ].map(read),
    );
  const components = buildComponents(
    {
      law,
      doo,
      nzok,
      tables,
      pages,
      execution,
      municipalities,
      outlook,
      summary,
    } as ComponentEvidence,
    flags['--build-date']!,
  );
  const rates = buildRates({ doo, nzok, nap, bill } as RatesEvidence, flags['--build-date']!);
  // Walk each directory before creating the next: no recursive mkdir through a symlink.
  let current = resolve('.');
  if ((await realpath(current)) !== current) throw new Error('Symlink in workspace path');
  for (const part of ['tmp', 'ts-migration', 'candidates', '06', 'data']) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(current)) !== current)
      throw new Error('Symlink or non-directory in output path');
  }
  for (const [name, value] of [
    ['components.json', components],
    ['rates.json', rates],
  ] as const) {
    const target = join(current, name);
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
        throw new Error('Symlink or unsafe output file');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const temp = join(current, `.${name}.${process.pid}.tmp`);
    let created = false;
    try {
      await writeFile(temp, jsonStringify(value) + '\n', { flag: 'wx' });
      created = true;
      await rename(temp, target);
      created = false;
    } finally {
      if (created) await unlink(temp).catch(() => {});
    }
  }
  return 0;
}
