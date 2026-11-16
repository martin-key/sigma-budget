import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import reference from './debt-cell-reference.json' with { type: 'json' };

/** Compare published cells with the committed reference decoded earlier by PDFMiner.
 * Runtime checks the pinned source SHA; it does not re-decode that source with PDFMiner.
 */
export function verifyDebtCells(document: unknown, source: string): void {
  const sha = createHash('sha256').update(readFileSync(source)).digest('hex');
  const d = document as Record<string, unknown>;
  if (
    sha !== reference.sourceSha256 ||
    d.sourceSha256 !== sha ||
    !Object.entries(reference.tables).every(([key, value]) => isDeepStrictEqual(d[key], value))
  )
    throw new Error('D38 cells differ from independent PDFMiner source transcription');
}
