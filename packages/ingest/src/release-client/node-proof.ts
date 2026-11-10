/** Strict Node proof compatibility shared by package/operator and candidate-site readers. */
import { createHash } from 'node:crypto';
import { matchesGlob } from 'node:path';
import { REQUIRED_VALIDATION_GROUPS } from '../release-build/types.js';
import { record, ReleaseError, type ReleaseManifest } from './types.js';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (record(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
const bytes = (v: unknown) => Buffer.from(JSON.stringify(canonical(v)) + '\n');
export function nodeProofReceipt(
  manifest: ReleaseManifest,
  releaseId: string,
  validationBytes: Uint8Array,
) {
  const parameters = manifest.processing.parameters;
  if (
    !record(parameters) ||
    typeof parameters.build_date !== 'string' ||
    !/^\d{4}-\d\d-\d\d$/.test(parameters.build_date)
  )
    throw new ReleaseError(2, 'Node package build date is missing');
  return {
    schema: 'node-release-build/1',
    release_id: releaseId,
    built: parameters.build_date + 'T00:00:00Z',
    env: 'node-offline',
    commit: manifest.processing.code.commit,
    executor: manifest.processing.executor,
    snapshot: manifest.processing.snapshot,
    validation_sha256: sha(validationBytes),
    outputs_sha256: sha(bytes(manifest.outputs)),
  };
}
export function verifyNodeProof(
  manifest: ReleaseManifest,
  manifestBytes: Uint8Array,
  receipt: unknown,
  validationBytes: Uint8Array,
): void {
  if (
    !record(manifest.processing?.executor) ||
    manifest.processing.executor.runtime !== 'node-export/1'
  )
    return;
  const fail = () => {
    throw new ReleaseError(
      2,
      'Node package requires complete executed validation and its bound receipt',
    );
  };
  const v = JSON.parse(
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(validationBytes),
  );
  const generated = manifest.processing.generated_intermediates;
  if (generated !== undefined) {
    if (!Array.isArray(generated) || !generated.length) fail();
    const paths = new Set<string>();
    for (const f of generated as unknown[]) {
      if (
        !record(f) ||
        typeof f.path !== 'string' ||
        !/^data\/(?:originals|cache|inputs)\//.test(f.path) ||
        f.path.split('/').some((p) => !p || p === '.' || p === '..') ||
        /[\\\x00-\x1f\x7f]/.test(f.path) ||
        paths.has(f.path) ||
        (manifest.inputs ?? []).some((i) => i.path === f.path) ||
        typeof f.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(f.sha256) ||
        !Number.isSafeInteger(f.bytes) ||
        Number(f.bytes) < 1 ||
        f.kind !== 'generated-intermediate' ||
        f.origin !== 'recorded-code-generation' ||
        typeof f.declaration !== 'string' ||
        !matchesGlob(f.path, f.declaration) ||
        !Array.isArray(f.datasets) ||
        !f.datasets.length ||
        !f.datasets.every((d) => typeof d === 'string') ||
        f.originalPinVerified !== (f.sha256 === f.legacy_pin_sha256)
      )
        fail();
      paths.add(f.path as string);
    }
  }
  if (
    !record(v) ||
    v.completeValidation !== true ||
    v.passed !== true ||
    v.historicalReconstruction !== 'unverified' ||
    !Array.isArray(v.groups)
  )
    fail();
  const required = [
      ...REQUIRED_VALIDATION_GROUPS,
      ...(manifest.processing.executor.id === 'registered-typescript-production/1'
        ? ['REGISTRY']
        : []),
    ],
    seen = new Set<string>();
  let checks = 0,
    warnings = 0;
  for (const g of v.groups) {
    if (
      !record(g) ||
      typeof g.group !== 'string' ||
      seen.has(g.group) ||
      !['OK', 'WARN'].includes(String(g.status)) ||
      !Number.isSafeInteger(g.checks) ||
      Number(g.checks) < 1 ||
      !Array.isArray(g.problems) ||
      g.problems.length ||
      !Array.isArray(g.warnings) ||
      !g.warnings.every((w) => typeof w === 'string') ||
      typeof g.summary !== 'string'
    )
      fail();
    seen.add(g.group as string);
    checks += Number(g.checks);
    warnings += (g.warnings as unknown[]).length;
  }
  if (
    required.some((name) => !seen.has(name)) ||
    v.result !== `RESULT OK: ${checks} checks, 0 problems, ${warnings} warnings`
  )
    fail();
  if (!Buffer.from(validationBytes).equals(bytes(v))) fail();
  if (
    !record(receipt) ||
    !bytes(receipt).equals(bytes(nodeProofReceipt(manifest, sha(manifestBytes), validationBytes)))
  )
    throw new ReleaseError(2, 'Node build receipt differs from package provenance');
}
