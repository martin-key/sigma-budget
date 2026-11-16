import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const root = new URL('../../test/fixtures/validate15b/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, root));
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
it('authenticates budget 2027 validation evidence and its data dependencies', () => {
  const pins = {
    'pdf-audit.json': '3af8035c5f8f30d9121442471a7de7b40c152518aa6b4f072c4254a64ae2bced',
    'source-order-provenance.json':
      'fc328256999279ce6875ec77427bdd00df8888ecd252becfc303584466f86133',
    'source-methods-provenance.json':
      '0dcfadccd2c6359192d43d25ba7f076d84b87cb8698d5ce79332a699e106b811',
    'optional-values-provenance.json':
      'e07b07d7b17d8df712097dc9d36783b44cb4907e065b77c02dac82dbe4408e8a',
  };
  for (const [name, hash] of Object.entries(pins)) expect(sha(bytes(name)), name).toBe(hash);
  for (const name of ['source-order', 'source-methods', 'optional-values']) {
    const proof = JSON.parse(bytes(name + '-provenance.json').toString());
    expect(sha(bytes(name + '.json'))).toBe(proof.oracleSha256);
    if (proof.inventorySha256) expect(sha(bytes('inventory.json'))).toBe(proof.inventorySha256);
    for (const [file, hash] of Object.entries(proof.inputs ?? {}))
      expect(sha(bytes(file)), file).toBe(hash);
  }
});
