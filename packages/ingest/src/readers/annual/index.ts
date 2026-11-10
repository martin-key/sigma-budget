import { createHash } from 'node:crypto';
import {
  verifyDocument,
  zipMember,
  type SourceDescriptor,
  type Extraction,
} from '../../build/annual-lineage.js';
import { readPdf, assert, type PdfLimits } from '../pdf/index.js';
import { extractForecast } from './forecast.js';
import { extractBill, type Data } from './bill.js';
export { extractForecast, forecastNumber } from './forecast.js';
export { extractBill, billNumber } from './bill.js';
export { serializeAnnual } from './json.js';
export { prepareAnnual, readAnnualRegistration, safePath } from './prepare.js';
export type { AnnualPreparationOptions, AnnualPreparationReceipt } from './prepare.js';
export interface AnnualRegistration {
  id: 'budget2027';
  /** Files read to construct this registration, protected by filesystem preparation. */
  inputPaths?: { registry: string; pins: string };
  archive: string;
  archiveSha256: string;
  acquisition: string;
  acquisitionSha256: string;
  members: { role: 'forecast' | 'bill'; archive: string; member: string; sha256: string }[];
}
export interface AnnualExtractionOptions {
  registration: AnnualRegistration;
  archive: Uint8Array;
  acquisition: Uint8Array;
  buildDate: string;
  limits?: PdfLimits;
}
export interface AnnualExtractions {
  forecast: Extraction & Data;
  bill: ReturnType<typeof extractBill>;
  evidence: Data;
}
export const annualMembers = {
  forecast: 'ZDBRB-2027/4-UMTBF-2027-2029-motivi.pdf',
  bill: 'ZDBRB-2027/3-PZDBRB-2027.pdf',
} as const;
export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
export function validDate(date: string): void {
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date + 'T00:00:00Z')) &&
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date,
    'Invalid build date',
  );
}
/** Decode both actual pinned PDF members. Metadata/pins are caller-supplied
 * committed registration, independently authenticated from acquisition bytes. */
export function extractAnnual2027(options: AnnualExtractionOptions): AnnualExtractions {
  const { registration: r, archive, acquisition, buildDate, limits } = options;
  validDate(buildDate);
  assert(
    r.id === 'budget2027' &&
      /^[\da-f]{64}$/.test(r.archiveSha256) &&
      /^[\da-f]{64}$/.test(r.acquisitionSha256),
    'Invalid annual registration',
  );
  assert(archive.length <= 32 * 1024 * 1024, 'Annual archive byte limit');
  assert(acquisition.length <= 1024 * 1024, 'Acquisition byte limit');
  assert(sha256(archive) === r.archiveSha256, 'Archive checksum mismatch');
  assert(sha256(acquisition) === r.acquisitionSha256, 'Acquisition checksum mismatch');
  const records = JSON.parse(Buffer.from(acquisition).toString('utf8'));
  assert(Array.isArray(records), 'Invalid acquisition record');
  const archives = records.filter((a) => a.file === r.archive.split('/').at(-1));
  assert(archives.length === 1, 'Acquisition archive missing or duplicate');
  const record = archives[0];
  assert(
    record.sha256 === r.archiveSha256 && record.bytes === archive.length,
    'Acquisition archive pin mismatch',
  );
  assert(
    r.members.length === 2 && new Set(r.members.map((m) => m.role)).size === 2,
    'Annual roles missing or duplicate',
  );
  const decoded: Partial<
    Record<'forecast' | 'bill', { source: SourceDescriptor; pdf: Uint8Array }>
  > = {};
  for (const role of ['forecast', 'bill'] as const) {
    const registered = r.members.find((m) => m.role === role);
    assert(
      registered && registered.archive === r.archive && registered.member === annualMembers[role],
      'Wrong annual PDF member',
    );
    const pins = record.members?.filter((m: Data) => m.name === registered.member);
    assert(
      pins?.length === 1 && pins[0].sha256 === registered.sha256,
      'Acquisition member pin mismatch',
    );
    const source: SourceDescriptor =
      role === 'forecast'
        ? {
            archive: r.archive,
            archive_sha256: r.archiveSha256,
            member: registered.member,
            pdf_sha256: registered.sha256,
          }
        : {
            archive: r.archive,
            sha256: r.archiveSha256,
            member: registered.member,
            memberSha256: registered.sha256,
          };
    verifyDocument(source, `budget_${role}_2027.json`, archive);
    const pdf = zipMember(archive, registered.member);
    assert(pdf.length === pins[0].bytes, 'Acquisition member length mismatch');
    decoded[role] = { source, pdf };
  }
  const f = decoded.forecast!,
    b = decoded.bill!;
  function decode<T>(pdf: Uint8Array, extract: (doc: ReturnType<typeof readPdf>) => T) {
    const doc = readPdf(pdf, limits);
    return {
      value: extract(doc),
      sha256: doc.sha256,
      pages: doc.pages.length,
      metadata: doc.metadata,
      engine: doc.engine,
      method: doc.method,
    };
  }
  const forecastDoc = decode(f.pdf, (doc) =>
    extractForecast(doc, { ...f.source, pages: 201 } as SourceDescriptor),
  );
  const billDoc = decode(b.pdf, (doc) =>
    extractBill(doc, { ...b.source, pages: 159 } as SourceDescriptor),
  );
  const forecast = forecastDoc.value as unknown as Extraction & Data,
    bill = billDoc.value;
  return {
    forecast,
    bill,
    evidence: {
      schema: 1,
      buildDate,
      engine: forecastDoc.engine,
      method: forecastDoc.method,
      sourceId: r.id,
      archive: { path: r.archive, sha256: r.archiveSha256, bytes: archive.length },
      acquisition: { path: r.acquisition, sha256: r.acquisitionSha256, bytes: acquisition.length },
      documents: {
        forecast: {
          sha256: forecastDoc.sha256,
          pages: forecastDoc.pages,
          metadata: forecastDoc.metadata,
        },
        bill: { sha256: billDoc.sha256, pages: billDoc.pages, metadata: billDoc.metadata },
      },
      limitations: [
        'Pinned 2027 edition only; embedded text and axis-aligned physical grids, no OCR or universal future-layout support.',
        'Historical originals absent from the supplied snapshot are not reconstructed.',
      ],
    },
  };
}
