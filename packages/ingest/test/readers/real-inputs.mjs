/** Required-input acceptance, intentionally separate from the portable unit suite.
 * Missing originals FAIL this command; no skip or replacement capture is allowed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SnapshotReader,
  readBnbSnapshot,
  readEurostatSnapshot,
  readGvaSnapshot,
  readParliamentSnapshot,
  readGiscoSnapshot,
  readOblastSnapshot,
  reduceParliament,
  eurostatSeries,
} from '../../dist/readers/snapshots/index.js';
import { readLegalHtml, readLegalDocx } from '../../dist/readers/documents/index.js';
import { transformDoo, transformNzok } from '../../dist/build/components-social.js';
import { transformAssumptions, transformRatesLaw } from '../../dist/build/rates-sources.js';
import { gazetteFacts } from '../../dist/build/law-evidence.js';
import { buildDebt } from '../../dist/build/debt.js';
import { buildMunicipalities } from '../../dist/build/municipalities.js';
import { loadAnnex } from '../../dist/build/annex.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const flags = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i],
    value = process.argv[i + 1];
  assert.ok(
    ['--input-root', '--report'].includes(key) && value && !flags[key],
    'Invalid acceptance arguments',
  );
  flags[key] = value;
}
assert.ok(
  flags['--input-root'] && flags['--report'],
  'Required: --input-root ROOT --report NEW_FILE',
);
const inputRoot = resolve(flags['--input-root']);
const reportPath = resolve(flags['--report']);
const load = async (name) =>
  JSON.parse(await readFile(join(repo, 'packages/ingest/test/fixtures', name), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (obj) => hash(JSON.stringify(obj));
const checks = [],
  receipts = [];
const report = {
  schema: 1,
  outcome: 'running',
  base: '3424bc998c726d6d511d4284295c54c50c42d099',
  inputRoot,
  checks,
  receipts,
  limitations: [
    'Read-only real originals are external to this managed checkout; this command fails if absent.',
    'Archived reader captures and donor outputs are independent TEST expectations only.',
    'Debt and municipal builder comparisons mix freshly read scoped sources with explicitly preserved PDF/historical inputs.',
    'Current saved Eurostat snapshots cannot prove the missing historical vintages behind published population/debt/GVA.',
    'GISCO evidence starts at the pinned reduced cache; original streamed GeoJSON is unavailable.',
    'No SEBRA/XLS/XLSX/PDF decoding, live acquisition, production dispatch cutover or complete release acceptance is claimed.',
  ],
};
const check = async (name, fn) => {
  await fn();
  checks.push({ name, outcome: 'pass' });
};
const keep = (result) => {
  receipts.push(result.receipt);
  return result.data;
};
let owned;
try {
  const reader = await SnapshotReader.open({
    inputRoot,
    registryPath: join(repo, 'data/sources.yaml'),
    pinsPath: join(repo, 'data/originals.sha256'),
    readDate: '2026-11-10',
  });
  const blocks = {};
  const archivedBlocks = await load('law/inputs/dv-blocks.json');
  for (const [source, file] of Object.entries({
    zdb: 'zdb2026_dv69_idMat245041.html',
    zbdoo: 'zbdoo2026_dv68_idMat244982.html',
    zbnzok: 'zbnzok2026_dv68_idMat244981.html',
  })) {
    await check(
      `actual HTML ${source}: every ordered paragraph/cell equals archived donor blocks`,
      async () => {
        blocks[source] = keep(await readLegalHtml(reader, source, 'data/originals/dv/' + file));
        assert.deepEqual(blocks[source], archivedBlocks[source]);
        const oracle = await load('law/gazette-oracle.json');
        assert.deepEqual(gazetteFacts(blocks[source]), oracle[source]);
      },
    );
  }
  let docx;
  await check(
    'actual DOCX: all blocks, physical tables/cells/merges and duplicate article variants equal independently pinned Python expectations',
    async () => {
      const expected = JSON.parse(
        await readFile(join(repo, 'packages/ingest/test/readers/docx-expectation.json'), 'utf8'),
      );
      docx = keep(await readLegalDocx(reader, 'bill', expected.input.path));
      assert.equal(receipts.at(-1).sha256, expected.input.sha256);
      assert.equal(docx.blocks.length, expected.blocks.count);
      assert.equal(digest(docx.blocks), expected.blocks.sha256);
      assert.equal(docx.tables.length, expected.physicalTables.count);
      assert.equal(digest(docx.tables), expected.physicalTables.sha256);
      for (const n of [1, 2])
        assert.equal(
          docx.blocks.filter(
            (b) => b[0] === 'p' && new RegExp(`^Чл\\.\\s*${n}\\.\\s*\\(1\\)\\s*Приема`).test(b[1]),
          ).length,
          2,
        );
    },
  );
  await check(
    'actual HTML/DOCX -> existing social/rates/assumptions reducers -> archived Python expectations',
    async () => {
      assert.deepEqual(
        transformRatesLaw(blocks.zbdoo, blocks.zbnzok),
        await load('components-rates/rates-law.json'),
      );
      assert.deepEqual(
        transformAssumptions(docx.blocks),
        await load('components-rates/assumptions.json'),
      );
      const social = await load('components-rates/social.json');
      assert.deepEqual(transformDoo(blocks.zbdoo), social.doo);
      assert.deepEqual(transformNzok(blocks.zbnzok), social.nzok);
    },
  );
  const bnb = {};
  const captures = await load('debt-local/inputs/reader-captures.json');
  for (const [key, path, indicator] of [
    ['bnbGg', 'ggd.xml', 'GGALN_G01_XDC'],
    ['bnbCg', 'cgd.xml', 'GCALN_G01_AC_XDC'],
  ]) {
    await check(
      `actual SDMX ${path}: every selected quarter/value equals archived Python reader`,
      async () => {
        bnb[key] = keep(
          await readBnbSnapshot(reader, 'data/originals/bnb_sdmx/' + path, indicator),
        );
        for (const k of ['asOf', 'indicator', 'quarters', 'mln'])
          assert.deepEqual(bnb[key][k], captures[key][k]);
      },
    );
  }
  const eurostat = {};
  for (const file of [
    'tps00001_BG.json',
    'demo_gind_BG_JAN.json',
    'gov_10dd_edpt1_BG_EU.json',
    'gov_10q_ggdebt_BG.json',
    'nama_10_a10_BG.json',
    'nama_10_gdp_BG.json',
  ]) {
    await check(
      `actual saved JSON-stat ${file}: original schema, units, sparse values and series`,
      async () => {
        const path = 'data/originals/eurostat/' + file;
        eurostat[file] = keep(await readEurostatSnapshot(reader, path));
        assert.deepEqual(eurostat[file], JSON.parse(await readFile(join(inputRoot, path), 'utf8')));
        assert.ok(Object.keys(eurostatSeries(eurostat[file], 'time', { geo: 'BG' })).length);
        if (file.startsWith('nama_'))
          assert.deepEqual(keep(await readGvaSnapshot(reader, path)).value, eurostat[file].value);
      },
    );
  }
  for (const [key, bill] of [
    ['zdb', 167157],
    ['zbdoo', 167156],
    ['zbnzok', 167155],
  ]) {
    await check(
      `actual saved Parliament bill ${bill}: existing facts reducer equals archived Python oracle`,
      async () => {
        const data = keep(
          await readParliamentSnapshot(reader, `data/originals/parliament/bill_${bill}.json`, bill),
        );
        assert.deepEqual(
          reduceParliament(bill, data),
          (await load('law/parliament-oracle.json'))[key],
        );
      },
    );
  }
  let gis, oblast;
  await check('actual pinned GISCO/oblast caches -> typed existing builder inputs', async () => {
    gis = keep(await readGiscoSnapshot(reader, 'data/cache/gisco_lau_bg.json'));
    oblast = keep(await readOblastSnapshot(reader, 'data/cache/eurostat_pop_nuts3_bg.json'));
    assert.deepEqual(gis, await load('debt-local/inputs/data/cache/gisco_lau_bg.json'));
    assert.equal(gis.items.length, 265);
    assert.deepEqual(
      oblast.jsonstat,
      (await load('debt-local/inputs/data/cache/eurostat_pop_nuts3_bg.json')).jsonstat,
    );
  });
  await check(
    'existing debt builder accepts actual HTML/SDMX/saved JSON with preserved PDF and historical inputs, matching donor',
    async () => {
      const tables = await load('debt-local/inputs/data/originals/asbp/asbp_tables.json');
      const result = buildDebt(
        {
          table: tables.tables.VI_1,
          gdp: loadAnnex(tables.tables).gdp,
          pages: await load(
            'debt-local/inputs/data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
          ),
          paragraphs: blocks.zdb.filter(([k]) => k === 'p').map(([, t]) => t),
          stock: await load('debt-local/inputs/data/inputs/debt_stock.json'),
          gdpCopy: await load('debt-local/inputs/data/inputs/debt_gdp.json'),
          annual: eurostat['gov_10dd_edpt1_BG_EU.json'],
          quarterly: eurostat['gov_10q_ggdebt_BG.json'],
          ...bnb,
          revisions: captures.revisions,
          execution: await load('debt-local/inputs/execution.json'),
        },
        '2026-11-08',
      );
      assert.deepEqual(result, await load('debt-local/donor/debt.json'));
    },
  );
  await check(
    'existing municipal builder accepts actual saved caches with preserved law/historical inputs, matching donor',
    async () => {
      const law = await load('debt-local/inputs/data/cache/law_bill.json');
      const result = buildMunicipalities(
        {
          art: law.municipal.art51,
          proto: await load('debt-local/inputs/data/inputs/municipal_transfers_2026.json'),
          gis,
          oblast,
          population: await load('debt-local/inputs/data/inputs/population.json'),
        },
        '2026-11-08',
        { preserveHistoricalChirpan: true },
      );
      assert.deepEqual(result.municipalities, await load('debt-local/donor/municipalities.json'));
      assert.deepEqual(result.geo, await load('debt-local/donor/geo/obshtini.json'));
    },
  );
  await check(
    'owned corrupt real-byte copies fail hash/type/path checks; external inputs stay untouched',
    async () => {
      owned = await mkdtemp(join(tmpdir(), 'sigma-real-doc-reader-'));
      const path = 'data/originals/bnb_sdmx/ggd.xml',
        file = join(owned, path);
      await mkdir(dirname(file), { recursive: true });
      const bytes = await readFile(join(inputRoot, path));
      await writeFile(file, Buffer.concat([bytes, Buffer.from('corrupt')]));
      const pinsPath = join(owned, 'pins.sha256');
      await writeFile(pinsPath, `${hash(bytes)}  ${path}\n`);
      const copy = await SnapshotReader.open({
        inputRoot: owned,
        registryPath: join(repo, 'data/sources.yaml'),
        pinsPath,
        readDate: '2026-11-10',
      });
      await assert.rejects(() => readBnbSnapshot(copy, path, 'GGALN_G01_XDC'), /hash mismatch/);
      await assert.rejects(() => copy.read('bnb', 'data/originals/../ggd.xml'), /path/);
      const corrupt = bytes.toString('utf8').replace('UNIT_MULT="6"', 'UNIT_MULT="3"');
      await writeFile(file, corrupt);
      await writeFile(pinsPath, `${hash(corrupt)}  ${path}\n`);
      const rePinned = await SnapshotReader.open({
        inputRoot: owned,
        registryPath: join(repo, 'data/sources.yaml'),
        pinsPath,
        readDate: '2026-11-10',
      });
      await assert.rejects(() => readBnbSnapshot(rePinned, path, 'GGALN_G01_XDC'), /units/);
    },
  );
  await check(
    'standalone CLI: all eight kinds read real sources, retain exact bytes and reject existing outputs',
    async () => {
      const output = await mkdtemp(join(tmpdir(), 'sigma-reader-cli-'));
      try {
        const cases = [
          ['html', 'zdb', 'data/originals/dv/zdb2026_dv69_idMat245041.html', []],
          ['docx', 'bill', 'data/originals/parliament/52-602-01-19.docx', []],
          ['bnb', 'bnb', 'data/originals/bnb_sdmx/ggd.xml', ['--indicator', 'GGALN_G01_XDC']],
          ['eurostat', 'eurostat', 'data/originals/eurostat/gov_10dd_edpt1_BG_EU.json', []],
          ['gva', 'eurostat', 'data/originals/eurostat/nama_10_a10_BG.json', []],
          [
            'parliament',
            'parliament',
            'data/originals/parliament/bill_167157.json',
            ['--bill-id', '167157'],
          ],
          ['gisco', 'gisco', 'data/cache/gisco_lau_bg.json', []],
          ['oblast', 'eurostat', 'data/cache/eurostat_pop_nuts3_bg.json', []],
        ];
        for (const [kind, source, path, extra] of cases) {
          const out = join(output, kind);
          const args = [
            join(repo, 'apps/etl/dist/prepare-documents.js'),
            '--kind',
            kind,
            '--input-root',
            inputRoot,
            '--registry',
            join(repo, 'data/sources.yaml'),
            '--pins',
            join(repo, 'data/originals.sha256'),
            '--source',
            source,
            '--path',
            path,
            '--date',
            '2026-11-10',
            '--out',
            out,
            ...extra,
          ];
          const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 });
          assert.equal(result.status, 0, result.stderr || result.error?.message);
          const receipt = JSON.parse(await readFile(join(out, 'receipt.json'), 'utf8'));
          assert.equal(hash(await readFile(join(out, 'source.bin'))), receipt.sha256);
          const again = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 });
          assert.notEqual(again.status, 0);
          assert.match(again.stderr, /EEXIST/);
        }
      } finally {
        await rm(output, { recursive: true, force: true });
      }
    },
  );
  await check('all real input bytes retain their verified SHA-256 after acceptance', async () => {
    for (const receipt of receipts)
      assert.equal(hash(await readFile(join(inputRoot, receipt.path))), receipt.sha256);
  });
  report.outcome = 'pass';
} catch (error) {
  report.outcome = 'fail';
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (owned) await rm(owned, { recursive: true, force: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`${report.outcome}: ${checks.length} checks; report ${reportPath}\n`);
  if (report.error) process.stderr.write(report.error + '\n');
}
