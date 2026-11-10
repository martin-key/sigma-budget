import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { REQUIRED_VALIDATION_GROUPS } from '../release-build/types.js';
import { verifyNodeProof } from './node-proof.js';
import type { ReleaseManifest } from './types.js';
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const bytes = (v: unknown) => Buffer.from(JSON.stringify(canonical(v)) + '\n'),
  sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
// Synthetic package metadata only; the real production executor is tested separately.
function fixture() {
  const manifest = {
    manifest_schema: 'budget-release/1',
    processing: {
      code: { commit: 'a'.repeat(40) },
      parameters: { build_date: '2026-11-10' },
      executor: { runtime: 'node-export/1', id: 'registered-typescript-production/1' },
      snapshot: { sha256: 'b'.repeat(64) },
    },
    outputs: [],
  } as unknown as ReleaseManifest;
  const groups = [...REQUIRED_VALIDATION_GROUPS, 'REGISTRY'].map((group) => ({
    group,
    status: 'OK',
    checks: 1,
    summary: 'synthetic metadata contract',
    problems: [],
    warnings: [],
  }));
  const validation = {
      tool: 'node release-build executor',
      completeValidation: true,
      passed: true,
      groups,
      result: `RESULT OK: ${groups.length} checks, 0 problems, 0 warnings`,
      historicalReconstruction: 'unverified',
    },
    vb = bytes(validation),
    mb = bytes(manifest);
  const receipt = {
    schema: 'node-release-build/1',
    release_id: sha(mb),
    built: '2026-11-10T00:00:00Z',
    env: 'node-offline',
    commit: manifest.processing.code.commit,
    executor: manifest.processing.executor,
    snapshot: manifest.processing.snapshot,
    validation_sha256: sha(vb),
    outputs_sha256: sha(bytes(manifest.outputs)),
  };
  return { manifest, mb, vb, receipt, validation };
}
it('accepts the independently constructed complete metadata contract', () => {
  const f = fixture();
  expect(() => verifyNodeProof(f.manifest, f.mb, f.receipt, f.vb)).not.toThrow();
});
it.each([
  'missing',
  'duplicate',
  'empty',
  'failed',
  'skip',
  'crashed',
  'incomplete',
  'receipt',
  'bom',
] as const)('rejects %s Node proof without accepting a package', (kind) => {
  const f = fixture();
  if (kind === 'missing') f.validation.groups.pop();
  if (kind === 'duplicate') f.validation.groups.push(f.validation.groups[0]!);
  if (kind === 'empty') f.validation.groups[0]!.checks = 0;
  if (kind === 'failed') f.validation.groups[0]!.problems = ['owned mutation'];
  if (kind === 'skip') f.validation.groups[0]!.status = 'SKIP';
  if (kind === 'crashed') f.validation.groups[0]!.status = 'FAIL';
  if (kind === 'incomplete') f.validation.completeValidation = false;
  if (kind === 'receipt') f.receipt.validation_sha256 = 'c'.repeat(64);
  let b = bytes(f.validation);
  if (kind === 'bom') b = Buffer.concat([Buffer.from('\uFEFF'), b]);
  expect(() => verifyNodeProof(f.manifest, f.mb, f.receipt, b)).toThrow();
});
it('preserves the existing historical package reader boundary', () => {
  expect(() =>
    verifyNodeProof({} as ReleaseManifest, Buffer.from('{}'), {}, Buffer.from('{}')),
  ).not.toThrow();
});
