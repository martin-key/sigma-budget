# Debt, municipalities, boundaries and SEBRA evidence

The oracle uses an independent frozen Python 3.12 copy of the three builders and their imported helpers from commit `05d6f6eeca9991468f3c94c3c9c26e87d5b0fae0`. `generate_oracle.py --check` reads only adjacent inputs, runs the frozen Python builders and raw BNB XML, SEBRA HTML and XLSX readers, checks the reader captures, and byte-checks the donor and projected outputs. It verifies every input, donor module, stage source, published snapshot, policy and registry through `provenance.json`. The archive was `release-build-inputs-2026-11-08-period-selector-complete.tar.gz`, SHA-256 `9430d8acfe5bd178a1675041aaae22295c89f2768474ebd27af347b465ace5e3`. The four published snapshots are copied from the named baseline commit, independently of the builders.

The annual-period stage changes outlook, revenue and expenditure; budget 2027 writes its own files. Wording, active-data selection, source glue and catalog refresh do not write these four outputs. Their frozen source is in `stage-evidence/`; the projected copies therefore equal the donor. SEBRA remains on disk as inactive phase 2 and is not added to the catalogue. The three scoped parity reports compare every field against donor, projected and published snapshots with no accepted differences or numeric tolerances. The source and policy inventory is pinned in the TypeScript fixture loader as well as in the Python check.

GISCO boundaries and population, the oblast JSON-stat and the law table are cached or reader-produced evidence; their original historical response bytes have not been recovered. `debt_stock.json` and `debt_gdp.json` are frozen copies whose original response bytes are unavailable. The cleaned PDF pages and adopted-law paragraphs are reader captures, not a fresh extraction. The captured paragraphs were also checked against the archived adopted-law HTML, whose SHA-256 is recorded in provenance; that large HTML is not included in the fixture. The BNB XML and the SEBRA HTML/XLSX bytes are present and are re-read by Python. The TS builders use their captured JSON, not new raw adapters. Thus this fixture provides full output parity from frozen evidence, not full regeneration from all original sources.

```sh
python3.12 packages/ingest/test/fixtures/debt-local/generate_oracle.py --check
pnpm --filter @sigma-budget/etl... build
pnpm --filter @sigma-budget/ingest exec vitest run src/build/debt.test.ts src/build/municipalities.test.ts src/build/sebra.test.ts
pnpm --filter @sigma-budget/etl exec vitest run src/debt-local-build.test.ts
```

`pnpm debt-local:compare-live` is a separate local diagnostic against the current release and is not a CI fixture. The test-only CLI writes only to this project's `tmp/ts-migration/candidates/07/data`, rejects unsafe paths, and dispatches only the exact four-dataset scope. No network acquisition is performed.

## Historical topology limitation

Independent topology validation found an existing self-intersection in the Chirpan (`SZR36`) boundary, both in the captured GISCO evidence and the published snapshot. The original historical GISCO response is unavailable, so the correct physical boundary cannot be established from this corpus. Output parity does **not** certify that historical geometry as valid.

Normal `buildMunicipalities`, `buildMunicipalGeo` and `municipalityGeometry` calls validate WGS84 coordinates and complete polygon/multipolygon topology before and after simplification, and reject this defect. The fixture loader explicitly requests `preserveHistoricalChirpan` solely to reproduce the archive. This opt-in accepts only the exact source-coordinate SHA-256 `a775c7cac73123abd78d88d30013e15b024bd2deb70ddb710991bcba1e80b5a0` and published-coordinate SHA-256 `b3c8416bcea638d92a6a83ea7bf2b7514c5ef459c5a9685f511717aee5d7a6d1` for `SZR36`; any altered invalid geometry is rejected. The CLI prints the limitation explicitly. It does not repair, approve or silently refresh the historical boundary. All other source and simplified geometries pass the same topology checks, including shell/hole intersections, nested holes and overlapping polygon components.
