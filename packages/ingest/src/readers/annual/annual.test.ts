import { readFile, mkdtemp, mkdir, writeFile, cp, rm, symlink, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  extractAnnual2027,
  prepareAnnual,
  readAnnualRegistration,
  sha256,
  type AnnualExtractions,
  type AnnualRegistration,
} from './index.js';
import { assertFreshAnnual } from './prepare.js';
import { readPdf, spans, pdfTables } from '../pdf/index.js';
import { zipMember } from '../../build/annual-lineage.js';
import { buildWave13a, validateProvenance, type LegacyOwners } from '../../build/wave13a.js';
const root = resolve(import.meta.dirname, '../../../../..');
const fixtures = join(root, 'packages/ingest/test/fixtures');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
let temp: string,
  registration: AnnualRegistration,
  archive: Buffer,
  acquisition: Buffer,
  result: AnnualExtractions;
const date = '2026-11-10';
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'sigma-annual-'));
  registration = await readAnnualRegistration(
    join(root, 'data/sources.yaml'),
    join(root, 'data/originals.sha256'),
  );
  archive = await readFile(join(root, registration.archive));
  acquisition = await readFile(join(root, registration.acquisition));
  result = extractAnnual2027({ registration, archive, acquisition, buildDate: date });
}, 60_000);
afterAll(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});
it('decodes the actual archive and matches both complete independent pinned Python extractions exactly', async () => {
  for (const role of ['forecast', 'bill'] as const) {
    const bytes = await readFile(join(root, `data/inputs/budget_${role}_2027.json`));
    expect(() => assertFreshAnnual(bytes, result[role], role)).not.toThrow();
  }
  expect(result.forecast.checks).toHaveLength(2775);
  expect(result.forecast.checks.every((c: any) => c.passed)).toBe(true);
  expect(result.bill.checks).toHaveLength(1473);
  expect(result.bill.tables).toHaveLength(263);
  expect(result.forecast.tables.annex2!.rows).toHaveLength(100);
  expect(result.bill.projects.rows).toHaveLength(226);
  expect(Object.keys(result.bill.billMc)).toEqual(['1', '2']);
  expect(result.forecast.diagnostics).toHaveLength(1);
  expect(result.forecast.tables.annex2!.rows.find((r: any) => r.source_no === '21')!.units).toEqual(
    [null, null, null, null],
  );
  expect(result.bill.municipal.art52!.rows).toHaveLength(265);
  expect(result.bill.municipal.art53!.rows).toHaveLength(265);
});
it('feeds the unchanged Wave13a builders and produces all six exact final outputs', async () => {
  const legacy: LegacyOwners = {
    outlook: await json(join(fixtures, 'fiscal/donor/outlook.json')),
    revenue: await json(join(fixtures, 'fiscal/donor/revenue.json')),
    expenditure: await json(join(fixtures, 'fiscal/donor/expenditure.json')),
    law: await json(join(fixtures, 'law/oracle.json')),
  };
  const outputs = buildWave13a({
    forecast: result.forecast,
    bill: result.bill,
    archives: { forecast: archive, bill: archive },
    legacy,
    buildDate: '2026-11-08',
  });
  validateProvenance(outputs);
  for (const [name, output] of Object.entries(outputs))
    expect(output, name).toEqual(await json(join(fixtures, 'wave13a/final', name)));
});
it('generates missing intermediates in an owned export, then verifies them without changing their bytes', async () => {
  const out = join(temp, 'generated'),
    opts = { sourceRoot: root, registration, out, buildDate: date };
  const generated = await prepareAnnual(opts);
  expect(generated.outputs.map((o) => o.action)).toEqual(['generated', 'generated']);
  const files = await Promise.all(generated.outputs.map((o) => readFile(join(out, o.path))));
  const verified = await prepareAnnual(opts);
  expect(verified.outputs.map((o) => o.action)).toEqual(['verified', 'verified']);
  expect(verified.outputs.map((o) => o.sha256)).toEqual(files.map(sha256));
  for (let i = 0; i < files.length; i++)
    expect(await readFile(join(out, verified.outputs[i]!.path))).toEqual(files[i]);
  expect(await json(join(out, 'tmp/budget-2027-extractions.json'))).toEqual(verified);
}, 60_000);
it('verifies real existing Python intermediates byte-for-byte unchanged', async () => {
  const out = join(temp, 'existing');
  await mkdir(join(out, 'data/inputs'), { recursive: true });
  for (const role of ['forecast', 'bill'])
    await cp(
      join(root, `data/inputs/budget_${role}_2027.json`),
      join(out, `data/inputs/budget_${role}_2027.json`),
    );
  const receipt = await prepareAnnual({ sourceRoot: root, registration, out, buildDate: date });
  expect(receipt.outputs.map((o) => o.action)).toEqual(['verified', 'verified']);
  expect(receipt.compatibility).toHaveLength(1);
  for (const o of receipt.outputs)
    expect(await readFile(join(out, o.path))).toEqual(await readFile(join(root, o.path)));
}, 60_000);
it('fails a stale second gate before creating the absent first intermediate or changing existing bytes', async () => {
  const out = join(temp, 'stale');
  await mkdir(join(out, 'data/inputs'), { recursive: true });
  const stale = structuredClone(result.bill);
  stale.projects.rows[0]!.values[0] = stale.projects.rows[0]!.values[0]! + 0.1;
  const bytes = Buffer.from(JSON.stringify(stale));
  const path = join(out, 'data/inputs/budget_bill_2027.json');
  await writeFile(path, bytes);
  await expect(
    prepareAnnual({ sourceRoot: root, registration, out, buildDate: date }),
  ).rejects.toThrow(/Stale bill/);
  expect(await readFile(path)).toEqual(bytes);
  await expect(readFile(join(out, 'data/inputs/budget_forecast_2027.json'))).rejects.toThrow(
    /ENOENT/,
  );
}, 60_000);
it.each([
  [
    'money',
    (o: any) => {
      o.tables.II_1.rows[0].values[0] += 0.0000001;
    },
  ],
  [
    'blank',
    (o: any) => {
      o.tables.annex3_mln.rows[20].values[2] = 0;
    },
  ],
  [
    'text',
    (o: any) => {
      o.tables.annex2!.rows[0].printed[0] += ' changed';
    },
  ],
  [
    'units',
    (o: any) => {
      o.tables.annex2!.rows[0].units[0] = 'EUR';
    },
  ],
  [
    'geometry',
    (o: any) => {
      o.tables.annex2!.rows[0].unit_cell.bbox[0] += 0.0000001;
    },
  ],
  [
    'source',
    (o: any) => {
      o.source.pdf_sha256 = '0'.repeat(64);
    },
  ],
  [
    'check',
    (o: any) => {
      o.checks[0].passed = false;
    },
  ],
  [
    'metadata',
    (o: any) => {
      o.tables.II_1.columns[0].vintage = 'проект';
    },
  ],
])('rejects exact freshness mutations in %s without numerical tolerance', (_name, mutate) => {
  const changed = structuredClone(result.forecast);
  mutate(changed);
  expect(() =>
    assertFreshAnnual(Buffer.from(JSON.stringify(changed)), result.forecast, 'forecast'),
  ).toThrow(/Stale/);
});
it('rejects malformed existing intermediate JSON', () =>
  expect(() => assertFreshAnnual(Buffer.from('{broken'), result.bill, 'bill')).toThrow());
it('rejects corrupt source, independently corrupt acquisition, wrong registered member and invalid date', () => {
  const opts = { registration, archive, acquisition, buildDate: date };
  const corrupt = Buffer.from(archive);
  corrupt[100] = corrupt[100]! ^ 1;
  expect(() => extractAnnual2027({ ...opts, archive: corrupt })).toThrow(/Archive checksum/);
  const corruptAcquisition = Buffer.from(acquisition);
  corruptAcquisition[30] = corruptAcquisition[30]! ^ 1;
  expect(() => extractAnnual2027({ ...opts, acquisition: corruptAcquisition })).toThrow(
    /Acquisition checksum/,
  );
  const wrong = structuredClone(registration);
  wrong.members[0]!.member = registration.members[1]!.member;
  expect(() => extractAnnual2027({ ...opts, registration: wrong })).toThrow(
    /Wrong annual PDF member/,
  );
  expect(() => extractAnnual2027({ ...opts, buildDate: '2026-02-30' })).toThrow(
    /Invalid build date/,
  );
  const member = structuredClone(registration);
  member.members[0]!.sha256 = '0'.repeat(64);
  expect(() => extractAnnual2027({ ...opts, registration: member })).toThrow(/member pin/);
});
it('detects corrupt bytes in an owned source copy without overwriting a present intermediate', async () => {
  const sourceRoot = join(temp, 'corrupt-source'),
    out = join(temp, 'corrupt-output');
  await mkdir(join(sourceRoot, 'data/originals/budget_2027'), { recursive: true });
  const broken = Buffer.from(archive);
  broken[100] = broken[100]! ^ 1;
  await writeFile(join(sourceRoot, registration.archive), broken);
  await writeFile(join(sourceRoot, registration.acquisition), acquisition);
  await mkdir(join(out, 'data/inputs'), { recursive: true });
  const path = join(out, 'data/inputs/budget_bill_2027.json'),
    before = Buffer.from('existing');
  await writeFile(path, before);
  await expect(prepareAnnual({ sourceRoot, registration, out, buildDate: date })).rejects.toThrow(
    /Archive checksum/,
  );
  expect(await readFile(path)).toEqual(before);
  expect(await readFile(join(sourceRoot, registration.archive))).toEqual(broken);
}, 60_000);
it('enforces physical decoder bounds and exposes reusable pages, spans and cells from actual bytes', () => {
  const pdf = zipMember(archive, registration.members.find((m) => m.role === 'forecast')!.member);
  expect(() => readPdf(pdf, { maxBytes: pdf.length - 1 })).toThrow(/byte limit/);
  expect(() => readPdf(pdf, { maxPages: 200 })).toThrow(/page limit/);
  expect(() => readPdf(pdf, { maxChars: 10 })).toThrow(/character limit/);
  expect(() => readPdf(pdf, { maxPathsPerPage: 1 })).toThrow(/path limit/);
  expect(() => readPdf(Buffer.from('bad pdf'))).toThrow(/header/);
  expect(() => readPdf(pdf, { maxPages: 0 })).toThrow(/Invalid PDF limit/);
  const doc = readPdf(pdf);
  expect(doc.pages).toHaveLength(201);
  expect(doc.metadata['info:Title']).toContain('АСБП');
  expect(spans(doc.pages[26]!).some((s) => s.text === '130 459')).toBe(true);
  expect(pdfTables(doc.pages[179]!).length).toBeGreaterThan(0);
}, 60_000);
it('rejects output overlap, symlink inputs/outputs and hardlinked intermediates', async () => {
  const opts = { sourceRoot: root, registration, buildDate: date };
  await expect(prepareAnnual({ ...opts, out: root })).rejects.toThrow(/overlaps/);
  await expect(prepareAnnual({ ...opts, out: join(root, 'data/release/annual') })).rejects.toThrow(
    /owned/,
  );
  const linked = join(temp, 'symlink');
  await symlink(root, linked);
  await expect(
    prepareAnnual({ ...opts, sourceRoot: linked, out: join(temp, 'safe') }),
  ).rejects.toThrow(/Unsafe path/);
  const target = join(temp, 'target');
  await mkdir(target);
  const out = join(temp, 'symlink-out');
  await symlink(target, out);
  await expect(prepareAnnual({ ...opts, out })).rejects.toThrow(/Unsafe path/);
  const hard = join(temp, 'hardlinked');
  await mkdir(join(hard, 'data/inputs'), { recursive: true });
  const original = join(temp, 'original.json');
  await writeFile(original, JSON.stringify(result.forecast));
  await link(original, join(hard, 'data/inputs/budget_forecast_2027.json'));
  await expect(prepareAnnual({ ...opts, out: hard })).rejects.toThrow(/Hardlinked/);
}, 60_000);
