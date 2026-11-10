import { SnapshotReader, utf8, type ReadResult } from './pinned.js';
import { parseBnbDocument, type BnbDocument, type BnbSeries } from './sdmx.js';
import { parseEurostatSnapshot, parseGvaSnapshot } from './jsonstat.js';
import { parseParliamentSnapshot } from './parliament.js';
import { parseGiscoSnapshot, parseOblastSnapshot } from './gisco.js';

export * from './pinned.js';
export * from './sdmx.js';
export * from './jsonstat.js';
export * from './parliament.js';
export * from './gisco.js';

async function read<T>(
  reader: SnapshotReader,
  source: string,
  path: string,
  parse: (text: string) => T,
): Promise<ReadResult<T>> {
  const result = await reader.read(source, path);
  return { data: parse(utf8(result.data)), receipt: result.receipt };
}
export async function readBnbSnapshot(
  reader: SnapshotReader,
  path: string,
  indicator: string,
): Promise<ReadResult<BnbSeries> & { evidence: Omit<BnbDocument, 'series'> }> {
  const raw = await reader.read('bnb', path);
  const { series, ...evidence } = parseBnbDocument(utf8(raw.data), indicator);
  return { data: series, receipt: raw.receipt, evidence };
}
export const readEurostatSnapshot = (reader: SnapshotReader, path: string) =>
  read(reader, 'eurostat', path, parseEurostatSnapshot);
export const readGvaSnapshot = (reader: SnapshotReader, path: string) =>
  read(reader, 'eurostat', path, parseGvaSnapshot);
export const readParliamentSnapshot = (reader: SnapshotReader, path: string, billId: number) =>
  read(reader, 'parliament', path, (text) => parseParliamentSnapshot(text, billId));
export const readGiscoSnapshot = (reader: SnapshotReader, path: string) =>
  read(reader, 'gisco', path, parseGiscoSnapshot);
export const readOblastSnapshot = (reader: SnapshotReader, path: string) =>
  read(reader, 'eurostat', path, parseOblastSnapshot);
