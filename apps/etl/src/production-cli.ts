import { readFile, writeFile, mkdir, mkdtemp, rm, cp, lstat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildRelease,
  reproduceRelease,
  checkReleaseDirectory,
  preflightDestination,
  ReproductionDifference,
} from '@sigma-budget/ingest/release-build';
import { productionExecutor, decodeKfp } from '@sigma-budget/ingest/production';
import {
  canonicalJson,
  ReleaseError,
  type HttpTransport,
} from '@sigma-budget/ingest/release-client';
import { prepareFiscalDocuments } from '@sigma-budget/ingest/readers/fiscal-documents';
import { preparePublicationDocuments } from '@sigma-budget/ingest/readers/publication-documents';
import { prepareAnnual, readAnnualRegistration } from '@sigma-budget/ingest/readers/annual';
import { safePath as safeDestination } from '@sigma-budget/ingest/readers/annual';
import { createRequire } from 'node:module';
import { sourceOperatorCli, type SourceOperatorDependencies } from './source-operator.js';
import { releaseOperatorCli, type OperatorCliDependencies } from './release-operator.js';
import { locateManifest, materializeRemote, getBytes } from './manifest-location.js';

export const PRODUCTION_USAGE = `Usage: budget <command> [options] (alias: budget-ts)
  build --commit COMMIT --inputs SNAPSHOT --out NEW_DIRECTORY --build-date YYYY-MM-DD [--site]
  validate --release CANDIDATE | --site [--inputs SNAPSHOT]
  reproduce --manifest FILE_OR_URL | --current SITE [--originals SNAPSHOT] [--out NEW_DIRECTORY] [--skip-published]
  collect [--seed SNAPSHOT] --out NEW_SNAPSHOT [--check-drift] [--summary FILE]
  refetch --manifest FILE_OR_URL | --current SITE --out NEW_SNAPSHOT
  import-source --source ID --file FILE --out NEW_SNAPSHOT [--url URL] [--replace] [--dry-run]
  source-status | drift (source operation options)
  status | upload | publish | rollback --environment NAME [--url ORIGIN] (existing release operator options)
  prepare --inputs SNAPSHOT --out NEW_DIRECTORY --build-date YYYY-MM-DD [--programme-source archive|extracted]
  freshness (existing options)
  --root defaults to the repository; --json emits machine-readable results.
New production builds are offline Node and require an explicit date. ./budget and budget-ts use this Node dispatcher; historical packages use ./budget-python.
Historical manifests: budget-ts reproduce --manifest FILE --historical-python --env local|docker
No restore subcommand: use the existing documented restore procedure/protocol.`;
export interface ProductionCliDependencies {
  root?: string;
  write?: (s: string) => void;
  error?: (s: string) => void;
  source?: SourceOperatorDependencies;
  operator?: OperatorCliDependencies;
  transport?: HttpTransport;
}
const boolean = new Set([
  '--json',
  '--site',
  '--skip-published',
  '--historical-python',
  '--resume',
  '--check-drift',
  '--replace',
  '--dry-run',
  '--yes',
]);
function flags(args: string[]) {
  const m = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!key.startsWith('--') || m.has(key))
      throw new ReleaseError(2, 'Unknown or duplicate command option');
    if (boolean.has(key)) m.set(key, 'true');
    else {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        throw new ReleaseError(2, 'Command option needs a value');
      m.set(key, value);
    }
  }
  return m;
}
export async function productionCli(
  argv: string[],
  deps: ProductionCliDependencies = {},
): Promise<number> {
  const out = deps.write ?? console.log,
    error = deps.error ?? console.error;
  let temporary: string | undefined;
  try {
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
      out(PRODUCTION_USAGE);
      return 0;
    }
    const [command, ...args] = argv,
      m = flags(args),
      root = resolve(m.get('--root') ?? deps.root ?? process.cwd());
    const get = (key: string, fallback?: string) => m.get(key) ?? fallback;
    const required = (key: string) => {
      const v = get(key);
      if (!v) throw new ReleaseError(2, 'Required option ' + key);
      return v;
    };
    const allowed = (keys: string[]) => {
      for (const k of m.keys())
        if (!['--root', '--json', ...keys].includes(k))
          throw new ReleaseError(2, 'Unknown option ' + k);
    };
    const pass = (omit: string[] = []) => {
      const result: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const key = args[i]!;
        if (['--root', '--json', ...omit].includes(key)) {
          if (!boolean.has(key)) i++;
        } else {
          result.push(key);
          if (!boolean.has(key)) result.push(args[++i]!);
        }
      }
      return result;
    };
    const inputs = resolve(get('--inputs', get('--originals', root))!);
    const freshTemp = async () =>
      (temporary ??= await mkdtemp(join(tmpdir(), 'budget-node-command-')));
    if (['collect', 'import-source', 'source-status', 'drift'].includes(command!)) {
      const sourceCommand = command === 'source-status' ? 'status' : command!;
      const forwarded = pass();
      const has = (f: string) => forwarded.includes(f);
      for (const [flag, value] of [
        ['--source-root', root],
        ['--registry', join(root, 'data/sources.yaml')],
        ['--pins', join(root, 'data/originals.sha256')],
      ])
        if (!has(flag!)) forwarded.push(flag!, value!);
      if (command === 'collect' && !has('--seed')) forwarded.push('--seed', root);
      return sourceOperatorCli([sourceCommand, ...forwarded], {
        ...deps.source,
        decodeKfp,
        write: out,
        error,
      });
    }
    if (['status', 'upload', 'publish', 'rollback', 'preflight'].includes(command!)) {
      const environment = required('--environment'),
        forwarded = pass();
      if (!m.has('--url')) {
        let envs = JSON.parse(await readFile(join(root, 'pipeline/environments.json'), 'utf8'));
        const local = join(root, 'pipeline/environments.local.json');
        if (existsSync(local)) envs = { ...envs, ...JSON.parse(await readFile(local, 'utf8')) };
        if (typeof envs[environment]?.url !== 'string')
          throw new ReleaseError(2, 'Named environment is not provisioned');
        forwarded.push('--url', envs[environment].url);
      }
      if (['upload', 'publish', 'preflight'].includes(command!) && !m.has('--originals'))
        forwarded.push('--originals', root);
      if (!m.has('--max-object-bytes')) forwarded.push('--max-object-bytes', '67108864');
      return releaseOperatorCli([command!, ...forwarded], { ...deps.operator, stdout: out });
    }
    if (command === 'refetch') {
      allowed([
        '--manifest',
        '--current',
        '--out',
        '--resume',
        '--summary',
        '--now',
        '--source-root',
        '--registry',
        '--pins',
      ]);
      const location = await locateManifest(
          { manifest: get('--manifest'), current: get('--current') },
          deps.transport,
        ),
        temp = await freshTemp();
      const path = join(temp, 'manifest.json');
      await writeFile(path, location.bytes, { flag: 'wx' });
      return sourceOperatorCli(
        [
          'refetch',
          '--source-root',
          get('--source-root', root)!,
          '--registry',
          get('--registry', join(root, 'data/sources.yaml'))!,
          '--pins',
          get('--pins', join(root, 'data/originals.sha256'))!,
          '--manifest',
          path,
          '--out',
          required('--out'),
          ...pass(['--manifest', '--current', '--out', '--source-root', '--registry', '--pins']),
        ],
        { ...deps.source, write: out, error },
      );
    }
    if (command === 'prepare') {
      allowed(['--inputs', '--out', '--build-date', '--programme-source']);
      const destination = await preflightDestination(resolve(required('--out')), [root, inputs]);
      await mkdir(destination);
      const date = required('--build-date');
      const registryPath = join(root, 'data/sources.yaml'),
        pinsPath = join(root, 'data/originals.sha256');
      await prepareFiscalDocuments({
        sourceRoot: inputs,
        registryPath,
        pinsPath,
        readDate: date,
        out: join(destination, 'fiscal'),
      });
      const annual = join(destination, 'annual');
      await mkdir(annual);
      await prepareAnnual({
        sourceRoot: inputs,
        registration: await readAnnualRegistration(registryPath, pinsPath),
        buildDate: date,
        out: annual,
      });
      const programmeSource = get('--programme-source', 'archive');
      if (!['archive', 'extracted'].includes(programmeSource!))
        throw new ReleaseError(2, 'Invalid programme source');
      const require = createRequire(join(root, 'packages/ingest/package.json'));
      const publication = join(destination, 'publication');
      await mkdir(publication);
      await preparePublicationDocuments({
        inputRoot: inputs,
        registryPath,
        pinsPath,
        readDate: date,
        out: publication,
        programmeSource: programmeSource as 'archive' | 'extracted',
        sevenZip: { wasmModule: require.resolve('7z-wasm') },
        zdbPath: join(root, 'data/inputs/zdb2026.json'),
      });
      out(
        JSON.stringify({
          out: destination,
          status: 'prepared',
          historicalReconstruction: 'unverified',
        }),
      );
      return 0;
    }
    if (command === 'build') {
      allowed(['--commit', '--inputs', '--out', '--build-date', '--env', '--site']);
      if (m.has('--env') && !['node', 'local'].includes(required('--env')))
        throw new ReleaseError(2, 'New builds require the locked local Node runtime');
      const result = await buildRelease({
        repositoryRoot: root,
        commit: get('--commit', 'HEAD')!,
        inputRoot: inputs,
        outputRoot: resolve(required('--out')),
        buildDate: required('--build-date'),
        executor: await productionExecutor(root),
        maxObjectBytes: 67108864,
      });
      if (m.has('--site')) await installSite(root, result.outputRoot, result.releaseId);
      out(
        JSON.stringify({
          release_id: result.releaseId,
          out: result.outputRoot,
          inputs: result.manifest.inputs.length,
          outputs: result.manifest.outputs.length,
          site: m.has('--site'),
        }),
      );
      return 0;
    }
    if (command !== 'validate' && command !== 'reproduce')
      throw new ReleaseError(2, PRODUCTION_USAGE);
    allowed(
      command === 'validate'
        ? ['--release', '--site', '--inputs', '--originals']
        : [
            '--manifest',
            '--current',
            '--release',
            '--originals',
            '--inputs',
            '--out',
            '--skip-published',
            '--historical-python',
            '--env',
          ],
    );
    let release: string, location;
    if (command === 'validate') {
      if (Number(m.has('--site')) + Number(m.has('--release')) !== 1)
        throw new ReleaseError(2, 'Choose --release or --site');
      release = m.has('--site')
        ? await sitePackage(root, join(await freshTemp(), 'site-package'))
        : resolve(required('--release'));
      location = await locateManifest({ manifest: join(release, 'manifest.json') }, deps.transport);
    } else {
      if (m.has('--release') && (m.has('--manifest') || m.has('--current')))
        throw new ReleaseError(2, 'Conflicting release selection');
      location = await locateManifest(
        {
          manifest: get(
            '--manifest',
            m.has('--release') ? join(required('--release'), 'manifest.json') : undefined,
          ),
          current: get('--current'),
        },
        deps.transport,
      );
      release = location.remote ? '' : location.base;
    }
    const executorInfo = location.manifest.processing.executor as any;
    if (executorInfo?.runtime !== 'node-export/1') {
      if (command !== 'reproduce' || !m.has('--historical-python'))
        throw new ReleaseError(
          2,
          'Historical manifest: use ./budget-python or explicit --historical-python replay',
        );
      const python =
        process.env.PYTHON312 ??
        (existsSync(join(root, 'tmp/venv-data/bin/python'))
          ? join(root, 'tmp/venv-data/bin/python')
          : 'python3.12');
      const result = await promisify(execFile)(
        python,
        [
          '-m',
          'budget_pipeline.cli',
          'reproduce',
          ...pass(['--historical-python', '--out', '--inputs', '--release']),
        ],
        {
          cwd: root,
          env: { ...process.env, PYTHONPATH: join(root, 'pipeline'), PYTHONDONTWRITEBYTECODE: '1' },
          timeout: 300000,
          maxBuffer: 1024 * 1024,
        },
      );
      out(result.stdout);
      return 0;
    }
    let source = inputs;
    if (location.remote && m.has('--skip-published')) {
      if (!m.has('--originals') && !m.has('--inputs')) {
        source = join(await freshTemp(), 'remote-originals');
        await mkdir(source);
        for (const f of location.manifest.inputs) {
          const b = await getBytes(
            new URL(f.path.split('/').map(encodeURIComponent).join('/'), location.base).href,
            deps.transport,
          );
          const { createHash } = await import('node:crypto');
          if (b.length !== f.bytes || createHash('sha256').update(b).digest('hex') !== f.sha256)
            throw new ReleaseError(2, 'Remote original differs from manifest');
          const path = join(source, f.path);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, b, { flag: 'wx' });
        }
      }
      const outputRoot = m.has('--out')
        ? await preflightDestination(resolve(required('--out')), [root, source])
        : join(await freshTemp(), 'replay');
      const parameters = location.manifest.processing.parameters as any;
      const result = await buildRelease({
        repositoryRoot: root,
        commit: location.manifest.processing.code.commit,
        inputRoot: source,
        outputRoot,
        buildDate: parameters.build_date,
        executor: await productionExecutor(root),
        maxObjectBytes: 67108864,
      });
      if (result.releaseId !== location.releaseId) {
        await rm(result.outputRoot, { recursive: true, force: true });
        throw new ReproductionDifference('Recorded manifest differs from local replay');
      }
      out(
        JSON.stringify({
          release_id: result.releaseId,
          verdict: 'reproduced byte for byte',
          completeValidation: true,
          publishedVerification: 'skipped by explicit option',
          out: m.has('--out') ? result.outputRoot : undefined,
        }),
      );
      return 0;
    }
    if (location.remote) {
      const temp = await freshTemp();
      release = await materializeRemote(
        location,
        join(temp, 'remote-package'),
        deps.transport,
        !m.has('--originals') && !m.has('--inputs'),
      );
      if (!m.has('--originals') && !m.has('--inputs')) source = release;
    }
    const outputRoot = m.has('--out')
      ? await preflightDestination(resolve(required('--out')), [root, source, release])
      : join(await freshTemp(), 'replay');
    const result = await reproduceRelease({
      repositoryRoot: root,
      releaseRoot: release,
      inputRoot: source,
      outputRoot,
      executor: await productionExecutor(root),
      maxObjectBytes: 67108864,
    });
    out(
      JSON.stringify({
        release_id: result.releaseId,
        verdict: 'reproduced byte for byte',
        completeValidation: true,
        out: m.has('--out') ? result.outputRoot : undefined,
      }),
    );
    return 0;
  } catch (e) {
    const code =
      e instanceof ReleaseError || e instanceof ReproductionDifference
        ? e.code
        : (e as NodeJS.ErrnoException).code === 'ENOENT'
          ? 3
          : 2;
    error(JSON.stringify({ exit: code, error: e instanceof Error ? e.message : String(e) }));
    return code;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
async function sitePackage(root: string, out: string) {
  const data = join(root, 'data/release'),
    pointer = JSON.parse(await readFile(join(data, 'releases/current.json'), 'utf8'));
  if (
    !/^[a-f0-9]{64}$/.test(pointer.release_id) ||
    pointer.manifest !== `data/releases/${pointer.release_id}/manifest.json`
  )
    throw new ReleaseError(2, 'Invalid site release pointer');
  const metadata = join(data, 'releases', pointer.release_id),
    location = await locateManifest({ manifest: join(metadata, 'manifest.json') });
  if (location.releaseId !== pointer.release_id)
    throw new ReleaseError(2, 'Site identity mismatch');
  await mkdir(out);
  for (const o of location.manifest.outputs) {
    const p = join(out, o.path);
    await mkdir(dirname(p), { recursive: true });
    await cp(
      o.path === 'validation.json' ? join(metadata, o.path) : join(data, o.path.slice(5)),
      p,
      { errorOnExist: true, force: false },
    );
  }
  for (const p of ['manifest.json', 'receipt.json'])
    await cp(join(metadata, p), join(out, p), { errorOnExist: true, force: false });
  return out;
}
export async function installSite(root: string, candidate: string, releaseId: string) {
  // Explicit local --site operation only. The build itself has already completed and verified.
  const data = join(root, 'data/release'),
    location = await locateManifest({ manifest: join(candidate, 'manifest.json') }),
    { manifest } = location;
  if (!/^[a-f0-9]{64}$/.test(releaseId) || location.releaseId !== releaseId)
    throw new ReleaseError(2, 'Site installation identity mismatch');
  const metadata = join(data, 'releases', releaseId);
  const targets = [
    ...manifest.outputs
      .filter((o) => o.path.startsWith('data/'))
      .map((o) => join(data, o.path.slice(5))),
    ...['manifest.json', 'validation.json', 'receipt.json'].map((p) => join(metadata, p)),
    join(data, 'releases/current.json'),
    join(data, 'releases', '.current-' + releaseId + '.json'),
  ];
  // Inspect the complete write set before creating any directory or replacing any byte.
  for (const target of targets) await safeDestination(target);
  for (const p of ['manifest.json', 'validation.json', 'receipt.json'])
    if (
      existsSync(join(metadata, p)) &&
      !(await readFile(join(metadata, p))).equals(await readFile(join(candidate, p)))
    )
      throw new ReleaseError(2, 'Immutable site metadata differs');
  await safeDestination(data, true);
  for (const o of manifest.outputs.filter((o) => o.path.startsWith('data/'))) {
    const path = join(data, o.path.slice(5));
    await safeDestination(dirname(path), true);
    await safeDestination(path);
    await cp(join(candidate, o.path), path);
  }
  await safeDestination(metadata, true);
  for (const p of ['manifest.json', 'validation.json', 'receipt.json']) {
    const path = join(metadata, p);
    if (existsSync(path)) {
      if (!(await readFile(path)).equals(await readFile(join(candidate, p))))
        throw new ReleaseError(2, 'Immutable site metadata differs');
    } else await cp(join(candidate, p), path, { errorOnExist: true, force: false });
  }
  const temp = join(data, 'releases', '.current-' + releaseId + '.json');
  await writeFile(
    temp,
    canonicalJson({
      release_id: releaseId,
      manifest: `data/releases/${releaseId}/manifest.json`,
      built: (manifest.processing.parameters as any).build_date,
    }) + '\n',
    { flag: 'wx' },
  );
  await rename(temp, join(data, 'releases/current.json'));
}
