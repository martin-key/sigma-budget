import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { compare, equal, type Difference } from '../parity/compare.js';
import { auditCatalogMetadata } from './catalog-metadata.js';
import type { Wave13bInput } from './wave13b.js';

const PROOF_HASH = '6035f035deaf1aaadb4b60c82e4c4941e8a6989d442aa8f4aca5beea9199f800';
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
export interface ArtifactEvidence {
  file: string;
  dataset: string;
  producer: string;
  stage: string;
  mode: string;
  parityEligible: boolean;
  fullOriginalRegenerationEligible: boolean;
  inputs: string[];
  limitations: string[];
  sourceHashes: Record<string, string>;
}
export async function loadWave13bReference(fixture: string) {
  const root = resolve(fixture),
    base = join(root, 'wave13b');
  if ((await realpath(root)) !== root) throw new Error('Unsafe reference root');
  const safe = async (name: string) => {
    if (
      isAbsolute(name) ||
      name.includes('\\') ||
      name.split('/').some((p) => !p || p === '.' || p === '..')
    )
      throw new Error('Unsafe reference path');
    const path = resolve(base, name),
      rel = relative(base, path);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
      throw new Error('Unsafe reference path');
    const st = await lstat(path);
    if (!st.isFile() || st.nlink !== 1 || (await realpath(path)) !== path)
      throw new Error(`Unsafe reference file: ${name}`);
    return readFile(path);
  };
  const proof = await safe('proof.json');
  if (sha(proof) !== PROOF_HASH) throw new Error('Wave13b proof inventory hash mismatch');
  const record = JSON.parse(proof.toString()) as {
    baseline: string;
    files: Record<string, string>;
  };
  if (record.baseline !== '027a262288c0b0ca4b188482a8b8da43bb378047')
    throw new Error('Wrong proof baseline');
  const content = new Map<string, Buffer>();
  for (const [name, expected] of Object.entries(record.files)) {
    const data = await safe(name);
    if (sha(data) !== expected) throw new Error(`Proof hash mismatch: ${name}`);
    if (name === 'artifact-inventory.json' || name.startsWith('oracle/')) content.set(name, data);
  }
  const inventoryBytes = content.get('artifact-inventory.json');
  if (!inventoryBytes) throw new Error('Missing artifact inventory');
  const inventory = JSON.parse(inventoryBytes.toString()) as {
    baseline: string;
    date: string;
    artifacts: ArtifactEvidence[];
  };
  if (
    inventory.baseline !== record.baseline ||
    inventory.date !== '2026-11-08' ||
    inventory.artifacts.length !== 70
  )
    throw new Error('Invalid artifact inventory');
  const names = inventory.artifacts.map((a) => a.file);
  if (
    inventory.artifacts.some(
      (item) =>
        !item.sourceHashes ||
        !Object.keys(item.sourceHashes).length ||
        Object.values(item.sourceHashes).some((hash) => !/^[0-9a-f]{64}$/.test(hash)),
    )
  )
    throw new Error('Incomplete artifact source hashes');
  if (
    new Set(names).size !== names.length ||
    names.some((name) => !content.has(`oracle/${name}`)) ||
    [...content.keys()].filter((name) => name.startsWith('oracle/')).length !== names.length
  )
    throw new Error('Incomplete reference artifacts');
  const walk = async (directory: string, prefix = ''): Promise<string[]> => {
    if ((await realpath(directory)) !== directory) throw new Error('Unsafe oracle directory');
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return walk(join(directory, entry.name), name);
        if (!entry.isFile()) throw new Error('Unsafe oracle entry');
        await safe(`oracle/${name}`);
        return [name];
      }),
    );
    return nested.flat();
  };
  if ((await walk(join(base, 'oracle'))).sort().join('\n') !== names.slice().sort().join('\n'))
    throw new Error('Unexpected or missing oracle file');
  return {
    inventory: inventory.artifacts,
    oracle: new Map(names.map((name) => [name, content.get(`oracle/${name}`)!])),
  };
}

/** Exact semantic comparison; byte-derived catalog differences are reported separately. */
export function compareWave13b(input: {
  streams: ReadonlyMap<string, Uint8Array>;
  reference: Awaited<ReturnType<typeof loadWave13bReference>>;
  registry: Wave13bInput['layers']['registry'];
  activeRoutes: Wave13bInput['layers']['activeRoutes'];
}) {
  const { streams, reference } = input;
  const expected = [...reference.oracle.keys()].sort(),
    actual = [...streams.keys()].sort();
  const missing = expected.filter((name) => !streams.has(name));
  const unexpected = actual.filter((name) => !reference.oracle.has(name));
  const differences: Difference[] = [],
    metadataDifferences: Difference[] = [],
    byteDifferences: string[] = [];
  const artifacts = reference.inventory.map((item) => {
    const candidate = streams.get(item.file),
      oracle = reference.oracle.get(item.file)!;
    if (candidate) {
      if (item.file.endsWith('.xml')) {
        if (!Buffer.from(candidate).equals(oracle)) byteDifferences.push(item.file);
      } else {
        const current = compare(
          JSON.parse(oracle.toString()),
          JSON.parse(Buffer.from(candidate).toString()),
          { dataset: item.dataset, file: item.file },
        );
        for (const diff of current) {
          if (
            item.file === 'catalog.json' &&
            /^\/datasets\/\d+\/(?:bytes|gzipBytes|parts\/\d+\/(?:bytes|gzipBytes))$/.test(
              diff.pointer,
            )
          )
            metadataDifferences.push(diff);
          else differences.push(diff);
        }
      }
    }
    return {
      ...item,
      oracleSha256: sha(oracle),
      candidateSha256: candidate ? sha(candidate) : null,
      state: !candidate
        ? 'missing'
        : item.mode === 'unverified-missing-original'
          ? 'unverified'
          : !item.parityEligible
            ? 'frozen-only'
            : 'eligible',
    };
  });
  const catalogBytes = streams.get('catalog.json');
  const metadata =
    catalogBytes && !missing.length
      ? auditCatalogMetadata({
          catalogBytes,
          ownerBytes: streams,
          registry: input.registry,
          activeRoutes: input.activeRoutes,
        })
      : null;
  const metadataValid = metadata !== null && equal(metadata.reported, metadata.computed);
  const failed =
    missing.length > 0 ||
    unexpected.length > 0 ||
    differences.length > 0 ||
    byteDifferences.length > 0 ||
    !metadataValid;
  return {
    outcome: failed ? 'fail' : 'unverified',
    missing,
    unexpected,
    differences,
    byteDifferences,
    metadataDifferences,
    metadataValid,
    artifacts,
    limits: [
      'The original October Eurostat GVA responses are missing; GVA regeneration is unverified.',
      'The archived SZR36 exception is restricted to the pinned coordinates and explicit opt-in; topology is not certified.',
      'Reader IR and source hashes do not establish full original-source regeneration for the unported readers.',
    ],
  };
}
