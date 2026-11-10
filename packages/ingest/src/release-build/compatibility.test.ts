import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportCommit } from './export.js';
import { prepareInputs } from './inputs.js';
import { checkReleaseDirectory } from './lifecycle.js';
import { copyCandidate, readCandidate } from '../../../../apps/web/scripts/candidate-data.js';
import { sha256 } from './files.js';

// Explicit read-only acceptance inputs. This Python package is compatibility evidence,
// never an executor or source of numeric bytes for a new Node release.
const releaseRoot = process.env.BUDGET_BUILD_ACCEPTED_CANDIDATE;
const inputRoot = process.env.BUDGET_BUILD_ACCEPTED_INPUTS;
it.skipIf(!releaseRoot || !inputRoot)(
  'authenticates the actual 119-input closure and accepted 70-output client/web package',
  async () => {
    const owned = await mkdtemp(join(tmpdir(), 'release-build-compatibility-'));
    try {
      const repositoryRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
      const before = sha256(await readFile(join(releaseRoot!, 'manifest.json')));
      const exported = await exportCommit(repositoryRoot, 'HEAD', join(owned, 'export'));
      const prepared = await prepareInputs(join(owned, 'export'), inputRoot!);
      const checked = await checkReleaseDirectory({
        releaseRoot: releaseRoot!,
        inputRoot: inputRoot!,
        maxObjectBytes: 67108864,
      });
      expect(checked.releaseId).toBe(
        'f6e78e74fba37602840310934821f4a6d95872a0d19af2512ba4763fefe5ca0b',
      );
      expect(prepared.inputs).toHaveLength(119);
      expect(
        prepared.inputs.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
      ).toEqual(
        checked.manifest.inputs.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
      );
      expect(checked.manifest.outputs).toHaveLength(70);
      expect(exported.commit).toMatch(/^[a-f0-9]{40}$/);
      const web = readCandidate(releaseRoot!);
      expect(web.releaseId).toBe(checked.releaseId);
      copyCandidate(web, join(owned, 'site-data'));
      for (const output of checked.manifest.outputs.filter((f) => f.path.startsWith('data/')))
        expect(sha256(await readFile(join(owned, 'site-data', output.path.slice(5))))).toBe(
          output.sha256,
        );
      expect(
        JSON.parse(await readFile(join(owned, 'site-data/releases/current.json'), 'utf8'))
          .release_id,
      ).toBe(checked.releaseId);
      expect(sha256(await readFile(join(releaseRoot!, 'manifest.json')))).toBe(before);
    } finally {
      await rm(owned, { recursive: true, force: true });
    }
  },
  60_000,
);
