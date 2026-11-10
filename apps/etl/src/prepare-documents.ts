import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLegalHtml, parseLegalDocx } from '@sigma-budget/ingest/readers/documents';
import {
  SnapshotReader,
  utf8,
  parseBnbDocument,
  parseEurostatSnapshot,
  parseGvaSnapshot,
  parseParliamentSnapshot,
  parseGiscoSnapshot,
  parseOblastSnapshot,
} from '@sigma-budget/ingest/readers/snapshots';

const project = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const within = (parent: string, path: string) => {
  const rel = relative(parent, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
};
const usage = `Offline preparation of one registered, pinned input.
Required: --kind html|docx|bnb|eurostat|gva|parliament|gisco|oblast
  --input-root ROOT --registry SOURCES_YAML --source ID --path REGISTERED_PATH
  --date YYYY-MM-DD --out NEW_DIRECTORY
Optional: --pins SHA256SUM_FILE (required unless registry declares the hash)
  --indicator CODE (bnb), --bill-id NUMBER (parliament)
The output parent must exist. The command creates a new owned directory and never overwrites it.
`;

/** Standalone module; unified production dispatch intentionally remains unchanged. */
export async function prepareDocumentsCli(args: string[], projectRoot = project): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(usage);
    return 0;
  }
  const flags: Record<string, string> = {};
  const allowed = [
    '--kind',
    '--input-root',
    '--registry',
    '--source',
    '--path',
    '--date',
    '--out',
    '--pins',
    '--indicator',
    '--bill-id',
  ];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (!key || !allowed.includes(key) || flags[key] || !value || value.startsWith('--'))
      throw new Error('Invalid prepare-documents arguments');
    flags[key] = value;
  }
  for (const key of [
    '--kind',
    '--input-root',
    '--registry',
    '--source',
    '--path',
    '--date',
    '--out',
  ])
    if (!flags[key]) throw new Error(`Missing ${key}`);
  const kind = flags['--kind']!,
    source = flags['--source']!;
  if (!['html', 'docx', 'bnb', 'eurostat', 'gva', 'parliament', 'gisco', 'oblast'].includes(kind))
    throw new Error('Unsupported preparation kind');
  const expectedSource: Record<string, string> = {
    bnb: 'bnb',
    eurostat: 'eurostat',
    gva: 'eurostat',
    parliament: 'parliament',
    gisco: 'gisco',
    oblast: 'eurostat',
  };
  if (expectedSource[kind] && source !== expectedSource[kind])
    throw new Error('Preparation source/kind mismatch');
  if (
    (kind === 'bnb') !== Boolean(flags['--indicator']) ||
    (kind === 'parliament') !== Boolean(flags['--bill-id'])
  )
    throw new Error('Missing or inapplicable indicator/bill-id');
  const inputRoot = resolve(flags['--input-root']!),
    out = resolve(flags['--out']!);
  const registryPath = resolve(flags['--registry']!),
    pinsPath = flags['--pins'] ? resolve(flags['--pins']) : undefined;
  // Existing parents only: do not mkdir through an unverified symlink chain.
  if ((await realpath(dirname(out))) !== dirname(out)) throw new Error('Symlink in output parent');
  if (
    within(out, inputRoot) ||
    within(inputRoot + '/data', out) ||
    within(out, registryPath) ||
    (pinsPath && within(out, pinsPath)) ||
    (within(projectRoot, out) && !within(resolve(projectRoot, 'tmp'), out))
  )
    throw new Error('Output overlaps protected inputs/checkout');
  const reader = await SnapshotReader.open({
    inputRoot,
    registryPath,
    pinsPath,
    readDate: flags['--date']!,
  });
  const raw = await reader.read(source, flags['--path']!);
  let data: unknown;
  switch (kind) {
    case 'html':
      data = parseLegalHtml(utf8(raw.data));
      break;
    case 'docx':
      data = parseLegalDocx(raw.data);
      break;
    case 'bnb':
      data = parseBnbDocument(utf8(raw.data), flags['--indicator']!);
      break;
    case 'eurostat':
      data = parseEurostatSnapshot(utf8(raw.data));
      break;
    case 'gva':
      data = parseGvaSnapshot(utf8(raw.data));
      break;
    case 'parliament': {
      if (!/^[1-9]\d*$/u.test(flags['--bill-id']!)) throw new Error('Invalid bill-id');
      data = parseParliamentSnapshot(utf8(raw.data), Number(flags['--bill-id']));
      break;
    }
    case 'gisco':
      data = parseGiscoSnapshot(utf8(raw.data));
      break;
    case 'oblast':
      data = parseOblastSnapshot(utf8(raw.data));
      break;
  }
  await mkdir(out); // Exclusive directory ownership. Never reuse an existing path.
  try {
    await writeFile(resolve(out, 'data.json'), JSON.stringify(data) + '\n', { flag: 'wx' });
    await writeFile(
      resolve(out, 'receipt.json'),
      JSON.stringify({
        ...raw.receipt,
        parser: kind,
        representation: kind === 'gisco' ? 'registered-reduced-cache' : 'registered-source',
      }) + '\n',
      { flag: 'wx' },
    );
    // Keep original tokens/order for a later JSON-stat/GVA reparse; serialized
    // data.json alone cannot preserve 1.0 vs 1 or sparse object member order.
    await writeFile(resolve(out, 'source.bin'), raw.data, { flag: 'wx' });
  } catch (e) {
    await rm(out, { recursive: true, force: true });
    throw e;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareDocumentsCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
      process.exitCode = 1;
    });
}
