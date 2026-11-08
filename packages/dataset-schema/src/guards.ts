export type Guard<T> = (value: unknown) => value is T;
export type Infer<G> = G extends Guard<infer T> ? T : never;
export type Json =
  | null
  | boolean
  | string
  | number
  | Json[]
  | { [key: string]: Json };
export const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const string: Guard<string> = (v): v is string => typeof v === "string";
export const number: Guard<number> = (v): v is number =>
  typeof v === "number" && Number.isFinite(v);
export const boolean: Guard<boolean> = (v): v is boolean =>
  typeof v === "boolean";
export const json: Guard<Json> = (v): v is Json =>
  v === null ||
  string(v) ||
  boolean(v) ||
  number(v) ||
  (Array.isArray(v)
    ? v.every(json)
    : object(v) && Object.values(v).every(json));
export const record: Guard<Record<string, Json>> = (
  v,
): v is Record<string, Json> => object(v) && Object.values(v).every(json);
export const array: Guard<Json[]> = (v): v is Json[] =>
  Array.isArray(v) && v.every(json);
export function shape<S extends Record<string, Guard<unknown>>>(
  fields: S,
): Guard<{ [K in keyof S]: Infer<S[K]> } & Record<string, Json>> {
  return (v): v is { [K in keyof S]: Infer<S[K]> } & Record<string, Json> =>
    record(v) &&
    Object.entries(fields).every(
      ([k, guard]) => Object.hasOwn(v, k) && guard(v[k]),
    );
}
export const strings: Guard<string[]> = (v): v is string[] =>
  Array.isArray(v) && v.every(string);
export const status: Guard<"real" | "mock" | "pending"> = (
  v,
): v is "real" | "mock" | "pending" =>
  v === "real" || v === "mock" || v === "pending";
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
export const isCanonicalDecimal: Guard<CanonicalDecimal> = (
  v,
): v is CanonicalDecimal =>
  string(v) &&
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) &&
  !/^-0(?:\.0+)?$/.test(v);
export function canonicalDecimal(v: unknown): CanonicalDecimal {
  if (!isCanonicalDecimal(v)) throw new Error("Invalid canonical decimal");
  return v;
}
export function list<T>(guard: Guard<T>): Guard<T[]> {
  return (v): v is T[] => Array.isArray(v) && v.every(guard);
}
export function literal<T extends string>(value: T): Guard<T> {
  return (v): v is T => v === value;
}
export const sha256: Guard<string> = (v): v is string =>
  string(v) && /^[a-f0-9]{64}$/.test(v);
export const nonnegativeInteger: Guard<number> = (v): v is number =>
  number(v) && Number.isSafeInteger(v) && v >= 0;
export const releasePointerGuard = shape({
  release_id: sha256,
  manifest: string,
  built: string,
});
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
  role: literal("validation"),
  mime: string,
});
export const releaseOutputGuard: Guard<
  Infer<typeof datasetOutputGuard> | Infer<typeof validationOutputGuard>
> = (
  v,
): v is
  | Infer<typeof datasetOutputGuard>
  | Infer<typeof validationOutputGuard> =>
  datasetOutputGuard(v) || validationOutputGuard(v);
export const releaseManifestGuard = shape({
  manifest_schema: literal("budget-release/1"),
  provenance_format: literal("provenance/1"),
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
});
export type ReleaseInput = Infer<typeof releaseInputGuard>;
export type ReleaseOutput = Infer<typeof releaseOutputGuard>;

export type DatasetEnvelope<T extends Record<string, Json>> = T & {
  meta: Meta;
};
export function mapOf<T extends Json>(
  guard: Guard<T>,
): Guard<Record<string, T>> {
  return (v): v is Record<string, T> =>
    record(v) && Object.values(v).every(guard);
}
export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (v): v is T | null => v === null || guard(v);
}
export function decimalPlaces(places: number): Guard<CanonicalDecimal> {
  return (v): v is CanonicalDecimal =>
    isCanonicalDecimal(v) && (v.split(".")[1]?.length ?? 0) === places;
}
export const executionSchemas = {
  current: "execution/2",
  legacy: "execution/1",
  provenance: "provenance/1",
} as const;
const rows3 = mapOf(list(nullable(decimalPlaces(3))));
export const executionColumnsGuard = shape({
  kfp: rows3,
  nat: rows3,
  eu: rows3,
});
const rows1 = mapOf(nullable(decimalPlaces(1)));
export const executionPlanGuard = shape({ kfp: rows1, nat: rows1, eu: rows1 });
