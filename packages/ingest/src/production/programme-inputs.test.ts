import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, expect, it } from 'vitest';
import { programmeReferences, supplementaryProgrammeCodes } from '@sigma-budget/dataset-schema';
import type { ExecutionContext } from '../release-build/types.js';
import { readProductionProgrammes } from './programmes.js';

const root = resolve(import.meta.dirname, '../../../..'),
  temp = mkdtempSync(join(tmpdir(), 'sigma-programme-inputs-')),
  prepared = join(temp, 'prepared'),
  sources = supplementaryProgrammeCodes.map((code) => programmeReferences[code]!),
  inputs = sources.map((source) => {
    const path = 'data/originals/program_budgets/' + source.file;
    mkdirSync(dirname(join(prepared, path)), { recursive: true });
    cpSync(join(root, path), join(prepared, path));
    return {
      path,
      sha256: source.sourceSha256,
      bytes: statSync(join(prepared, path)).size,
      mime: 'application/pdf',
    };
  });
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function context(generatedCount: number): ExecutionContext {
  return {
    // No full checkout or original PDFs are available through this path.
    exportRoot: join(temp, 'absent-export'),
    preparedInputRoot: prepared,
    candidateRoot: join(temp, 'candidate'),
    scratchRoot: join(temp, 'scratch'),
    commit: 'test',
    buildDate: '2026-11-14',
    inputs: inputs.slice(generatedCount),
    missingIntermediates: inputs.slice(0, generatedCount).map((i) => ({
      path: i.path,
      declaration: 'data/originals/program_budgets/*',
      legacyPin: i.sha256,
      datasets: ['ministries-programs'],
    })),
    generatedIntermediates: inputs.slice(0, generatedCount).map((i) => ({
      ...i,
      kind: 'generated-intermediate',
      datasets: ['ministries-programs'],
    })),
  };
}

it.each([0, 1, sources.length])(
  'reads the same four documents with %i authenticated generated PDF members in an isolated prepared view',
  (generatedCount) => expect(readProductionProgrammes(context(generatedCount))).toEqual(sources),
  20000,
);

const changes: [string, (c: ExecutionContext) => void][] = [
  ['absent generated records', (c) => delete c.generatedIntermediates],
  ['absent generation declarations', (c) => delete c.missingIntermediates],
  [
    'absent generated member',
    (c) => (c.generatedIntermediates = c.generatedIntermediates!.slice(1)),
  ],
  ['wrong generated SHA', (c) => (c.generatedIntermediates![0]!.sha256 = '0'.repeat(64))],
  ['wrong generated kind', (c) => (c.generatedIntermediates![0]!.kind = 'source')],
  ['absent declared member', (c) => (c.missingIntermediates = c.missingIntermediates!.slice(1))],
  ['absent original pin', (c) => delete c.missingIntermediates![0]!.legacyPin],
  ['wrong original pin', (c) => (c.missingIntermediates![0]!.legacyPin = '0'.repeat(64))],
  [
    'wrong generator declaration',
    (c) => (c.missingIntermediates![0]!.declaration = 'data/originals/*'),
  ],
  [
    'duplicate generated member',
    (c) =>
      (c.generatedIntermediates = [...c.generatedIntermediates!, c.generatedIntermediates![0]!]),
  ],
  [
    'duplicate declaration',
    (c) => (c.missingIntermediates = [...c.missingIntermediates!, c.missingIntermediates![0]!]),
  ],
  ['conflicting direct and generated records', (c) => (c.inputs = [inputs[0]!])],
];
it.each(changes)('rejects generated programme inputs with %s', (_name, change) => {
  const c = structuredClone(context(sources.length));
  change(c);
  expect(() => readProductionProgrammes(c)).toThrow(/Missing programme source pin/);
});

it('rejects absent, duplicate and changed direct pins', () => {
  for (const records of [
    [],
    [inputs[0]!, ...inputs],
    [{ ...inputs[0]!, sha256: '0'.repeat(64) }, ...inputs.slice(1)],
  ]) {
    expect(() => readProductionProgrammes({ ...context(0), inputs: records })).toThrow(
      /Missing programme source pin/,
    );
  }
  expect(() =>
    readProductionProgrammes({
      ...context(0),
      missingIntermediates: context(1).missingIntermediates,
    }),
  ).toThrow(/Missing programme source pin/);
});

it('rechecks actual generated PDF bytes even when their recorded hashes and original pins match', () => {
  const path = join(prepared, inputs[0]!.path),
    original = readFileSync(path);
  try {
    writeFileSync(path, Buffer.concat([original, Buffer.from('\n')]));
    expect(() => readProductionProgrammes(context(sources.length))).toThrow(
      /independent PDFMiner source transcription/,
    );
  } finally {
    writeFileSync(path, original);
  }
});
