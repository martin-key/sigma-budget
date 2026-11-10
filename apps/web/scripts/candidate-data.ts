// Local build input only. A Python candidate keeps its manifest/validation next
// to data/; packaging it must not publish into the checkout's data/release.
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

type Output = { path: string; bytes: number; sha256: string };
export interface Candidate {
  root: string;
  releaseId: string;
  manifest: Buffer;
  outputs: Output[];
  buildDate: string;
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fail = (message: string): never => {
  throw new Error(`BUDGET_CANDIDATE: ${message}`);
};

function files(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix)).flatMap((name) => {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) return fail(`symlink is not a candidate file: ${path}`);
    return stat.isDirectory() ? files(root, path) : [path];
  });
}

/** Verify all packaged bytes, including the successful production validation
 * report. This verifies a candidate receipt; numerical validation is Python's
 * budget build/validate, not a second implementation in the Vite config. */
export function readCandidate(directory: string): Candidate {
  try {
    const root = resolve(directory);
    const manifest = readFileSync(join(root, 'manifest.json'));
    const doc = JSON.parse(manifest.toString('utf8'));
    if (doc.manifest_schema !== 'budget-release/1' || !Array.isArray(doc.outputs))
      fail('expected a budget build candidate with manifest_schema budget-release/1');
    const releaseId = hash(manifest);
    const receipt = JSON.parse(readFileSync(join(root, 'receipt.json'), 'utf8'));
    if (receipt.release_id !== releaseId) fail('receipt release_id differs from manifest SHA-256');
    if (lstatSync(join(root, 'data')).isSymbolicLink()) fail('data/ must not be a symlink');
    const listed = new Set<string>();
    for (const output of doc.outputs as Output[]) {
      if (
        typeof output.path !== 'string' ||
        !/^(data\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*|validation\.json)$/.test(output.path) ||
        output.path.split('/').some((part) => part === '.' || part === '..') ||
        output.path.startsWith('data/releases/') ||
        listed.has(output.path)
      )
        fail(`invalid or duplicate output path: ${output.path}`);
      listed.add(output.path);
      const path = join(root, output.path);
      if (lstatSync(path).isSymbolicLink()) fail(`symlink is not a candidate file: ${output.path}`);
      const bytes = readFileSync(path);
      if (bytes.length !== output.bytes || hash(bytes) !== output.sha256)
        fail(`bytes or SHA-256 differ from manifest: ${output.path}`);
    }
    for (const path of ['data/core.json', 'data/catalog.json', 'validation.json'])
      if (!listed.has(path)) fail(`required output is not in manifest: ${path}`);
    for (const path of files(join(root, 'data')))
      if (!listed.has(`data/${path}`)) fail(`unlisted candidate data: data/${path}`);
    const validation = JSON.parse(readFileSync(join(root, 'validation.json'), 'utf8'));
    if (
      validation.passed !== true ||
      !Array.isArray(validation.groups) ||
      validation.groups.length === 0 ||
      validation.groups.some((g: { status: string }) => g.status === 'FAIL')
    )
      fail('candidate has no successful production validation report');
    return {
      root,
      releaseId,
      manifest,
      outputs: doc.outputs,
      buildDate: doc.processing?.parameters?.build_date || receipt.built?.slice(0, 10) || '',
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BUDGET_CANDIDATE:')) throw error;
    return fail(`cannot read validated candidate at ${directory}: ${String(error)}`);
  }
}

/** Revalidate at copy time as well: a changed candidate cannot produce mixed
 * SSR identity and public bytes after the config was loaded. */
export function copyCandidate(candidate: Candidate, destination: string) {
  const current = readCandidate(candidate.root);
  if (current.releaseId !== candidate.releaseId) fail('candidate changed during site build');
  const target = resolve(destination);
  if (
    target === candidate.root ||
    target.startsWith(candidate.root + '/') ||
    candidate.root.startsWith(target + '/')
  )
    fail('site output must be separate from candidate');
  rmSync(target, { recursive: true, force: true });
  cpSync(join(candidate.root, 'data'), target, { recursive: true });
  const metadata = join(target, 'releases', candidate.releaseId);
  mkdirSync(metadata, { recursive: true });
  writeFileSync(join(metadata, 'manifest.json'), candidate.manifest);
  cpSync(join(candidate.root, 'validation.json'), join(metadata, 'validation.json'));
  writeFileSync(
    join(target, 'releases/current.json'),
    JSON.stringify({
      release_id: candidate.releaseId,
      manifest: `data/releases/${candidate.releaseId}/manifest.json`,
      built: candidate.buildDate,
    }) + '\n',
  );
}
