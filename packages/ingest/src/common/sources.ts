import type { Json } from '@sigma-budget/dataset-schema';
import { monthName } from './format.js';
import { pendingDefinitions, sources } from './source-definitions.js';
export { sources, pendingDefinitions };
export type PendingDefinitions = Record<
  string,
  {
    title: string | null;
    reason: string | null;
    expected: string;
    source: string[];
    screens: string[];
  }
>;
export function pendingForExecution(
  defs: PendingDefinitions,
  execution: {
    pendingMonths: { asOf: string; month: number }[];
    latest: { month: number; asOf: string };
  },
): void {
  const next = execution.pendingMonths[0]!;
  const last = execution.latest;
  const [year, month, day] = next.asOf.split('-');
  Object.assign(defs.P04!, {
    title: `Отчетът към ${day}.${month}.${year} г. и следващите`,
    reason: `Отчетът за ${monthName(next.month)} ${year} г. още не е добавен: страницата на МФ с месечните отчети се отваря само през браузър (отказ 403 към автоматични заявки), а последният наличен файл е за ${monthName(last.month)} ${last.asOf.slice(0, 4)} г.`,
  });
}
export function pendingBlock(
  defs: PendingDefinitions,
  id: string,
  override: Record<string, Json> = {},
): Record<string, Json> {
  const d = defs[id];
  if (!d) throw new Error(`Unknown pending id: ${id}`);
  return {
    status: 'pending',
    id,
    title: d.title,
    reason: d.reason,
    expected: d.expected,
    source: [...d.source],
    screens: [...d.screens],
    ...override,
  };
}
