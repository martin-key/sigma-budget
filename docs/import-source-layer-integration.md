# Import source-layer integration

This integration includes the four independently accepted component heads through
ordinary merge ancestry, on top of main `beeb5f885cb82138bf7fa1a4f3922d2b222f541b`:

| Component                                                                      | Head                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------ |
| [#43](https://github.com/midt-bg/sigma-budget/pull/43), workbook/execution     | `b3ec14f06de07f1b9ce746650ad4ba9e1763e995` |
| [#44](https://github.com/midt-bg/sigma-budget/pull/44), documents/snapshots    | `e573f6533a99c694d36e142ba0c3a58718c2adff` |
| [#46](https://github.com/midt-bg/sigma-budget/pull/46), PDF/annual preparation | `567b66ccc7a10879bd696683b163b38afedfac42` |
| [#47](https://github.com/midt-bg/sigma-budget/pull/47), release operator       | `c747b2cfc691f002058f9553aa64f6b13196c1fb` |

All 61 component files outside the shared package manifest and lockfile retain
their exact source-head Git blobs. Each standalone CLI and every component test
is retained. Main's existing Context/report guards from #35 and debt/local rules
from #42 are unchanged.

## Integration delta

`packages/ingest/package.json` contains the union of the component exports and
dependencies. The complete union was resolved during the documents merge and
retained through the annual and release-client merges. `pnpm-lock.yaml` combines
only the original component additions, retaining their integrity hashes. A
frozen-lockfile installation verifies the resulting union. There are no unrelated
version changes: SheetJS remains the official `xlsx-0.20.3.tgz` URL, `saxes` is
`6.0.0`, `htmlparser2` is `10.1.0`, and `mupdf` is `1.26.4`.

Beyond those two shared files, the integration adds only this document and
`apps/etl/test/source-layer-composition.mjs`. It changes no source algorithm,
existing test, timeout, shared ingest barrel, default CLI or dataset graph.
Originals, caches, registries, pins, published data, Python donors and existing
fixture bytes remain unchanged.

## Available contracts

All subpaths below are under `@sigma-budget/ingest`. They resolve to their
corresponding `dist/**/index.js`; the default `.` still resolves to
`./dist/index.js`. Node readers and the release client are not re-exported through
the shared barrel.

| Subpath              | Main integration contract                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                  | Existing builders, `AnnualLineage`, `parsePythonJson` and validation APIs                                                                                                                                                                                                        |
| `/readers/workbooks` | `readWorkbook({ path, sha256, format })`, scalar/cache/raw-token and source-cell APIs                                                                                                                                                                                            |
| `/readers/execution` | `executionAnnualFromPrepared(lineage, historicalTables)`; `prepareExecution({ reports, annual, buildDate, headlines? })` returns `{ execution, provenance, evidence }`; `readExecutionAnnual(files)` and `prepareExecutionFiles(config, buildDate)` provide pinned file adapters |
| `/readers/documents` | `readLegalHtml(reader, source, path)`, `readLegalDocx(reader, source, path)` and byte/text parsers                                                                                                                                                                               |
| `/readers/snapshots` | `SnapshotReader.open({ inputRoot, registryPath, pinsPath?, readDate })`, authenticated reads and BNB/Eurostat/GVA/Parliament/GISCO/oblast adapters                                                                                                                               |
| `/readers/pdf`       | `readPdf(bytes, limits?)` and physical spans/words/search/text/table APIs                                                                                                                                                                                                        |
| `/readers/annual`    | `readAnnualRegistration(registryPath, pinsPath)`; `prepareAnnual({ sourceRoot, registration, buildDate, out, limits? })`; byte-based `extractAnnual2027`; `serializeAnnual`                                                                                                      |
| `/release-client`    | Offline `preflightRelease({ release, originals, maxObjectBytes? })`; `ReleaseClient` status/upload/publish/rollback/readback and explicit transport/environment/receipt contracts                                                                                                |

Compiled standalone entry points remain:

- `apps/etl/dist/prepare-annual.js`: explicit source root, registry, pins, date and
  owned export. Generates or verifies both annual intermediates and a receipt.
- `apps/etl/dist/prepare-execution.js`: `execution-inputs/1` config, build date and
  new owned output directory. Writes the two complete documents and reader evidence.
- `apps/etl/dist/prepare-documents.js`: explicit registered kind/source/path and
  reader options. Writes `data.json`, `receipt.json`, and exact `source.bin`.
- `apps/etl/dist/release-operator.js`: explicit environment/origin and operator
  command. `preflight` is offline; remote operations require the existing explicit
  credential and CAS contracts.

See [execution reader](typescript-execution-reader.md),
[annual preparation](../packages/ingest/src/readers/annual/README.md),
[document/snapshot readers](../packages/ingest/test/readers/README.md), and
[release operator](release-client.md) for complete flags, types and boundaries.

The release client uses the existing HTTP routes: public
`GET /api/releases/current`, `GET /api/releases?limit=5`, and
`GET /data/releases/:releaseId/{manifest.json|outputPath}`; authenticated
`POST /admin/operations`, `GET /admin/operations/:id`,
`PUT /admin/operations/:id/objects/:sha256`, `POST /admin/operations/:id/seal`,
`GET /admin/requests/:requestId`, and `POST /admin/publish`. Publish and rollback
share the latter endpoint with `{ release_id, expected_revision, request_id,
kind }`. The fixed intent/request ID, revision CAS, explicit receipts and
release-specific readback contracts are unchanged. Only `/admin/*` receives
credentials. No HTTP route is added by this integration.

## Finite composition acceptance

After dependency installation, run all 15 workspace build/typecheck/test tasks
uncached, with heavy commands restricted to the assigned CPUs:

```sh
taskset -c 2,3 pnpm exec turbo run build typecheck test --force --concurrency=1 --continue=always --summarize
taskset -c 2,3 node apps/etl/test/source-layer-composition.mjs \
  --source-root /absolute/read-only/source-checkout \
  --out /tmp/new-owned-composition-export
```

The acceptance command requires actual existing originals; it does not fetch,
discover a new source registry or copy captured annual output into its inputs.
It imports all eight exports from the ETL consumer, invokes the compiled annual
CLI on the registered ZIP/acquisition bytes, and requires both intermediates to
be newly generated. All 2,775 forecast and 1,473 bill checks must pass.

The generated intermediates feed `AnnualLineage`, then the existing
`executionAnnualFromPrepared` projection of the **2026 adopted-law** table in the
2027 forecast. `prepareExecution` reads all 33 pinned real monthly XLS reports
specified by the unchanged existing wave18 inventory. Both complete documents
must equal the published parsed JSON, with no excluded fields or monetary
tolerance. The compiled execution CLI separately consumes these generated files;
its two full documents agree with the API and a second CLI export repeats all
three output files byte for byte. The check covers 7,128 source-cell receipts,
the four known source warnings, sparse law coverage, all four compiled CLI
argument guards, an incorrect annual pin, and existing-output preservation.

The command records byte lengths and SHA-256 for every source, registry, pin,
expectation and generated intermediate it reads, and rechecks every digest in
`finally`. It leaves its exclusively created export and `report.json` for parent
inspection. It starts no server. The historical Annex 3 remains the existing
pinned prepared artifact because its historical original is unavailable.

The fixed test date `2026-11-08` matches the full-document publication oracle;
production APIs continue to require an explicit caller date. The annual receipt
establishes PDF decoding in this composed run. The execution reader's own
`annualBoundary.rawPdfDecoded` remains truthfully `false`: that reader checks the
prepared-data boundary rather than decoding PDFs itself.

Fresh Python 3.12/PyMuPDF and xlrd oracle generation is inherited from the
independent component acceptances. Before reuse, verify their saved receipts,
source/donor hashes and output bytes, and compare the new composed outputs to
those verified references. Do not count that integrity check as a new Python run.

## Parent acceptance and remaining integration

Python remains the production default. Parent acceptance must target this exact
integration head, confirm final CI/readiness, and own any remote merge. Unified
default dispatch, registry-driven transitive input closure, remaining raw-source
adapter bindings, aggregate release validation and production cutover remain
parent integration work. This PR adds no replacement dataset graph and performs
no acquisition, deployment, remote upload, publication or rollback.

The execution model remains 2024–2026. Missing historical originals and arbitrary
future PDF/workbook layouts remain the existing component limits. Release object
limits remain 50 MiB by default; the accepted 63,488,595-byte archive needs matching
explicit client/server limits for an intended environment. No global limit is
changed here.
