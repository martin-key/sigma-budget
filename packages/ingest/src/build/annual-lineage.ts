import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { decimalSum, type AnnualCell, type AnnualForecast } from './fiscal-annual.js';

export interface SourceDescriptor {
  archive: string;
  member: string;
  archive_sha256?: string | null;
  sha256?: string | null;
  pdf_sha256?: string | null;
  memberSha256?: string | null;
}
export interface Extraction extends AnnualForecast {
  source: SourceDescriptor;
}
export interface BillTable {
  id: string;
  page: number;
  rawCells: (string | null)[][];
}
export interface BillRow {
  text?: string | null;
  name?: string | null;
  id?: string | null;
  no?: string | number | null;
  n?: string | number | null;
  sec?: string | null;
  value?: number | null;
  values?: (number | null)[];
  table?: string | null;
  page?: number | null;
  pages?: number[] | null;
}
export interface BillArticle {
  name: string;
  rows: BillRow[];
  policiesRows: BillRow[];
  commitmentRows: BillRow[];
}
export interface BillExtraction {
  source: SourceDescriptor;
  year: number;
  unit: string;
  tables: BillTable[];
  bill: Record<string, BillArticle>;
  billMc: Record<string, BillArticle>;
  municipal: Record<
    string,
    {
      rows: (BillRow & { name: string; region: string; values: number[] })[];
      pages: number[];
      total: number[];
    }
  >;
  projects: {
    rows: (BillRow & {
      id: string;
      name: string;
      institution: string;
      values: (number | null)[];
    })[];
  };
  articles: Record<string, { text: string; page: number }[]>;
}
export interface DocumentRecord {
  source: 'budget2027';
  archive: string;
  archiveSha256: string;
  member: string;
  memberSha256: string;
  input: string;
}
export type ProvenanceEntry = {
  output: string;
  document: string;
  period: string;
  unit: string;
  [key: string]: unknown;
};
const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const provenanceId = (output: string) => sha(output).slice(0, 24);

/** Read exactly one ZIP member from a pinned archive. Reject ZIP64, encryption,
 * duplicates, unsupported compression and malformed bounds. */
export function zipMember(bytes: Uint8Array, name: string): Buffer {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) {
      end = i;
      break;
    }
  }
  if (end < 0 || b.readUInt16LE(end + 4) !== 0 || b.readUInt16LE(end + 6) !== 0)
    throw new Error('Invalid ZIP directory');
  const count = b.readUInt16LE(end + 10),
    size = b.readUInt32LE(end + 12),
    offset = b.readUInt32LE(end + 16);
  if (count === 0xffff || offset + size !== end || b.readUInt16LE(end + 8) !== count)
    throw new Error('Unsupported ZIP directory');
  let p = offset,
    found: Buffer | undefined;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || b.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const flags = b.readUInt16LE(p + 8),
      method = b.readUInt16LE(p + 10);
    const compressed = b.readUInt32LE(p + 20),
      length = b.readUInt32LE(p + 24);
    const n = b.readUInt16LE(p + 28),
      extra = b.readUInt16LE(p + 30),
      comment = b.readUInt16LE(p + 32),
      local = b.readUInt32LE(p + 42);
    if (p + 46 + n + extra + comment > end) throw new Error('Invalid ZIP entry bounds');
    const entryName = b.subarray(p + 46, p + 46 + n).toString('utf8');
    if (entryName === name) {
      if (
        found ||
        length > 100 * 1024 * 1024 ||
        flags & 1 ||
        ![0, 8].includes(method) ||
        local + 30 > offset ||
        b.readUInt32LE(local) !== 0x04034b50
      )
        throw new Error('Invalid or duplicate ZIP member');
      const localNameLength = b.readUInt16LE(local + 26),
        localExtra = b.readUInt16LE(local + 28);
      const start = local + 30 + localNameLength + localExtra;
      if (
        start + compressed > offset ||
        b.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name ||
        b.readUInt16LE(local + 8) !== method
      )
        throw new Error('Invalid ZIP local header');
      const data = b.subarray(start, start + compressed);
      found =
        method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: length + 1 });
      if (found.length !== length) throw new Error('Invalid ZIP member length');
    }
    p += 46 + n + extra + comment;
  }
  if (p !== end || !found) throw new Error(`ZIP member missing: ${name}`);
  return found;
}
function getDefault<T>(value: T | undefined, fallback: T | undefined): T | undefined {
  return value === undefined ? fallback : value;
}
export function verifyDocument(
  source: SourceDescriptor,
  input: string,
  archive: Uint8Array,
): DocumentRecord {
  const archiveHash = getDefault(source.archive_sha256, source.sha256);
  const memberHash = getDefault(source.pdf_sha256, source.memberSha256);
  if (typeof archiveHash !== 'string' || sha(archive) !== archiveHash)
    throw new Error('Archive checksum mismatch');
  if (typeof memberHash !== 'string' || sha(zipMember(archive, source.member)) !== memberHash)
    throw new Error('PDF member checksum mismatch');
  return {
    source: 'budget2027',
    archive: source.archive,
    archiveSha256: archiveHash,
    member: source.member,
    memberSha256: memberHash,
    input,
  };
}
export function pointer(object: unknown, path: string): any {
  if (!path.startsWith('/')) throw new Error('Invalid pointer');
  let value: any = object;
  for (const part of path.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(part)) throw new Error('Invalid pointer escape');
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error(`Missing pointer ${path}`);
    value = value[key];
  }
  return value;
}
const headers: Record<string, string> = {
  '2026.law': 'програма',
  '2026.expected': 'очаквано',
  '2027.draft': 'проект',
  '2028.forecast': 'прогноза',
  '2029.forecast': 'прогноза',
};
export class AnnualLineage {
  readonly inputs: { F: Extraction; B: BillExtraction };
  readonly documents: { forecast: DocumentRecord; bill: DocumentRecord };
  readonly entries: Record<string, ProvenanceEntry> = {};
  constructor(
    forecast: Extraction,
    bill: BillExtraction,
    archives: { forecast: Uint8Array; bill: Uint8Array },
  ) {
    this.inputs = { F: forecast, B: bill };
    this.documents = {
      forecast: verifyDocument(forecast.source, 'budget_forecast_2027.json', archives.forecast),
      bill: verifyDocument(bill.source, 'budget_bill_2027.json', archives.bill),
    };
  }
  record(output: string, entry: Omit<ProvenanceEntry, 'output'>): string {
    const id = provenanceId(output);
    if (Object.hasOwn(this.entries, id)) throw new Error(`Duplicate provenance: ${output}`);
    this.entries[id] = { output, ...entry } as ProvenanceEntry;
    return id;
  }
  leaf(
    kind: 'F' | 'B',
    extraction: string,
    output: string,
    unit: string,
    period: string,
    location: Record<string, unknown>,
  ): AnnualCell {
    const value = pointer(this.inputs[kind], extraction);
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(`Non-numeric extraction cell: ${kind}${extraction}`);
    const provenance = this.record(output, {
      document: kind === 'F' ? 'forecast' : 'bill',
      extraction,
      period,
      unit,
      ...location,
    });
    return { value, unit, provenance };
  }
  f(
    table: string,
    rowIndex: number,
    columnIndex: number,
    output: string,
    period: string,
  ): AnnualCell {
    const source = this.inputs.F.tables[table],
      row = source?.rows[rowIndex],
      column = source?.columns[columnIndex];
    if (!row || !column || column.year !== Number(period.slice(0, 4)) || !headers[period])
      throw new Error(`Wrong year in ${table} column ${columnIndex}: ${period}`);
    const vintage = table === 'I_2' ? 'прогноза' : headers[period];
    if (
      !(['II_7', 'II_8', 'annex9'].includes(table) && !Object.hasOwn(column, 'vintage')) &&
      column.vintage !== vintage
    )
      throw new Error(`Wrong vintage in ${table} column ${columnIndex}: ${period}`);
    const unit = row.units[columnIndex];
    const expectedUnit =
      table === 'I_2'
        ? rowIndex === 0
          ? 'млн. €'
          : rowIndex >= 11 && rowIndex <= 13
            ? '% от БВП'
            : '%'
        : table === 'annex3_pct_gdp' && rowIndex === 63
          ? 'млн. €'
          : table === 'II_5' && column.unit === '%' && rowIndex >= 20
            ? '% от БВП'
            : table === 'VI_1' && [1, 3, 5].includes(rowIndex)
              ? '% от БВП'
              : column.unit;
    if (typeof unit !== 'string' || !unit || unit !== expectedUnit)
      throw new Error(`Wrong unit in ${table}`);
    if (
      typeof row.page !== 'number' ||
      !Array.isArray(row.printed) ||
      typeof row.printed[columnIndex] !== 'string'
    )
      throw new Error(`Missing physical evidence in ${table}`);
    return this.leaf(
      'F',
      `/tables/${table}/rows/${rowIndex}/values/${columnIndex}`,
      output,
      unit,
      period,
      {
        table,
        row: rowIndex,
        label: row.label,
        column,
        page: row.page,
        printed: row.printed[columnIndex],
      },
    );
  }
  derived(
    output: string,
    period: string,
    operation: 'sum' | 'subtract',
    operands: AnnualCell[],
    unit = 'млн. €',
  ): AnnualCell {
    if (!operands.length || operands.some((x) => !this.entries[x.provenance]))
      throw new Error('Missing provenance operand');
    const value = decimalSum(
      operation === 'sum'
        ? operands.map((x) => x.value)
        : [operands[0]!.value, -operands[1]!.value],
    );
    const provenance = this.record(output, {
      document: this.entries[operands[0]!.provenance]!.document,
      period,
      unit,
      operation,
      operands: operands.map((x) => x.provenance),
    });
    return { value, unit, provenance };
  }
}
