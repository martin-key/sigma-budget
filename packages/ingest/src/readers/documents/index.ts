import { SnapshotReader, utf8, type ReadResult } from '../snapshots/pinned.js';
import { parseLegalHtml } from './html.js';
import { parseLegalDocx } from './docx.js';
export * from './html.js';
export * from './docx.js';

export async function readLegalHtml(
  reader: SnapshotReader,
  source: string,
  path: string,
): Promise<ReadResult<ReturnType<typeof parseLegalHtml>>> {
  const result = await reader.read(source, path);
  return { data: parseLegalHtml(utf8(result.data)), receipt: result.receipt };
}
export async function readLegalDocx(
  reader: SnapshotReader,
  source: string,
  path: string,
): Promise<ReadResult<ReturnType<typeof parseLegalDocx>>> {
  const result = await reader.read(source, path);
  return { data: parseLegalDocx(result.data), receipt: result.receipt };
}
