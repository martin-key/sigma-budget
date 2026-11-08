import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  link,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it, expect } from "vitest";
import { parseRegistry, compareScope, parityCli } from "./cli.js";
import { exactPolicy } from "./policy.js";
it("rejects duplicate YAML keys and dataset ids", () => {
  expect(() => parseRegistry("schema: 1\nschema: 1\ndatasets: []")).toThrow();
  expect(() =>
    parseRegistry("schema: 1\ndatasets: [{id: a}, {id: a}]"),
  ).toThrow();
});
it("protects the project release directory independently of the caller directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "budget-parity-project-"));
  try {
    const report = fileURLToPath(
      new URL(
        "../../../../data/release/forbidden-report.json",
        import.meta.url,
      ),
    );
    // The absent registry prevents a write if the path guard regresses.
    await expect(
      parityCli([
        "--oracle",
        join(root, "oracle"),
        "--candidate",
        join(root, "candidate"),
        "--scope",
        "ministry",
        "--policy",
        join(root, "policy.json"),
        "--registry",
        join(root, "missing-registry.yaml"),
        "--report",
        report,
      ]),
    ).rejects.toThrow("outside input roots");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("preserves registry and policy inputs when reports alias their paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "budget-parity-inputs-"));
  try {
    const oracle = join(root, "oracle"),
      candidate = join(root, "candidate");
    await mkdir(oracle);
    await mkdir(candidate);
    await writeFile(join(oracle, "a.json"), "{}");
    await writeFile(join(candidate, "a.json"), "{}");
    const reg = join(root, "registry.yaml"),
      override = join(root, "override.yaml"),
      pol = join(root, "policy.json");
    const yaml =
      'schema: 1\ndatasets: [{id: ministry, files: ["data/release/*.json"]}]';
    await writeFile(reg, yaml);
    await writeFile(override, yaml);
    await writeFile(pol, JSON.stringify(exactPolicy));
    const args = [
      "--oracle",
      oracle,
      "--candidate",
      candidate,
      "--scope",
      "ministry",
      "--policy",
      pol,
    ];
    const cases = [
      { input: reg, extra: [] },
      { input: override, extra: ["--registry", override] },
      { input: pol, extra: [] },
    ];
    for (const [i, c] of cases.entries()) {
      const before = await readFile(c.input);
      const symbolic = join(root, `symbolic-${i}`),
        hard = join(root, `hard-${i}`);
      await symlink(c.input, symbolic);
      await link(c.input, hard);
      for (const report of [c.input, symbolic, hard]) {
        await expect(
          parityCli([...args, ...c.extra, "--report", report], reg),
        ).rejects.toThrow(/Report/);
        expect(await readFile(c.input)).toEqual(before);
      }
    }
    const report = join(root, "report.json");
    expect(
      await parityCli(
        [...args, "--registry", override, "--report", report],
        reg,
      ),
    ).toBe(0);
    expect(JSON.parse(await readFile(report, "utf8")).outcome).toBe("pass");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("compares exact scoped file sets, pending and absent inputs, and CLI exit codes", async () => {
  const root = await mkdtemp(join(tmpdir(), "budget-parity-"));
  try {
    const oracle = join(root, "oracle"),
      candidate = join(root, "candidate");
    await mkdir(oracle);
    await mkdir(candidate);
    const registry = [{ id: "ministry", files: ["data/release/*.json"] }];
    const opts = {
      oracle,
      candidate,
      registry,
      scope: ["ministry"],
      policy: exactPolicy,
    };
    await writeFile(join(oracle, "a.json"), "{}");
    expect((await compareScope(opts)).outcome).toBe("fail");
    await writeFile(join(candidate, "a.json"), "{}");
    expect((await compareScope(opts)).outcome).toBe("pass");
    await writeFile(join(candidate, "stale.json"), "{}");
    expect((await compareScope(opts)).differences[0]?.kind).toBe("file-set");
    await rm(join(candidate, "stale.json"));
    await writeFile(join(oracle, "a.json"), '{"id":9007199254740992}');
    await writeFile(join(candidate, "a.json"), '{"id":9007199254740993}');
    expect((await compareScope(opts)).outcome).toBe("fail");
    await writeFile(join(oracle, "a.json"), "{}");
    await writeFile(join(candidate, "a.json"), '{"value":NaN}');
    expect((await compareScope(opts)).outcome).toBe("fail");
    expect(
      (await compareScope({ ...opts, oracle: join(root, "missing") })).outcome,
    ).toBe("unverified");
    expect(
      (
        await compareScope({
          ...opts,
          registry: [{ id: "ministry", files: [] }],
        })
      ).outcome,
    ).toBe("unverified");
    await expect(
      compareScope({ ...opts, scope: ["unknown"] }),
    ).rejects.toThrow();
    const reg = join(root, "registry.yaml"),
      pol = join(root, "policy.json");
    await writeFile(
      reg,
      'schema: 1\ndatasets: [{id: ministry, files: ["data/release/*.json"]}]',
    );
    await writeFile(pol, JSON.stringify(exactPolicy));
    const args = [
      "--oracle",
      oracle,
      "--candidate",
      candidate,
      "--scope",
      "ministry",
      "--policy",
      pol,
      "--report",
      join(root, "report.json"),
    ];
    expect(await parityCli(args, reg)).toBe(1);
    const unsafe = [...args];
    unsafe[9] = join(oracle, "report.json");
    await expect(parityCli(unsafe, reg)).rejects.toThrow("outside input roots");
    await writeFile(join(candidate, "a.json"), "{}");
    expect(await parityCli(args, reg)).toBe(0);
    args[1] = join(root, "missing");
    expect(await parityCli(args, reg)).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
