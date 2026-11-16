// The published files of data/release/ as the release of a request (apps/web/workers/release-data.ts ReleaseData), for the tests of the MCP
// server: the tools read the real catalog, index and data files, so a change of a format that breaks a tool fails a test.
import { existsSync, readFileSync } from 'node:fs';
import { parse, PendingError } from '../../client/data.js';
import type { ReleaseData } from '../release-data';
import type { Ctx } from './data';

const ROOT = new URL('../../../../data/release/', import.meta.url);

export function diskRelease(over: Partial<ReleaseData> = {}): ReleaseData {
  return {
    releaseId: 'disk',
    dataBase: '/data/',
    async load(name) {
      // release/manifest is the manifest of the current release, as apps/web/workers/release-data.ts serves it
      const file =
        name === 'release/manifest'
          ? new URL(
              `releases/${JSON.parse(readFileSync(new URL('releases/current.json', ROOT), 'utf8')).release_id}/manifest.json`,
              ROOT,
            )
          : new URL(name + '.json', ROOT);
      if (!existsSync(file)) throw new PendingError(name);
      return parse(name, readFileSync(file, 'utf8'));
    },
    ...over,
  };
}

export const ORIGIN = 'https://budget.example';
export const diskCtx = (data: ReleaseData = diskRelease(), env: Partial<Env> = {}): Ctx => ({
  env: env as Env,
  origin: ORIGIN,
  data,
});
