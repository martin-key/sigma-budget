import type { ReleaseFile, ReleaseManifest } from '../release-client/types.js';

/** The complete production rule set; raw reconstruction is a separate assertion. */
export const REQUIRED_VALIDATION_GROUPS = [
  'INPUTS',
  'ENVELOPE',
  'NUMBERS',
  'SIZES',
  'PRIVACY',
  'GLOSSARY',
  'CORE',
  'KFP',
  'ANNEX3',
  'REVENUE',
  'EXPENDITURE',
  'MEASURES',
  'BUDGET2027',
  'LAW',
  'BUDGETS',
  'PROGRAMS',
  'DEBT',
  'MUNIC',
  'SEBRA',
  'COMPONENTS',
  'RATES',
  'SEARCH',
  'FEED',
  'CATALOG',
  'INDIRECT',
  'CONTRACT',
] as const;
export interface ValidationGroup {
  group: string;
  status: 'OK' | 'WARN' | 'FAIL' | 'SKIP';
  checks: number;
  summary: string;
  problems: string[];
  warnings: string[];
}
export interface ExecutorResult {
  validation: { completeValidation: true; groups: ValidationGroup[] };
  datasets: { id: string; action: 'built' | 'preserved-input' }[];
  /** Optional actual extraction evidence; never substitutes for validation groups. */
  extractions?: unknown[];
}
export interface ExecutionContext {
  /** No .git or pre-existing release outputs; external bytes are private copies. */
  exportRoot: string;
  /** Only data/** may be written here. Lifecycle owns manifest/validation/receipt. */
  candidateRoot: string;
  scratchRoot: string;
  commit: string;
  buildDate: string;
  inputs: readonly ReleaseFile[];
}
export interface ExecutorIdentity {
  runtime: 'node-export/1';
  id: string;
  /** Committed entry, relative to exportRoot. Its bytes are independently hashed. */
  entry: string;
}
/** Trusted adapter: execute exported code, never import current-checkout producers.
 * The adapter must confine writes to candidateRoot and scratchRoot and use no network.
 * This is an execution/trust contract, not an OS sandbox for hostile code. */
export interface ReleaseExecutor {
  identity: ExecutorIdentity;
  /** Native bridge hash, or the trusted adapter's committed runner entry/hash. */
  bridgeSha256?: string;
  /** Optional trusted offline compiler/dependency installation; its lock must equal the export. */
  dependenciesRoot?: string;
  execute(context: Readonly<ExecutionContext>): Promise<ExecutorResult>;
}
export interface BuildReleaseOptions {
  repositoryRoot: string;
  commit: string;
  inputRoot: string;
  outputRoot: string;
  buildDate: string;
  executor: ReleaseExecutor;
  /** Explicit object size contract; 64 MiB is needed by the accepted programme ZIP. */
  maxObjectBytes?: number;
}
export interface BuildReleaseResult {
  releaseId: string;
  manifest: ReleaseManifest;
  outputRoot: string;
}
export interface ReproduceOptions extends Omit<BuildReleaseOptions, 'commit' | 'buildDate'> {
  releaseRoot: string;
}

/** Python-compatible local replay verdict: byte differences are exit 1, not invalid input. */
export class ReproductionDifference extends Error {
  readonly code = 1;
  constructor(message: string) {
    super(message);
    this.name = 'ReproductionDifference';
  }
}
