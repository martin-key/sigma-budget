import {
  AnnualLineage,
  pointer,
  provenanceId,
  type BillExtraction,
  type Extraction,
} from './annual-lineage.js';
import { buildAnnualPeriods } from './fiscal-annual.js';
import { buildBudget2027 } from './budget-2027.js';
import { next2027 } from './law-evidence.js';
import { decimalSum } from './fiscal-annual.js';

export type Wave13aOwner = 'outlook' | 'revenue' | 'expenditure' | 'law';
export type LegacyOwners = Record<Wave13aOwner, Record<string, any>>;
export interface Wave13aInput {
  forecast: Extraction;
  bill: BillExtraction;
  archives: { forecast: Uint8Array; bill: Uint8Array };
  legacy: LegacyOwners;
  buildDate: string;
}
export type Wave13aOutputs = Record<
  | 'outlook.json'
  | 'revenue.json'
  | 'expenditure.json'
  | 'budget2027.json'
  | 'budget2027-provenance.json'
  | 'law.json',
  Record<string, any>
>;

/** Add current publication fields to independent upstream owners. */
export function buildWave13a(input: Wave13aInput): Wave13aOutputs {
  const lineage = new AnnualLineage(input.forecast, input.bill, input.archives);
  const annual = buildAnnualPeriods(input.forecast, lineage);
  const { budget, provenance } = buildBudget2027(lineage, input.buildDate);
  const outputs: Wave13aOutputs = {
    'outlook.json': { ...input.legacy.outlook, byPeriod: annual.outlook },
    'revenue.json': { ...input.legacy.revenue, byPeriod: annual.revenue },
    'expenditure.json': { ...input.legacy.expenditure, byPeriod: annual.expenditure },
    'budget2027.json': budget,
    'budget2027-provenance.json': provenance,
    'law.json': { ...input.legacy.law, next: next2027(budget as { publication: string }) },
  };
  validateProvenance(outputs, lineage);
  return outputs;
}
/** Ensure every recorded output points at its cell, and every cell has one record. */
export function validateProvenance(outputs: Wave13aOutputs, lineage?: AnnualLineage): void {
  const entries = outputs['budget2027-provenance.json'].entries as Record<string, any>;
  const seen = new Set<string>();
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Cyclic provenance operands');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const operand of entries[id]?.operands ?? []) {
      if (!Object.hasOwn(entries, operand)) throw new Error('Invalid provenance operand');
      visit(operand);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const [id, entry] of Object.entries(entries)) {
    visit(id);
    if (!Object.hasOwn(outputs['budget2027-provenance.json'].documents, entry.document))
      throw new Error('Invalid provenance document');
    if (id !== provenanceId(entry.output) || seen.has(entry.output))
      throw new Error('Duplicate or invalid provenance id');
    seen.add(entry.output);
    const [file, path] = entry.output.split('#');
    if (!file || !path || !(file in outputs) || file === 'budget2027-provenance.json')
      throw new Error('Invalid provenance output');
    const cell = pointer(outputs[file as keyof Wave13aOutputs], path);
    if (
      !cell ||
      cell.provenance !== id ||
      cell.unit !== entry.unit ||
      typeof cell.value !== 'number' ||
      !Number.isFinite(cell.value)
    )
      throw new Error(`Invalid provenance target ${entry.output}`);
    if (lineage && entry.extraction) {
      const source = entry.document === 'forecast' ? lineage.inputs.F : lineage.inputs.B;
      const extracted = pointer(source, entry.extraction);
      if (entry.operation === 'parse-billion-euro') {
        if (
          typeof extracted !== 'string' ||
          !extracted.includes(entry.printed) ||
          Number(entry.printed.match(/^(\d+(?:,\d+)?)/)?.[1]?.replace(',', '.')) !== cell.value
        )
          throw new Error('Invalid prose provenance');
      } else if (extracted !== cell.value) throw new Error('Invalid source provenance');
    }
    if (entry.operands) {
      if (
        !Array.isArray(entry.operands) ||
        !entry.operands.length ||
        new Set(entry.operands).size !== entry.operands.length ||
        entry.operands.some((operand: string) => !Object.hasOwn(entries, operand) || operand === id)
      )
        throw new Error('Invalid provenance operand');
      const cells = entry.operands.map((operand: string) => {
        const [sourceFile, sourcePath] = entries[operand].output.split('#');
        return pointer(outputs[sourceFile as keyof Wave13aOutputs], sourcePath);
      });
      if (
        !cells.every((operand: any, index: number) => operand.provenance === entry.operands[index])
      )
        throw new Error('Invalid provenance operand target');
      const values = cells.map((operand: any) => operand.value);
      if (entry.operation === 'sum' && decimalSum(values) !== cell.value)
        throw new Error('Invalid derived value');
      if (
        entry.operation === 'subtract' &&
        (values.length !== 2 || decimalSum([values[0], -values[1]]) !== cell.value)
      )
        throw new Error('Invalid derived value');
    }
  }
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (
      Object.hasOwn(value, 'provenance') &&
      typeof value.provenance === 'string' &&
      Object.hasOwn(value, 'value') &&
      !Object.hasOwn(entries, value.provenance)
    )
      throw new Error('Unlinked provenance cell');
    for (const child of Object.values(value)) walk(child);
  };
  for (const name of [
    'outlook.json',
    'revenue.json',
    'expenditure.json',
    'budget2027.json',
  ] as const) {
    const value = name === 'budget2027.json' ? outputs[name] : outputs[name].byPeriod;
    walk(value);
  }
}
