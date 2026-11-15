import { prepareExecution, type PrepareExecutionOptions } from '../readers/execution/producer.js';
import type { PinnedFile } from '../readers/workbooks/index.js';
import { readExecutionReport } from '../readers/execution/report.js';
import { P02_TITLE, P02_REASON, P02_EXPECTED } from './launch-texts.js';
import differences from '../validate/kfp-source-differences.json' with { type: 'json' };

/** Resolutions are shared by core, catalog, feed and search before graph construction. */
export const RESOLVED_PENDING = new Set(['P01', 'P03', 'P05', 'P06']);
export function resolveProductionPending<T>(pending: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(pending)
      .filter(([id]) => !RESOLVED_PENDING.has(id))
      .map(([id, value]) => [
        id,
        id === 'P02'
          ? { ...value, title: P02_TITLE, reason: P02_REASON, expected: P02_EXPECTED }
          : value,
      ]),
  );
}

/** Exact signed source differences, bound to original bytes, never a relaxed accounting tolerance. */
export function readHistoricalReport(input: PinnedFile) {
  return readExecutionReport(input, differences);
}

/** Production metadata and historical coverage, before the derived graph consumes execution. */
export function prepareProductionExecution(
  options: Omit<PrepareExecutionOptions, 'firstYear' | 'sourceDifferences'>,
) {
  const result = prepareExecution({
    ...options,
    firstYear: 2022,
    sourceDifferences: differences,
  });
  result.execution.meta.pending = (result.execution.meta.pending as string[]).filter(
    (id) => !RESOLVED_PENDING.has(id),
  );
  const contract = result.execution.contract as {
    conversion: { years: string };
    blocks: { data: { note: string } };
  };
  contract.conversion.years = '2022–2025';
  contract.blocks.data.note =
    'cumulative since 1 January; 2022–2025 are derived by the conversion from BGN';
  result.provenance.rules.data = result.provenance.rules.data!.replace(
    '2024 and 2025',
    '2022–2025',
  );
  return result;
}
