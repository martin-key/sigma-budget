import { lstat, realpath, readFile, mkdir, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';
import { isIsoDay } from '../../common/dates.js';
import { SnapshotReader, type InputReceipt } from '../snapshots/pinned.js';
import { assert } from '../pdf/index.js';
import { extractAsbp } from './asbp.js';
import { extractNap } from './nap.js';
import { readIndirectTaxInput, readIndirectEvidence, type IndirectOriginals } from './indirect.js';
import { FISCAL_DOCUMENT_PATHS as paths, sha256, type FiscalOriginal } from './source.js';

export interface FiscalPreparationOptions {
  sourceRoot: string;
  registryPath: string;
  pinsPath: string;
  readDate: string;
  /** Must be a new, separate owned directory whose parent already exists. */
  out: string;
}
const inside = (parent: string, child: string) => {
  const r = relative(parent, child);
  return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep));
};
async function noAliases(path: string, required: boolean): Promise<void> {
  let current = resolve(sep);
  for (const part of resolve(path).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const st = await lstat(current);
      assert(
        !st.isSymbolicLink() && (await realpath(current)) === current,
        `Symlink path: ${current}`,
      );
      assert(
        st.isDirectory() || (current === resolve(path) && st.isFile() && st.nlink === 1),
        `Unsafe/hardlinked path: ${current}`,
      );
    } catch (e) {
      if (!required && (e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
  }
}
/** Validate the complete write surface before any directory/file is created. */
export async function validateFiscalDestination(
  options: FiscalPreparationOptions,
): Promise<string> {
  assert(isIsoDay(options.readDate), 'Invalid fiscal preparation date');
  const out = resolve(options.out),
    source = resolve(options.sourceRoot),
    registry = resolve(options.registryPath),
    pins = resolve(options.pinsPath);
  for (const p of [source, registry, pins]) {
    assert(!inside(p, out) && !inside(out, p), 'Fiscal output overlaps source/registry/pins');
    await noAliases(p, true);
  }
  // New-only output excludes existing files, directories, hardlinks and dangling links.
  await noAliases(out, false);
  const parent = resolve(out, '..');
  await noAliases(parent, true);
  try {
    await lstat(out);
    throw new Error('Fiscal output must be a new directory');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  // Do not emit source-like destination trees accidentally outside sourceRoot either.
  assert(
    !out.split(sep).some((p) => ['originals', 'cache', 'release', '.git'].includes(p)),
    'Protected fiscal destination tree',
  );
  return out;
}
function serial(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_k, v: unknown) => {
        if (typeof v === 'number') {
          assert(Number.isFinite(v), 'Nonfinite fiscal evidence');
          return Object.is(v, -0) ? 0 : v;
        }
        return v;
      },
      2,
    ) + '\n'
  );
}
/** Offline preparation only. It does not replace Python's production defaults,
 * shared graph, registries, pins, existing extracts or the retained July summary. */
export async function prepareFiscalDocuments(options: FiscalPreparationOptions) {
  const out = await validateFiscalDestination(options),
    reader = await SnapshotReader.open({
      inputRoot: options.sourceRoot,
      registryPath: options.registryPath,
      pinsPath: options.pinsPath,
      readDate: options.readDate,
    });
  const sources = {} as Record<keyof typeof paths, FiscalOriginal>,
    receipts: InputReceipt[] = [];
  for (const key of Object.keys(paths) as (keyof typeof paths)[]) {
    const source =
      (
        {
          prices: 'ec-oil',
          duties: 'ec-oil',
          gazette: 'excise-law',
          customs: 'customs-excise-law',
          nsi: 'nsi-pack',
        } as Partial<Record<keyof typeof paths, string>>
      )[key] ?? key;
    const result = await reader.read(source, paths[key]);
    sources[key] = { path: paths[key], sha256: result.receipt.sha256, bytes: result.data };
    receipts.push(result.receipt);
  }
  const asbp = extractAsbp(sources.asbp, sources.bill),
    nap = extractNap(sources.nap),
    indirect = readIndirectTaxInput(sources as IndirectOriginals),
    independent = readIndirectEvidence(sources as IndirectOriginals);
  const content: Record<string, string> = {
    'asbp-tables.json': serial({
      source: asbp.source,
      tables: { ...asbp.tables, IV_text: asbp.municipalText },
      docx_check: asbp.docx_check,
      evidenceNotes: asbp.evidenceNotes,
    }),
    'asbp-pages.json': serial(asbp.pages),
    'nap-rows.json': serial(nap.rows),
    'nap-physical.json': serial({ source: nap.source, physicalRows: nap.physicalRows }),
    'indirect-input.json': serial(indirect.input),
    'indirect-documents.json': serial({
      nsi: indirect.documents.nsi,
      customs: indirect.documents.customs,
      docx: indirect.documents.docx,
    }),
    'indirect-evidence.json': serial(independent),
  };
  const receipt = {
    schema: 1,
    readDate: options.readDate,
    sources: receipts,
    outputs: Object.entries(content).map(([path, text]) => ({
      path,
      bytes: Buffer.byteLength(text),
      sha256: sha256(Buffer.from(text)),
    })),
    notes: asbp.evidenceNotes,
  };
  content['fiscal-documents-receipt.json'] = serial(receipt);
  // Recheck after decoding, before the first write; sources/metadata must still be identical.
  await validateFiscalDestination(options);
  for (const receipt of receipts)
    assert(
      sha256(await readFile(join(options.sourceRoot, receipt.path))) === receipt.sha256,
      'Fiscal source changed during preparation',
    );
  for (const [path, digest] of [
    [options.registryPath, receipts[0]!.registry.sha256],
    [options.pinsPath, receipts[0]!.pins!.sha256],
  ])
    assert(
      sha256(await readFile(path!)) === digest,
      'Fiscal registry/pins changed during preparation',
    );
  let created = false;
  try {
    await mkdir(out);
    created = true;
    for (const [name, text] of Object.entries(content)) {
      await noAliases(out, true);
      const file = await open(
        join(out, name),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
    }
    return receipt;
  } catch (e) {
    if (created) await rm(out, { recursive: true, force: true });
    throw e;
  }
}
