#!/usr/bin/env node
/** Standalone, explicit offline preparation. No global production registration. */
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { preparePublicationDocuments } from '../../../packages/ingest/dist/readers/publication-documents/index.js';
const { values } = parseArgs({
  options: {
    'input-root': { type: 'string' },
    registry: { type: 'string' },
    pins: { type: 'string' },
    out: { type: 'string' },
    date: { type: 'string' },
    roles: { type: 'string' },
    'programme-source': { type: 'string' },
    outlook: { type: 'string' },
    zdb: { type: 'string' },
  },
});
for (const k of ['input-root', 'registry', 'pins', 'out', 'date'])
  if (!values[k]) throw new Error('Required --' + k);
const programmeSource = values['programme-source'] ?? 'extracted';
if (!['extracted', 'archive'].includes(programmeSource))
  throw new Error('Invalid --programme-source');
const result = await preparePublicationDocuments({
  inputRoot: values['input-root'],
  registryPath: values.registry,
  pinsPath: values.pins,
  out: values.out,
  readDate: values.date,
  roles: values.roles?.split(','),
  programmeSource,
  sevenZip:
    programmeSource === 'archive'
      ? { wasmModule: createRequire(import.meta.url).resolve('7z-wasm') }
      : undefined,
  outlookPath: values.outlook,
  zdbPath: values.zdb,
});
console.log(JSON.stringify(result, null, 2));
