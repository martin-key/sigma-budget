// Node-only ingestion entry point. Domain builders land in subsequent ports.
export * from './parity/compare.js';
export * from './parity/policy.js';
export * from './parity/cli.js';
export * from './io/data.js';
export * from './io/registry.js';
export * from './common/metadata.js';
export * from './build/context.js';
export * from './build/annex.js';
export * from './build/fiscal.js';
export * from './common/format.js';
export * from './common/sources.js';
export * from './build/law.js';
export * from './build/editorial.js';
export * from './build/budgets.js';
export {
  loadProgrammes,
  cleanName,
  lawPolicyName,
  type ProgrammeEvidence,
  type ProgrammeLawArticle,
  type ProgrammeLawDiff,
  type ProgrammeLawEvidence,
  type ProgrammeNode,
  type ProgrammePolicy,
  type ProgrammeBudgetDifference,
  type ProgrammeRecord,
  type PendingProgrammeRecord,
  type PublishedProgrammeRecord,
} from './build/programmes.js';
export { verifyProgrammeInputs } from './build/programme-fixture.js';
export * from './build/fiscal-expenditure.js';
export * from './build/fiscal-annual.js';
export * from './build/fiscal-build.js';
export * from './build/fiscal-fixture.js';
export * from './build/measures.js';
export * from './build/debt-text.js';
