import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Isolated deep entry until parent owns package exports/unified dispatch binding.
import {
  buildRelease,
  checkReleaseDirectory,
  recordedNodeExecutor,
  reproduceRelease,
  ReproductionDifference,
  type ReleaseExecutor,
} from '../../../packages/ingest/dist/release-build/index.js';
import { ReleaseError } from '@sigma-budget/ingest/release-client';

export interface ReleaseBuildOperatorDependencies {
  /** Parent supplies its real exported-code graph/complete-validator adapter here. */
  executor?: ReleaseExecutor;
  stdout?: (text: string) => void;
}
const usage = `Usage: release-build-operator <build|validate|reproduce>
  build: --root REPOSITORY --commit COMMIT --inputs SNAPSHOT --out NEW_DIRECTORY --build-date YYYY-MM-DD
  reproduce: --root REPOSITORY --release CANDIDATE --inputs SNAPSHOT --out NEW_DIRECTORY
  validate: --release CANDIDATE --inputs CANONICAL_SOURCE_ROOT
  build/reproduce: --entry COMMITTED_NODE_ENTRY --executor-id ID (unless injected by parent)
  [--max-object-bytes INTEGER]
Offline only. Historical Python releases use budget reproduce. No default source/executor/fixture.`;
export async function releaseBuildOperatorCli(
  args: string[],
  dependencies: ReleaseBuildOperatorDependencies = {},
): Promise<number> {
  const out = dependencies.stdout ?? ((text: string) => console.log(text));
  try {
    if (!args.length || (args.length === 1 && args[0] === '--help')) {
      out(usage);
      return 0;
    }
    const command = args[0];
    if (!['build', 'validate', 'reproduce'].includes(command ?? ''))
      throw new ReleaseError(2, 'Unknown build lifecycle command');
    const allowed = new Set([
      '--inputs',
      '--max-object-bytes',
      ...(command === 'validate'
        ? ['--release']
        : [
            '--root',
            '--out',
            '--entry',
            '--executor-id',
            ...(command === 'build' ? ['--commit', '--build-date'] : ['--release']),
          ]),
    ]);
    const flags: Record<string, string> = {};
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i]!,
        value = args[i + 1];
      if (!allowed.has(key) || flags[key] !== undefined || !value || value.startsWith('--'))
        throw new ReleaseError(2, 'Unknown, duplicate or incomplete build option');
      flags[key] = value;
    }
    const required = (key: string) => {
      const value = flags[key];
      if (!value) throw new ReleaseError(2, 'Required option ' + key);
      return value;
    };
    const inputRoot = resolve(required('--inputs'));
    let maxObjectBytes: number | undefined;
    if (flags['--max-object-bytes'] !== undefined) {
      const raw = flags['--max-object-bytes'];
      if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
        throw new ReleaseError(2, 'Invalid object byte limit');
      maxObjectBytes = Number(raw);
    }
    if (command === 'validate') {
      const pkg = await checkReleaseDirectory({
        releaseRoot: resolve(required('--release')),
        inputRoot,
        maxObjectBytes,
      });
      out(
        JSON.stringify({
          release_id: pkg.releaseId,
          inputs: pkg.manifest.inputs.length,
          outputs: pkg.manifest.outputs.length,
          package: 'verified',
          numericalValidation: 'recorded-report-only',
        }),
      );
      return 0;
    }
    if (dependencies.executor && (flags['--entry'] || flags['--executor-id']))
      throw new ReleaseError(2, 'Injected executor conflicts with command executor identity');
    const executor =
      dependencies.executor ??
      recordedNodeExecutor({ entry: required('--entry'), id: required('--executor-id') });
    const shared = {
      repositoryRoot: resolve(required('--root')),
      inputRoot,
      outputRoot: resolve(required('--out')),
      executor,
      maxObjectBytes,
    };
    const result =
      command === 'build'
        ? await buildRelease({
            ...shared,
            commit: required('--commit'),
            buildDate: required('--build-date'),
          })
        : await reproduceRelease({ ...shared, releaseRoot: resolve(required('--release')) });
    out(
      JSON.stringify({
        release_id: result.releaseId,
        out: result.outputRoot,
        inputs: result.manifest.inputs.length,
        outputs: result.manifest.outputs.length,
        ...(command === 'reproduce' ? { verdict: 'reproduced byte for byte' } : {}),
      }),
    );
    return 0;
  } catch (error) {
    const code =
      error instanceof ReleaseError || error instanceof ReproductionDifference
        ? error.code
        : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? 3
          : 2;
    out(
      JSON.stringify({
        exit: code,
        error: error instanceof Error ? error.message : 'Build lifecycle failed',
      }),
    );
    return code;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await releaseBuildOperatorCli(process.argv.slice(2));
