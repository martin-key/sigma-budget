import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { it, expect } from "vitest";
import { parseFixtureManifest, resolveFixture } from "./index.js";
it("verifies inventory, hashes and path confinement", async () => {
  const root = await mkdtemp(join(tmpdir(), "budget-fixture-"));
  try {
    await writeFile(join(root, "input"), "python evidence");
    const m = parseFixtureManifest({
      schema: 1,
      baselineRevision: "a".repeat(40),
      buildDate: "2026-11-05",
      inputs: [
        {
          path: "input",
          sha256: createHash("sha256").update("python evidence").digest("hex"),
        },
      ],
      datasets: [
        {
          id: "sample",
          eligibility: "frozen-only",
          rationale: "Source absent",
        },
      ],
    });
    expect(await resolveFixture(root, m, "input")).toBe(join(root, "input"));
    await expect(resolveFixture(root, m, "unknown")).rejects.toThrow();
    await writeFile(join(root, "input"), "changed");
    await expect(resolveFixture(root, m, "input")).rejects.toThrow(
      "hash mismatch",
    );
    await symlink("/etc/hosts", join(root, "escape"));
    await expect(
      resolveFixture(
        root,
        { ...m, inputs: [{ path: "escape", sha256: "0".repeat(64) }] },
        "escape",
      ),
    ).rejects.toThrow("escapes");
    expect(() =>
      parseFixtureManifest({
        ...m,
        inputs: [{ path: "../escape", sha256: "0".repeat(64) }],
      }),
    ).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
