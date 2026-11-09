import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parsePythonJson } from '../common/numbers.js';
import { buildWave13a, type LegacyOwners, type Wave13aOutputs } from './wave13a.js';
import type { BillExtraction, Extraction } from './annual-lineage.js';
const manifestHash = '3e8b1ed66d5f3aeb221bda7cf9a56e880d632ceb96d68929f76434996660b2e2';
const required = [
  'fiscal/inputs/data/inputs/budget_forecast_2027.json',
  'fiscal/inputs/data/inputs/budget_bill_2027.json',
  'fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip',
  'fiscal/donor/outlook.json',
  'fiscal/donor/revenue.json',
  'fiscal/donor/expenditure.json',
  'law/oracle.json',
  'wave13a/law-donor.py',
  ...['outlook', 'revenue', 'expenditure', 'budget2027', 'budget2027-provenance', 'law'].map(
    (n) => `wave13a/published/${n}.json`,
  ),
  'wave13a/datasets.yaml',
  'wave13a/sources.yaml',
  'wave13a/policy.json',
];
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export async function loadWave13aFixture(base: string, buildDate: string): Promise<Wave13aOutputs> {
  base = resolve(base);
  if ((await realpath(base)) !== base) throw new Error('Symlink in fixture root');
  const read = async (name: string) => {
    const path = resolve(base, name),
      rel = relative(base, path);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
      throw new Error('Invalid fixture path');
    let current = base;
    for (const part of rel.split(sep)) {
      current = join(current, part);
      const s = await lstat(current);
      if (s.isSymbolicLink()) throw new Error('Symlink in fixture');
      if (current === path && (!s.isFile() || s.nlink !== 1))
        throw new Error('Unsafe fixture input');
    }
    return readFile(path);
  };
  const manifest = await read('wave13a/inputs-sha256.json');
  if (sha(manifest) !== manifestHash) throw new Error('Fixture inventory changed');
  const hashes = JSON.parse(manifest.toString()) as Record<string, string>;
  if (Object.keys(hashes).sort().join('\n') !== required.slice().sort().join('\n'))
    throw new Error('Incomplete fixture inventory');
  const content = new Map<string, Buffer>();
  // Published snapshots are oracle targets and are never read by the builder.
  for (const name of required.filter((name) => !name.startsWith('wave13a/published/'))) {
    const data = await read(name);
    if (sha(data) !== hashes[name]) throw new Error(`Fixture checksum mismatch: ${name}`);
    content.set(name, data);
  }
  const json = <T>(name: string): T => parsePythonJson<T>(content.get(name)!.toString('utf8'));
  const forecast = json<Extraction>(required[0]!);
  const bill = json<BillExtraction>(required[1]!);
  const archive = content.get(required[2]!)!;
  const legacy: LegacyOwners = {
    outlook: json('fiscal/donor/outlook.json'),
    revenue: json('fiscal/donor/revenue.json'),
    expenditure: json('fiscal/donor/expenditure.json'),
    law: json('law/oracle.json'),
  };
  return buildWave13a({
    forecast,
    bill,
    archives: { forecast: archive, bill: archive },
    legacy,
    buildDate,
  });
}
