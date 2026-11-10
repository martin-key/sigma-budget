import { constants } from 'node:fs';
import { open, readFile, readdir, lstat, link, unlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  SnapshotReader,
  parsePins,
  type ReaderOptions,
  type InputReceipt,
} from '../snapshots/pinned.js';
import { safePath } from '../annual/prepare.js';
import { parseYaml } from '../../io/registry.js';
import { assert } from '../pdf/index.js';
import { extractLawBill, type LawBillCache } from './legal.js';
import { extractDbp, DBP_PATH } from './dbp.js';
import {
  extractProgrammes,
  programme2027Unavailable,
  type ProgrammePdfInput,
} from './programmes.js';
import { extractProgrammeArchive, type SevenZipOptions } from './archive.js';
import { verifyLegacyProgrammeSource } from './legacy-programme.js';
export const PUBLICATION_PATHS = {
  law: 'data/cache/law_bill.json',
  dbp: 'data/cache/research/dbp-2027/dbp2027_figures.json',
  programmes: 'data/inputs/program_budgets_2026.json',
  programmeEvidence: 'data/inputs/programme_pdf_evidence.json',
} as const;
export type PublicationRole = 'law' | 'dbp' | 'programmes';
export interface PublicationOptions extends ReaderOptions {
  out: string;
  roles?: PublicationRole[];
  programmeSource?: 'extracted' | 'archive';
  sevenZip?: SevenZipOptions;
  /** Optional explicit comparison input, read-only. Not a fiscal acquisition. */
  outlookPath?: string;
  /** Frozen ZDB intermediate used by the existing programme extraction contract. */
  zdbPath?: string;
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const inside = (a: string, b: string) => {
  const r = relative(a, b);
  return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep));
};
export async function readPublicationFile(
  path: string,
  maxBytes = 128 * 1024 * 1024,
): Promise<Buffer> {
  await safePath(path);
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await f.stat();
    assert(
      st.isFile() && st.nlink === 1 && st.size <= maxBytes,
      'Unsafe/oversized publication input',
    );
    const b = await f.readFile();
    assert(b.length === st.size, 'Publication input changed');
    return b;
  } finally {
    await f.close();
  }
}
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
/** No amount/text/null/year/order tolerance. Existing bytes are retained. */
export function assertFreshPublication(bytes: Uint8Array, expected: unknown, role: string): void {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert(
    JSON.stringify(canonical(value)) === JSON.stringify(canonical(expected)),
    'Stale publication intermediate: ' + role,
  );
}
/** Validate every destination and every protected input before creating anything. */
export async function publicationOutputPreflight(
  options: Pick<
    PublicationOptions,
    'inputRoot' | 'registryPath' | 'pinsPath' | 'out' | 'outlookPath' | 'zdbPath'
  >,
  paths: string[],
): Promise<void> {
  const root = resolve(options.inputRoot),
    out = resolve(options.out);
  await safePath(root);
  await safePath(out);
  assert(!inside(root, out) && !inside(out, root), 'Publication output overlaps input root');
  assert(
    !out
      .split(sep)
      .some((p) => ['originals', 'release', 'fixtures', '.git', 'registries'].includes(p)),
    'Protected publication output location',
  );
  const inputs = [options.registryPath, options.pinsPath, options.outlookPath, options.zdbPath]
    .filter((p): p is string => !!p)
    .map((p) => resolve(p));
  const destinations = paths.map((p) => {
    assert(
      !isAbsolute(p) &&
        p.split('/').every((x) => x && x !== '.' && x !== '..') &&
        !p.includes('\\'),
      'Invalid publication output path',
    );
    return resolve(out, p);
  });
  for (const input of inputs) {
    await safePath(input);
    assert(
      !inside(out, input) && !inside(input, out),
      'Output overlaps registry/pins/comparison input',
    );
  }
  const aliases = new Set<string>();
  for (const d of destinations) {
    assert(inside(out, d) && d !== out, 'Output escape');
    const alias = d.normalize('NFC').toLowerCase();
    assert(!aliases.has(alias), 'Duplicate publication output alias');
    aliases.add(alias);
    await safePath(d);
    for (const input of inputs)
      assert(!inside(input, d) && !inside(d, input), 'Output aliases protected input');
  }
}
export async function readRegisteredProgrammePdfs(
  options: ReaderOptions,
): Promise<{ pdfs: ProgrammePdfInput[]; receipts: InputReceipt[] }> {
  assert(options.pinsPath, 'Programme PDF pins are required');
  const registryBytes = await readPublicationFile(resolve(options.registryPath), 2 * 1024 * 1024),
    pinsBytes = await readPublicationFile(resolve(options.pinsPath), 2 * 1024 * 1024),
    registry = parseYaml(registryBytes.toString('utf8')) as any,
    pins = parsePins(pinsBytes.toString('utf8'));
  const registration = (registry.intermediates ?? []).filter(
    (i: any) =>
      i.path === 'data/originals/program_budgets/*' &&
      i.reproducible === true &&
      i.inputs?.includes('prb'),
  );
  assert(registration.length === 1, 'Extracted programme PDFs are not uniquely registered');
  const base = join(resolve(options.inputRoot), 'data/originals/program_budgets');
  await safePath(base);
  const files = (await readdir(base)).filter((n) => n.endsWith('.pdf')).sort();
  assert(files.length === 46, 'Programme PDF inventory incomplete');
  const pdfs: ProgrammePdfInput[] = [],
    receipts: InputReceipt[] = [];
  for (const file of files) {
    assert(/^\d{4}[_-].*\.pdf$/u.test(file), 'Invalid programme PDF filename');
    const path = 'data/originals/program_budgets/' + file,
      pin = pins.get(path);
    assert(pin, 'Missing programme PDF pin: ' + file);
    const bytes = await readPublicationFile(join(options.inputRoot, path), 32 * 1024 * 1024);
    assert(sha(bytes) === pin, 'Programme PDF hash mismatch: ' + file);
    pdfs.push({ file, bytes });
    receipts.push({
      source: 'prb',
      path,
      sha256: pin,
      bytes: bytes.length,
      readDate: options.readDate,
      registry: { path: resolve(options.registryPath), sha256: sha(registryBytes) },
      pins: { path: resolve(options.pinsPath), sha256: sha(pinsBytes) },
      url: null,
    });
  }
  return { pdfs, receipts };
}
export async function extractPublicationDocuments(options: Omit<PublicationOptions, 'out'>) {
  for (const p of [
    options.registryPath,
    options.pinsPath,
    options.outlookPath,
    options.zdbPath,
  ].filter((p): p is string => !!p))
    await safePath(resolve(p));
  const reader = await SnapshotReader.open(options),
    roles = options.roles ?? ['law', 'dbp', 'programmes'];
  assert(
    roles.length > 0 &&
      new Set(roles).size === roles.length &&
      roles.every((r) => ['law', 'dbp', 'programmes'].includes(r)),
    'Invalid publication roles',
  );
  const receipts: InputReceipt[] = [],
    outputs: Record<string, unknown> = {};
  let law: LawBillCache | undefined;
  if (roles.includes('law') || roles.includes('programmes')) {
    const html = await reader.read('zdb', 'data/originals/dv/zdb2026_dv69_idMat245041.html'),
      docx = await reader.read('bill', 'data/originals/parliament/52-602-01-19.docx');
    receipts.push(html.receipt, docx.receipt);
    law = extractLawBill(html.data, docx.data);
    if (roles.includes('law')) outputs[PUBLICATION_PATHS.law] = law;
  }
  if (roles.includes('dbp')) {
    const pdf = await reader.read('dbp2027', DBP_PATH);
    receipts.push(pdf.receipt);
    const outlook = options.outlookPath
      ? JSON.parse(
          (await readPublicationFile(resolve(options.outlookPath), 16 * 1024 * 1024)).toString(
            'utf8',
          ),
        )
      : undefined;
    outputs[PUBLICATION_PATHS.dbp] = extractDbp(pdf.data, outlook);
  }
  if (roles.includes('programmes')) {
    let pdfs: ProgrammePdfInput[],
      members: unknown = null;
    if ((options.programmeSource ?? 'extracted') === 'extracted') {
      const r = await readRegisteredProgrammePdfs(options);
      pdfs = r.pdfs;
      receipts.push(...r.receipts);
    } else {
      assert(options.sevenZip, '7z-wasm is required for archive preparation');
      const archive = await reader.read('prb', 'data/originals/parliament/52-602-01-19.zip');
      receipts.push(archive.receipt);
      const r = await extractProgrammeArchive(archive.data, options.sevenZip);
      pdfs = r.pdfs;
      members = r.members;
    }
    const zdb = options.zdbPath
      ? JSON.parse(
          (await readPublicationFile(resolve(options.zdbPath), 4 * 1024 * 1024)).toString('utf8'),
        )
      : undefined;
    const e = extractProgrammes(pdfs, law!, zdb);
    outputs[PUBLICATION_PATHS.programmes] = e.source;
    outputs[PUBLICATION_PATHS.programmeEvidence] = e.pdfs;
    return {
      outputs,
      receipts,
      programmeLaw: law,
      archiveMembers: members,
      programme2027: programme2027Unavailable,
      engine: 'MuPDF.js 1.26.4; ordered physical HTML/DOCX; 7z-wasm 1.2.0 when archive selected',
    };
  }
  return {
    outputs,
    receipts,
    programmeLaw: law,
    archiveMembers: null,
    programme2027: programme2027Unavailable,
    engine: 'MuPDF.js 1.26.4; ordered physical HTML/DOCX',
  };
}
async function writeNew(path: string, bytes: Uint8Array) {
  await safePath(dirname(path), true);
  const temp = join(dirname(path), '.publication-' + randomUUID() + '.tmp');
  let created = false;
  try {
    const f = await open(
      temp,
      constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
      0o600,
    );
    created = true;
    try {
      await f.writeFile(bytes);
      await f.sync();
    } finally {
      await f.close();
    }
    await safePath(path);
    await link(temp, path);
  } finally {
    if (created) await unlink(temp);
  }
}
export async function preparePublicationDocuments(options: PublicationOptions) {
  const report = 'tmp/publication-documents-receipt.json';
  await publicationOutputPreflight(options, [...Object.values(PUBLICATION_PATHS), report]);
  const result = await extractPublicationDocuments(options),
    pending: { path: string; bytes: Buffer; action: 'generated' | 'verified' }[] = [],
    compatibility: string[] = [];
  for (const [path, value] of Object.entries(result.outputs)) {
    const target = resolve(options.out, path);
    let existing: Buffer | undefined;
    try {
      existing = await readPublicationFile(target, 32 * 1024 * 1024);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (existing)
      try {
        assertFreshPublication(existing, value, path);
      } catch (e) {
        if (path !== PUBLICATION_PATHS.programmes) throw e;
        compatibility.push(
          verifyLegacyProgrammeSource(
            JSON.parse(existing.toString('utf8')),
            result.outputs[PUBLICATION_PATHS.programmeEvidence],
            result.programmeLaw,
          ),
        );
      }
    pending.push({
      path,
      bytes: existing ?? Buffer.from(JSON.stringify(value, null, 1) + '\n'),
      action: existing ? 'verified' : 'generated',
    });
  }
  const auxiliaryInputs = [];
  for (const path of [options.outlookPath, options.zdbPath].filter((p): p is string => !!p)) {
    const b = await readPublicationFile(resolve(path));
    auxiliaryInputs.push({ path: resolve(path), bytes: b.length, sha256: sha(b) });
  }
  const receipt = {
    schema: 1,
    readDate: options.readDate,
    inputs: result.receipts,
    auxiliaryInputs,
    archiveMembers: result.archiveMembers,
    programme2027: result.programme2027,
    engine: result.engine,
    compatibility,
    outputs: pending.map((p) => ({
      path: p.path,
      action: p.action,
      bytes: p.bytes.length,
      sha256: sha(p.bytes),
    })),
  };
  // Existing receipts are verification inputs too; do not silently replace them.
  try {
    const old = JSON.parse(
      (await readPublicationFile(resolve(options.out, report))).toString('utf8'),
    );
    const normalized = {
      ...receipt,
      outputs: receipt.outputs.map((o) => ({
        ...o,
        action: old.outputs?.find((p: any) => p.path === o.path)?.action ?? o.action,
      })),
    };
    assertFreshPublication(Buffer.from(JSON.stringify(old)), normalized, 'receipt');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const created: string[] = [];
  try {
    for (const p of pending)
      if (p.action === 'generated') {
        const path = resolve(options.out, p.path);
        await writeNew(path, p.bytes);
        created.push(path);
      }
    const path = resolve(options.out, report);
    try {
      await lstat(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await writeNew(path, Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
      created.push(path);
    }
  } catch (e) {
    for (const path of created.reverse()) await unlink(path);
    throw e;
  }
  return receipt;
}
