import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPublishedOutputs } from '../apps/web/scripts/release-artifact.ts';

export function checkReleaseLock(root = resolve(import.meta.dirname, '..')) {
  const lock = JSON.parse(readFileSync(resolve(root, 'data/release.lock.json'), 'utf8'));
  if (lock.repository !== 'midt-bg/sigma-budget-data' || !/^[a-f0-9]{40}$/.test(lock.commit))
    throw new Error('Invalid release lock repository or commit');
  const id = checkPublishedOutputs(root, resolve(root, 'data/release'), true);
  if (id !== lock.release_id) throw new Error('Release pointer differs from lock');
  console.log(`PASS pinned release ${id} at ${lock.commit}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkReleaseLock();
