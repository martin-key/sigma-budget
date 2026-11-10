/** Dedicated integration barrel; production aggregate registration belongs to the caller. */
import type { Context } from './context.js';
import type { Group } from './runner.js';
import { componentsRatesGroups, ratesGroup, type NapRowsReader } from './components-rules.js';
import { indirectGroup, type IndirectEvidenceReader } from './indirect-rules.js';
import { executionIntegrityGroup, type ExecutionLawReader } from './execution-integrity.js';
export {
  components,
  rates,
  componentsRatesGroups,
  ratesGroup,
  NAP_ORIGINAL_PATH,
  type NapRowsReader,
  type NapRow,
} from './components-rules.js';
export {
  indirect,
  indirectGroup,
  INDIRECT_SOURCE_PATHS,
  type IndirectEvidence,
  type IndirectEvidenceReader,
  type OriginalBytes,
} from './indirect-rules.js';
export {
  executionIntegrity,
  executionIntegrityGroup,
  type ExecutionLawReader,
  type ExecutionLawTable,
} from './execution-integrity.js';
export { INDEPENDENT_RULE_NAMES } from './rule-support.js';
export interface IndependentRuleReaders {
  nap?: NapRowsReader;
  indirect?: IndirectEvidenceReader;
  executionLaw?: ExecutionLawReader;
}
/** Missing bindings are reported in Check diagnostics/facts. This factory makes no
 * completeValidation claim and does not register or replace any other group. */
export function independentRuleGroups(readers: IndependentRuleReaders = {}): Group<Context>[] {
  return [
    componentsRatesGroups[0]!,
    ratesGroup(readers.nap),
    indirectGroup(readers.indirect),
    executionIntegrityGroup(readers.executionLaw),
  ];
}
