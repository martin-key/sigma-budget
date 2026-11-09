import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  AnnualLineage,
  zipMember,
  type BillExtraction,
  type Extraction,
} from '../build/annual-lineage.js';
import { buildAnnualPeriods } from '../build/fiscal-annual.js';
import { buildBudget2027 } from '../build/budget-2027.js';
import { debtProseMatches, pythonDigitPattern } from '../build/budget-prose.js';
import { parsePythonJson, pythonNumberAt, pythonNumericText } from '../common/numbers.js';
import { Check, pyRepr, pyTruth } from './checks.js';
import { Context, safePath } from './context.js';
import { executionRequired } from './execution-python.js';

const periods = ['2026.law', '2026.expected', '2027.draft', '2028.forecast', '2029.forecast'];
const functions = [0, 4, 10, 11, 12, 16, 19, 24, 31];
const revenueParts = [11, 7, 19, 28, 6, 12, 3, 13, 14, 15];

/** Decimal arithmetic uses integer coefficients and never adds a floating-point guard. */
class Decimal {
  constructor(
    readonly coefficient: bigint,
    readonly scale: number,
  ) {}
  static from(value: unknown): Decimal {
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))
      throw pythonError('InvalidOperation', "[<class 'decimal.ConversionSyntax'>]");
    const s = pythonNumericText(String(value));
    const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m) throw pythonError('InvalidOperation', "[<class 'decimal.ConversionSyntax'>]");
    const scale = (m[3]?.length ?? 0) - Number(m[4] ?? 0);
    if (!Number.isSafeInteger(scale) || Math.abs(scale) > 1000) throw new Error('Invalid decimal');
    return new Decimal(BigInt((m[1] ?? '') + m[2] + (m[3] ?? '')), scale);
  }
  add(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(
      this.coefficient * 10n ** BigInt(scale - this.scale) +
        other.coefficient * 10n ** BigInt(scale - other.scale),
      scale,
    );
  }
  neg(): Decimal {
    return new Decimal(-this.coefficient, this.scale);
  }
  equal(other: Decimal): boolean {
    return this.add(other.neg()).coefficient === 0n;
  }
  within(other: Decimal): boolean {
    const a = this.coefficient < 0n ? this.neg() : this;
    const scale = Math.max(a.scale, other.scale);
    return (
      a.coefficient * 10n ** BigInt(scale - a.scale) <=
      other.coefficient * 10n ** BigInt(scale - other.scale)
    );
  }
}
const decimal = (x: unknown) => Decimal.from(x);
const sum = (values: unknown[]) => values.reduce<Decimal>((a, b) => a.add(decimal(b)), decimal(0));
const halfUnits = (n: number) => new Decimal(BigInt(n) * 5n, 2);
function printed(text: unknown): Decimal {
  if (typeof text !== 'string') {
    const type =
      text === null
        ? 'NoneType'
        : Array.isArray(text)
          ? 'list'
          : typeof text === 'object'
            ? 'dict'
            : typeof text === 'boolean'
              ? 'bool'
              : typeof text === 'number'
                ? Number.isInteger(text)
                  ? 'int'
                  : 'float'
                : typeof text;
    throw pythonError('AttributeError', `'${type}' object has no attribute 'strip'`);
  }
  const ws =
    '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const pattern = new RegExp(
    `^[−-]?${ws}*${pythonDigitPattern}(?:${pythonDigitPattern}|${ws})*(?:[,.]${pythonDigitPattern}+)?`,
    'u',
  );
  const match = pattern.exec(text.replace(new RegExp(`^${ws}+|${ws}+$`, 'gu'), ''));
  if (!match) throw pythonError('ValueError', `Not a printed number: ${text}`);
  return decimal(
    pythonNumericText(
      match[0].replace(new RegExp(ws, 'gu'), '').replace('−', '-').replace(',', '.'),
    ),
  );
}
function pythonError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
const indexPattern = new RegExp(`^[+-]?${pythonDigitPattern}+(?:_${pythonDigitPattern}+)*$`, 'u');
const pythonDigit = new RegExp(`^${pythonDigitPattern}$`, 'u');
function indexRepr(key: string): string {
  let result = pyRepr(key);
  for (const char of key) {
    if (/\p{Decimal_Number}/u.test(char) && !pythonDigit.test(char)) {
      const code = char.codePointAt(0)!;
      result = result.replaceAll(
        char,
        code <= 0xffff
          ? `\\u${code.toString(16).padStart(4, '0')}`
          : `\\U${code.toString(16).padStart(8, '0')}`,
      );
    }
  }
  return result;
}
const indexWhitespace =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
function resolveOutput(object: unknown, path: string): any {
  let value: any = object;
  for (const part of path.split('/').slice(1)) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      const integer = key.replace(indexWhitespace, '');
      if (!indexPattern.test(integer))
        throw pythonError(
          'ValueError',
          `invalid literal for int() with base 10: ${indexRepr(key)}`,
        );
      let index = Number(pythonNumericText(integer).replaceAll('_', ''));
      if (index < 0) index += value.length;
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length)
        throw pythonError('IndexError', 'list index out of range');
      value = value[index];
    } else if (value !== null && typeof value === 'object') {
      if (!Object.hasOwn(value, key)) throw pythonError('KeyError', pyRepr(key));
      value = value[key];
    } else
      throw pythonError(
        'TypeError',
        `'${value === null ? 'NoneType' : typeof value}' object is not subscriptable`,
      );
  }
  return value;
}
function splitAddress(address: unknown): [string, string] {
  if (typeof address !== 'string')
    throw pythonError('AttributeError', "'NoneType' object has no attribute 'split'");
  const parts = address.split('#');
  if (parts.length < 2)
    throw pythonError(
      'ValueError',
      `not enough values to unpack (expected 2, got ${parts.length})`,
    );
  if (parts.length > 2) throw pythonError('ValueError', 'too many values to unpack (expected 2)');
  return [parts[0]!, parts[1]!];
}
function outputValue(ctx: Context, entry: any): any {
  const [file, path] = splitAddress(entry.output);
  return resolveOutput(ctx.get(file), path);
}
function leafRecords(entries: Record<string, any>, id: string, ancestors: string[] = []): any[] {
  if (ancestors.includes(id)) throw pythonError('ValueError', `Cyclic provenance operands: ${id}`);
  if (!Object.hasOwn(entries, id)) throw pythonError('KeyError', pyRepr(id));
  const entry = entries[id];
  if (!Object.hasOwn(entry, 'operands')) return [entry];
  if (!Array.isArray(entry.operands)) throw new Error('Invalid provenance operands');
  return entry.operands.flatMap((operand: string) =>
    leafRecords(entries, operand, [...ancestors, id]),
  );
}
function counter(records: any[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const record of records) {
    const d = printed(record.printed);
    // Normalize trailing zeroes while retaining multiplicity.
    let c = d.coefficient,
      scale = c === 0n ? 0 : d.scale;
    while (c !== 0n && c % 10n === 0n) {
      c /= 10n;
      scale--;
    }
    const key = JSON.stringify([record.document, record.page, c.toString(), scale]);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}
export function checkOutputOracles(check: Check, ctx: Context, oracles: any[]): void {
  const index = ctx.get('budget2027-provenance.json');
  for (const oracle of oracles) {
    const address = oracle.output;
    const [filename, path] = splitAddress(address);
    try {
      const cell = resolveOutput(ctx.get(filename), path);
      const entry = index.entries[cell.provenance];
      if (!entry) throw pythonError('KeyError', pyRepr(cell.provenance));
      const leaves = leafRecords(index.entries, cell.provenance);
      check.ok(
        decimal(cell.value).equal(decimal(oracle.value)),
        `${address}: independent PDF value`,
      );
      check.ok(cell.unit === oracle.unit, `${address}: independent PDF unit`);
      check.ok(entry.output === address, `${address}: independent output address`);
      check.ok(entry.period === oracle.period, `${address}: independent period`);
      check.ok(entry.document === oracle.document, `${address}: independent document`);
      check.ok(
        isDeepStrictEqual(
          counter(leaves),
          counter(oracle.sources.map((source: any) => ({ ...source, document: oracle.document }))),
        ),
        `${address}: independent PDF pages and printed operands`,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !['KeyError', 'IndexError', 'TypeError', 'ValueError'].includes(error.name)
      )
        throw error;
      check.fail(
        `${address}: independent PDF oracle cannot resolve: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
export function checkLawIdentities(check: Check, ctx: Context): void {
  const series = resolveOutput(ctx.get('outlook.json'), '/byPeriod/2026.law/series');
  const revenue = decimal(series.revenue.value),
    expenditure = decimal(series.expenditure.value),
    balance = decimal(series.balance.value),
    interest = decimal(series.interest.value),
    primary = decimal(series.primaryBalance.value);
  check.ok(
    revenue.add(expenditure.neg()).add(balance.neg()).within(halfUnits(3)),
    '2026.law: published revenue - expenditure = balance',
  );
  check.ok(
    balance.add(interest).equal(primary),
    '2026.law: published balance + interest = primary balance',
  );
}
function calculated(
  ctx: Context,
  lineage: AnnualLineage,
  documents: any,
  entries: any,
  entry: any,
): Decimal {
  if (entry.operation === 'parse-billion-euro') {
    const value = sourceValue(lineage, documents, entry);
    if (typeof value !== 'string') throw new Error('Invalid debt prose');
    const match = debtProseMatches(value)[0];
    if (!match) throw new Error('Invalid debt prose');
    return decimal(match[1]!.replace(',', '.'));
  }
  if (Object.hasOwn(entry, 'operation')) {
    const values = entry.operands.map((id: string) => {
      if (!Object.hasOwn(entries, id)) throw pythonError('KeyError', pyRepr(id));
      return decimal(outputValue(ctx, entries[id]).value);
    });
    return entry.operation === 'sum'
      ? values.reduce((a: Decimal, b: Decimal) => a.add(b), decimal(0))
      : values[0].add(values[1].neg());
  }
  return decimal(sourceValue(lineage, documents, entry));
}
function sourceValue(lineage: AnnualLineage, documents: any, entry: any): unknown {
  const name = entry.document as 'forecast' | 'bill';
  if (documents[name].input !== lineage.documents[name].input)
    throw pythonError('ValueError', `Wrong extraction input for ${name}`);
  return resolveOutput(lineage.inputs[name === 'forecast' ? 'F' : 'B'], entry.extraction);
}
function checkLineage(check: Check, ctx: Context, lineage: AnnualLineage): void {
  const index = ctx.get('budget2027-provenance.json'),
    documents = index.documents,
    entries = index.entries;
  check.ok(
    isDeepStrictEqual(documents, lineage.documents),
    'provenance: exact documents and checksums',
  );
  check.ok(
    isDeepStrictEqual(entries, lineage.entries),
    'provenance: exact index, physical cells and operand coverage',
  );
  for (const [id, raw] of Object.entries(entries)) {
    const entry = raw as any;
    if (!check.ok(Object.hasOwn(documents, entry.document), `${id}: document reference`)) continue;
    let cell: any;
    try {
      cell = outputValue(ctx, entry);
    } catch {
      check.fail(`${id}: unresolved output pointer`);
      continue;
    }
    check.ok(cell.provenance === id && cell.unit === entry.unit, `${id}: output pointer`);
    check.ok(
      decimal(cell.value).equal(calculated(ctx, lineage, documents, entries, entry)),
      `${id}: extraction/operation value`,
    );
  }
}
function printedIdentity(
  check: Check,
  tables: any,
  table: string,
  column: number,
  total: number,
  parts: number[],
  signs = parts.map(() => 1),
): void {
  const rows = tables[table].rows;
  const values = [total, ...parts].map((row) => decimal(rows[row].values[column]));
  const components = values
    .slice(1)
    .reduce((a, v, i) => a.add(signs[i] === -1 ? v.neg() : v), decimal(0));
  check.ok(
    values[0]!.add(components.neg()).within(halfUnits(values.length)),
    `${table} c${column}: ${total} = [${parts.join(', ')}], Decimal printed intervals`,
  );
}
export function forecastIdentities(check: Check, tables: any): void {
  for (const column of [1, 2, 3, 4]) {
    printedIdentity(check, tables, 'annex3_mln', column, 61, [0, 31], [1, -1]);
    printedIdentity(check, tables, 'annex3_mln', column, 62, [61], [-1]);
    printedIdentity(check, tables, 'annex3_mln', column, 0, revenueParts);
    const values = functions.map((row) => tables.III_1.rows[row].values[column - 1]);
    const total = decimal(tables.annex3_mln.rows[32].values[column]);
    check.ok(
      sum(values).add(total.neg()).within(halfUnits(10)),
      `functions c${column}: sum equals expenditure excluding EU contribution`,
    );
  }
}
export function billIdentities(check: Check, bill: any): void {
  for (const variant of ['bill', 'billMc'])
    for (const [article, raw] of Object.entries(bill[variant])) {
      const item = raw as any,
        h = item.headline;
      if (
        ['rev', 'exp', 'transfers', 'balance'].every((k) => h[k] !== null && h[k] !== undefined)
      ) {
        const transfers = decimal(h.transfers);
        const error = decimal(h.rev)
          .add(decimal(h.exp).neg())
          .add(article === '1' ? transfers.neg() : transfers)
          .add(decimal(pyTruth(h.eucontrib) ? h.eucontrib : 0).neg())
          .add(decimal(h.balance).neg());
        check.ok(error.within(halfUnits(5)), `${variant}/${article}: printed budget balance`);
      }
      if (item.policyTotal != null && h.exp != null)
        check.ok(
          decimal(item.policyTotal).add(decimal(h.exp).neg()).within(halfUnits(2)),
          `${variant}/${article}: policies equal expenditure`,
        );
    }
}
export function municipalIdentities(check: Check, bill: any): void {
  for (const section of ['art52', 'art53']) {
    const { rows, total } = bill.municipal[section];
    const identities = new Set(rows.map((row: any) => JSON.stringify([row.region, row.name])));
    check.ok(rows.length === 265 && identities.size === 265, `${section}: 265 unique identities`);
    total.forEach((value: unknown, column: number) =>
      check.ok(
        sum(rows.map((row: any) => row.values[column]))
          .add(decimal(value).neg())
          .within(halfUnits(rows.length + 1)),
        `${section}: printed column sum ${column}`,
      ),
    );
  }
  for (const row of bill.municipal.art52.rows)
    check.ok(
      decimal(row.values[0])
        .add(sum(row.values.slice(1)).neg())
        .within(halfUnits(5)),
      `${row.name}: transfer parts`,
    );
}
/** Reject float-encoded indices and malformed count metadata before comparisons. */
function assertCountMetadata(value: unknown): void {
  function walk(node: unknown): void {
    if (node === null || typeof node !== 'object') return;
    for (const [key, item] of Object.entries(node)) {
      const required = ['year', 'page', 'rawRow', 'rawColumn'].includes(key);
      if (['row', 'n'].includes(key) && typeof item !== 'string' && typeof item !== 'number')
        throw pythonError('ValueError', `Invalid integer metadata: ${key}`);
      const optionalIndex = ['row', 'n'].includes(key) && typeof item === 'number';
      if (required || optionalIndex) {
        if (
          typeof item !== 'number' ||
          !Number.isSafeInteger(item) ||
          pythonNumberAt(node, key, item).kind !== 'int'
        )
          throw pythonError('ValueError', `Invalid integer metadata: ${key}`);
      }
      if (key === 'pages') {
        const values = Array.isArray(item) ? item : [item];
        for (let i = 0; i < values.length; i++) {
          const v = values[i];
          const holder = Array.isArray(item) ? item : node;
          const field = Array.isArray(item) ? String(i) : key;
          if (
            typeof v !== 'number' ||
            !Number.isSafeInteger(v) ||
            pythonNumberAt(holder, field, v).kind !== 'int'
          )
            throw pythonError('ValueError', 'Invalid integer metadata: pages');
        }
      }
      walk(item);
    }
  }
  walk(value);
}
export function budget2027(ctx: Context): Check {
  const check = new Check('BUDGET2027');
  const read = (path: string) => readFileSync(safePath(ctx.root, path));
  const forecast = parsePythonJson<Extraction>(
    read('data/inputs/budget_forecast_2027.json').toString('utf8'),
  );
  const archive = (extraction: Extraction | BillExtraction): Buffer => {
    const source = executionRequired(extraction, 'source') as Extraction['source'];
    const archivePath = executionRequired(source, 'archive', extraction, 'source');
    const member = executionRequired(source, 'member', extraction, 'source');
    const bytes = read(archivePath);
    const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
    const archiveHash = Object.hasOwn(source, 'archive_sha256')
      ? source.archive_sha256
      : source.sha256;
    if (digest(bytes) !== archiveHash)
      throw pythonError('ValueError', `Archive checksum mismatch: ${source.archive}`);
    if (member !== null && typeof member === 'object')
      throw pythonError(
        'TypeError',
        `unhashable type: '${Array.isArray(member) ? 'list' : 'dict'}'`,
      );
    let memberBytes: Buffer;
    try {
      memberBytes = zipMember(bytes, member);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('ZIP member missing: ')) {
        let label = pyRepr(member);
        if (
          typeof member === 'number' &&
          pythonNumberAt(source, 'member', member).kind === 'float'
        ) {
          if (Object.is(member, -0)) label = '-0.0';
          else if (!Number.isFinite(member))
            label = Number.isNaN(member) ? 'nan' : member < 0 ? '-inf' : 'inf';
          else {
            const magnitude = Math.abs(member);
            label =
              magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16)
                ? member.toExponential()
                : String(member);
            if (label.includes('e'))
              label = label.replace(
                /e([+-]?)(\d+)$/,
                (_, sign: string, digits: string) => 'e' + (sign || '+') + digits.padStart(2, '0'),
              );
            else if (!label.includes('.')) label += '.0';
          }
        }
        throw pythonError(
          'KeyError',
          pyRepr('There is no item named ' + label + ' in the archive'),
        );
      }
      throw error;
    }
    const memberHash = Object.hasOwn(source, 'pdf_sha256')
      ? source.pdf_sha256
      : source.memberSha256;
    if (digest(memberBytes) !== memberHash)
      throw pythonError('ValueError', `PDF member checksum mismatch: ${source.member}`);
    return bytes;
  };
  const forecastArchive = archive(forecast);
  const bill = parsePythonJson<BillExtraction>(
    read('data/inputs/budget_bill_2027.json').toString('utf8'),
  );
  const billArchive = archive(bill);
  const lineage = new AnnualLineage(forecast, bill, {
    forecast: forecastArchive,
    bill: billArchive,
  });
  assertCountMetadata(forecast);
  for (const table of Object.values(forecast.tables)) {
    if (!Array.isArray(table.rows) || !Array.isArray(table.columns))
      throw pythonError('ValueError', 'Invalid forecast table');
    for (const row of table.rows) {
      if (
        typeof row.label !== 'string' ||
        !Array.isArray(row.values) ||
        !Array.isArray(row.units) ||
        !Array.isArray(row.printed)
      )
        throw pythonError('ValueError', 'Invalid forecast row metadata');
      if (
        row.values.some(
          (value) => value !== null && (typeof value !== 'number' || !Number.isFinite(value)),
        ) ||
        row.units.some((unit) => unit !== null && typeof unit !== 'string') ||
        row.printed.some((text) => text !== null && typeof text !== 'string')
      )
        throw pythonError('ValueError', 'Invalid forecast cell metadata');
    }
  }
  const buildExpected = <T>(build: () => T): T => {
    try {
      return build();
    } catch (error) {
      if (
        error instanceof Error &&
        /^(Non-numeric extraction cell:|Wrong year in |Wrong vintage in )/.test(error.message)
      )
        throw pythonError('ValueError', error.message);
      throw error;
    }
  };
  const annual = buildExpected(() => buildAnnualPeriods(forecast, lineage));
  assertCountMetadata(bill);
  for (const section of ['art52', 'art53'] as const)
    for (const row of bill.municipal[section]!.rows)
      if (typeof row.region !== 'string' || typeof row.name !== 'string')
        throw pythonError('ValueError', 'Invalid municipality identity');
  for (const row of bill.projects.rows) {
    if (typeof row.id !== 'string') throw pythonError('ValueError', 'Invalid project identity');
    if (
      typeof row.n !== 'number' ||
      !Number.isSafeInteger(row.n) ||
      pythonNumberAt(row, 'n', row.n).kind !== 'int'
    )
      throw pythonError('ValueError', 'Invalid integer metadata: n');
  }
  const built = buildExpected(() => buildBudget2027(lineage, ctx.buildDate).budget);
  for (const file of [
    'outlook.json',
    'revenue.json',
    'expenditure.json',
    'budget2027.json',
    'budget2027-provenance.json',
  ])
    assertCountMetadata(parsePythonJson(ctx.text(file)));
  for (const [name, records] of Object.entries(annual)) {
    const actual = ctx.get(`${name}.json`).byPeriod;
    if (actual != null && (typeof actual !== 'object' || Array.isArray(actual)))
      throw pythonError('TypeError', 'Invalid byPeriod object');
    if (actual != null && Object.keys(actual).some((period) => !periods.includes(period)))
      throw pythonError('ValueError', 'Unexpected annual period');
    check.ok(actual != null, `${name}: byPeriod required in the current release`);
    for (const period of periods)
      check.ok(
        actual != null && isDeepStrictEqual(actual[period], records[period]),
        `${name} ${period}: exact cells, metadata and sparse coverage`,
      );
  }
  check.ok(
    isDeepStrictEqual(ctx.get('budget2027.json'), built),
    'bill: exact source variants, periods, units and coverage',
  );
  const oracle = JSON.parse(
    read('pipeline/budget_pipeline/validate/fixtures/budget_2027_cells.json').toString('utf8'),
  );
  checkOutputOracles(check, ctx, oracle.cells);
  checkLawIdentities(check, ctx);
  checkLineage(check, ctx, lineage);
  forecastIdentities(check, forecast.tables);
  check.ok(
    isDeepStrictEqual(
      new Set(Object.keys(built.budgets.bill)),
      new Set(Array.from({ length: 48 }, (_, i) => String(i + 1))),
    ),
    '48 articles, including 47 institutional budgets',
  );
  check.ok(
    isDeepStrictEqual(new Set(Object.keys(built.budgets.billMc)), new Set(['1', '2'])),
    'two MC alternatives remain separate',
  );
  check.ok(
    built.projects.length === 226 && new Set(built.projects.map((p: any) => p.id)).size === 226,
    '226 unique projects',
  );
  billIdentities(check, bill);
  municipalIdentities(check, bill);
  return check;
}
