import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  credentialsFromEnvironment,
  preflightRelease,
  ReleaseClient,
  ReleaseError,
  type ClientOptions,
  type ReleaseEnvironment,
} from '@sigma-budget/ingest/release-client';

const usage = `Usage: node apps/etl/dist/release-operator.js <status|preflight|upload|publish|rollback>
  --environment <name> --url <https-origin> [--receipts <directory>]
  preflight/upload/publish: --release <candidate> --originals <source-root>
  rollback: --release-id <sha256>
  upload/publish/rollback: --yes | --dry-run
  publish/rollback: [--expected-revision <integer>]
  [--max-object-bytes <integer>] [--json]
Protected process inputs: BUDGET_ACCESS_TOKEN, or CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET.
No credential flags, home auth discovery, environment file loading or default environment.`;

export interface OperatorCliDependencies {
  /** Parent may inject its existing environment registry after resolving it. */
  environment?: (name: string) => ReleaseEnvironment;
  credentialEnvironment?: Readonly<Record<string, string | undefined>>;
  client?: (options: ClientOptions) => ReleaseClient;
  stdout?: (text: string) => void;
}
/** Standalone dispatch; importing this module neither reads process inputs nor runs a command. */
export async function releaseOperatorCli(
  args: string[],
  dependencies: OperatorCliDependencies = {},
): Promise<number> {
  const out = dependencies.stdout ?? ((text) => console.log(text));
  try {
    if (args.length === 0 || args.includes('--help')) {
      out(usage);
      return 0;
    }
    const command = args[0];
    if (!['status', 'preflight', 'upload', 'publish', 'rollback'].includes(command ?? ''))
      throw new ReleaseError(2, 'Unknown release operator command');
    const flags: Record<string, string | true> = {};
    const boolean = new Set(['--json', '--yes', '--dry-run']);
    const allowed = new Set([
      '--environment',
      '--url',
      '--receipts',
      '--max-object-bytes',
      '--json',
      ...(command === 'status'
        ? []
        : command === 'preflight'
          ? ['--release', '--originals']
          : [
              '--yes',
              '--dry-run',
              ...(command === 'rollback'
                ? ['--release-id', '--expected-revision']
                : [
                    '--release',
                    '--originals',
                    ...(command === 'publish' ? ['--expected-revision'] : []),
                  ]),
            ]),
    ]);
    for (let i = 1; i < args.length; i++) {
      const key = args[i]!;
      // Never echo unknown flags or values: they might contain a secret.
      if (!allowed.has(key) || flags[key] !== undefined)
        throw new ReleaseError(2, 'Unknown or duplicate operator option');
      if (boolean.has(key)) flags[key] = true;
      else {
        const value = args[++i];
        if (!value || value.startsWith('--'))
          throw new ReleaseError(2, 'Operator option requires a value');
        flags[key] = value;
      }
    }
    const get = (key: string) =>
      typeof flags[key] === 'string' ? (flags[key] as string) : undefined;
    const required = (key: string) => {
      const value = get(key);
      if (!value) throw new ReleaseError(2, `Required option ${key}`);
      return value;
    };
    const integer = (key: string) => {
      const value = get(key);
      if (value === undefined) return undefined;
      if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new ReleaseError(2, 'Expected an integer operator option');
      return Number(value);
    };
    const name = required('--environment');
    const supplied = dependencies.environment?.(name);
    if (supplied && (supplied.name !== name || (get('--url') && get('--url') !== supplied.url)))
      throw new ReleaseError(2, 'Explicit URL conflicts with resolved environment');
    const environment = supplied ?? { name, url: required('--url') };
    const maxObjectBytes = integer('--max-object-bytes');
    const options: ClientOptions = {
      environment,
      receiptDirectory: get('--receipts') ?? resolve('work/ts-operator-receipts'),
      maxObjectBytes,
      credentials: () =>
        credentialsFromEnvironment(dependencies.credentialEnvironment ?? process.env),
    };
    const client = dependencies.client?.(options) ?? new ReleaseClient(options);
    const dryRun = flags['--dry-run'] === true;
    if (['upload', 'publish', 'rollback'].includes(command!) && !dryRun && flags['--yes'] !== true)
      throw new ReleaseError(
        2,
        'Pass --yes to authorize the named environment change, or --dry-run',
      );
    let result: unknown;
    if (command === 'status') result = await client.status();
    else if (command === 'rollback')
      result = await client.rollback({
        releaseId: required('--release-id'),
        expectedRevision: integer('--expected-revision'),
        dryRun,
      });
    else {
      const pkg = {
        release: required('--release'),
        originals: required('--originals'),
        maxObjectBytes,
      };
      if (command === 'preflight') {
        const checked = await preflightRelease(pkg);
        result = {
          environment: client.environment.name,
          url: client.environment.url,
          release_id: checked.releaseId,
          manifestBytes: checked.manifestBytes.length,
          inputs: checked.manifest.inputs.length,
          outputs: checked.manifest.outputs.length,
          objects: checked.objects.size,
          maxObjectBytes: checked.maxObjectBytes,
          largestObject: Math.max(
            ...checked.manifest.inputs.concat(checked.manifest.outputs).map((f) => f.bytes),
          ),
          preflight: 'verified',
        };
      } else if (command === 'upload') result = await client.upload({ ...pkg, dryRun });
      else
        result = await client.publish({
          ...pkg,
          expectedRevision: integer('--expected-revision'),
          dryRun,
        });
    }
    out(JSON.stringify({ ...(result as object), exit: 0 }));
    return 0;
  } catch (error) {
    const code = error instanceof ReleaseError ? error.code : 2;
    out(
      JSON.stringify({
        error:
          error instanceof ReleaseError
            ? error.message
            : 'Release operator failed; no credential or transport payload is shown',
        exit: code,
      }),
    );
    return code;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await releaseOperatorCli(process.argv.slice(2));
}
