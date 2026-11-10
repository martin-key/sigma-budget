/** Finite offline actual-source acceptance; explicit originals and fresh donor output.
 * Usage: node test/publication-documents-real.mjs <source-root> <fresh-python-dir> <owned-output>
 * Missing originals fail as unverified. Captures below are labelled inherited.
 */
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  preparePublicationDocuments,
  extractProgrammeArchive,
  readRegisteredProgrammePdfs,
  PUBLICATION_PATHS,
  assertFreshPublication,
  verifyLegacyProgrammeSource,
  readProgrammeSevenZip,
  DBP_PATH,
  extractDbp,
  extractDbpDocument,
} from '../dist/readers/publication-documents/index.js';
import { readPdf, pdfTables } from '../dist/readers/pdf/index.js';
import { buildBudgets } from '../dist/build/budgets.js';
import { buildBudgetPlan } from '../dist/build/dbp-gva.js';
const [source, donor, output] = process.argv.slice(2).map((p) => resolve(p));
assert(source && donor && output);
assert(relative(source, output).startsWith('../'), 'output must be outside source');
await mkdir(output);
const json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const options = {
  inputRoot: source,
  registryPath: join(source, 'data/sources.yaml'),
  pinsPath: join(source, 'data/originals.sha256'),
  readDate: '2026-11-10',
  out: join(output, 'candidate'),
  outlookPath: join(source, 'data/release/outlook.json'),
  zdbPath: join(source, 'data/inputs/zdb2026.json'),
};
try {
  const first = await preparePublicationDocuments(options),
    loaded = {};
  assert.equal(first.outputs.length, 4);
  assert(first.outputs.every((o) => o.action === 'generated'));
  for (const [key, path] of Object.entries(PUBLICATION_PATHS))
    loaded[key] = await json(join(options.out, path));
  assert.deepEqual(loaded.law, await json(join(donor, 'legal.json')));
  assert.deepEqual(loaded.dbp, await json(join(donor, 'dbp.json')));
  assert.deepEqual(loaded.programmeEvidence, await json(join(donor, 'pdf-evidence.json')));
  const legacy = await json(join(donor, 'programmes.json'));
  verifyLegacyProgrammeSource(legacy, loaded.programmeEvidence, loaded.law);
  const newBuilt = buildBudgets(
      { source: loaded.programmes, pdfs: loaded.programmeEvidence, law: loaded.law },
      '2026-11-08',
    ),
    oldBuilt = buildBudgets(
      { source: legacy, pdfs: loaded.programmeEvidence, law: loaded.law },
      '2026-11-08',
    );
  assert.deepEqual(newBuilt, oldBuilt);
  // All inherited 44 published-file expectations, not fresh independent captures.
  assert.deepEqual(
    newBuilt,
    await json(new URL('./fixtures/programmes/oracle.json', import.meta.url)),
  );
  const ed = await json(new URL('./fixtures/dbp-gva/inputs/editorial.json', import.meta.url)),
    expectedPlan = await json(new URL('./fixtures/dbp-gva/inputs/figures.json', import.meta.url));
  assert.deepEqual(
    buildBudgetPlan(loaded.dbp, ed, loaded.dbp.document.sha256),
    buildBudgetPlan(expectedPlan, ed, loaded.dbp.document.sha256),
  );
  const bytesBefore = await Promise.all(
    first.outputs.map((o) => readFile(join(options.out, o.path))),
  );
  const second = await preparePublicationDocuments(options);
  assert(second.outputs.every((o) => o.action === 'verified'));
  for (let i = 0; i < first.outputs.length; i++)
    assert.deepEqual(await readFile(join(options.out, first.outputs[i].path)), bytesBefore[i]);
  const legacyOut = join(output, 'legacy-candidate');
  await mkdir(join(legacyOut, 'data/inputs'), { recursive: true });
  const legacyBytes = await readFile(join(donor, 'programmes.json'));
  await writeFile(join(legacyOut, PUBLICATION_PATHS.programmes), legacyBytes);
  const legacyReceipt = await preparePublicationDocuments({
    ...options,
    out: legacyOut,
    roles: ['programmes'],
  });
  assert.equal(legacyReceipt.compatibility.length, 1);
  assert.deepEqual(await readFile(join(legacyOut, PUBLICATION_PATHS.programmes)), legacyBytes);
  const req = createRequire(
      new URL('../../../apps/etl/publication-documents/package.json', import.meta.url),
    ),
    wasmModule = req.resolve('7z-wasm');
  const archive = await extractProgrammeArchive(
      await readFile(join(source, 'data/originals/parliament/52-602-01-19.zip')),
      { wasmModule },
    ),
    registered = await readRegisteredProgrammePdfs(options);
  assert.equal(archive.pdfs.length, 46);
  for (const p of archive.pdfs)
    assert.equal(hash(p.bytes), hash(registered.pdfs.find((x) => x.file === p.file).bytes));
  await assert.rejects(readProgrammeSevenZip(Buffer.from('corrupt'), { wasmModule }));
  const pdfBytes = await readFile(join(source, DBP_PATH)),
    badHash = Buffer.from(pdfBytes);
  badHash[badHash.length - 1] ^= 1;
  assert.throws(() => extractDbp(badHash), /SHA-256/);
  const wrong = readPdf(pdfBytes),
    row = pdfTables(wrong.pages[23])
      .flatMap((t) => t.rawCells)
      .find((r) => r[0] === '1');
  const numericIndex = row.findIndex((c, i) => i > 0 && /^-?\d+(?:[ ,]\d+)*$/u.test(c));
  assert(numericIndex > 0);
  row[numericIndex] = '';
  assert.throws(() => extractDbpDocument(wrong), /column count/);
  const badQuote = readPdf(pdfBytes);
  badQuote.pages[18].text = 'corrupt quote';
  assert.throws(() => extractDbpDocument(badQuote), /quote absent/);
  const stale = structuredClone(loaded.programmeEvidence),
    key = Object.keys(stale)[0];
  stale[key].cells[0][1].tokens[0]++;
  assert.throws(
    () =>
      assertFreshPublication(
        Buffer.from(JSON.stringify(stale)),
        loaded.programmeEvidence,
        'programmeEvidence',
      ),
    /Stale/,
  );
  assert.throws(() => verifyLegacyProgrammeSource(legacy, stale, loaded.law), /Stale/);
  const staleOut = join(output, 'stale');
  await mkdir(join(staleOut, 'data/cache'), { recursive: true });
  await writeFile(join(staleOut, PUBLICATION_PATHS.law), '{}\n');
  await assert.rejects(
    preparePublicationDocuments({ ...options, out: staleOut, roles: ['law'] }),
    /Stale/,
  );
  assert.equal(await readFile(join(staleOut, PUBLICATION_PATHS.law), 'utf8'), '{}\n');
  await assert.rejects(lstat(join(staleOut, 'tmp')));
  const wrongPins = join(output, 'wrong-pins.sha256');
  await writeFile(
    wrongPins,
    (await readFile(options.pinsPath, 'utf8'))
      .split('\n')
      .map((line) => (line.endsWith('  ' + DBP_PATH) ? '0'.repeat(64) + '  ' + DBP_PATH : line))
      .join('\n'),
  );
  const wrongOut = join(output, 'wrong-hash-candidate');
  await assert.rejects(
    preparePublicationDocuments({ ...options, out: wrongOut, pinsPath: wrongPins, roles: ['dbp'] }),
    /hash|SHA/i,
  );
  await assert.rejects(lstat(wrongOut));
  const emptyInput = join(output, 'empty-input');
  await mkdir(emptyInput);
  const missingOut = join(output, 'missing-candidate');
  await assert.rejects(
    preparePublicationDocuments({
      ...options,
      inputRoot: emptyInput,
      out: missingOut,
      roles: ['dbp'],
    }),
    { code: 'ENOENT' },
  );
  await assert.rejects(lstat(missingOut));
  const summary = {
    outcome: 'pass',
    actual: {
      law: 'complete JSON equals fresh Python 3.12 and current intermediate',
      dbp: {
        reported: loaded.dbp.figures.length,
        derived: loaded.dbp.derived.length,
        checks: loaded.dbp.checks.length,
        comparison: 'complete JSON equals fresh Python 3.12',
      },
      programmePdfs: {
        count: 46,
        comparison: 'complete cells/conflicts/names/labels equal fresh Python 3.12',
      },
      programmeSource:
        'physical-grid extraction differs from Python find_tables only in recovered 1000/1100 source rows; complete existing-builder publication is identical',
      archive: '46 nested ZIP/7z PDFs equal registered PDF pins',
      preparation: 'absent generation + existing-byte verification + stale fail before writes',
    },
    inherited: ['all 44 programme budget outputs', 'DBP full existing builder output'],
    negative: [
      'corrupt PDF',
      'wrong DBP hash',
      'wrong physical column count',
      'missing quote',
      'corrupt 7z',
      'missing original remains unverified; no output',
      'registered source hash mismatch; no output',
      'stale evidence',
      'stale cache retained',
    ],
    unverified: [],
    receipts: first,
  };
  await writeFile(join(output, 'acceptance.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(
    JSON.stringify(
      { ...summary, receipts: 'candidate/tmp/publication-documents-receipt.json' },
      null,
      2,
    ),
  );
} catch (e) {
  await writeFile(
    join(output, 'failure.json'),
    JSON.stringify(
      { outcome: 'fail', error: e.stack, unverified: 'No missing-source substitution permitted' },
      null,
      2,
    ),
  );
  throw e;
}
