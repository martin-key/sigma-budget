import {
  readFile,
  readdir,
  stat,
  mkdir,
  writeFile,
  realpath,
} from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../io/registry.js";
import { object } from "@sigma-budget/dataset-schema";
import { compare, type Report } from "./compare.js";
import { parsePolicy } from "./policy.js";
export interface RegistryEntry {
  id: string;
  files: string[];
}
export function parseRegistry(text: string): RegistryEntry[] {
  const v: unknown = parseYaml(text);
  if (!object(v) || v.schema !== 1 || !Array.isArray(v.datasets))
    throw new Error("Invalid dataset registry");
  const ids = new Set<string>();
  return v.datasets.map((d) => {
    if (
      !object(d) ||
      typeof d.id !== "string" ||
      ids.has(d.id) ||
      (d.files !== undefined &&
        (!Array.isArray(d.files) ||
          !d.files.every(
            (f) =>
              typeof f === "string" &&
              f.startsWith("data/release/") &&
              !f.includes("..") &&
              !f.includes("\\"),
          )))
    )
      throw new Error("Invalid or duplicate dataset");
    ids.add(d.id);
    return { id: d.id, files: (d.files ?? []) as string[] };
  });
}
async function inventory(root: string): Promise<string[] | null> {
  try {
    if (!(await stat(root)).isDirectory()) return null;
  } catch {
    return null;
  }
  async function walk(path: string): Promise<string[]> {
    const entries = await readdir(resolve(root, path), { withFileTypes: true });
    return (
      await Promise.all(
        entries.map(async (e) => {
          const p = path ? `${path}/${e.name}` : e.name;
          if (e.isSymbolicLink())
            throw new Error(`Symlink in parity input: ${p}`);
          return e.isDirectory() ? walk(p) : [p];
        }),
      )
    ).flat();
  }
  return walk("");
}
function match(pattern: string, file: string): boolean {
  const re = pattern
    .replace(/^data\/release\//, "")
    .split("*")
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${re}$`).test(file);
}
export async function compareScope(options: {
  oracle: string;
  candidate: string;
  scope: string[];
  registry: RegistryEntry[];
  policy: ReturnType<typeof parsePolicy>;
}): Promise<Report> {
  if (
    !options.scope.length ||
    new Set(options.scope).size !== options.scope.length
  )
    throw new Error("Scope must contain unique dataset ids");
  const entries = options.scope.map((id) => {
    const d = options.registry.find((d) => d.id === id);
    if (!d) throw new Error(`Unknown scope: ${id}`);
    return d;
  });
  const [oracle, candidate] = await Promise.all([
    inventory(options.oracle),
    inventory(options.candidate),
  ]);
  const report: Report = { outcome: "pass", differences: [], unverified: [] };
  if (!oracle || !candidate)
    return {
      ...report,
      outcome: "unverified",
      unverified: ["Missing oracle or candidate directory"],
    };
  for (const entry of entries) {
    if (!entry.files.length)
      report.unverified.push(`${entry.id}: no published inputs`);
    for (const pattern of entry.files) {
      const a = oracle.filter((f) => match(pattern, f)),
        b = candidate.filter((f) => match(pattern, f));
      if (!a.length)
        report.unverified.push(`${entry.id}: missing oracle ${pattern}`);
      for (const file of new Set([...a, ...b])) {
        if (!a.includes(file) || !b.includes(file)) {
          report.differences.push({
            dataset: entry.id,
            file,
            pointer: "",
            kind: "file-set",
            expected: a.includes(file),
            actual: b.includes(file),
            tolerance: 0,
            outcome: "different",
          });
          continue;
        }
        try {
          const [x, y] = await Promise.all([
            readFile(resolve(options.oracle, file), "utf8"),
            readFile(resolve(options.candidate, file), "utf8"),
          ]);
          if (!file.endsWith(".json")) {
            report.unverified.push(`${file}: non-JSON adapter not implemented`);
            continue;
          }
          report.differences.push(
            ...compare(
              JSON.parse(x),
              JSON.parse(y),
              { dataset: entry.id, file },
              options.policy,
            ),
          );
        } catch (e) {
          report.differences.push({
            dataset: entry.id,
            file,
            pointer: "",
            kind: "invalid-json",
            actual: String(e),
            tolerance: 0,
            outcome: "different",
          });
        }
      }
    }
  }
  report.outcome = report.unverified.length
    ? "unverified"
    : report.differences.some((d) => d.outcome === "different")
      ? "fail"
      : "pass";
  return report;
}
export async function parityCli(
  args: string[],
  registryPath = "data/datasets.yaml",
): Promise<number> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      ![
        "--oracle",
        "--candidate",
        "--scope",
        "--policy",
        "--report",
        "--registry",
      ].includes(key) ||
      !value ||
      value.startsWith("--") ||
      flags[key]
    )
      throw new Error("Invalid parity arguments");
    flags[key] = value;
  }
  for (const k of [
    "--oracle",
    "--candidate",
    "--scope",
    "--policy",
    "--report",
  ])
    if (!flags[k]) throw new Error(`Required: ${k}`);
  // Reports must never overwrite an input, including through a symlinked parent.
  async function canonical(path: string): Promise<string> {
    try {
      return await realpath(path);
    } catch {
      const parent = dirname(path);
      if (parent === path) return path;
      return resolve(await canonical(parent), relative(parent, path));
    }
  }
  const reportPath = await canonical(resolve(flags["--report"]!));
  const effectiveRegistryPath = flags["--registry"] ?? registryPath;
  for (const input of [
    flags["--oracle"]!,
    flags["--candidate"]!,
    "data/release",
    fileURLToPath(new URL("../../../../data/release", import.meta.url)),
    effectiveRegistryPath,
    flags["--policy"]!,
  ]) {
    const rel = relative(await canonical(resolve(input)), reportPath);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
      throw new Error("Report must be outside input roots and data/release");
  }
  try {
    if ((await stat(reportPath)).nlink > 1)
      throw new Error("Report must not overwrite a hard-linked file");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const registry = parseRegistry(await readFile(effectiveRegistryPath, "utf8"));
  const policy = parsePolicy(
    JSON.parse(await readFile(flags["--policy"]!, "utf8")),
  );
  const report = await compareScope({
    oracle: flags["--oracle"]!,
    candidate: flags["--candidate"]!,
    scope: flags["--scope"]!.split(","),
    registry,
    policy,
  });
  await mkdir(dirname(flags["--report"]!), { recursive: true });
  await writeFile(flags["--report"]!, JSON.stringify(report, null, 2) + "\n");
  return report.outcome === "pass"
    ? 0
    : report.outcome === "unverified"
      ? 2
      : 1;
}
