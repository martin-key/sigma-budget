/** Raw CONTRACT rules. Never feed this validator Context.get('execution.json'). */
import { existsSync, readFileSync } from 'node:fs';
import { zipMember } from '../build/annual-lineage.js';
import { Check, isnum, pyRepr } from './checks.js';
import { Context, safePath, strictJson } from './context.js';
import { CONTRACT } from './execution-contract.js';
import { originalPins, sha256, type OriginalBytes } from './indirect-rules.js';
import { equal, keys, sameSet, text, values, type Doc } from './rule-support.js';
import type { Group } from './runner.js';

const cols = ['kfp', 'nat', 'eu'];
const blocks = ['data', 'monthly', 'plan2026', 'latest', 'pace', 'reconcile'];
const lawRows: Record<string, number> = {
  rev: 0,
  'rev.tax': 1,
  'rev.nontax': 6,
  'rev.grants': 7,
  'exp.total': 8,
  'exp.interest': 14,
  eucontrib: 15,
  'exp.capex': 11,
  'exp.abroad': 12,
  'exp.contingency': 13,
  balance: 17,
};
const lawTable = 'annex1_execution2026';
const provenanceRules = {
  data: 'the cell of the original of the month; 2024 and 2025: млн. лв. ÷ 1.95583, rounded to 3 places (contract.conversion)',
  monthly: 'data(m) − data(m − 1) of the same year, column and row; January = data(1)',
  latest:
    'cum and prevYearCum: data of the latest month of this and the previous year, rounded to 1 place; plan: plan2026',
  pace: 'data(m) ÷ data(12) of the same year × 100',
  reconcile:
    'data(12) of 2024 and 2025 against the columns 2024 Отчет and 2025 Предв. отчет of Приложение 3',
};
/** Physical PDF table evidence. All page/printed/label/unit facts come from the
 * decoder, never from execution-provenance.json or the execution producer. */
export interface ExecutionLawTable {
  columns: { scope: string; unit: string; vintage: string; year: number }[];
  rows: { label: string; page: number; units: string[]; printed: string[]; values: number[] }[];
}
export type ExecutionLawReader = (
  pdf: OriginalBytes & { archive: string; archiveSha256: string; member: string },
) => ExecutionLawTable;

function raw(ctx: Context, name: string): Doc {
  return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(ctx.bytes(name))) as Doc;
}
function moneyOk(c: Check, v: unknown, places: number, where: string): void {
  if (v === null) return;
  const match = typeof v === 'string' ? new RegExp(`^-?[0-9]+\\.[0-9]{${places}}$`).exec(v) : null;
  c.ok(
    match !== null && match[0].length === (v as string).length && !/^-0\.0+$/.test(v as string),
    `${where}: ${pyRepr(v)} is not a decimal string with ${places} places`,
  );
}

/** Independently resolve the pinned Annex 1 law locators. This does not call
 * law_plan(), a TS builder, or use released provenance as expected evidence. */
function expectedPlan(ctx: Context, c: Check, reader?: ExecutionLawReader): Doc {
  const pins = originalPins(ctx),
    rel = 'data/inputs/budget_forecast_2027.json';
  const inputBytes = readFileSync(safePath(ctx.root, rel));
  if (sha256(inputBytes) !== pins.get(rel))
    throw new Error('pinned forecast extraction checksum mismatch');
  const input = strictJson(inputBytes.toString('utf8')) as Doc,
    source = input.source;
  const archiveBytes = readFileSync(safePath(ctx.root, source.archive));
  if (
    sha256(archiveBytes) !== pins.get(source.archive) ||
    sha256(archiveBytes) !== source.archive_sha256
  )
    throw new Error('pinned forecast archive checksum mismatch');
  const pdf = zipMember(archiveBytes, source.member);
  if (sha256(pdf) !== source.pdf_sha256)
    throw new Error('pinned forecast PDF member checksum mismatch');
  let table: ExecutionLawTable = input.tables[lawTable];
  if (reader) {
    table = reader({
      path: source.member,
      sha256: source.pdf_sha256,
      bytes: pdf,
      archive: source.archive,
      archiveSha256: source.archive_sha256,
      member: source.member,
    });
    c.ok(
      equal(table, input.tables[lawTable]),
      'independent Annex 1 law table differs from pinned extraction',
    );
    c.fact('independent Annex 1 PDF reader ran on the pinned archive member');
  } else
    c.fact(
      'Annex 1 PDF reader not bound: locators checked against pinned extraction and authenticated archive/member bytes; no PDF re-extraction claimed',
    );
  const column = table.columns[0];
  if (column?.year !== 2026 || column.vintage !== 'програма' || column.unit !== 'млн. €')
    throw new Error('wrong Annex 1 law year / vintage / unit');
  const cells: Doc = {};
  for (const [rid, index] of Object.entries(lawRows)) {
    const row = table.rows[index];
    if (
      !row ||
      !isnum(row.values[0]) ||
      !Number.isInteger(row.page) ||
      row.page < 1 ||
      !text(row.label) ||
      !text(row.printed[0]) ||
      row.units[0] !== 'млн. €'
    )
      throw new Error('invalid Annex 1 source cell ' + rid);
    cells[rid] = {
      output: 'execution.json#/plan2026/kfp/' + rid,
      document: 'forecast',
      extraction: `/tables/${lawTable}/rows/${index}/values/0`,
      period: '2026.law',
      unit: row.units[0],
      table: lawTable,
      row: row.label,
      label: row.label,
      column,
      page: row.page,
      printed: row.printed[0],
      rowIndex: index,
    };
  }
  cells.exp = {
    operation: 'subtract',
    operands: ['exp.total', 'eucontrib'],
    cells: [cells['exp.total'], cells.eucontrib],
  };
  cells.fin = {
    operation: 'negate',
    basis: 'balancing-operation',
    operands: ['balance'],
    cells: [cells.balance],
  };
  const reason =
    'Приложение 1 не дава национална/европейска разбивка на закона; колони 2/3 са отчет.';
  return {
    kfp: {
      source: 'budget2027',
      archive: source.archive,
      archiveSha256: source.archive_sha256,
      member: source.member,
      memberSha256: source.pdf_sha256,
      input: 'budget_forecast_2027.json',
      sha256: source.pdf_sha256,
      periodKey: '2026.law',
      basis: 'adopted-law',
      table: lawTable,
      column,
      rows: cells,
    },
    nat: { rows: {}, reason },
    eu: { rows: {}, reason },
  };
}

export function executionIntegrity(ctx: Context, reader?: ExecutionLawReader): Check {
  const c = new Check('CONTRACT');
  let ex: Doc;
  try {
    ex = raw(ctx, 'execution.json');
  } catch (error) {
    c.fail(
      'cannot read raw execution contract: ' +
        (error instanceof Error ? error.message : String(error)),
    );
    return c;
  }
  const k = ex.contract ?? {};
  if (
    !c.ok(
      k.schema === CONTRACT.schema,
      `execution.json: contract.schema is ${pyRepr(k.schema)}, expected ${CONTRACT.schema}`,
    )
  )
    return c;
  c.ok(ex.meta.schema === 'execution/2', 'execution.json: meta.schema must be execution/2');
  const m = k.money ?? {};
  c.ok(
    m.encoding === 'decimal-string' &&
      m.currency === 'EUR' &&
      m.unit === ex.meta.unit &&
      m.scale === 1000000,
    'contract.money: encoding, currency, unit (as meta.unit) and scale',
  );
  c.ok(
    equal(m.places, CONTRACT.money.places),
    'contract.money.places must be ' + pyRepr(CONTRACT.money.places),
  );
  c.ok(sameSet(keys(k.scope ?? {}), cols), 'contract.scope must describe ' + cols.join(', '));
  c.ok(k.accountingBasis === 'cash', 'contract.accountingBasis must be cash (the КФП reports)');
  const contractBlocks = k.blocks ?? {};
  c.ok(
    sameSet(keys(contractBlocks), blocks),
    'contract.blocks: ' + pyRepr(keys(contractBlocks).sort()),
  );
  for (const [name, b] of Object.entries(contractBlocks) as [string, Doc][])
    c.ok(
      ['real', 'mock', 'pending'].includes(b.evidence) &&
        ['draft', 'law', 'report', 'forecast'].includes(b.budget) &&
        ['observed', 'derived', 'estimate'].includes(b.value),
      `contract.blocks.${name}: evidence/budget/value ${pyRepr(b.evidence)}/${pyRepr(b.budget)}/${pyRepr(b.value)}`,
    );
  c.ok(
    contractBlocks.plan2026?.budget === 'law',
    'the plan is the adopted law (budget status law)',
  );
  c.ok(
    contractBlocks.monthly?.value === 'derived',
    'the monthly values are derived from the cumulative ones',
  );
  let n = 0;
  for (const name of ['data', 'monthly'] as const)
    for (const [y, block] of Object.entries(ex[name]) as [string, Doc][])
      for (const col of cols)
        for (const [rid, arr] of Object.entries(block[col]) as [string, unknown[]][])
          arr.forEach((v, i) => {
            moneyOk(c, v, CONTRACT.money.places[name], `${name}.${y}.${col}.${rid}[${i}]`);
            n++;
          });
  for (const col of cols) {
    for (const [rid, v] of Object.entries(ex.plan2026[col])) {
      moneyOk(c, v, CONTRACT.money.places.plan2026, `plan2026.${col}.${rid}`);
      n++;
    }
    for (const [rid, d] of Object.entries(ex.latest[col]) as [string, Doc][]) {
      for (const key of ['cum', 'plan', 'prevYearCum'])
        if (key in d) {
          moneyOk(c, d[key], CONTRACT.money.places.latest, `latest.${col}.${rid}.${key}`);
          n++;
        }
      for (const key of ['pctPlan', 'yoyPct'])
        if (key in d)
          c.ok(isnum(d[key]), `latest.${col}.${rid}.${key}: a percentage stays a number`);
    }
  }
  for (const [key, rec] of Object.entries(ex.reconcile) as [string, Doc][])
    if (key.startsWith('dec'))
      for (const [rid, d] of Object.entries(rec) as [string, Doc][])
        for (const field of ['kfp', 'annex3', 'diff'] as const) {
          moneyOk(
            c,
            d[field],
            CONTRACT.money.places[`reconcile.${field}`],
            `reconcile.${key}.${rid}.${field}`,
          );
          n++;
        }
  for (const [y, rows] of Object.entries(ex.pace) as [string, Doc][])
    c.ok(
      values(rows).every((arr) => Array.isArray(arr) && arr.every(isnum)),
      `pace.${y}: percentages stay numbers`,
    );
  const pname = k.provenance;
  if (
    !c.ok(
      typeof pname === 'string' && !!pname && ctx.exists(pname),
      `contract.provenance names a file of data/release: ${pyRepr(pname)}`,
    )
  )
    return c;
  const p = raw(ctx, pname);
  c.ok(
    p.schema === 'provenance/1' && p.dataset === 'execution',
    `${pname}: schema provenance/1 for execution`,
  );
  const files: Doc = {};
  for (const [y, block] of Object.entries(ex.data) as [string, Doc][])
    for (const f of block.files) files[`${y}-${String(f.month).padStart(2, '0')}`] = f;
  const orig = p.originals ?? {};
  c.ok(
    sameSet(keys(orig), keys(files)),
    `${pname}: originals ${keys(orig).length}, reports in execution.json ${keys(files).length}`,
  );
  for (const [key, f] of Object.entries(files) as [string, Doc][]) {
    const o = orig[key] ?? {};
    c.ok(
      o.file === f.file && o.sha256 === f.sha256 && o.source === 'kfp',
      `${pname}: original ${key} must be ${f.file} with the sha256 of execution.json`,
    );
  }
  c.ok(
    sameSet(keys(p.columns ?? {}), cols) &&
      values(p.columns).every((v) => typeof v === 'string' && /^[A-Z]$/.test(v)),
    `${pname}: a column letter for every column`,
  );
  const rids = ex.rows.map((r: Doc) => r.id),
    computed = keys(p.computed ?? {}),
    rows = p.rows ?? {};
  c.ok(
    sameSet([...keys(rows), ...computed], rids) && !computed.some((k) => k in rows),
    `${pname}: every row has a cell row or a rule, not both`,
  );
  c.ok(
    values(rows).every((v) => Number.isInteger(v) && v > 0),
    `${pname}: rows are Excel row numbers`,
  );
  for (const rid of computed)
    c.ok(
      (p.computed[rid].from ?? []).every((id: string) => id in rows),
      `${pname}: computed ${rid} is made from rows with cells`,
    );
  const plan = p.plan2026 ?? {};
  for (const col of cols)
    c.ok(
      sameSet(keys(plan[col]?.rows ?? {}), keys(ex.plan2026[col])),
      `${pname}: a locator for every plan2026.${col} item`,
    );
  const kfpPlan = plan.kfp ?? {};
  c.ok(
    kfpPlan.source === 'budget2027' &&
      typeof kfpPlan.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(kfpPlan.sha256),
    `${pname}: plan2026.kfp points to the forecast_tables PDF by sha256`,
  );
  try {
    c.ok(
      equal(plan, expectedPlan(ctx, c, reader)),
      'plan provenance must match pinned annex1 law cells and operations',
    );
  } catch (error) {
    c.fail(
      'cannot independently verify plan provenance: ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  for (const [rid, loc] of Object.entries(kfpPlan.rows ?? {}) as [string, Doc][])
    c.ok(
      (loc.cells ?? [loc]).every((x: Doc) => Number.isInteger(x.page) && x.row),
      `${pname}: plan2026.kfp.${rid} needs a page and a row`,
    );
  c.fact(
    `${n} money values as decimal strings; ${keys(orig).length} originals; ${keys(rows).length} rows with a cell, ${computed.length} computed; ${cols.reduce((n, col) => n + keys(plan[col]?.rows ?? {}).length, 0)} plan items with a locator`,
  );
  integrityCoverage(ctx, c, ex, p, files);
  return c;
}

/** Additional omission/provenance checks close false-PASS gaps in the donor.
 * Numeric agreement with XLS cells remains the independent KFP group's job. */
function integrityCoverage(ctx: Context, c: Check, ex: Doc, p: Doc, files: Doc): void {
  const rids = ex.rows.map((r: Doc) => r.id);
  c.ok(
    rids.length > 0 && new Set(rids).size === rids.length,
    'execution rows are nonempty and unique',
  );
  c.ok(ex.meta.unit === CONTRACT.money.unit, 'execution money unit is the canonical EUR unit');
  c.ok(sameSet(keys(ex.data), keys(ex.monthly)), 'data and monthly cover the same years');
  for (const [year, block] of Object.entries(ex.data) as [string, Doc][]) {
    c.ok(
      Number.isInteger(block.months) && block.months > 0 && block.months <= 12,
      `${year}: reported month count`,
    );
    c.ok(
      equal(
        block.files.map((f: Doc) => f.month),
        Array.from({ length: block.months }, (_, i) => i + 1),
      ),
      `${year}: one original for every reported month`,
    );
    for (const name of ['data', 'monthly'])
      for (const col of cols) {
        const moneyRows = ex[name][year]?.[col] ?? {};
        c.ok(
          sameSet(keys(moneyRows), name === 'monthly' ? ['rev', 'exp.total', 'balance'] : rids),
          `${name}.${year}.${col}: every execution row is present`,
        );
        c.ok(
          values(moneyRows).every((arr) => Array.isArray(arr) && arr.length === block.months),
          `${name}.${year}.${col}: every row covers every reported month`,
        );
      }
  }
  for (const r of ex.rows) {
    if (r.computed)
      c.ok(
        p.computed?.[r.id]?.rule ===
          'exp + eucontrib of the same report, added on the original numbers, then converted' &&
          equal(p.computed[r.id].from, ['exp', 'eucontrib']) &&
          r.computed === 'exp+eucontrib',
        `${r.id}: complete computed-cell rule`,
      );
    else c.ok(p.rows?.[r.id] === r.row, `${r.id}: provenance cell row matches execution row`);
  }
  c.ok(
    equal(p.columns, { kfp: 'B', nat: 'C', eu: 'D' }) && p.sheet === 'стартова',
    'provenance worksheet and column locators',
  );
  c.ok(equal(p.rules, provenanceRules), 'every derived block has its canonical provenance rule');
  let pins: Map<string, string>;
  try {
    pins = originalPins(ctx);
  } catch (error) {
    c.fail(
      'cannot verify execution original pins: ' +
        (error instanceof Error ? error.message : String(error)),
    );
    return;
  }
  const unavailable: string[] = [];
  for (const [key, f] of Object.entries(files) as [string, Doc][]) {
    const year = key.slice(0, 4),
      rel = `data/originals/kfp_${year}/${f.file}`;
    const o = p.originals?.[key] ?? {};
    c.ok(
      typeof f.sha256 === 'string' && /^[a-f0-9]{64}$/.test(f.sha256) && pins.get(rel) === f.sha256,
      `${key}: original hash agrees with pinned inventory`,
    );
    c.ok(
      o.unit === (Number(year) < 2026 ? 'BGN' : 'EUR') &&
        o.asOf ===
          `${key}-${new Date(Date.UTC(Number(year), Number(key.slice(5)), 0)).getUTCDate()}`,
      `${key}: original currency and reporting date`,
    );
    const absolute = safePath(ctx.root, rel);
    if (existsSync(absolute))
      c.ok(
        sha256(readFileSync(absolute)) === f.sha256,
        `${key}: original bytes agree with pinned hash`,
      );
    else unavailable.push(rel);
  }
  if (unavailable.length)
    c.fact('execution originals unavailable (no re-read claimed): ' + unavailable.join(', '));
}
export function executionIntegrityGroup(reader?: ExecutionLawReader): Group<Context> {
  return {
    name: 'CONTRACT',
    description: 'Raw decimal-string execution contract and complete source/cell provenance',
    run: (ctx) => executionIntegrity(ctx, reader),
  };
}
