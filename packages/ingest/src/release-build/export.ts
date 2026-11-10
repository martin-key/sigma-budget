import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { listFiles, readSafeBytes } from '../release-client/files.js';
import {
  fail,
  fileFacts,
  jsonBytes,
  preflightDestination,
  safeDirectory,
  safeRelative,
  sha256,
} from './files.js';

const exec = promisify(execFile);
async function git(root: string, args: string[]): Promise<Buffer> {
  try {
    return (
      await exec('git', ['--no-replace-objects', '-C', root, ...args], {
        encoding: 'buffer',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          HOME: '/nonexistent',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
        },
      })
    ).stdout;
  } catch {
    return fail('Cannot read the requested local Git commit');
  }
}
export interface ExportedCommit {
  commit: string;
  tree: string;
  files: Record<string, { bytes: number; sha256: string }>;
  snapshotSha256: string;
}
/** git archive of a verified tree; no checkout, worktree, hooks or network. */
export async function exportCommit(
  repositoryRoot: string,
  commit: string,
  destination: string,
): Promise<ExportedCommit> {
  repositoryRoot = await safeDirectory(resolve(repositoryRoot));
  destination = await preflightDestination(destination, [repositoryRoot]);
  await safeDirectory(dirname(destination));
  if (!commit || commit.startsWith('-') || !/^[A-Za-z0-9_./~^@{}-]+$/.test(commit))
    fail('Invalid commit selector');
  const resolved = (await git(repositoryRoot, ['rev-parse', '--verify', `${commit}^{commit}`]))
    .toString()
    .trim();
  if (!/^[a-f0-9]{40}$/.test(resolved)) fail('Expected a SHA-1 processing commit');
  const tree = (await git(repositoryRoot, ['rev-parse', `${resolved}^{tree}`])).toString().trim();
  const entries = (await git(repositoryRoot, ['ls-tree', '-rz', '--full-tree', resolved]))
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const path = safeRelative(entry.slice(tab + 1));
    if (
      !/^100(?:644|755) blob [a-f0-9]{40}$/.test(entry.slice(0, tab)) ||
      path.split('/').includes('.git') ||
      path.split('/')[0] === '.export.tar'
    )
      fail('Commit contains a symlink, submodule or unsafe entry: ' + path);
  }
  await mkdir(destination, { mode: 0o700 }); // caller owns its new parent
  const archive = join(destination, '.export.tar');
  try {
    await git(repositoryRoot, ['archive', '--format=tar', `--output=${archive}`, resolved]);
    await exec(
      'tar',
      [
        '--extract',
        '--file',
        archive,
        '--directory',
        destination,
        '--no-same-owner',
        '--no-same-permissions',
      ],
      { timeout: 60_000, env: { PATH: process.env.PATH, HOME: '/nonexistent' } },
    );
  } finally {
    await rm(archive, { force: true });
  }
  // Finished release data is never a production input. External sources must be staged explicitly.
  for (const path of ['data/release', 'data/originals', 'data/cache'])
    await rm(join(destination, path), { recursive: true, force: true });
  const files: ExportedCommit['files'] = {};
  for (const path of (await listFiles(destination)).sort())
    files[path] = await fileFacts(join(destination, path));
  if (!files['pnpm-lock.yaml']) fail('Recorded Node build requires a committed dependency lock');
  await readSafeBytes(join(destination, 'pnpm-lock.yaml'), 8 * 1024 * 1024);
  return { commit: resolved, tree, files, snapshotSha256: sha256(jsonBytes(files)) };
}
export async function verifyExport(root: string, exported: ExportedCommit): Promise<void> {
  for (const [path, expected] of Object.entries(exported.files)) {
    const actual = await fileFacts(join(root, path), expected.bytes);
    if (actual.sha256 !== expected.sha256) fail('Executor modified committed code/input: ' + path);
  }
}
