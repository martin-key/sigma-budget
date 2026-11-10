import { mkdtemp, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, matchesGlob, resolve } from 'node:path';
import { listFiles, readSafeBytes } from '../release-client/files.js';
import { parseManifest, preflightRelease } from '../release-client/package.js';
import { record, type ReleaseFile, type ReleaseManifest } from '../release-client/types.js';
import { clean } from '../io/data.js';
import {
  atomicNew,
  fail,
  fileFacts,
  jsonBytes,
  preflightDestination,
  safeDirectory,
  safeRelative,
  sha256,
} from './files.js';
import { exportCommit, verifyExport, type ExportedCommit } from './export.js';
import {
  mime,
  prepareInputs,
  stageInputs,
  verifyStagedInputs,
  type PreparedInputs,
} from './inputs.js';
import {
  REQUIRED_VALIDATION_GROUPS,
  ReproductionDifference,
  type BuildReleaseOptions,
  type BuildReleaseResult,
  type ExecutorResult,
  type ReproduceOptions,
} from './types.js';

const LIMIT = 32 * 1024 * 1024;
export function validationReport(result: ExecutorResult): Record<string, unknown> {
  const validation = result?.validation;
  if (!validation || validation.completeValidation !== true || !Array.isArray(validation.groups))
    fail('Executor did not return complete validation');
  const seen = new Set<string>();
  let checks = 0,
    warnings = 0;
  for (const group of validation.groups) {
    if (
      !group ||
      typeof group.group !== 'string' ||
      seen.has(group.group) ||
      !['OK', 'WARN'].includes(group.status) ||
      !Number.isSafeInteger(group.checks) ||
      group.checks < 1 ||
      typeof group.summary !== 'string' ||
      !Array.isArray(group.problems) ||
      group.problems.length ||
      !Array.isArray(group.warnings) ||
      !group.warnings.every((w) => typeof w === 'string')
    )
      fail('Failed, skipped or malformed validation group');
    seen.add(group.group);
    checks += group.checks;
    warnings += group.warnings.length;
  }
  for (const name of REQUIRED_VALIDATION_GROUPS)
    if (!seen.has(name)) fail('Required validation group absent: ' + name);
  // Fixed required order, deterministic order for explicitly added groups.
  const groups = [...validation.groups].sort((a, b) => {
    const rank = (name: string) => {
      const n = (REQUIRED_VALIDATION_GROUPS as readonly string[]).indexOf(name);
      return n < 0 ? REQUIRED_VALIDATION_GROUPS.length : n;
    };
    return rank(a.group) - rank(b.group) || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0);
  });
  return {
    tool: 'node release-build executor',
    completeValidation: true,
    passed: true,
    groups,
    result: `RESULT OK: ${checks} checks, 0 problems, ${warnings} warnings`,
    historicalReconstruction: 'unverified',
  };
}
function datasetPatterns(prepared: PreparedInputs) {
  return prepared.datasets.datasets
    .filter((d) => d.status !== 'pending' && d.id !== 'releases')
    .map((d) => {
      if (
        !Array.isArray(d.files) ||
        d.files.length === 0 ||
        !d.files.every((p) => typeof p === 'string' && p.startsWith('data/release/'))
      )
        fail('Dataset has no valid output patterns: ' + d.id);
      return { dataset: d, patterns: (d.files as string[]).map((p) => safeRelative(p, true)) };
    });
}
async function outputFacts(
  root: string,
  prepared: PreparedInputs,
  result: ExecutorResult,
): Promise<ReleaseFile[]> {
  const definitions = datasetPatterns(prepared);
  if (!Array.isArray(result.datasets)) fail('Executor dataset actions are missing');
  const actions = new Map<string, string>();
  for (const row of result.datasets) {
    if (
      !row ||
      actions.has(row.id) ||
      !['built', 'preserved-input'].includes(row.action) ||
      !definitions.some((d) => d.dataset.id === row.id)
    )
      fail('Invalid executor dataset action');
    actions.set(row.id, row.action);
  }
  const files = (await listFiles(root)).sort();
  const resultFacts: ReleaseFile[] = [];
  for (const path of files) {
    safeRelative(path);
    if (path === 'validation.json') {
      resultFacts.push({
        path,
        ...(await fileFacts(join(root, path))),
        mime: mime(path),
        role: 'validation',
      });
      continue;
    }
    if (!path.startsWith('data/') || path.startsWith('data/releases/'))
      fail('Executor wrote lifecycle metadata or an unsupported output: ' + path);
    const owners = definitions.filter((d) =>
      d.patterns.some((p) => matchesGlob('data/release/' + path.slice(5), p)),
    );
    if (owners.length !== 1) fail('Output has no unique dataset owner: ' + path);
    resultFacts.push({
      path,
      ...(await fileFacts(join(root, path))),
      mime: mime(path),
      dataset: owners[0]!.dataset.id,
    });
  }
  for (const def of definitions) {
    if (!actions.has(def.dataset.id)) fail('Executor omitted a dataset action: ' + def.dataset.id);
    for (const pattern of def.patterns)
      if (
        !files.some(
          (p) => p.startsWith('data/') && matchesGlob('data/release/' + p.slice(5), pattern),
        )
      )
        fail('Required dataset output absent: ' + pattern);
  }
  for (const required of ['data/core.json', 'data/catalog.json', 'data/execution.json'])
    if (!files.includes(required)) fail('Required candidate output absent: ' + required);
  return resultFacts;
}
async function makeManifest(
  root: string,
  exported: ExportedCommit,
  prepared: PreparedInputs,
  options: BuildReleaseOptions,
  result: ExecutorResult,
): Promise<ReleaseManifest> {
  const outputs = await outputFacts(root, prepared, result);
  const execution: unknown = JSON.parse(
    (await readSafeBytes(join(root, 'data/execution.json'), LIMIT)).toString('utf8'),
  );
  if (
    !record(execution) ||
    !record(execution.meta) ||
    typeof execution.meta.schema !== 'string' ||
    !record(execution.contract) ||
    typeof execution.contract.provenance !== 'string'
  )
    fail('Execution output lacks schema/provenance contract');
  const provenancePath = 'data/' + safeRelative(execution.contract.provenance);
  if (!outputs.some((o) => o.path === provenancePath))
    fail('Execution provenance is absent from outputs');
  const provenance: unknown = JSON.parse(
    (await readSafeBytes(join(root, provenancePath), LIMIT)).toString('utf8'),
  );
  if (!record(provenance) || typeof provenance.schema !== 'string')
    fail('Invalid execution provenance schema');
  const entry = exported.files[options.executor.identity.entry];
  if (!entry) fail('Executor entry is absent from recorded commit');
  const actions = new Map(result.datasets.map((d) => [d.id, d.action]));
  const coverage = prepared.datasets.datasets.map((d) => {
    const row: Record<string, unknown> = { dataset: d.id, status: d.status };
    for (const key of ['period', 'unit', 'scope', 'limitations', 'reason'])
      if (d[key] !== undefined) row[key] = d[key];
    if (d.status !== 'pending') row.rebuiltByThisRelease = actions.get(d.id) === 'built';
    return row;
  });
  return clean({
    manifest_schema: 'budget-release/1',
    data_schema: {
      execution: execution.meta.schema,
      'execution-provenance': provenance.schema,
      other: 'docs/data-spec.md',
    },
    provenance_format: provenance.schema,
    processing: {
      code: {
        repository: 'https://github.com/midt-bg/sigma-budget',
        commit: exported.commit,
        tree: exported.tree,
        export_sha256: exported.snapshotSha256,
      },
      executor: {
        ...options.executor.identity,
        entry_sha256: entry.sha256,
        ...(options.executor.bridgeSha256 ? { bridge_sha256: options.executor.bridgeSha256 } : {}),
      },
      environment: {
        runtime: 'node',
        node: process.version,
        lock: 'pnpm-lock.yaml',
        lock_sha256: exported.files['pnpm-lock.yaml']!.sha256,
        dependency_mode: options.executor.dependenciesRoot
          ? 'locked-local-adapter'
          : 'native-node-only',
      },
      command: `node ${options.executor.identity.entry}`,
      parameters: { build_date: options.buildDate },
      registries: prepared.registries,
      snapshot: prepared.snapshot,
      committed_inputs: prepared.committedInputs,
      ...(result.generatedIntermediates?.length
        ? {
            generated_intermediates: result.generatedIntermediates.map((f) => ({
              ...f,
              declaration: prepared.missingIntermediates.find((i) => i.path === f.path)!
                .declaration,
              legacy_pin_sha256:
                prepared.missingIntermediates.find((i) => i.path === f.path)!.legacyPin ?? null,
              origin: 'recorded-code-generation',
              originalPinVerified:
                f.sha256 ===
                prepared.missingIntermediates.find((i) => i.path === f.path)!.legacyPin,
            })),
          }
        : {}),
      ...(result.extractions ? { extractions: result.extractions } : {}),
    },
    inputs: prepared.inputs,
    outputs,
    coverage: {
      datasets: coverage,
      missingInputs: [],
      validationGroups: [...REQUIRED_VALIDATION_GROUPS],
      historicalReconstruction: 'unverified',
      historicalLimitations: (prepared.sources.intermediates ?? [])
        .filter((i) => i.reproducible === false)
        .map((i) => ({ path: i.path, ...(i.note ? { note: i.note } : {}) })),
      ...(record(execution.latest) && typeof execution.latest.asOf === 'string'
        ? { latest: { execution: execution.latest.asOf } }
        : {}),
    },
    compatibility: {
      execution: ['execution/1', 'execution/2'],
      readers: 'release-client preflightRelease and apps/web/scripts/candidate-data.ts',
    },
  }) as unknown as ReleaseManifest;
}
function buildReceipt(manifest: ReleaseManifest, releaseId: string, validationBytes: Buffer) {
  if (
    !record(manifest.processing.parameters) ||
    typeof manifest.processing.parameters.build_date !== 'string'
  )
    fail('Missing recorded build date');
  return {
    schema: 'node-release-build/1',
    release_id: releaseId,
    built: manifest.processing.parameters.build_date + 'T00:00:00Z',
    env: 'node-offline',
    commit: manifest.processing.code.commit,
    executor: manifest.processing.executor,
    snapshot: manifest.processing.snapshot,
    validation_sha256: sha256(validationBytes),
    outputs_sha256: sha256(jsonBytes(manifest.outputs)),
  };
}
function buildDate(date: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date + 'T00:00:00Z')) ||
    new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date
  )
    fail('Expected an explicit valid build date YYYY-MM-DD');
}
async function verifyOwnedExport(
  root: string,
  exported: ExportedCommit,
  prepared: PreparedInputs,
): Promise<void> {
  await verifyExport(root, exported);
  await verifyStagedInputs(prepared, root);
  const allowed = new Set([...Object.keys(exported.files), ...prepared.inputs.map((f) => f.path)]);
  for (const path of await listFiles(root))
    if (!allowed.has(path)) fail('Executor wrote outside candidate/scratch: ' + path);
}
/** A new candidate is installed atomically only after all checks pass. Failed work never exposes a PASS receipt. */
export async function buildRelease(options: BuildReleaseOptions): Promise<BuildReleaseResult> {
  // Capture provenance while retaining class adapters' method binding.
  if (!options.executor?.identity) fail('Explicit recorded-code Node executor required');
  const adapter = options.executor;
  options = {
    ...options,
    executor: {
      identity: { ...adapter.identity },
      bridgeSha256: adapter.bridgeSha256,
      dependenciesRoot: adapter.dependenciesRoot,
      generatedIntermediates: adapter.generatedIntermediates
        ? [...adapter.generatedIntermediates]
        : undefined,
      execute: adapter.execute.bind(adapter),
    },
  };
  buildDate(options.buildDate);
  if (!options.executor || options.executor.identity.runtime !== 'node-export/1')
    fail('Explicit recorded-code Node executor required');
  safeRelative(options.executor.identity.entry);
  if (
    typeof options.executor.identity.id !== 'string' ||
    !options.executor.identity.id ||
    options.executor.identity.id.length > 200 ||
    /[\x00-\x1f\x7f]/.test(options.executor.identity.id)
  )
    fail('Invalid executor identity');
  if (
    options.executor.bridgeSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(options.executor.bridgeSha256)
  )
    fail('Invalid executor runner hash');
  const repositoryRoot = await safeDirectory(resolve(options.repositoryRoot));
  const inputRoot = await safeDirectory(resolve(options.inputRoot));
  const dependenciesRoot = options.executor.dependenciesRoot
    ? await safeDirectory(resolve(options.executor.dependenciesRoot))
    : undefined;
  const protectedRoots = [
    repositoryRoot,
    inputRoot,
    ...(dependenciesRoot ? [dependenciesRoot] : []),
  ];
  const outputRoot = await preflightDestination(options.outputRoot, protectedRoots);
  await mkdir(dirname(outputRoot), { recursive: true });
  await safeDirectory(dirname(outputRoot));
  const work = await mkdtemp(join(dirname(outputRoot), '.release-build-'));
  try {
    const source = join(work, 'export'),
      candidate = join(work, 'candidate'),
      scratch = join(work, 'scratch');
    await mkdir(candidate);
    await mkdir(scratch);
    const exported = await exportCommit(repositoryRoot, options.commit, source);
    if (!exported.files[options.executor.identity.entry])
      fail('Executor entry is absent from recorded commit');
    if (
      dependenciesRoot &&
      sha256(await readSafeBytes(join(dependenciesRoot, 'pnpm-lock.yaml'), LIMIT)) !==
        exported.files['pnpm-lock.yaml']!.sha256
    )
      fail(
        'Locked local dependencies differ from recorded commit; no network install is permitted',
      );
    const prepared = await prepareInputs(
      source,
      inputRoot,
      options.executor.generatedIntermediates,
    );
    // Reuse the accepted protocol parser before any producer sees an invalid path/size.
    parseManifest(
      jsonBytes({
        manifest_schema: 'budget-release/1',
        data_schema: {},
        processing: { code: { commit: exported.commit } },
        inputs: prepared.inputs,
        outputs: [
          {
            path: 'validation.json',
            sha256: '0'.repeat(64),
            bytes: 0,
            mime: 'application/json',
            role: 'validation',
          },
        ],
      }),
      options.maxObjectBytes,
    );
    const definitions = datasetPatterns(prepared);
    for (const definition of definitions)
      for (const pattern of definition.patterns) {
        const logical = 'data/' + pattern.slice('data/release/'.length);
        if (
          logical.startsWith('data/releases/') ||
          prepared.inputs.some((input) => matchesGlob(input.path, logical))
        )
          fail('Declared output overlaps inputs or protected release metadata');
      }
    await stageInputs(prepared, source);
    const result = await options.executor.execute(
      Object.freeze({
        exportRoot: source,
        candidateRoot: candidate,
        scratchRoot: scratch,
        commit: exported.commit,
        buildDate: options.buildDate,
        inputs: structuredClone(prepared.inputs),
        ...(prepared.missingIntermediates.length
          ? { missingIntermediates: structuredClone(prepared.missingIntermediates) }
          : {}),
      }),
    );
    const generated = result.generatedIntermediates ?? [];
    if (
      generated.length !== prepared.missingIntermediates.length ||
      new Set(generated.map((f) => f.path)).size !== generated.length
    )
      fail('Recorded executor did not complete the declared intermediate closure');
    if (generated.length) {
      const view = join(scratch, 'prepared-inputs');
      await verifyExport(view, exported);
      await verifyStagedInputs(prepared, view);
      const allowed = new Set([
        ...Object.keys(exported.files),
        ...prepared.inputs.map((f) => f.path),
        ...prepared.missingIntermediates.map((f) => f.path),
      ]);
      for (const path of await listFiles(view))
        if (!allowed.has(path)) fail('Unexpected generated input: ' + path);
      for (const f of generated) {
        const declaration = prepared.missingIntermediates.find((i) => i.path === f.path);
        if (
          !declaration ||
          f.kind !== 'generated-intermediate' ||
          jsonBytes(f.datasets).compare(jsonBytes(declaration.datasets)) !== 0
        )
          fail('Invalid generated intermediate binding');
        const actual = await fileFacts(join(view, safeRelative(f.path)), f.bytes);
        if (actual.sha256 !== f.sha256)
          fail('Generated intermediate differs from recorded evidence: ' + f.path);
      }
    }
    await verifyOwnedExport(source, exported, prepared);
    // Reject metadata forged by an executor before lifecycle writes its report.
    for (const path of await listFiles(candidate))
      if (!path.startsWith('data/') || path.startsWith('data/releases/'))
        fail('Executor wrote protected lifecycle metadata');
    const report = validationReport(result);
    await atomicNew(join(candidate, 'validation.json'), jsonBytes(report));
    const manifest = await makeManifest(candidate, exported, prepared, options, result);
    const manifestBytes = jsonBytes(manifest);
    parseManifest(manifestBytes, options.maxObjectBytes);
    const releaseId = sha256(manifestBytes);
    await atomicNew(join(candidate, 'manifest.json'), manifestBytes);
    await atomicNew(
      join(candidate, 'receipt.json'),
      jsonBytes(buildReceipt(manifest, releaseId, jsonBytes(report))),
    );
    await preflightRelease({
      release: candidate,
      originals: source,
      maxObjectBytes: options.maxObjectBytes,
    });
    await verifyOwnedExport(source, exported, prepared);
    await preflightDestination(outputRoot, protectedRoots);
    await rename(candidate, outputRoot);
    const parent = await open(dirname(outputRoot), 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return { releaseId, manifest, outputRoot };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
/** Node-specific receipt bindings supplement the existing package/hash verifier. */
async function checkNodeReceipt(
  root: string,
  manifest: ReleaseManifest,
  manifestBytes: Buffer,
): Promise<void> {
  const receipt = JSON.parse(
    (await readSafeBytes(join(root, 'receipt.json'), LIMIT)).toString('utf8'),
  );
  if (!record(receipt) || receipt.release_id !== sha256(manifestBytes))
    fail('Build receipt identity differs');
  if (
    record(manifest.processing.executor) &&
    manifest.processing.executor.runtime === 'node-export/1'
  ) {
    if (receipt.schema !== 'node-release-build/1') fail('Node build receipt schema is missing');
    const bytes = await readSafeBytes(join(root, 'validation.json'), LIMIT);
    const validation = JSON.parse(bytes.toString('utf8'));
    const expected = validationReport({ validation, datasets: [] });
    if (
      !jsonBytes(expected).equals(bytes) ||
      !jsonBytes(receipt).equals(jsonBytes(buildReceipt(manifest, sha256(manifestBytes), bytes)))
    )
      fail('Node build receipt differs from package provenance');
  }
}
/** Existing client checks exact bytes/membership/receipt; Node adds complete group and receipt binding.
 * inputRoot here is canonical (the same originals contract as release-client). */
export async function checkReleaseDirectory(options: {
  releaseRoot: string;
  inputRoot: string;
  maxObjectBytes?: number;
}) {
  const pkg = await preflightRelease({
    release: options.releaseRoot,
    originals: options.inputRoot,
    maxObjectBytes: options.maxObjectBytes,
  });
  await checkNodeReceipt(pkg.root, pkg.manifest, pkg.manifestBytes);
  return pkg;
}
/** Exact Node replay. Historical Python releases remain supported by Python cmd_reproduce only. */
export async function reproduceRelease(options: ReproduceOptions): Promise<BuildReleaseResult> {
  const outputRoot = await preflightDestination(options.outputRoot, [
    options.repositoryRoot,
    options.inputRoot,
    options.releaseRoot,
    ...(options.executor.dependenciesRoot ? [options.executor.dependenciesRoot] : []),
  ]);
  const root = await safeDirectory(resolve(options.releaseRoot));
  const bytes = await readSafeBytes(join(root, 'manifest.json'), LIMIT);
  const manifest = parseManifest(bytes, options.maxObjectBytes);
  const processing = manifest.processing;
  if (!record(processing.executor) || processing.executor.runtime !== 'node-export/1')
    fail('Historical runtime unsupported here; use recorded Python budget reproduce boundary');
  if (!record(processing.parameters) || typeof processing.parameters.build_date !== 'string')
    fail('Recorded build date missing');
  if (!record(processing.environment) || processing.environment.node !== process.version)
    fail('Recorded Node runtime differs; use its exact offline runtime');
  if (
    processing.executor.id !== options.executor.identity.id ||
    processing.executor.entry !== options.executor.identity.entry ||
    processing.executor.bridge_sha256 !== options.executor.bridgeSha256
  )
    fail('Recorded executor identity differs');
  await checkNodeReceipt(root, manifest, bytes);
  const allowed = new Set([
    'manifest.json',
    'receipt.json',
    ...manifest.outputs.map((o) => o.path),
  ]);
  for (const path of await listFiles(root))
    if (!allowed.has(path)) fail('Recorded package contains an unlisted file');
  for (const output of manifest.outputs) {
    const actual = await fileFacts(join(root, output.path), output.bytes);
    if (actual.sha256 !== output.sha256)
      fail('Recorded output differs from manifest: ' + output.path);
  }
  await mkdir(dirname(outputRoot), { recursive: true });
  await safeDirectory(dirname(outputRoot));
  const work = await mkdtemp(join(dirname(outputRoot), '.release-reproduce-'));
  try {
    // Verification and versioned selection use the same committed input closure.
    const result = await buildRelease({
      ...options,
      outputRoot: join(work, 'candidate'),
      commit: processing.code.commit,
      buildDate: processing.parameters.build_date,
    });
    if (result.releaseId !== sha256(bytes) || !jsonBytes(result.manifest).equals(bytes))
      throw new ReproductionDifference(
        'Reproduction differs from recorded bytes/manifest identity',
      );
    for (const output of manifest.outputs) {
      const actual = await fileFacts(join(result.outputRoot, output.path), output.bytes);
      if (actual.sha256 !== output.sha256)
        throw new ReproductionDifference('Reproduction output differs: ' + output.path);
    }
    await preflightDestination(outputRoot, [
      options.repositoryRoot,
      options.inputRoot,
      options.releaseRoot,
      ...(options.executor.dependenciesRoot ? [options.executor.dependenciesRoot] : []),
    ]);
    await rename(result.outputRoot, outputRoot);
    const parent = await open(dirname(outputRoot), 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return { ...result, outputRoot };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
