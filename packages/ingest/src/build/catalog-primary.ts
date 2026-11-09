import { monthName } from '../common/format.js';

export interface CatalogFileFact {
  bytes: number;
  sha256?: string;
}
export interface ManifestRecord {
  url: string;
  http_status: number;
  sha256: string;
  bytes: number;
  retrieved: string;
}
export interface PrimaryRecord {
  name: string;
  title: string;
  sha256: string;
  source: string[];
  usedBy: string[];
  role: string;
  [key: string]: unknown;
}
export interface CatalogPrimaryInput {
  manifest: Record<string, ManifestRecord>;
  manifestFiles: readonly (readonly [string, string, readonly string[], readonly string[]])[];
  /** Observed facts for raw paths. No claim that the underlying bytes are present. */
  rawFacts: ReadonlyMap<string, CatalogFileFact>;
  cacheFacts: ReadonlyMap<string, CatalogFileFact>;
  sebraBase: string;
  sebraCache: readonly (readonly [string, string, string])[];
  historicalGva: readonly PrimaryRecord[];
  kfpPage: string;
  execution: { data: Record<string, { files: { file: string; month: number; sha256: string }[] }> };
}
const hash = /^[a-f0-9]{64}$/;
const validSize = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const validHash = (value: unknown): value is string =>
  typeof value === 'string' && hash.test(value);
function validUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const day = value.slice(0, 10),
    parsed = new Date(day + 'T00:00:00Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === day;
}
/** urllib.parse.unquote of the last path component, after stripping the query. */
export function catalogUrlName(url: string): string {
  const path = url.split('?')[0]!.split('/').at(-1)!;
  return path.replace(/(?:%[0-9a-fA-F]{2})+/g, (part) =>
    new TextDecoder().decode(
      Uint8Array.from(part.match(/[0-9a-fA-F]{2}/g)!.map((x) => parseInt(x, 16))),
    ),
  );
}
export function primaryFiles(input: CatalogPrimaryInput): PrimaryRecord[] {
  const out: PrimaryRecord[] = [];
  for (const [key, title, source, usedBy] of input.manifestFiles) {
    const v = input.manifest[key];
    if (
      !v ||
      v.http_status !== 200 ||
      !validHash(v.sha256) ||
      !validSize(v.bytes) ||
      !validUrl(v.url) ||
      !validDate(v.retrieved)
    )
      throw new Error(`Invalid required manifest entry: ${key}`);
    const fact = input.rawFacts.get(key);
    if (fact && fact.bytes !== v.bytes) throw new Error(`Manifest size disagreement: ${key}`);
    out.push({
      name: /^(sebra\/|nap\/|parliament\/52)/.test(key)
        ? catalogUrlName(v.url)
        : key.split('/').at(-1)!,
      title,
      url: v.url,
      sha256: v.sha256,
      bytes: v.bytes,
      retrieved: v.retrieved.slice(0, 10),
      source: [...source],
      usedBy: [...usedBy],
      role: 'source',
    });
  }
  const pdf = input.rawFacts.get('asbp/UMTBF-2026-2028-motivi.pdf');
  if (pdf) {
    if (!validSize(pdf.bytes) || !validHash(pdf.sha256)) throw new Error('Invalid ASBP PDF facts');
    out.push({
      name: 'UMTBF-2026-2028-motivi.pdf',
      title: 'Мотиви към законопроекта: PDF версия (проект от юни 2026 г.)',
      sha256: pdf.sha256,
      bytes: pdf.bytes,
      source: ['asbp'],
      usedBy: ['outlook', 'revenue', 'expenditure', 'measures', 'debt', 'components'],
      role: 'source',
      note: 'Първоначалната версия на мотивите; адресът, от който е изтеглена, не е записан, затова няма връзка. Контролната сума позволява да сравниш своето копие.',
    });
  }
  for (const [name, path, day] of input.sebraCache) {
    const fact = input.cacheFacts.get(name);
    if (!fact) continue;
    if (!validSize(fact.bytes) || !validHash(fact.sha256))
      throw new Error(`Invalid cache facts: ${name}`);
    const url = input.sebraBase + path;
    out.push({
      name: catalogUrlName(url),
      title: `СЕБРА: дневно обобщение на МИДТ за ${day} г.`,
      url,
      sha256: fact.sha256,
      bytes: fact.bytes,
      source: ['sebra'],
      usedBy: ['sebra'],
      role: 'source',
    });
  }
  if (!validUrl(input.kfpPage)) throw new Error('Missing KFP source page');
  for (const year of Object.keys(input.execution.data).sort()) {
    for (const f of input.execution.data[year]!.files) {
      if (!validHash(f.sha256) || !f.file || f.file.includes('/') || !Number.isInteger(f.month))
        throw new Error('Invalid KFP file');
      const fact = input.rawFacts.get(`kfp_${year}/${f.file}`);
      if (fact && !validSize(fact.bytes)) throw new Error('Invalid KFP file size');
      out.push({
        name: f.file,
        title: `КФП: месечен отчет към края на ${monthName(f.month)} ${year} г. (xls)`,
        page: input.kfpPage,
        sha256: f.sha256,
        ...(fact ? { bytes: fact.bytes } : {}),
        source: ['kfp'],
        usedBy: ['execution'],
        role: 'source',
      });
    }
  }
  for (const record of input.historicalGva) {
    if (!validHash(record.sha256)) throw new Error('Invalid historical GVA record');
    out.push(structuredClone(record));
  }
  if (new Set(out.map((row) => row.sha256)).size !== out.length)
    throw new Error('Two primary files share a checksum');
  return out;
}
