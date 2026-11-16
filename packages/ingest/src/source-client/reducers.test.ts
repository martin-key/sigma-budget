import { describe, expect, it } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  GISCO_CSV,
  GISCO_GEOJSON,
  LAU_BASE,
  NUTS3_BG,
  OBLAST_BASE,
  OBLAST_URL,
  reduceGisco,
  reduceOblast,
} from './reducers.js';
import { SourceClient } from './client.js';
import { sha256 } from './files.js';
const fixtureRoot = resolve('test/fixtures/debt-local/inputs');
const expectedRoot = resolve('test/expected/source-client-reducers');
/**
 * `JSON.stringify` with the default `json.dumps` separators (`, ` and `: `). It does not reproduce Python's float formatting
 * (`12.0`, `1e-05`): the rows compared here have no integral floats and no exponent forms. If such a value appears, the hash
 * below fails although the rows are equal, never the other way round.
 */
const pythonJson = (value: unknown) =>
  JSON.stringify(value).replace(
    /("(?:[^"\\]|\\.)*")|([:,])/g,
    (_m, text, sep) => text ?? (sep === ':' ? ': ' : ', '),
  );
async function rawFromReduced() {
  // Synthetic raw reconstruction for algorithm/orchestration tests only. Never historical evidence.
  const saved = JSON.parse(
    await readFile(join(fixtureRoot, 'data/cache/gisco_lau_bg.json'), 'utf8'),
  );
  const csv = Buffer.from(
    'CNTR_CODE,GISCO_ID,LAU_NAME,POP_2024,AREA_KM2\r\n' +
      saved.items
        .map((r: any) =>
          ['BG', 'BG_' + r.id, '"' + r.name.replaceAll('"', '""') + '"', r.pop, r.areaKm2].join(
            ',',
          ),
        )
        .join('\r\n') +
      '\r\n',
  );
  const geo = Buffer.from(
    JSON.stringify({
      type: 'FeatureCollection',
      features: saved.items.map((r: any) => ({
        type: 'Feature',
        properties: { CNTR_CODE: 'BG', GISCO_ID: 'BG_' + r.id },
        geometry: { type: 'MultiPolygon', coordinates: r.rings },
      })),
    }),
  );
  return { saved, csv, geo };
}
describe('raw GISCO and oblast reducer responsibilities', () => {
  it('runs the complete 265-row raw CSV/geometry join, sort and Python rounding', async () => {
    const { saved, csv, geo } = await rawFromReduced();
    const reduced = reduceGisco(csv, geo);
    expect(reduced).toEqual(saved);
    expect(reduced.populationSum).toBe(6445481);
  });
  it('compares the reduction with the frozen Python donor output for the same synthetic raw bytes', async () => {
    const { csv, geo } = await rawFromReduced();
    const frozen = JSON.parse(
      await readFile(join(expectedRoot, 'gisco-donor-reduction.json'), 'utf8'),
    );
    const items = reduceGisco(csv, geo).items;
    expect(items).toHaveLength(frozen.rows);
    // The donor printed `json.dumps(rows, ensure_ascii=False)`; reproduce those exact bytes.
    expect(sha256(Buffer.from(pythonJson(items)))).toBe(frozen.outputSha256);
  });
  it('rejects missing geometry, duplicate identity, bad CSV and incomplete country count', async () => {
    const { csv, geo } = await rawFromReduced();
    const doc = JSON.parse(geo.toString());
    doc.features.pop();
    expect(() => reduceGisco(csv, Buffer.from(JSON.stringify(doc)))).toThrow(
      /Missing GISCO geometry/,
    );
    expect(() =>
      reduceGisco(Buffer.from(csv.toString() + csv.toString().split('\r\n')[1] + '\r\n'), geo),
    ).toThrow(/Duplicate/);
    expect(() => reduceGisco(Buffer.from('"unterminated'), geo)).toThrow(/Unclosed/);
    expect(() => reduceGisco(csv, geo, { expectedCount: 264 })).toThrow(/count/);
    doc.features[0].geometry.coordinates[0][0][0][0] = Infinity;
    expect(() => reduceGisco(csv, Buffer.from(JSON.stringify(doc)))).toThrow(/coordinate/);
  });
  it('wraps the recorded oblast API response through existing JSON-stat helpers and retains its unit/sex/age constraints', async () => {
    const cache = JSON.parse(
      await readFile(join(fixtureRoot, 'data/cache/eurostat_pop_nuts3_bg.json'), 'utf8'),
    );
    const reduced = reduceOblast(Buffer.from(JSON.stringify(cache.jsonstat)), cache.url);
    expect(reduced).toEqual(cache);
    const bad = structuredClone(cache.jsonstat);
    bad.dimension.geo.category.index = { BG311: 0 };
    expect(() => reduceOblast(Buffer.from(JSON.stringify(bad)))).toThrow();
  });
  it('collects and records raw reducer dependencies with fake HTTP; preserves both existing pinned caches', async () => {
    const { csv, geo } = await rawFromReduced();
    const oblast = JSON.parse(
      await readFile(join(fixtureRoot, 'data/cache/eurostat_pop_nuts3_bg.json'), 'utf8'),
    );
    const root = await mkdtemp(join(tmpdir(), 'sigma-source-reducer-client-'));
    try {
      const source = join(root, 'source');
      await mkdir(join(source, 'data/cache'), { recursive: true });
      const giscoPath = 'data/cache/gisco_lau_bg.json',
        oblastPath = 'data/cache/eurostat_pop_nuts3_bg.json';
      const oldGisco = await readFile(join(fixtureRoot, giscoPath)),
        oldOblast = await readFile(join(fixtureRoot, oblastPath));
      await writeFile(join(source, giscoPath), oldGisco);
      await writeFile(join(source, oblastPath), oldOblast);
      const registryPath = join(root, 'sources.json');
      await writeFile(
        registryPath,
        JSON.stringify({
          schema: 1,
          sources: [
            {
              id: 'gisco',
              acquisition: 'fetch',
              files: [
                {
                  path: giscoPath,
                  url: LAU_BASE,
                  via: 'packages/ingest/src/source-client/reducers.ts',
                  sha256: sha256(oldGisco),
                },
              ],
            },
            {
              id: 'eurostat',
              acquisition: 'fetch',
              files: [
                {
                  path: oblastPath,
                  url: OBLAST_BASE,
                  via: 'packages/ingest/src/source-client/reducers.ts',
                  sha256: sha256(oldOblast),
                },
              ],
            },
          ],
        }),
      );
      const calls: string[] = [];
      const client = await SourceClient.open({
        sourceRoot: source,
        registryPath,
        clock: () => new Date('2031-01-01T00:00:00Z'),
        transport: async ({ url }) => {
          calls.push(url);
          return {
            status: 200,
            body:
              url === GISCO_CSV
                ? csv
                : url === GISCO_GEOJSON
                  ? geo
                  : url === OBLAST_URL
                    ? Buffer.from(JSON.stringify(oblast.jsonstat))
                    : Buffer.from('unregistered'),
          };
        },
      });
      const result = await client.collect({ snapshotRoot: join(root, 'out'), checkDrift: true });
      expect(result.snapshot.collected.every((r) => r.status === 'ok')).toBe(true);
      expect(calls).toEqual([GISCO_CSV, GISCO_GEOJSON, OBLAST_URL]);
      expect(result.snapshot.collected.map((r) => r.raw!.length)).toEqual([2, 1]);
      expect(result.snapshot.historicalReconstruction).toBe('unverified');
      expect(await readFile(join(source, giscoPath))).toEqual(oldGisco);
      expect(await readFile(join(source, oblastPath))).toEqual(oldOblast);
      await client.readSnapshot(join(root, 'out/snapshot.json'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('never promotes incomplete new population observations as historical reconstruction', () => {
    expect(NUTS3_BG).toHaveLength(28);
    expect(() => reduceOblast(Buffer.from('{"updated":"2031-01-01"}'))).toThrow(/dimensions/);
  });
});
