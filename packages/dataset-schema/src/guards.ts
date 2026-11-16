export type Schema = { [key: string]: any };
export type Guard<T> = ((value: unknown) => value is T) & { schema?: Schema };
export function described<T>(guard: Guard<T>, schema: Schema): Guard<T> {
  return Object.assign(guard, { schema });
}
export const schemaOf = (guard: Guard<unknown>): Schema => guard.schema ?? {};
export type Infer<G> = G extends Guard<infer T> ? T : never;
export type Json = null | boolean | string | number | Json[] | { [key: string]: Json };
export const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const string: Guard<string> = (v): v is string => typeof v === 'string';
export const number: Guard<number> = (v): v is number =>
  typeof v === 'number' && Number.isFinite(v);
export const boolean: Guard<boolean> = (v): v is boolean => typeof v === 'boolean';
export const json: Guard<Json> = (v): v is Json =>
  v === null ||
  string(v) ||
  boolean(v) ||
  number(v) ||
  (Array.isArray(v) ? v.every(json) : object(v) && Object.values(v).every(json));
export const record: Guard<Record<string, Json>> = (v): v is Record<string, Json> =>
  object(v) && Object.values(v).every(json);
export const array: Guard<Json[]> = (v): v is Json[] => Array.isArray(v) && v.every(json);
export function shape<S extends Record<string, Guard<unknown>>>(
  fields: S,
): Guard<{ [K in keyof S]: Infer<S[K]> } & Record<string, Json>> {
  return described(
    (v): v is { [K in keyof S]: Infer<S[K]> } & Record<string, Json> =>
      record(v) && Object.entries(fields).every(([k, guard]) => Object.hasOwn(v, k) && guard(v[k])),
    {
      type: 'object',
      required: Object.keys(fields),
      properties: Object.fromEntries(Object.entries(fields).map(([k, g]) => [k, schemaOf(g)])),
    },
  );
}
export const strings: Guard<string[]> = (v): v is string[] => Array.isArray(v) && v.every(string);
export const status: Guard<'real' | 'mock' | 'pending'> = (v): v is 'real' | 'mock' | 'pending' =>
  v === 'real' || v === 'mock' || v === 'pending';
Object.assign(string, { schema: { type: 'string' } });
Object.assign(number, { schema: { type: 'number' } });
Object.assign(boolean, { schema: { type: 'boolean' } });
Object.assign(json, { schema: {} });
Object.assign(record, { schema: { type: 'object' } });
Object.assign(array, { schema: { type: 'array' } });
Object.assign(strings, { schema: { type: 'array', items: { type: 'string' } } });
Object.assign(status, { schema: { enum: ['real', 'mock', 'pending'] } });
export const metaGuard = shape({
  id: string,
  title: string,
  status,
  source: strings,
  sourceNote: string,
  asOf: string,
  retrieved: string,
  mock: boolean,
});
export type Meta = Infer<typeof metaGuard>;
declare const decimalBrand: unique symbol;
export type CanonicalDecimal = string & { readonly [decimalBrand]: true };
// Canonical execution/2 uses ordinary decimal notation, no exponent or leading zeros.
export const isCanonicalDecimal: Guard<CanonicalDecimal> = (v): v is CanonicalDecimal =>
  string(v) && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) && !/^-0(?:\.0+)?$/.test(v);
export function canonicalDecimal(v: unknown): CanonicalDecimal {
  if (!isCanonicalDecimal(v)) throw new Error('Invalid canonical decimal');
  return v;
}
export function list<T>(guard: Guard<T>): Guard<T[]> {
  return described((v): v is T[] => Array.isArray(v) && v.every(guard), {
    type: 'array',
    items: schemaOf(guard),
  });
}
export function literal<T extends string>(value: T): Guard<T> {
  return described((v): v is T => v === value, { const: value });
}
export const sha256: Guard<string> = (v): v is string => string(v) && /^[a-f0-9]{64}$/.test(v);
export const nonnegativeInteger: Guard<number> = (v): v is number =>
  number(v) && Number.isSafeInteger(v) && v >= 0;
// Historical budget-release/1 metadata predates the explicit format field.
function formatEnvelope<T>(guard: Guard<T>): Guard<T> {
  return described(
    (value): value is T =>
      guard(value) &&
      object(value) &&
      (!Object.hasOwn(value, 'format') ||
        (number(value.format) && Number.isSafeInteger(value.format))),
    {
      ...schemaOf(guard),
      properties: { ...schemaOf(guard).properties, format: { type: 'integer' } },
    },
  );
}
export const releasePointerGuard = formatEnvelope(
  shape({
    release_id: sha256,
    manifest: string,
    built: string,
  }),
);
export const releaseInputGuard = shape({
  path: string,
  sha256,
  bytes: nonnegativeInteger,
  datasets: strings,
  kind: string,
  mime: string,
});
const datasetOutputGuard = shape({
  path: string,
  sha256,
  bytes: nonnegativeInteger,
  dataset: string,
  mime: string,
});
const validationOutputGuard = shape({
  path: string,
  sha256,
  bytes: nonnegativeInteger,
  role: literal('validation'),
  mime: string,
});
export const releaseOutputGuard: Guard<
  Infer<typeof datasetOutputGuard> | Infer<typeof validationOutputGuard>
> = (v): v is Infer<typeof datasetOutputGuard> | Infer<typeof validationOutputGuard> =>
  datasetOutputGuard(v) || validationOutputGuard(v);
export const releaseManifestGuard = formatEnvelope(
  shape({
    manifest_schema: literal('budget-release/1'),
    provenance_format: literal('provenance/1'),
    data_schema: record,
    compatibility: shape({ execution: strings, readers: string }),
    coverage: shape({ datasets: list(record) }),
    inputs: list(releaseInputGuard),
    outputs: list(releaseOutputGuard),
    processing: shape({
      code: record,
      command: string,
      environment: record,
      parameters: record,
      registries: record,
    }),
  }),
);
/** Build receipt that a local Node release installation keeps next to the manifest and validation report. */
export const releaseReceiptGuard = shape({
  schema: literal('node-release-build/1'),
  release_id: sha256,
  built: string,
  env: literal('node-offline'),
  commit: string,
  executor: record,
  snapshot: shape({ sha256 }),
  validation_sha256: sha256,
  outputs_sha256: sha256,
});
export type ReleaseInput = Infer<typeof releaseInputGuard>;
export type ReleaseOutput = Infer<typeof releaseOutputGuard>;

export type DatasetEnvelope<T extends Record<string, Json>> = T & {
  meta: Meta;
};
export function mapOf<T extends Json>(guard: Guard<T>): Guard<Record<string, T>> {
  return described((v): v is Record<string, T> => record(v) && Object.values(v).every(guard), {
    type: 'object',
    additionalProperties: schemaOf(guard),
  });
}
export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return described((v): v is T | null => v === null || guard(v), {
    anyOf: [{ type: 'null' }, schemaOf(guard)],
  });
}
export function decimalPlaces(places: number): Guard<CanonicalDecimal> {
  return described(
    (v): v is CanonicalDecimal =>
      isCanonicalDecimal(v) && (v.split('.')[1]?.length ?? 0) === places,
    { type: 'string' },
  );
}
export const executionSchemas = {
  current: 'execution/2',
  legacy: 'execution/1',
  provenance: 'provenance/1',
} as const;
const rows3 = mapOf(list(nullable(decimalPlaces(3))));
export const executionColumnsGuard = shape({
  kfp: rows3,
  nat: rows3,
  eu: rows3,
});
const rows1 = mapOf(nullable(decimalPlaces(1)));
export const executionPlanGuard = shape({ kfp: rows1, nat: rows1, eu: rows1 });

export const annualCellGuard = shape({ value: number, unit: string, provenance: string });
export const annualPeriodGuard = shape({
  periodKey: string,
  year: number,
  status: string,
  vintage: string,
  publication: string,
  sourceRefs: strings,
  series: mapOf(annualCellGuard),
  rows: list(record),
  gaps: mapOf(string),
});
// Older releases predate byPeriod and remain readable.
export const optionalPeriods = (v: unknown): boolean =>
  object(v) && (!Object.hasOwn(v, 'byPeriod') || validPeriodRecords(v.byPeriod));

const periodMetadata: Record<string, [number, string, string]> = {
  '2026.law': [2026, 'law', 'plan'],
  '2026.expected': [2026, 'expected', 'expected'],
  '2027.draft': [2027, 'draft', 'plan'],
  '2028.forecast': [2028, 'forecast', 'forecast'],
  '2029.forecast': [2029, 'forecast', 'forecast'],
};
export function validPeriodRecords(v: unknown): boolean {
  if (!object(v)) return false;
  return Object.entries(v).every(([key, row]) => {
    const expected = periodMetadata[key];
    return (
      !!expected &&
      annualPeriodGuard(row) &&
      row.periodKey === key &&
      row.year === expected[0] &&
      row.status === expected[1] &&
      row.vintage === expected[2]
    );
  });
}

export const budgetDocumentGuard = shape({
  source: string,
  archive: string,
  archiveSha256: sha256,
  member: string,
  memberSha256: sha256,
  input: string,
});
const budgetDocumentName: Guard<'forecast' | 'bill'> = (v): v is 'forecast' | 'bill' =>
  v === 'forecast' || v === 'bill';
const budgetProvenanceShape = shape({
  meta: metaGuard,
  schema: literal('budget2027-provenance/1'),
  documents: shape({ forecast: budgetDocumentGuard, bill: budgetDocumentGuard }),
  entries: mapOf(
    shape({ document: budgetDocumentName, output: string, period: string, unit: string }),
  ),
});
export const budgetProvenanceGuard: typeof budgetProvenanceShape = (
  v,
): v is Infer<typeof budgetProvenanceShape> =>
  budgetProvenanceShape(v) &&
  Object.values(v.entries).every(
    (entry) =>
      !['source', 'archive', 'archiveSha256', 'member', 'memberSha256', 'input'].some((key) =>
        Object.hasOwn(entry, key),
      ),
  );

// Primitive contracts also describe guards embedded by the combinators above.
