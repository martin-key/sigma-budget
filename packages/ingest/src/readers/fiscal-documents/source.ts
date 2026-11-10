import { createHash } from 'node:crypto';
import { assert } from '../pdf/index.js';

/** Structurally matches independent-rule OriginalBytes; no alternate registry. */
export interface FiscalOriginal {
  path: string;
  sha256: string;
  bytes: Uint8Array;
}
export const FISCAL_DOCUMENT_PATHS = {
  asbp: 'data/originals/asbp/UMTBF-2026-2028-motivi.pdf',
  nap: 'data/originals/nap/nap_prilozhenie_1_VK-30-10237_12.08.2026.pdf',
  prices: 'data/originals/ec-oil/weekly-prices-2026-11-02.xlsx',
  duties: 'data/originals/ec-oil/duties-and-taxes-2026-11-07.xlsx',
  gazette: 'data/originals/excise-law/dv-69-2026-budget.html',
  customs: 'data/originals/excise-law/excise-law-dv54-2025.pdf',
  nsi: 'data/originals/nsi-pack/statistical-yearbook-2025.pdf',
  bill: 'data/originals/parliament/52-602-01-19.docx',
} as const;
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function authenticate(source: FiscalOriginal, path: string): Uint8Array {
  assert(source && source.path === path, `Missing or wrong fiscal source: ${path}`);
  assert(
    source.bytes instanceof Uint8Array &&
      source.bytes.length > 0 &&
      source.bytes.length <= 128 * 1024 * 1024,
    `Invalid fiscal source bytes: ${path}`,
  );
  assert(
    /^[a-f0-9]{64}$/u.test(source.sha256) && sha256(source.bytes) === source.sha256,
    `Fiscal source SHA-256 mismatch: ${path}`,
  );
  return source.bytes;
}
