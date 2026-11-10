# Registered TypeScript production import

`budget-ts build` now assembles the registered current sources, executes the existing `wave13bStages` graph, runs all 26 domain groups plus REGISTRY, and packages the actual outputs through the release-build lifecycle. `./budget` is the normal Node dispatcher, keeping compiled workspace tools current through Turbo. `./budget-python` preserves the historical Python launcher byte for byte. The existing scoped fixture commands remain reproducibility tests; the production dispatcher never calls their assemblers or expected outputs.

```sh
pnpm install --frozen-lockfile
pnpm --filter @sigma-budget/etl... build
./budget build --commit HEAD --inputs /acquired-snapshot \
  --out /owned/new-candidate --build-date 2026-11-10
./budget validate --release /owned/new-candidate --inputs /acquired-snapshot
./budget reproduce --manifest /owned/new-candidate/manifest.json \
  --originals /acquired-snapshot --out /owned/new-replay
BUDGET_CANDIDATE=/owned/new-candidate pnpm --filter @sigma-budget/web... build
```

Every candidate/replay destination must be new and outside the checkout and source/dependency trees. Build dates are explicit UTC dates. `validate` authenticates and numerically rebuilds the recorded candidate through local reproduction; it does not merely trust its stored report. Source roots contain `data/originals` and `data/cache`, optionally an authenticated source-client snapshot. Committed authored inputs come from the recorded Git commit. No acquisition occurs during a build.

## Sources and production boundary

The loader consumes the real ASBP PDF and DOCX EMF tables, 33 monthly BIFF reports, annual ZIP members/PDF physical tables, legal HTML/DOCX, programme archive and all 46 member PDFs, DBP and NAP PDFs, EC workbooks, Customs/NSI documents, BNB SDMX, Parliament snapshots, Eurostat JSON-stat and saved GISCO/oblast caches. It verifies existing intermediates against these rereads, retains their bytes and fails on stale values. A finite registered generator binding covers absent reproducible ASBP/law/DBP/annual/function/indirect/programme intermediates. The executor generates them only in `scratch/prepared-inputs`; the lifecycle verifies that complete view against the immutable export and staged originals, requires every planned file and rejects extra files. Fresh intermediate facts are recorded separately as `processing.generated_intermediates`, with exact original-pin matches distinguished from newly generated intermediate identities. A missing raw source or unbound/historical intermediate fails before production execution. The full declared closure remains mandatory.

The old programme source is accepted only by PR51's exact three full-document fingerprints. The production adapter also records the exact old/fresh DBP JSON fingerprints for its three historical path/producer labels; every amount, unit, quotation and other field must still match. There is no wildcard legacy exception. July WEB_2 component evidence, authored measures/editorial history, the original historical GISCO response and old Eurostat/GVA vintages remain unavailable as documented. The committed GVA bytes under `packages/ingest/src/production/historical` are explicitly preserved published material, not a new raw extraction. Newer supplied national-account responses do not authorize revising that historical publication. The full 2027–2029 programme archive is still unavailable; 2027/2028 columns inside the 2026 PDFs keep their own forecast meaning.

Independent KFP expectations use actual workbook cells. RATES, INDIRECT and CONTRACT bind the real NAP reader, independent six-source reader and independently selected physical Annex 1 table. DEBT/MUNIC/SEBRA add authenticated original-source assertions and source/geometry predicates to their existing donor rules. Reusing document transport does not reuse dataset-producer results as numerical expectations. Exact documented CORE/CATALOG contract exceptions and the two exact SZR36 coordinate fingerprints remain unchanged.

`completeValidation` is emitted only after every required group has run, has a positive check count and has no problems. Source and topology checks are additional groups. Historical raw reconstruction is recorded separately as `unverified`; no package claims recovery of all historical originals.

## Recorded code and deterministic packaging

`productionExecutor(dependenciesRoot)` implements the exact `ReleaseExecutor.execute(ExecutionContext) -> ExecutorResult` ABI. The committed entry is `packages/ingest/src/production/entry.ts`. The lifecycle exports the requested commit, removes old releases, authenticates/stages the full registry closure and checks all exported/staged bytes after execution. The adapter compiles only exported workspace source with the matching installed lock and pinned esbuild 0.28.2. It records the actual compiler API/binary, runner, adapter, committed entry and bundled code hashes. No install, network or current-checkout producer fallback exists. WASM assets are private scratch copies of the locked packages.

The Node process has bounded runtime/output and filesystem permissions restricted to the export, scratch and candidate. Its archive worker retains permissions and its independent memory/deadline bounds. The old Emscripten constants accessor is supplied from public frozen filesystem constants; NODEFS/WORKERFS are not mounted. Reader receipts normalize owned paths to logical export/scratch names, so random temporary directories do not change release identity.

The graph emits no old `releases/current.json` seed. The registry checker accounts for that one lifecycle-owned metadata route explicitly, using the recorded export inventory rather than checkout Git metadata. The candidate site generates the new pointer after hashing the manifest. Every active owner/file and catalogue size/gzip fact comes from generated or explicitly preserved bytes; the functional artifact count is derived from the registry and manifest.

New Node candidates require complete executed validation and a receipt binding the manifest, executor, snapshot, validation and output inventory. The package client and `BUDGET_CANDIDATE` reader enforce this contract without weakening path/hash checks. SSR and browser metadata retain one release ID. Historical Python manifests remain on their recorded Python replay path:

```sh
PYTHON312=/path/to/pinned/python3.12 pnpm exec budget-ts reproduce \
  --manifest /historical/manifest.json --historical-python --env local
```

A new Node executor is never applied under an old Python commit label.

## Normal command map

| Command                                                | Implementation and semantics                                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`                                                | Registered offline source assembly, existing graph, complete validation and release-build packaging; optional explicit local `--site` installation.                                           |
| `validate --release/--site`                            | Recorded-date, recorded-code numerical replay and package verification.                                                                                                                       |
| `reproduce --manifest/--current`                       | Local manifest or existing public Worker/static current protocol, authenticated input/output bytes and exact replay. Explicit `--skip-published` omits published-output retrieval/comparison. |
| `collect`, `refetch`, `import-source`                  | Source-client immutable acquisition/versioned snapshots and receipts. KFP imports bind the real workbook decoder automatically. Acquisition output is a separate new directory.               |
| `source-status`, `drift`, `freshness`                  | Local source/pin/freshness diagnostics and reviewed drift.                                                                                                                                    |
| `status`, `upload`, `publish`, `rollback`, `preflight` | Existing release-client protocol, named environment, guarded credentials, stable request IDs, CAS, resumable uploads, lost-response/readback behavior. No remote operation is implicit.       |
| `prepare`                                              | Offline actual fiscal, annual and publication reader preparation, including nested ZIP/7z archives, in separate owned output directories.                                                     |
| scoped `build --scope ...`, `parity`, `wave13b-live`   | Existing frozen migration/reference commands, separate from the production build.                                                                                                             |

There is no `restore` subcommand. The existing operator procedure and protocol restore scenarios remain in `docs/operator-guide.md`, `tests/release/release_check.py` and `tests/release/restore_drill.py`.

## Finite required acceptance and CI inputs

```sh
node scripts/node-import-acceptance.mjs /acquired-snapshot /owned/new-acceptance 2026-11-10 /accepted-python-candidate
node scripts/node-candidate-site-acceptance.mjs /owned/new-acceptance/candidate /owned/new-site-proof
```

The first script requires actual inputs, two builds and local reproduction with identical IDs and all package bytes. It executes independent number/provenance/unit mutations, missing raw, stale intermediate and failed-stage rejection. Optional Python comparison checks every JSON value and RSS byte under the existing exact-money/source policy; only independently audited byte-derived catalogue sizes are classified separately. The site script requires a fresh Node receipt, builds in an owned Git export, serves an owned ephemeral loopback Worker and checks representative SSR/assets, actual Chromium dataset identity and the registered execution CSV. Chromium must already be provisioned; the script installs nothing, blocks external browser requests and cleans up its own processes.

The required `node-inputs` job downloads the approved repository-owned draft release asset. Draft access requires `contents: write`, restricted to that small job: it has no checkout, dependency installation or project-code execution, and the token is passed only to a fixed GitHub download command. It checks the literal archive digest and size before passing an Actions artifact to `node-import`. The importer retains the workflow default `contents: read`, receives no token, and `scripts/restore-node-input-cache.mjs` makes a private copy authenticated against `scripts/registered-node-inputs.json`, then verifies every registered input and the snapshot identity before installation. A missing archive, changed byte, registry mismatch or invalid input fails the job. No live fiscal fetch, acceptance skip or fixture fallback exists. The draft remains unpublished CI storage. `scripts/prepare-node-input-cache.mjs` prepares a replacement snapshot for review; the fixed bootstrap digest must change with its descriptor. Existing frozen proofs (including the same 17/max-two proof pool), data-image, release/restore jobs, triggers and deployment guards remain; deployment additionally waits for this acceptance. Source drift invokes the normal Node source command.

Independent component acceptances are inherited evidence. Whole-integration acceptance, final CI readiness and any merge remain parent-owned. No live source refresh, Cloudflare authentication, provisioning, upload, publish, rollback, deployment or recovery is part of local acceptance.
