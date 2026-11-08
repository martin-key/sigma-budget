#!/usr/bin/env node
import { parityCli } from "@sigma-budget/ingest";
try {
  if (process.argv[2] !== "parity")
    throw new Error(
      "Usage: budget-ts parity --oracle <dir> --candidate <dir> --scope <ids> --policy <file> --report <file>",
    );
  process.exitCode = await parityCli(process.argv.slice(3));
} catch (e) {
  console.error(String(e));
  process.exitCode = 1;
}
