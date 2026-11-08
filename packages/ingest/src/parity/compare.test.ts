import { describe, it, expect } from "vitest";
import { compare } from "./compare.js";
import { exactPolicy, parsePolicy, type Policy } from "./policy.js";
const ctx = { dataset: "sample", file: "sample.json" };
const diff = (a: unknown, b: unknown, p = exactPolicy) => compare(a, b, ctx, p);
const policy: Policy = {
  precision: [
    { dataset: "sample", pointer: "/amount", decimals: 1, unit: "EUR" },
  ],
  accepted: [],
};
describe("semantic comparator", () => {
  it("ignores object key order", () =>
    expect(diff({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]));
  it.each([
    ["missing key", { a: null }, {}],
    ["changed string", "а", "б"],
    ["changed status", { status: "real" }, { status: "mock" }],
    ["array order", [1, 2], [2, 1]],
    ["array length", [1], [1, 2]],
    ["null versus zero", null, 0],
    ["type mismatch", "1", 1],
    ["NaN", NaN, NaN],
    ["Infinity", Infinity, Infinity],
    ["overflow parsed JSON", JSON.parse("1e999"), 0],
    ["invalid nested number", { a: NaN }, { a: NaN }],
    ["unsafe integer", { id: 2 ** 53 }, { id: 2 ** 53 }],
  ])("%s", (_name, a, b) => expect(diff(a, b).length).toBeGreaterThan(0));
  it("accepts the half-unit boundary", () =>
    expect(diff({ amount: 0 }, { amount: 0.05 }, policy)).toEqual([]));
  it("accepts half-units at large published amounts", () =>
    expect(diff({ amount: 1000000 }, { amount: 1000000.05 }, policy)).toEqual(
      [],
    ));
  it("keeps zero-decimal units exact", () =>
    expect(
      diff(
        { amount: 1 },
        { amount: 1.4 },
        {
          precision: [
            { dataset: "sample", pointer: "/amount", decimals: 0, unit: "EUR" },
          ],
          accepted: [],
        },
      ).length,
    ).toBe(1));
  it("rejects beyond the half-unit boundary", () =>
    expect(diff({ amount: 0 }, { amount: 0.0500001 }, policy)[0]).toMatchObject(
      { tolerance: 0.05, unit: "EUR", pointer: "/amount" },
    ));
  it("does not scale tolerance with amount", () =>
    expect(diff({ amount: 1e12 }, { amount: 1e12 + 0.1 }, policy).length).toBe(
      1,
    ));
  it("keeps IDs, years, counts and integer units exact", () => {
    for (const key of ["id", "years", "counts", "fiscalYears", "rowCounts"])
      expect(
        diff(
          { [key]: 1 },
          { [key]: 1.01 },
          {
            precision: [
              {
                dataset: "sample",
                pointer: `/${key}`,
                decimals: 1,
                unit: "EUR",
              },
            ],
            accepted: [],
          },
        ).length,
      ).toBe(1);
    expect(diff({ amount: 1 }, { amount: 1.001 }).length).toBe(1);
  });
  it("matches one pointer token and escapes keys", () => {
    expect(diff({ "a/b": { "~": 1 } }, { "a/b": { "~": 2 } })[0]?.pointer).toBe(
      "/a~1b/~0",
    );
    expect(
      diff(
        { x: { v: 1 } },
        { x: { v: 1.04 } },
        {
          precision: [
            { dataset: "sample", pointer: "/*/v", decimals: 1, unit: "EUR" },
          ],
          accepted: [],
        },
      ),
    ).toEqual([]);
  });
  it("accepts only the named file, pointer and exact values with rationale", () => {
    const p = parsePolicy({
      precision: [],
      accepted: [
        {
          ...ctx,
          pointer: "/status",
          expected: "draft",
          actual: "actual",
          rationale: "Approved fixture correction",
        },
      ],
    });
    expect(diff({ status: "draft" }, { status: "actual" }, p)[0]?.outcome).toBe(
      "accepted",
    );
    expect(diff({ status: "draft" }, { status: "other" }, p)[0]?.outcome).toBe(
      "different",
    );
    expect(() =>
      parsePolicy({
        precision: [],
        accepted: [{ ...p.accepted[0], rationale: "" }],
      }),
    ).toThrow();
  });
});
