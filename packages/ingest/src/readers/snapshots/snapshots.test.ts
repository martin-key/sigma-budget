import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SnapshotReader,
  parseBnbSdmx,
  parseBnbDocument,
  parseEurostatSnapshot,
  eurostatCells,
  eurostatSeries,
  parseGvaSnapshot,
  parseParliamentSnapshot,
  parseGiscoSnapshot,
  parseOblastSnapshot,
  parsePins,
  reduceParliament,
} from './index.js';
import { pythonNumberAt } from '../../common/numbers.js';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const stat = `{"version":"2.0","class":"dataset","updated":"2026-11-10T00:00:00Z","id":["geo","time"],"size":[1,3],"dimension":{"geo":{"category":{"index":{"BG":0}}},"time":{"category":{"index":{"2024":0,"2025":1,"2026":2}}}},"value":{"2":1.0,"0":0,"1":null},"status":{"2":"p"},"extension":{"annotation":[{"type":"UPDATE_DATA","date":"2026-11-10"}]}}`;
const message = 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message';
const sdmx = `<m:StructureSpecificData xmlns:m="${message}"><m:Header><m:Prepared>2026-10-30T10:18:58</m:Prepared></m:Header><m:DataSet><Series INDICATOR="GGALN_G01_XDC" UNIT_MULT="6" REF_AREA="BG" FREQ="Q"><Obs TIME_PERIOD="2025-Q4" OBS_VALUE="11871.440" OBS_STATUS="A"/><Obs TIME_PERIOD="2026-Q1" OBS_VALUE="0" OBS_STATUS="A"/></Series></m:DataSet></m:StructureSpecificData>`;

describe('offline snapshots', () => {
  it('retains sparse source order, null/zero, status and number tokens', () => {
    const data = parseEurostatSnapshot(stat);
    expect(eurostatCells(data).map((c) => [c.coords.time, c.value, c.status])).toEqual([
      ['2026', 1, 'p'],
      ['2024', 0, null],
    ]);
    expect(eurostatSeries(data, 'time', { geo: 'BG' })).toEqual({
      '2024': [0, null],
      '2026': [1, 'p'],
    });
    expect(() => eurostatSeries(data, 'bogus')).toThrow(/dimension/);
    const gva = parseGvaSnapshot(`{"jsonstat":${stat},"updated":"2026-11-10T00:00:00Z"}`);
    expect(pythonNumberAt(gva.value, '2', gva.value['2']!)).toEqual({ value: 1, kind: 'float' });
    expect(pythonNumberAt(gva.value, '0', gva.value['0']!)).toEqual({ value: 0, kind: 'int' });
    expect(
      parseOblastSnapshot(`{"jsonstat":${stat},"updated":"2026-11-10T00:00:00Z"}`).updated,
    ).toBe('2026-11-10T00:00:00Z');
  });
  it.each([
    stat.replace('"size":[1,3]', '"size":[1,4]'),
    stat.replace('"2":1.0', '"3":1.0'),
    stat.replace('"2":1.0', '"2":"1.0"'),
    stat.replace('"2025":1', '"2025":0'),
    stat.replace('2026-11-10T', '2026-02-30T'),
  ])('rejects corrupt JSON-stat shapes', (text) =>
    expect(() => parseEurostatSnapshot(text)).toThrow(),
  );
  it('reads BNB units, prepared date and exact observation tokens', () => {
    const b = parseBnbSdmx(sdmx, 'GGALN_G01_XDC');
    expect([b.asOf, b.quarters, b.mln]).toEqual([
      '2026-10-30',
      ['2025-Q4', '2026-Q1'],
      [11871.44, 0],
    ]);
    expect(parseBnbDocument(sdmx, 'GGALN_G01_XDC').observations[0]?.rawValue).toBe('11871.440');
  });
  it.each([
    sdmx.replace('UNIT_MULT="6"', 'UNIT_MULT="3"'),
    sdmx.replace('OBS_STATUS="A"', 'OBS_STATUS="P"'),
    sdmx.replace('OBS_VALUE="0"', 'OBS_VALUE="NaN"'),
    sdmx.replace('2026-Q1', '2026-Q2'),
    sdmx.replace('2026-Q1', '2025-Q4'),
    '<!DOCTYPE m SYSTEM "https://invalid.test/">' + sdmx,
  ])('rejects corrupt BNB evidence', (text) =>
    expect(() => parseBnbSdmx(text, 'GGALN_G01_XDC')).toThrow(),
  );
  it('adapts actual Parliament shape and constrained legacy file literals through the existing reducer', async () => {
    const archived = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, '../../../test/fixtures/law/inputs/parliament.json'),
        'utf8',
      ),
    );
    const source = { ...archived.zdb, L_Act_id: 167157 };
    const a = parseParliamentSnapshot(JSON.stringify(source), 167157);
    const original = reduceParliament(167157, a);
    source.proposal_12_list[0].act_files = "[{'FILENAME': '52-654-04-56.pdf'}]";
    expect(
      reduceParliament(167157, parseParliamentSnapshot(JSON.stringify(source), 167157)),
    ).toEqual(original);
    expect(() => parseParliamentSnapshot(JSON.stringify(source), 1)).toThrow(/identity/);
    source.proposal_12_list[0].act_files = "__import__('os').system('false')";
    expect(() => parseParliamentSnapshot(JSON.stringify(source), 167157)).toThrow(/literal/);
  });
  it('loads the pinned GISCO representation without silently repairing coordinates', async () => {
    const text = await readFile(
      resolve(
        import.meta.dirname,
        '../../../test/fixtures/debt-local/inputs/data/cache/gisco_lau_bg.json',
      ),
      'utf8',
    );
    expect(parseGiscoSnapshot(text).items).toHaveLength(265);
    const broken = JSON.parse(text);
    broken.items[0].pop++;
    expect(() => parseGiscoSnapshot(JSON.stringify(broken))).toThrow(/sum/);
    broken.items[0].rings[0][0][0][0] = null;
    expect(() => parseGiscoSnapshot(JSON.stringify(broken))).toThrow(/coordinate/);
  });
  it('enforces source identity, path, exact bytes, pins and symlinks with owned cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sigma-saved-reader-'));
    try {
      await mkdir(join(root, 'data/originals/eurostat'), { recursive: true });
      const path = 'data/originals/eurostat/input.json',
        file = join(root, path);
      await writeFile(file, stat);
      const registryPath = join(root, 'sources.yaml'),
        pinsPath = join(root, 'pins.sha256');
      await writeFile(
        registryPath,
        `schema: 1\nsources:\n- id: eurostat\n  acquisition: fetch\n  files:\n  - path: ${path}\n`,
      );
      await writeFile(pinsPath, `${sha(stat)}  ${path}\n`);
      const options = { inputRoot: root, registryPath, pinsPath, readDate: '2026-11-10' };
      const reader = await SnapshotReader.open(options);
      expect((await reader.read('eurostat', path)).receipt.sha256).toBe(sha(stat));
      await expect(reader.read('other', path)).rejects.toThrow(/registered/);
      await expect(reader.read('eurostat', 'data/originals/../input.json')).rejects.toThrow(/path/);
      await writeFile(file, '{}');
      await expect(reader.read('eurostat', path)).rejects.toThrow(/hash mismatch/);
      await rm(file);
      await symlink(pinsPath, file);
      await expect(reader.read('eurostat', path)).rejects.toThrow(/Symlink/);
      await expect(SnapshotReader.open({ ...options, readDate: '2026-02-30' })).rejects.toThrow(
        /date/,
      );
      await writeFile(pinsPath, '');
      await expect((await SnapshotReader.open(options)).read('eurostat', path)).rejects.toThrow(
        /Missing source pin/,
      );
      await writeFile(
        registryPath,
        `schema: 1\nsources:\n- id: eurostat\n  acquisition: fetch\n  files:\n  - path: ${path}\n    sha256: ${sha('{}')}\n`,
      );
      await writeFile(pinsPath, `${sha(stat)}  ${path}\n`);
      await expect((await SnapshotReader.open(options)).read('eurostat', path)).rejects.toThrow(
        /Conflicting/,
      );
      expect(() => parsePins(`${sha(stat)}  ${path}\n${sha(stat)}  ${path}\n`)).toThrow(
        /duplicate/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
