/** Stage a supplied acquired snapshot for the required CI cache; never fetch or change pins. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  exportCommit,
  prepareInputs,
  stageInputs,
  preflightDestination,
} from '../packages/ingest/dist/release-build/index.js';
const [inputArg, outArg] = process.argv.slice(2);
if (!inputArg || !outArg)
  throw Error('Usage: node scripts/prepare-node-input-cache.mjs ACQUIRED_INPUTS NEW_OUTPUT');
const root = resolve(new URL('..', import.meta.url).pathname),
  inputs = resolve(inputArg),
  out = await preflightDestination(resolve(outArg), [root, inputs]),
  work = await mkdtemp(join(tmpdir(), 'node-ci-inputs-'));
try {
  await exportCommit(root, 'HEAD', join(work, 'export'));
  const prepared = await prepareInputs(join(work, 'export'), inputs);
  await mkdir(out);
  await stageInputs(prepared, out);
  await writeFile(
    join(out, 'authenticated-inputs.json'),
    JSON.stringify(
      {
        schema: 'registered-ci-inputs/1',
        snapshot: prepared.snapshot,
        inputs: prepared.inputs,
        registries: prepared.registries,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({ out, inputs: prepared.inputs.length, snapshot: prepared.snapshot.sha256 }),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
