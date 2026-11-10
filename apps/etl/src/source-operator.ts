#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SourceClient,
  inspectDrift,
  type ClientOptions,
  type KfpDecoder,
} from '@sigma-budget/ingest/source-client';
import { checkFreshness } from './freshness.js';

export const SOURCE_OPERATOR_USAGE = `Usage: source-operator <collect|refetch|import-source|status|drift>
  --source-root DIR --registry FILE [--pins FILE] [--now ISO_TIMESTAMP]
  collect: --out DIR [--seed DIR] [--sources ID,ID] [--resume] [--check-drift] [--summary FILE]
  refetch: --manifest FILE --out DIR [--resume] [--summary FILE]
  import-source: --source ID --file FILE --out DIR [--url PUBLIC_URL] [--replace] [--dry-run]
                 [--decoder-module FILE] [--summary FILE]
  status: no additional arguments
  drift: --snapshot FILE [--review FILE] [--report FILE] [--summary FILE]
  acquisition limits: [--attempts 1..5] [--timeout-ms 1..30000] [--max-bytes N] [--max-decoded-bytes N]
  All output roots must be separate from source roots and all input files.
  --decoder-module exports decodeKfp(bytes): {sheet,rows,columns,title,unitText}.`;
export interface SourceOperatorDependencies {
  client?: Pick<ClientOptions, 'transport' | 'clock' | 'allowLocalHttp' | 'allowedRedirects'>;
  decodeKfp?: KfpDecoder;
  write?: (text: string) => void;
  error?: (text: string) => void;
}
/** Parent dispatch can call this function; importing the module never executes a command. */
export async function sourceOperatorCli(
  argv: string[],
  deps: SourceOperatorDependencies = {},
): Promise<number> {
  const write = deps.write ?? console.log,
    error = deps.error ?? console.error;
  try {
    if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) {
      write(SOURCE_OPERATOR_USAGE);
      return 0;
    }
    const [command, ...args] = argv;
    const boolean = new Set(['--resume', '--check-drift', '--replace', '--dry-run']);
    const common = [
      '--source-root',
      '--registry',
      '--pins',
      '--now',
      '--attempts',
      '--timeout-ms',
      '--max-bytes',
      '--max-decoded-bytes',
    ];
    const commandFlags: Record<string, string[]> = {
      collect: ['--out', '--seed', '--sources', '--resume', '--check-drift', '--summary'],
      refetch: ['--out', '--manifest', '--resume', '--summary'],
      'import-source': [
        '--out',
        '--source',
        '--file',
        '--url',
        '--replace',
        '--dry-run',
        '--decoder-module',
        '--summary',
      ],
      status: [],
      drift: ['--snapshot', '--review', '--report', '--summary'],
    };
    if (!command || !commandFlags[command]) throw new Error(SOURCE_OPERATOR_USAGE);
    const allowed = new Set([...common, ...commandFlags[command]!]),
      values = new Map<string, string>();
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]!;
      if (!allowed.has(flag) || values.has(flag))
        throw new Error('Unknown or duplicate option: ' + flag);
      if (boolean.has(flag)) values.set(flag, 'true');
      else {
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
        values.set(flag, value);
      }
    }
    const required = (flag: string): string => {
      const value = values.get(flag);
      if (!value) throw new Error('Required: ' + flag);
      return value;
    };
    const numeric = (flag: string): number | undefined => {
      const v = values.get(flag);
      if (v === undefined) return undefined;
      if (!/^\d+$/.test(v) || !Number.isSafeInteger(+v) || +v <= 0)
        throw new Error('Invalid numeric option: ' + flag);
      return +v;
    };
    let clock = deps.client?.clock;
    if (values.has('--now')) {
      const date = new Date(required('--now'));
      if (
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(required('--now')) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().replace('.000Z', 'Z') !== required('--now').replace('.000Z', 'Z')
      )
        throw new Error('Invalid --now UTC timestamp');
      clock = () => new Date(date);
    }
    const client = await SourceClient.open({
      ...deps.client,
      clock,
      sourceRoot: required('--source-root'),
      registryPath: required('--registry'),
      pinsPath: values.get('--pins'),
      attempts: numeric('--attempts'),
      timeoutMs: numeric('--timeout-ms'),
      maxBytes: numeric('--max-bytes'),
      maxDecodedBytes: numeric('--max-decoded-bytes'),
    });
    if (command === 'status') {
      const result = await client.status();
      const freshness = result.latestAsOf
        ? checkFreshness(result.latestAsOf, client.now().slice(0, 10))
        : undefined;
      write(JSON.stringify({ ...result, freshness }));
      return result.code;
    }
    if (command === 'drift') {
      const result = await inspectDrift(client, {
        snapshotPath: required('--snapshot'),
        reviewPath: values.get('--review'),
        reportPath: values.get('--report'),
        summaryPath: values.get('--summary'),
      });
      write(JSON.stringify(result));
      return result.code;
    }
    let result;
    if (command === 'import-source') {
      let decodeKfp = deps.decodeKfp;
      if (values.has('--decoder-module')) {
        const module = (await import(
          pathToFileURL(resolve(required('--decoder-module'))).href
        )) as { decodeKfp?: KfpDecoder };
        if (typeof module.decodeKfp !== 'function')
          throw new Error('Decoder module must export decodeKfp');
        decodeKfp = module.decodeKfp;
      }
      result = await client.importSource({
        source: required('--source'),
        file: required('--file'),
        snapshotRoot: required('--out'),
        url: values.get('--url'),
        replace: values.has('--replace'),
        dryRun: values.has('--dry-run'),
        decodeKfp,
        summaryPath: values.get('--summary'),
      });
    } else if (command === 'refetch')
      result = await client.refetch({
        manifestPath: required('--manifest'),
        snapshotRoot: required('--out'),
        resume: values.has('--resume'),
        summaryPath: values.get('--summary'),
      });
    else
      result = await client.collect({
        snapshotRoot: required('--out'),
        seedRoot: values.get('--seed'),
        sources: values.get('--sources')?.split(','),
        resume: values.has('--resume'),
        checkDrift: values.has('--check-drift'),
        summaryPath: values.get('--summary'),
      });
    write(JSON.stringify(result));
    return result.code;
  } catch (e) {
    error(e instanceof Error ? e.message : 'Source operation failed');
    return 2;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await sourceOperatorCli(process.argv.slice(2));
