import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import reference from './debt-cell-reference.json' with { type: 'json' };

/** PDFMiner's independent source transcription, never the MuPDF generator output.
 * Python tests regenerate this entire reference from the pinned original.
 * The SHA binds the cached decoding to the exact source bytes in this run.
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
