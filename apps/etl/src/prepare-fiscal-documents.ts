/** Standalone scoped offline preparation; deliberately absent from the global CLI. */
import { parseArgs } from 'node:util';
import { prepareFiscalDocuments } from '../../../packages/ingest/dist/readers/fiscal-documents/index.js';
const { values } = parseArgs({
  options: {
    sources: { type: 'string' },
    registry: { type: 'string' },
    pins: { type: 'string' },
    out: { type: 'string' },
    date: { type: 'string' },
  },
  strict: true,
});
for (const key of ['sources', 'registry', 'pins', 'out', 'date'] as const)
  if (!values[key]) throw new Error(`Missing --${key}`);
const result = await prepareFiscalDocuments({
  sourceRoot: values.sources!,
  registryPath: values.registry!,
  pinsPath: values.pins!,
  readDate: values.date!,
  out: values.out!,
});
process.stdout.write(JSON.stringify(result) + '\n');
