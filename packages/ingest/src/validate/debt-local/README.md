# DEBT, MUNIC and SEBRA validation APIs

Import from `validate/debt-local/index.js`. `debtLocalGroups` exports three
`Group<Context>` registrations, using the existing shared `Context`, `Check` and
runner. The aggregate registration and production command belong to the parent
integration. No scoped CLI or independent Context implementation is introduced.

The rules port all checks in `pipeline/budget_pipeline/validate/debt.py` and
`local_finance.py` at `3424bc998c726d6d511d4284295c54c50c42d099`. They inspect
published datasets and cross-file relationships without calling a debt,
municipality or payment builder. The only imported build-directory function is
the existing geometry topology predicate in the separately labelled safety API.
The runtime does not run Python.

## Donor scope and precision

`debt(context)` checks VI-1 totals, percentages and the outlook GDP denominator;
scopes/latest/next; annual Maastricht series; all three continuous quarterly
series; provisional flags; Eurostat/BNB and Q4/annual reconciliations; the three
debt definitions; every structure group and maturity; interest and guaranteed
debt; issuance; five legal limits, SAFE inclusion and plan relationships;
execution financing references; notes; and every stored control.

The reviewed GDP vintage exception remains exactly `2026-10-21` for 2024 and
2025, with tolerance 0.2 rather than 0.051. The other donor tolerances are
unchanged: printed-part sums `0.05 * (n + 1) + 0.01`, quarterly overlap 0.05,
annual/Q4 overlap 0.06, structure deviations 0.101 and stored deviations 0.0051.
Common compensated summation follows Python 3.12 for the float arrays.

`municipalities(context)` checks ordered schema and kinds, year and population
year, all 265 identities and 28 regions, the Dobrich population swap, population
controls, every transfer component and per-capita value, national/region sums,
manual name matches, all boundary identities and every coordinate. Published
thousand-euro transfer precision is unchanged, including row deviation 0.26,
region sums 0.05, national sums 0.5 and per-capita deviations 0.0051.

`sebra(context)` checks all three ordered days, day/category/organisation count
and euro aggregates, latest-day headline, overall category aggregation, file
listing, byte sizes, publication dates, ministry/publisher text, partial-month
wording and stored checks. Money tolerance remains 0.011. Its build-date bound
uses `context.buildDate`, not the donor module's global date. The donor accepts
nonempty ministry identifiers; checking their original identity requires the
reader binding below.

Each function returns its donor-named `Check`. On both named frozen baselines,
DEBT runs 176 checks, MUNIC 4,940, and SEBRA 55: 5,171 total, with zero problems
and the exact same facts as Python. These groups have no accepted-problem
wrappers in the donor. Unmatched errors remain failures under the existing
runner; omitted or crashed required groups cannot pass.

## Separately labelled additional safety

`debtLocalSafetyGroups` exports `DEBT_SAFETY`, `MUNIC_SAFETY` and `SEBRA_SAFETY`.
They close three donor gaps: null/non-numeric quarterly percentages and
per-capita values, impossible Gregorian dates, and invalid polygon topology
inside the Bulgaria bounding box. They are additional checks, not claims about
the Python donor's original behavior. On the current candidate they run 1, 530
and 14 checks respectively (545 total).

The existing `validateMunicipalityGeometry` predicate retains its exact
historical SZR36 exception only for source-coordinate SHA-256
`a775c7cac73123abd78d88d30013e15b024bd2deb70ddb710991bcba1e80b5a0` and
published-coordinate SHA-256
`b3c8416bcea638d92a6a83ea7bf2b7514c5ef459c5a9685f511717aee5d7a6d1`.
An altered self-intersecting SZR36 fails. The known defect is reported as a
warning; no historical boundary is repaired or newly certified.

## Independent source-reader integration remains explicit

The two donor modules do not read raw source files. Passing their rules means
published-data contract parity, not proof of re-reading originals.
`createDebtLocalSourceGroups(bindings)` provides separate `DEBT_SOURCE`,
`MUNIC_SOURCE` and `SEBRA_SOURCE` registrations for the readers under parallel
development. It uses the same `Context`; it does not fork its interface.

Each binding receives `Context` and must parse actual original bytes,
independently of the corresponding production builder. Expected registry pins
are supplied separately in `binding.pins`. Paths resolve under `context.root`
through `safePath`, so the parent should construct a staged root containing
source inputs and a separately selected candidate data directory. Every pin is
hashed before the reader runs, source identities are checked for the group,
and each assertion must reference a pinned original. Readers return expected
values with candidate file/RFC 6901 pointers and exact equality or explicitly
reviewed source-printed tolerance.

Required reader scopes are exported as `debtLocalSourceRequirements`:

- DEBT: ASBP ZDD/structure/issuance, adopted-law limits, Eurostat annual and
  quarterly series, both BNB series and distinct GDP vintages.
- MUNIC: adopted-law transfers, GISCO identities/population and geometry,
  Eurostat oblast population.
- SEBRA: publication listing, XLSX payments and ministry identity.

Unbound readers, missing scopes, empty/mismatched pins, captured/unavailable
evidence, missing assertion targets and reader crashes fail explicitly. A
binding's assertions and scope coverage are a trusted adapter contract, not a
way for this module to prove that an arbitrary callback actually parsed every
required source cell. Parent integration must accept each adapter against its
actual documents before treating these groups as complete original evidence.
No original binding is installed by this PR and no report here claims
`completeValidation: true`.

Available BNB XML and SEBRA HTML/XLSX files are pinned in the fixture inventory
and were hashed here, not parsed by these rules. Historical GISCO boundaries,
population and debt snapshot originals are unavailable; existing captured
evidence cannot be relabelled as newly acquired originals. PDF/law readers and
the additional raw original comparisons remain parent integration work.

## Reproducible test evidence

`test/fixtures/debt-local-validation` is new; existing frozen fixtures are
unchanged. It contains complete byte-for-byte copies of the six required
published files at `3424bc998c726d6d511d4284295c54c50c42d099` (build date
`2026-11-08`) and the supplied independently accepted Python candidate built
from `b81203662a904c3dd6583d8277e92ae7f6e8fcd8` on `2026-11-10`.
The candidate manifest SHA-256 is
`f6e78e74fba37602840310934821f4a6d95872a0d19af2512ba4763fefe5ca0b`.
The snapshots are test evidence, not newly acquired original sources. All donor,
snapshot, oracle, generator and case hashes are in `provenance.json`.

The independent Python 3.12 oracle imports only the frozen validator and checks
modules. It never imports the TypeScript code or any production builder. Its
95 scenarios contain six baselines, 88 failing functional mutations and one
accepted within-precision control. The TypeScript tests compare status, true
check counts, problem counts, warnings and facts wherever the donor completes.
Null money may crash the donor; both runtime outcomes must fail, without
requiring identical exception prose. Diagnostic wording is retained for useful
explanations, not tested through an unbounded exception-string sweep.

```sh
python3.12 packages/ingest/test/fixtures/debt-local-validation/generate_oracle.py --check
pnpm --filter @sigma-budget/ingest... build
pnpm --filter @sigma-budget/ingest typecheck
PYTHON312=python3.12 DEBT_LOCAL_REAL_CANDIDATE=/tmp/pr40-independent-acceptance1/candidate \
  pnpm --filter @sigma-budget/ingest test
pnpm exec prettier --check packages/ingest/src/validate/debt-local*.ts \
  packages/ingest/src/validate/debt-local/index.ts \
  packages/ingest/src/validate/debt-local/README.md
```

The explicitly enabled live-candidate test verifies that manifest and every
required candidate byte hash before checking the actual files. Without that
environment variable it is visibly skipped; all frozen candidate and published
baseline checks still run. No production dataset, registry, shared validation
file, builder, Python path, root CLI or build graph is edited. No network source
fetch, Cloudflare operation, deployment or publication is part of this scope.
