import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const required = [
  'bill-blocks.json',
  'capture-source-hashes.json',
  'doo-blocks.json',
  'execution.json',
  'kfp-components.json',
  'law.json',
  'municipalities.json',
  'nap-rows.json',
  'nzok-blocks.json',
  'outlook.json',
  'pages.json',
  'tables.json',
];
export async function verifyComponentsRatesInputs(root: string): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(join(root, 'provenance.json'), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('frozenInputSha256' in parsed))
    throw new Error('Invalid components/rates fixture manifest');
  const hashes = parsed.frozenInputSha256;
  if (
    typeof hashes !== 'object' ||
    hashes === null ||
    Array.isArray(hashes) ||
    Object.keys(hashes).sort().join('\n') !== required.join('\n')
  )
    throw new Error('Invalid components/rates fixture manifest');
  for (const name of required) {
    const expected = (hashes as Record<string, unknown>)[name],
      bytes = await readFile(join(root, 'inputs', name));
    if (
      typeof expected !== 'string' ||
      createHash('sha256').update(bytes).digest('hex') !== expected
    )
      throw new Error(`Input hash mismatch: ${name}`);
  }
}
