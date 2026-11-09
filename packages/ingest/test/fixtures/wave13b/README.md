# Wave 13b: build graph and publication layers

The baseline is `027a262288c0b0ca4b188482a8b8da43bb378047` and the build date is 2026-11-08. `artifact-inventory.json` maps the 70 registry files to their Python producers, graph stages, inputs, evidence modes and eligibility. The 42 ministry details are listed individually. The reference contains 66 eligible candidate files, three frozen-only files (`execution.json`, `execution-provenance.json`, and `releases/current.json`), and the unverified, hash-pinned `gva-sectors.json`. Guide and glossary restoration is checked from frozen editorial snapshots; their original texts are unavailable. No M06/M07 files are restored.

`provenance.json` pins the complete TypeScript reader input and evidence inventory, including the dataset and source registries, current routes, wording and editorial inputs. `proof.json` pins the unchanged Python modules from the baseline, the runner, this inventory and each independent reference file. The runner executes the current Python dataset order and wrapper layers using only these Git-exportable fixtures. Python acquisition and parser calls are replaced with frozen reader captures, not with generated datasets. KFP execution and its provenance are explicitly frozen because their transformation has no eligible TypeScript producer yet. The dated Eurostat GVA responses from October are missing; comparing its frozen bytes cannot establish regeneration.

The source archive is `release-build-inputs-2026-11-08-period-selector-complete.tar.gz`, SHA-256 `9430d8acfe5bd178a1675041aaae22295c89f2768474ebd27af347b465ace5e3`. Reader captures retain their existing source hashes and limitations, including the unavailable original July component source, unrecovered historical debt/GISCO responses and the earlier editorial texts. The `SZR36` boundary is reproduced only with the existing exact-hash opt-in; that exception does not establish valid geometry. The new indirect-tax fixture records six source hashes and independently preserves the original Python producer and reader IR.

Regenerate and check without access to a live release, cache or registry:

```sh
PYTHONDONTWRITEBYTECODE=1 python3.12 packages/ingest/test/fixtures/indirect-taxes/regenerate.py
PYTHONDONTWRITEBYTECODE=1 python3.12 packages/ingest/test/fixtures/wave13b/generate_oracle.py --check
pnpm --filter @sigma-budget/etl... build
pnpm exec budget-ts build --inputs packages/ingest/test/fixtures --out tmp/ts-migration/candidates/candidate13b --scope wave13b --build-date 2026-11-08
```

The candidate report records dependencies, each stage state, artifact eligibility, exact JSON differences, RSS byte differences and separately reported catalog byte-size differences. It verifies catalog metadata against actual candidate bytes. A successful report remains `unverified` because of GVA. The optional `pnpm exec budget-ts wave13b-live` is a separate read-only diagnostic against the local published release and is not a required frozen CI check.
