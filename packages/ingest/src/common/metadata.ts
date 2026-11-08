import type { Json } from '@sigma-budget/dataset-schema';
export const DATASET_SOURCES_NOTE =
  'Данните са от публични източници; пълните препратки са в „Данни“ → източници.';
export interface MetaOptions {
  status?: string;
  source?: string[];
  sourceNote?: string | null;
  asOf?: string | null;
  unit?: string | null;
  extra?: Record<string, Json>;
}
export function metadata(
  id: string,
  title: string,
  buildDate: string,
  options: MetaOptions = {},
): Record<string, Json> {
  const status = options.status ?? 'real';
  return {
    id,
    title,
    status,
    source: [...(options.source ?? [])],
    ...(options.sourceNote ? { sourceNote: options.sourceNote } : {}),
    asOf: options.asOf || buildDate,
    retrieved: buildDate,
    ...(options.unit ? { unit: options.unit } : {}),
    ...options.extra,
    mock: status === 'mock',
  };
}
export function span<T>(values: (T | null)[]): [number, T[]] {
  const first = values.findIndex((v) => v !== null);
  if (first < 0) return [0, []];
  let last = values.length - 1;
  while (values[last] === null) last--;
  const segment = values.slice(first, last + 1);
  if (segment.some((v) => v === null))
    throw new Error(`blank inside a series: ${JSON.stringify(values)}`);
  return [first, segment as T[]];
}
