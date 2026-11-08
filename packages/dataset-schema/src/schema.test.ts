// Filesystem is confined to tests; production exports have no platform imports.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import { describe, it, expect } from "vitest";
import {
  datasetGuards,
  isDataset,
  canonicalDecimal,
  metaGuard,
  type DatasetName,
} from "./index.js";
const root = fileURLToPath(new URL("../../../data/release/", import.meta.url));
describe("published contracts", () => {
  it("covers exactly the published file inventory", () =>
    expect(
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(root, `${e.parentPath}/${e.name}`))
        .sort(),
    ).toEqual(Object.keys(datasetGuards).sort()));
  for (const name of Object.keys(datasetGuards) as DatasetName[])
    it(name, () => {
      const text = readFileSync(root + name, "utf8");
      const value: unknown = name.endsWith(".json") ? JSON.parse(text) : text;
      expect(isDataset(name, value)).toBe(true);
      if (typeof value === "object" && value !== null && "meta" in value)
        expect(
          metaGuard({ ...(value.meta as object), status: "invented" }),
        ).toBe(false);
    });
  it("rejects bad decimal encodings", () => {
    for (const v of ["01", "1e3", "NaN", "-0", "-0.00", 1, null, "+1", ".1"])
      expect(() => canonicalDecimal(v)).toThrow();
    for (const v of ["0", "0.00", "-0.01", "123.45"])
      expect(canonicalDecimal(v)).toBe(v);
  });
  it("rejects floats and wrong precision in canonical execution money", () => {
    const value = JSON.parse(readFileSync(root + "execution.json", "utf8"));
    value.data["2024"].kfp.rev[0] = 1;
    expect(isDataset("execution.json", value)).toBe(false);
    value.data["2024"].kfp.rev[0] = "1.0";
    expect(isDataset("execution.json", value)).toBe(false);
  });
  it("rejects missing envelope fields", () =>
    expect(metaGuard({ status: "real" })).toBe(false));
});
