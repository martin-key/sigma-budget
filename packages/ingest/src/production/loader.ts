import { scopeAnnualCatalogTraps } from '../build/catalog-editorial.js';
/** Registered, offline production assembly. Every external byte was staged by release-build. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse as yaml } from 'yaml';
import { parsePythonJson } from '../common/numbers.js';
import { parseOrderedPythonJson } from '../validate/ordered-json.js';
import {
  SnapshotReader,
  parseBnbSdmx,
  parseEurostatSnapshot,
  parseGiscoSnapshot,
  parseOblastSnapshot,
  parseParliamentSnapshot,
} from '../readers/snapshots/index.js';
import { parseLegalHtml, parseLegalDocx } from '../readers/documents/index.js';
import {
  extractAsbp,
  asbpFiscalEvidence,
  extractNap,
  readIndirectTaxInput,
  readIndirectEvidence,
  FISCAL_DOCUMENT_PATHS,
  type FiscalOriginal,
  type IndirectOriginals,
} from '../readers/fiscal-documents/index.js';
import {
  extractAnnual2027,
  readAnnualRegistration,
  serializeAnnual,
} from '../readers/annual/index.js';
import { assertFreshAnnual } from '../readers/annual/prepare.js';
import {
  extractPublicationDocuments,
  assertFreshPublication,
  PUBLICATION_PATHS,
} from '../readers/publication-documents/prepare.js';
import { verifyLegacyProgrammeSource } from '../readers/publication-documents/legacy-programme.js';
import { extractProgrammeArchive, programmeZip } from '../readers/publication-documents/archive.js';
import { physicalLawSummary } from './intermediates.js';
import { AnnualLineage } from '../build/annual-lineage.js';
import { prepareExecution, executionAnnualFromPrepared } from '../readers/execution/index.js';
import {
  readWorkbook,
  workbookCellText,
  workbookGrid,
  decodeWorkbook,
  sheetByName,
} from '../readers/workbooks/index.js';
import { executionNumbers } from '../build/context.js';
import { buildOutlook } from '../build/fiscal.js';
import { loadEditorialRoutes } from '../build/editorial.js';
import { pendingFromExecution, zddTable } from '../build/aggregation-core.js';
import { orderedKeysFromJson } from '../build/aggregation-search.js';
import type { Wave13bInput } from '../build/wave13b.js';
import type { ExecutionContext } from '../release-build/types.js';
import type { KfpEvidence } from '../validate/kfp.js';
import type { GazetteBlock, LawKey } from '../build/law-types.js';
import { authored } from './authored.js';

export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const bytesOf = (v: unknown) => Buffer.from(JSON.stringify(v) + '\n');
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export function sameValues(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected)))
    throw new Error('Stale production input: ' + label);
}
export interface PreparedProduction {
  input: Wave13bInput;
  kfp: KfpEvidence;
  originals: Record<string, FiscalOriginal>;
  independentIndirect: ReturnType<typeof readIndirectEvidence>;
  annual: ReturnType<typeof extractAnnual2027>;
  extractions: unknown[];
}
/** Logical-path receipts are independent of random scratch/machine paths. */
export function logicalReceipt(value: any, roots: { root: string; scratch: string }): any {
  if (Array.isArray(value)) return value.map((v) => logicalReceipt(v, roots));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, logicalReceipt(v, roots)]));
  if (typeof value === 'string') {
    for (const [base, prefix] of [
      [roots.root, 'export'],
      [roots.scratch, 'scratch'],
    ])
      if (value === base || value.startsWith(base + '/'))
        return prefix + '/' + relative(base!, value);
  }
  return value;
}
export async function loadProduction(
  context: Readonly<ExecutionContext>,
  programmeSource: 'archive' | 'extracted' = 'archive',
): Promise<PreparedProduction> {
  const root = context.preparedInputRoot ?? context.exportRoot,
    scratch = context.scratchRoot,
    date = context.buildDate;
  const raw = (p: string) => readFileSync(join(root, p));
  const json = (p: string): any => parseOrderedPythonJson(raw(p).toString('utf8'));
  const src = (name: string) => json('data/inputs/' + name + '.json');
  const generate = async (path: string, bytes: Uint8Array) => {
    if (existsSync(join(root, path))) return;
    if (!context.missingIntermediates?.some((i) => i.path === path))
      throw new Error('No registered generator binding: ' + path);
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes, { flag: 'wx' });
  };
  const options = {
    inputRoot: root,
    registryPath: join(root, 'data/sources.yaml'),
    pinsPath: join(root, 'data/originals.sha256'),
    readDate: date,
  };
  const reader = await SnapshotReader.open(options);
  const originals: Record<string, FiscalOriginal> = {};
  const receipts: unknown[] = [];
  const sourceFor: Record<string, string> = {
    asbp: 'asbp',
    nap: 'nap',
    prices: 'ec-oil',
    duties: 'ec-oil',
    gazette: 'excise-law',
    customs: 'customs-excise-law',
    nsi: 'nsi-pack',
    bill: 'bill',
  };
  for (const [role, path] of Object.entries(FISCAL_DOCUMENT_PATHS)) {
    const r = await reader.read(sourceFor[role]!, path);
    originals[role] = { path, bytes: r.data, sha256: r.receipt.sha256 };
    receipts.push(r.receipt);
  }
  const asbp = extractAsbp(originals.asbp!, originals.bill!);
  const fiscalRaw = asbpFiscalEvidence(asbp);
  const tables = asbp.tables as unknown as import('../build/annex.js').AnnexTables &
    Record<string, any>;
  await generate(
    'data/originals/asbp/asbp_tables.json',
    bytesOf({ ...asbp, tables: { ...asbp.tables, IV_text: asbp.municipalText } }),
  );
  await generate(
    'data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
    bytesOf(asbp.pages),
  );
  // Existing originals retain bytes. Fresh physical rows, units and page text are the consumed evidence.
  const oldTables = json('data/originals/asbp/asbp_tables.json');
  for (const [key, t] of Object.entries(asbp.tables)) {
    const old = oldTables.tables[key];
    if (!old) throw new Error('ASBP table registration missing: ' + key);
    sameValues(old.columns, t.columns, 'ASBP ' + key + ' columns');
    sameValues(
      old.rows.map((r: any) => ({
        page: r.page,
        y: r.y,
        x0: r.x0,
        label: r.label,
        values: r.values,
      })),
      t.rows.map((r) => ({ page: r.page, y: r.y, x0: r.x0, label: r.label, values: r.values })),
      'ASBP ' + key + ' rows',
    );
  }
  sameValues(
    oldTables.docx_check.differing_rows,
    asbp.docx_check.differing_rows,
    'ASBP DOCX differences',
  );
  sameValues(
    json('data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json'),
    asbp.pages,
    'ASBP pages',
  );
  const registration = await readAnnualRegistration(options.registryPath, options.pinsPath);
  const archive = raw(registration.archive);
  const annual = extractAnnual2027({
    registration,
    archive,
    acquisition: raw(registration.acquisition),
    buildDate: date,
  });
  // Preserve original scalar kinds/key order after the actual physical reread passes freshness.
  for (const role of ['forecast', 'bill'] as const) {
    await generate(
      'data/inputs/budget_' + role + '_2027.json',
      Buffer.from(serializeAnnual(annual[role])),
    );
    assertFreshAnnual(raw('data/inputs/budget_' + role + '_2027.json'), annual[role], role);
  }
  const forecast = src('budget_forecast_2027'),
    bill = src('budget_bill_2027');
  const billDoc = parseLegalDocx(originals.bill!.bytes);
  const dooPath = 'data/originals/dv/zbdoo2026_dv68_idMat244982.html',
    nzokPath = 'data/originals/dv/zbnzok2026_dv68_idMat244981.html';
  const zdb = await reader.read('zdb', 'data/originals/dv/zdb2026_dv69_idMat245041.html');
  const dooRaw = await reader.read('zbdoo', dooPath),
    nzokRaw = await reader.read('zbnzok', nzokPath);
  receipts.push(zdb.receipt, dooRaw.receipt, nzokRaw.receipt);
  const doo = parseLegalHtml(dooRaw.data.toString('utf8')),
    nzok = parseLegalHtml(nzokRaw.data.toString('utf8'));
  const dvBlocks: Record<LawKey, GazetteBlock[]> = {
    zdb: parseLegalHtml(zdb.data.toString('utf8')),
    zbdoo: doo,
    zbnzok: nzok,
  };
  const dvSummary = physicalLawSummary(dvBlocks);
  await generate('data/originals/dv/dv_laws_2026.json', bytesOf(dvSummary));
  sameValues(json('data/originals/dv/dv_laws_2026.json'), dvSummary, 'physical DV summary');
  const parliament: any = {};
  for (const [key, id] of [
    ['zdb', 167157],
    ['zbdoo', 167156],
    ['zbnzok', 167155],
  ] as const) {
    const p = 'data/originals/parliament/bill_' + id + '.json',
      r = await reader.read('parliament', p);
    parliament[key] = parseParliamentSnapshot(r.data.toString('utf8'), id);
    receipts.push(r.receipt);
  }
  const fiscal = {
    ...fiscalRaw,
    tables,
    functions: existsSync(join(root, 'data/inputs/kfp_functions_2026.json'))
      ? src('kfp_functions_2026').functions
      : undefined,
    cofog: src('cofog_bg'),
    population: src('population'),
    measures: src('measures_2026'),
    excerpts: src('measure_excerpts'),
    forecast,
  };
  // The same actual DOCX must verify the registered historical function intermediate.
  const functionTable = billDoc.tables.filter((t) =>
    isDeepStrictEqual(
      t.rows[0]?.map((c) => c.text),
      ['ПОКАЗАТЕЛИ', 'млн. евро', '% от БВП'],
    ),
  );
  if (functionTable.length !== 1) throw new Error('DOCX III-1 table missing/duplicate');
  const functions: any[] = [];
  for (const row of functionTable[0]!.rows.slice(3)) {
    const cells = row.map((c) => c.text),
      label = cells[0]!.trim();
    if (!label) continue;
    if (cells.length !== 9) throw new Error('DOCX III-1 physical cell count');
    const values = cells.slice(1).map((v) => Number(v.replace(/[\s%]/gu, '').replace(',', '.')));
    if (values.some((v) => !Number.isFinite(v))) throw new Error('DOCX III-1 numeric cell');
    const item = {
      name: label.replace(/^-\s*/, ''),
      mln: values.slice(0, 4),
      pc_gdp: values.slice(4),
    };
    if (label.startsWith('-')) functions.at(-1).parts.push(item);
    else functions.push({ ...item, parts: [] });
  }
  await generate('data/inputs/kfp_functions_2026.json', bytesOf({ functions }));
  fiscal.functions ??= functions;
  sameValues(fiscal.functions, functions, 'DOCX functions');
  const preliminaryOutlook = buildOutlook(fiscal, date);
  const outlookPath = join(scratch, 'outlook-comparison.json');
  await writeFile(outlookPath, bytesOf(preliminaryOutlook), { flag: 'wx' });
  const missingPdfs =
    context.missingIntermediates?.filter(
      (i) => i.declaration === 'data/originals/program_budgets/*',
    ) ?? [];
  if (missingPdfs.length) {
    const r = await reader.read('prb', 'data/originals/parliament/52-602-01-19.zip');
    const extracted = await extractProgrammeArchive(r.data, {
      wasmModule: join(scratch, '7z/7zz.umd.js'),
    });
    const archiveEntries = programmeZip(r.data);
    for (const i of missingPdfs) {
      const pdf = extracted.pdfs.find((p) => 'data/originals/program_budgets/' + p.file === i.path);
      const members = archiveEntries.filter(
        (e) => !e.directory && e.name.split('/').at(-1) === i.path.split('/').at(-1),
      );
      const bytes = pdf?.bytes ?? (members.length === 1 ? members[0]!.read() : undefined);
      if (!bytes || sha256(bytes) !== i.legacyPin)
        throw new Error('Archive member does not equal registered PDF pin: ' + i.path);
      await generate(i.path, bytes);
    }
    receipts.push({ schema: 'generated-programme-members/1', members: extracted.members });
  }
  const publication = await extractPublicationDocuments({
    ...options,
    programmeSource,
    sevenZip: { wasmModule: join(scratch, '7z/7zz.umd.js') },
    outlookPath,
    zdbPath: join(root, 'data/inputs/zdb2026.json'),
  });
  for (const [p, value] of Object.entries(publication.outputs)) {
    if (existsSync(join(root, p))) {
      try {
        assertFreshPublication(raw(p), value, p);
      } catch (e) {
        if (p === PUBLICATION_PATHS.programmes)
          verifyLegacyProgrammeSource(
            json(p),
            publication.outputs[PUBLICATION_PATHS.programmeEvidence],
            publication.programmeLaw,
          );
        else if (
          p === PUBLICATION_PATHS.dbp &&
          sha256(JSON.stringify(canonical(JSON.parse(raw(p).toString('utf8'))))) ===
            'a4b42f7bd2707fff43428c7b07e9d217452164225a4558fa466bcaaeee662e5c' &&
          sha256(JSON.stringify(canonical(value))) ===
            '6601d4c430c1d5854e624dbc4434c124d543e14ce6cd4d33c12c7a275d77b95b'
        )
          receipts.push({
            schema: 'dbp-exact-legacy-metadata/1',
            path: p,
            legacy: 'a4b42f7bd2707fff43428c7b07e9d217452164225a4558fa466bcaaeee662e5c',
            fresh: '6601d4c430c1d5854e624dbc4434c124d543e14ce6cd4d33c12c7a275d77b95b',
            changes: [
              'meta.generated_by',
              'document.file',
              'basis_differences_vs_mock.mock_vs_dbp._source',
            ],
            action: 'verified-existing-bytes',
          });
        else throw e;
      }
    } else {
      if (context.missingIntermediates?.some((i) => i.path === p))
        await generate(p, bytesOf(value));
      else {
        const target = join(scratch, 'generated', p);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytesOf(value), { flag: 'wx' });
      }
    }
  }
  const lawCache =
    publication.programmeLaw! as unknown as import('../build/law-types.js').ParsedLawEvidence & {
      municipal: any;
    };
  const lineage = new AnnualLineage(forecast, bill, { forecast: archive, bill: archive });
  const reports = context.inputs
    .filter((f) => /^data\/originals\/kfp_202[456]\/.*\.xls$/u.test(f.path))
    .map((f) => ({ path: join(root, f.path), sha256: f.sha256 }));
  const executionResult = prepareExecution({
    reports,
    annual: executionAnnualFromPrepared(lineage, tables),
    buildDate: date,
  });
  const execution = executionNumbers(executionResult.execution);
  const kfp: KfpEvidence = { rawPresent: true, reports: {}, filesByYear: {} };
  for (const r of reports) {
    const book = readWorkbook({ ...r, format: 'xls' }),
      sheet = sheetByName(book, 'стартова'),
      filename = r.path.split('/').at(-1)!;
    const reportYear = r.path.match(/kfp_(\d{4})/)![1]!;
    kfp.reports[reportYear + '/' + filename] = {
      filename,
      rawSha256: r.sha256,
      sheet: sheet.name,
      dims: [sheet.rows, sheet.columns],
      cells: workbookGrid(sheet).map((row) =>
        row.map((c) => ({
          type:
            c.type === 'number'
              ? 2
              : c.type === 'text'
                ? 1
                : c.type === 'boolean'
                  ? 4
                  : c.type === 'error'
                    ? 5
                    : 0,
          value: c.value ?? '',
        })),
      ),
    };
    const year = r.path.match(/kfp_(\d{4})/)![1]!;
    (kfp.filesByYear[year] ??= []).push(filename);
  }
  for (const list of Object.values(kfp.filesByYear)) list.sort();
  const nap = extractNap(originals.nap!);
  const indirectOriginals = Object.fromEntries(
    ['prices', 'duties', 'gazette', 'customs', 'nsi', 'bill'].map((k) => [k, originals[k]!]),
  ) as unknown as IndirectOriginals;
  const indirect = readIndirectTaxInput(indirectOriginals),
    independentIndirect = readIndirectEvidence(indirectOriginals);
  await generate('data/inputs/indirect_tax_evidence.json', bytesOf(independentIndirect));
  sameValues(src('indirect_tax_evidence'), independentIndirect, 'indirect evidence');
  const annualStat = await reader.read(
      'eurostat',
      'data/originals/eurostat/gov_10dd_edpt1_BG_EU.json',
    ),
    quarter = await reader.read('eurostat', 'data/originals/eurostat/gov_10q_ggdebt_BG.json'),
    pop = await reader.read('eurostat', 'data/originals/eurostat/tps00001_BG.json');
  const gg = await reader.read('bnb', 'data/originals/bnb_sdmx/ggd.xml'),
    cg = await reader.read('bnb', 'data/originals/bnb_sdmx/cgd.xml');
  receipts.push(annualStat.receipt, quarter.receipt, pop.receipt, gg.receipt, cg.receipt);
  const annualJson = json('data/originals/eurostat/gov_10dd_edpt1_BG_EU.json');
  const gis = parseGiscoSnapshot(raw('data/cache/gisco_lau_bg.json').toString('utf8')),
    oblast = parseOblastSnapshot(raw('data/cache/eurostat_pop_nuts3_bg.json').toString('utf8'));
  const sebra = await readSebra(root, reader, receipts);
  const aggregate = {
    ...authored.aggregation,
    pending: pendingFromExecution(authored.aggregation.pending, execution),
  };
  const cat = authored.catalog;
  const manifest = json('data/originals/MANIFEST.json');
  const facts = async (base: string) =>
    new Map(
      await Promise.all(
        (await walk(join(root, base))).map(async (p) => {
          const b = await readFile(join(root, base, p));
          return [p, { bytes: b.length, sha256: sha256(b) }] as const;
        }),
      ),
    );
  const gvaPath = 'packages/ingest/src/production/historical/gva-sectors.json',
    gvaBytes = raw(gvaPath);
  if (sha256(gvaBytes) !== 'f1d96acd63f3db527e696194d23bd142f774168259aeb4dd6868ce1a23a447a2')
    throw new Error('Historical GVA material changed');
  const routes = json('apps/web/app/lib/routes.json'),
    registry = yaml(raw('data/datasets.yaml').toString('utf8'));
  const executionBytes = bytesOf(executionResult.execution),
    provenanceBytes = bytesOf(executionResult.provenance);
  const input: Wave13bInput = {
    fiscal: {
      fiscal,
      forecast,
      bill,
      archives: { forecast: archive, bill: archive },
      law: {
        law: lawCache,
        ministries: null,
        parliament,
        dvBlocks,
        archiveBytes: context.inputs.find(
          (f) => f.path === 'data/originals/parliament/52-602-01-19.zip',
        )?.bytes,
      },
      buildDate: date,
    },
    programmes: {
      source: (existsSync(join(root, PUBLICATION_PATHS.programmes))
        ? json(PUBLICATION_PATHS.programmes)
        : publication.outputs[PUBLICATION_PATHS.programmes]) as any,
      law: lawCache,
      pdfs: publication.outputs[PUBLICATION_PATHS.programmeEvidence] as any,
    },
    debt: {
      table: tables.VI_1 as any,
      gdp: fiscal.annex.gdp as number[],
      pages: asbp.pages,
      paragraphs: dvBlocks.zdb.filter((b) => b[0] === 'p').map((b) => b[1]) as string[],
      stock: src('debt_stock'),
      gdpCopy: src('debt_gdp'),
      annual: parseEurostatSnapshot(annualStat.data.toString('utf8')) as any,
      quarterly: parseEurostatSnapshot(quarter.data.toString('utf8')) as any,
      bnbGg: parseBnbSdmx(gg.data.toString('utf8'), 'GGALN_G01_XDC'),
      bnbCg: parseBnbSdmx(cg.data.toString('utf8'), 'GCALN_G01_AC_XDC'),
      revisions: authored.revisions,
    },
    rates: { doo, nzok, bill: billDoc.blocks, nap: nap.rows },
    indirectTaxes: indirect.input,
    municipalities: {
      art: lawCache.municipal.art51,
      proto: src('municipal_transfers_2026'),
      gis,
      oblast,
      population: fiscal.population,
    },
    geometryOptions: { preserveHistoricalChirpan: true },
    components: {
      doo,
      nzok,
      tables: { ...tables, IV_text: asbp.municipalText } as any,
      pages: asbp.pages,
      summary: src('kfp_components_2026'),
    },
    sebra,
    editorial: {
      snapshots: {
        'guide.json': raw('data/inputs/editorial/guide.json'),
        'glossary.json': raw('data/inputs/editorial/glossary.json'),
      },
      routes: loadEditorialRoutes(routes),
    },
    plan: {
      figures: publication.outputs[PUBLICATION_PATHS.dbp] as any,
      editorial: authored.plan,
      pdfSha256: context.inputs.find((f) =>
        f.path.endsWith('/Draft_Budgetary_Plan_of_the_Republic_of_Bulgaria_for_2027.pdf'),
      )!.sha256,
    },
    frozen: {
      execution: executionResult.execution,
      executionProvenance: executionResult.provenance,
      gva: parsePythonJson(gvaBytes.toString('utf8')),
      bytes: {
        'execution.json': executionBytes,
        'execution-provenance.json': provenanceBytes,
        'gva-sectors.json': gvaBytes,
      },
    },
    core: {
      law: lawCache,
      budgetCount: aggregate.budgetCount,
      sources: aggregate.sources,
      pending: aggregate.pending,
      population: fiscal.population,
      populationAsOf: aggregate.populationAsOf,
      zdd: zddTable(tables.VI_1!.rows as any),
      gisco: gis,
      glossaryInput: src('glossary'),
    },
    feed: {
      annualUpdated: annualJson.updated,
      quarterUpdated: json('data/originals/eurostat/gov_10q_ggdebt_BG.json').updated,
      cofogUpdated: fiscal.cofog.updated,
      population: fiscal.population,
      populationStat: parseEurostatSnapshot(pop.data.toString('utf8')),
      populationAsOf: aggregate.populationAsOf,
      pending: aggregate.pending,
    },
    search: {
      authored: aggregate,
      billOrder: orderedKeysFromJson(raw('data/inputs/budget_bill_2027.json').toString('utf8'), [
        'bill',
      ]),
    },
    catalog: {
      definitions: aggregate.catalogDefinitions,
      groups: aggregate.catalogGroups,
      pending: aggregate.pending,
      primary: {
        manifest,
        manifestFiles: cat.manifestFiles,
        rawFacts: await facts('data/originals'),
        cacheFacts: await facts('data/cache'),
        sebraBase: cat.sebraBase,
        sebraCache: cat.sebraCache,
        historicalGva: cat.historicalGva,
        kfpPage: cat.kfpPage,
        execution,
      },
      editorial: {
        traps: scopeAnnualCatalogTraps(cat.traps),
        methodology: cat.methodology,
        execution,
        manifest,
        eur: cat.eur,
      },
    },
    layers: {
      wording: src('wording'),
      sourceGlue: aggregate.sourceGlue,
      registry: registry.datasets,
      activeRoutes: routes.routes.map((r: any) => r[0]),
    },
  };
  return {
    input,
    kfp,
    originals,
    independentIndirect,
    annual,
    extractions: logicalReceipt(
      [
        {
          schema: 'production-sources/1',
          inputs: receipts,
          annual: annual.evidence,
          publication: {
            inputs: publication.receipts,
            archiveMembers: publication.archiveMembers,
            programme2027: publication.programme2027,
          },
          execution: executionResult.evidence,
          historical: [
            {
              path: gvaPath,
              sha256: sha256(gvaBytes),
              action: 'preserved-input',
              originals: 'unverified',
            },
            ...asbp.evidenceNotes,
          ],
        },
      ],
      { root, scratch },
    ),
  };
}
export async function walk(root: string, prefix = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const result: string[] = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) throw new Error('Symlink in production input');
    const p = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) result.push(...(await walk(root, p)));
    else if (e.isFile()) result.push(p);
    else throw new Error('Special production input');
  }
  return result.sort();
}
export function decodeKfp(bytes: Uint8Array) {
  const book = decodeWorkbook(bytes, { format: 'xls', sha256: sha256(bytes) }),
    sheet = sheetByName(book, 'стартова');
  return {
    sheet: sheet.name,
    rows: sheet.rows,
    columns: sheet.columns,
    title: String(sheet.cells.A3?.value ?? ''),
    unitText: String(sheet.cells.D4?.value ?? ''),
  };
}
async function readSebra(root: string, reader: SnapshotReader, receipts: unknown[]) {
  const page = await reader.read('midt-sebra', 'data/originals/sebra/midt_sebra_2026_page.html');
  receipts.push(page.receipt);
  // htmlparser2 is already the authenticated HTML transport; entity decoding preserves the listing text.
  const { Parser } = await import('htmlparser2');
  let text = '',
    ignored = 0;
  new Parser(
    {
      onopentag(n) {
        if (n === 'script' || n === 'style') ignored++;
      },
      onclosetag(n) {
        if (n === 'script' || n === 'style') ignored--;
      },
      ontext(t) {
        if (!ignored) text += ' ' + t;
      },
    },
    { decodeEntities: true },
  ).end(page.data.toString('utf8'));
  text = text.replace(/\s+/gu, ' ');
  const heads = [
      ...text.matchAll(
        /Документи за (\S+ \d{4}) г\. Публикувани на (\d\d\.\d\d\.\d{4}) Файлове \((\d+)\)/gu,
      ),
    ],
    i = heads.findIndex((m) => m[1] === 'август 2026'),
    h = heads[i];
  if (!h) throw new Error('SEBRA month section missing');
  const section = text.slice(h.index! + h[0].length, heads[i + 1]?.index ?? text.length),
    iso = (s: string) => s.split('.').reverse().join('-');
  const files = [
    ...section.matchAll(
      /Име на файла (\d+) (\S+) (\d{4}) г\. Дата (\d\d\.\d\d\.\d{4}) Размер ([\d.]+) KB Формат (\w+)/gu,
    ),
  ]
    .map((m) => {
      if (m[2] !== 'август') throw new Error('SEBRA month mismatch');
      return {
        label: `${m[1]} ${m[2]} ${m[3]} г.`,
        day: `${m[3]}-08-${m[1]!.padStart(2, '0')}`,
        listedOn: iso(m[4]!),
        sizeKb: Number(m[5]),
        format: m[6]!,
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  if (files.length !== 3 || Number(h[3]) !== 3) throw new Error('SEBRA listing count');
  const payments: Record<string, { bytes: number; rows: Record<string, string>[] }> = {};
  for (const f of files) {
    const p =
      f.day === '2026-08-31'
        ? 'data/originals/sebra/midt_sebra_31.08.2026.xlsx'
        : `data/cache/sebra_${f.day.slice(8)}.08.2026.xlsx`;
    const bytes = await readFile(join(root, p)),
      book = decodeWorkbook(bytes, { format: 'xlsx', sha256: sha256(bytes) }),
      sheet = book.sheets[book.sheetNames[0]!]!;
    const rows = workbookGrid(sheet)
      .map((row) =>
        Object.fromEntries(
          row
            .filter((c) => c.value !== null && c.type !== 'blank' && c.type !== 'missing')
            .map((c) => [c.address.replace(/\d+$/, ''), workbookCellText(c)!]),
        ),
      )
      .filter((row) => Object.keys(row).length);
    payments[f.day] = { bytes: bytes.length, rows };
  }
  return {
    listing: {
      section: 'Документи за август 2026 г.',
      sectionPublished: iso(h[2]!),
      page: 'https://midt.gov.bg/bg/transparency/sebra/2026',
      retrieved: '2026-10-01',
      files,
    },
    files: payments,
    latest: '2026-08-31',
    latestExpected: { count: 28, eur: 171854.85 },
  };
}
