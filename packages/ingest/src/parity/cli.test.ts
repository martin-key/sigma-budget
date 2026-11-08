import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { parseRegistry, compareScope, parityCli } from "./cli.js";
import { exactPolicy } from "./policy.js";
it("rejects duplicate YAML keys and dataset ids", () => {
  expect(() => parseRegistry("schema: 1\nschema: 1\ndatasets: []")).toThrow();
  expect(() =>
    parseRegistry("schema: 1\ndatasets: [{id: a}, {id: a}]"),
  ).toThrow();
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
