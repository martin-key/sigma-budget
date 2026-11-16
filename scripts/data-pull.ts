import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkPublishedOutputs } from '../apps/web/scripts/release-artifact.ts';

const { values } = parseArgs({ options: { commit: { type: 'string', default: 'main' } } });
const revision = values.commit!;
if (revision !== 'main' && !/^[a-f0-9]{40}$/.test(revision))
  throw new Error('--commit must be a full commit SHA (or main)');
const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'sigma-budget-data-'));
const destination = join(root, 'data/release');
const staging = mkdtempSync(join(root, 'data/.release-pull-'));
const pending = join(staging, 'release');
const backup = join(staging, 'backup');
// Disable credential helpers and prompts: the producer repository is public.
const git = (args: string[]) =>
  execFileSync('git', ['-c', 'credential.helper=', ...args], {
    cwd: scratch,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
try {
  git(['init', '--quiet']);
  git(['remote', 'add', 'origin', 'https://github.com/midt-bg/sigma-budget-data.git']);
  git(['sparse-checkout', 'set', 'data/release']);
  git(['fetch', '--quiet', '--depth=1', '--no-tags', '--filter=blob:none', 'origin', revision]);
  git(['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  const commit = git(['rev-parse', 'HEAD']);
  const release = join(scratch, 'data/release');
  const release_id = checkPublishedOutputs(scratch, release, true);
  const lock =
    JSON.stringify({ repository: 'midt-bg/sigma-budget-data', commit, release_id }, null, 2) + '\n';
  cpSync(release, pending, { recursive: true, errorOnExist: true, force: false });
  renameSync(destination, backup);
  try {
    renameSync(pending, destination);
    writeFileSync(join(staging, 'release.lock.json'), lock);
    renameSync(join(staging, 'release.lock.json'), join(root, 'data/release.lock.json'));
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    renameSync(backup, destination);
    throw error;
  }
  rmSync(backup, { recursive: true });
  console.log(`Pinned ${release_id} from ${commit}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
}
