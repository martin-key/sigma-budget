import { json, object } from "@sigma-budget/dataset-schema";
import { exactPolicy, precision, type Policy } from "./policy.js";
export interface Difference {
  dataset: string;
  file: string;
  pointer: string;
  expected?: unknown;
  actual?: unknown;
  kind: string;
  unit?: string;
  tolerance: number;
  outcome: "accepted" | "different";
  rationale?: string;
}
export type Outcome = "pass" | "fail" | "unverified";
export interface Report {
  outcome: Outcome;
  differences: Difference[];
  unverified: string[];
}
const token = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
export function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (object(a) && object(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
    );
  return false;
}
// Compare the decimal spellings without subtracting large binary floats at a boundary.
function withinPrecision(a: number, b: number, decimals: number): boolean {
  function scaled(n: number): [bigint, number] {
    const [mantissa = "", exp = "0"] = n.toString().split("e");
    const fraction = mantissa.split(".")[1]?.length ?? 0;
    return [BigInt(mantissa.replace(".", "")), Number(exp) - fraction];
  }
  const [x, xe] = scaled(a),
    [y, ye] = scaled(b);
  const exponent = Math.min(xe, ye, -decimals);
  const delta =
    x * 10n ** BigInt(xe - exponent) - y * 10n ** BigInt(ye - exponent);
  return (
    (delta < 0n ? -delta : delta) * 2n <= 10n ** BigInt(-decimals - exponent)
  );
}
export function compare(
  expected: unknown,
  actual: unknown,
  context: { dataset: string; file: string },
  policy: Policy = exactPolicy,
): Difference[] {
  const diffs: Difference[] = [];
  function add(
    pointer: string,
    a: unknown,
    b: unknown,
    kind: string,
    tolerance = 0,
    unit?: string,
  ) {
    const accepted =
      kind === "value" &&
      policy.accepted.find(
        (r) =>
          r.dataset === context.dataset &&
          r.file === context.file &&
          r.pointer === pointer &&
          equal(r.expected, a) &&
          equal(r.actual, b),
      );
    diffs.push({
      ...context,
      pointer,
      expected: a,
      actual: b,
      kind,
      tolerance,
      unit,
      outcome: accepted ? "accepted" : "different",
      ...(accepted ? { rationale: accepted.rationale } : {}),
    });
  }
  function walk(a: unknown, b: unknown, p: string) {
    if (!json(a) || !json(b)) {
      add(p, a, b, "invalid-json");
      return;
    }
    if (typeof a === "number" && typeof b === "number") {
      // JSON.parse rounds integers beyond 2^53, so two different literals may parse equal.
      if ([a, b].some((n) => Number.isInteger(n) && !Number.isSafeInteger(n))) {
        add(p, a, b, "unsafe-integer");
        return;
      }
      const rule = precision(policy, context.dataset, p),
        tolerance = rule && rule.decimals > 0 ? 0.5 * 10 ** -rule.decimals : 0;
      // Integer monetary units are exact; fractional units use decimal half-units.
      if (rule && tolerance ? !withinPrecision(a, b, rule.decimals) : a !== b)
        add(p, a, b, "value", tolerance, rule?.unit);
    } else if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) add(p, a.length, b.length, "array-length");
      for (let i = 0; i < Math.min(a.length, b.length); i++)
        walk(a[i], b[i], `${p}/${i}`);
    } else if (object(a) && object(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const next = `${p}/${token(k)}`;
        if (!Object.hasOwn(a, k) || !Object.hasOwn(b, k))
          add(next, a[k], b[k], "missing-key");
        else walk(a[k], b[k], next);
      }
    } else if (a !== b)
      add(
        p,
        a,
        b,
        typeof a !== typeof b ||
          a === null ||
          b === null ||
          Array.isArray(a) !== Array.isArray(b)
          ? "type"
          : "value",
      );
  }
  walk(expected, actual, "");
  return diffs;
}
