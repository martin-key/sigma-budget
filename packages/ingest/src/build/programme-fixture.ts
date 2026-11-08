import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Verify all frozen inputs before constructing a candidate. */
export async function verifyProgrammeInputs(root: string): Promise<void> {
  const provenance = JSON.parse(await readFile(join(root, 'provenance.json'), 'utf8'));
  const hashes: Record<string, string> = provenance.frozenInputSha256;
  const required = [
    'law-cache.json',
    'original-hashes.json',
    'pdf-evidence.json',
    'program-budgets.json',
  ];
  if (!hashes || Object.keys(hashes).sort().join('\n') !== required.join('\n'))
    throw new Error('Invalid programme fixture manifest');
  for (const name of required) {
    const bytes = await readFile(join(root, 'inputs', name));
    if (createHash('sha256').update(bytes).digest('hex') !== hashes[name])
      throw new Error(`Input hash mismatch: ${name}`);
  }
}
