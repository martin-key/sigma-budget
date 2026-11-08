import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
export interface FixtureManifest {
  schema: 1;
  baselineRevision: string;
  buildDate: string;
  inputs: { path: string; sha256: string }[];
  datasets: {
    id: string;
    eligibility: "reproducible" | "frozen-only" | "unverified";
    rationale: string;
  }[];
}
export function parseFixtureManifest(v: unknown): FixtureManifest {
  const m = v as FixtureManifest | null;
  if (
    !m ||
    m.schema !== 1 ||
    !/^[a-f0-9]{40}$/.test(m.baselineRevision) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(m.buildDate) ||
    !Array.isArray(m.inputs) ||
    !Array.isArray(m.datasets)
  )
    throw new Error("Invalid fixture manifest");
  const paths = new Set<string>();
  for (const f of m.inputs) {
    if (
      !f ||
      typeof f.path !== "string" ||
      !f.path ||
      isAbsolute(f.path) ||
      f.path.split(/[\\/]/).includes("..") ||
      paths.has(f.path) ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error("Invalid fixture input");
    paths.add(f.path);
  }
  const ids = new Set<string>();
  for (const d of m.datasets) {
    if (
      !d ||
      typeof d.id !== "string" ||
      !d.id ||
      ids.has(d.id) ||
      !["reproducible", "frozen-only", "unverified"].includes(d.eligibility) ||
      typeof d.rationale !== "string" ||
      !d.rationale.trim()
    )
      throw new Error("Invalid fixture eligibility");
    ids.add(d.id);
  }
  return m;
}
export async function resolveFixture(
  root: string,
  manifest: FixtureManifest,
  name: string,
): Promise<string> {
  const entry = manifest.inputs.find((f) => f.path === name);
  if (!entry) throw new Error(`Uninventoried fixture: ${name}`);
  const base = await realpath(root),
    file = await realpath(resolve(base, name));
  const rel = relative(base, file);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Fixture escapes root");
  if (
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex") !== entry.sha256
  )
    throw new Error(`Fixture hash mismatch: ${name}`);
  return file;
}
