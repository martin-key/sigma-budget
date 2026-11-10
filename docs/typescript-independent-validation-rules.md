# Independent COMPONENTS, RATES, INDIRECT and CONTRACT rules

These rules supplement the existing TypeScript validators. They do not change the builders, shared Context, aggregate runner, CLI, registries, released data or Python production path. They make no `completeValidation: true` claim. Production aggregate registration belongs to the integration parent after the other validation and reader changes land.

## API and registration

Import from `packages/ingest/src/validate/independent-rules.ts` (or the corresponding compiled module). The dedicated barrel exports `independentRuleGroups(readers?: IndependentRuleReaders): Group<Context>[]` and `INDEPENDENT_RULE_NAMES`, in this order: COMPONENTS, RATES, INDIRECT, CONTRACT. Each rule accepts the existing shared `Context`; there is no alternate Context class.

Individual exports are `components(ctx)`, `rates(ctx, napReader?)`, `componentsRatesGroups`, `ratesGroup(napReader?)`, `indirect(ctx, reader?)`, `indirectGroup(reader?)`, `executionIntegrity(ctx, lawReader?)` and `executionIntegrityGroup(reader?)`. Factories return `Group<Context>`. All rule functions return the existing `Check` collector. The integration parent can pass the returned groups to `runGroups`; selecting an omitted required group fails. Registering these four groups alone does not establish full validation.

The reader callbacks are synchronous to match `Group<Context>.run`. Preparation may decode/cache asynchronously first, but a binding must authenticate and resolve the particular supplied bytes. It must not return production-builder results as independent evidence.

| Binding                             | Input supplied by validator                                                      | Required independent result                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nap?: NapRowsReader`               | NAP PDF bytes, original relative path and verified SHA-256                       | `Record<string, NapRow>`; numbered rows including `1.1.`, `1.2.`, `5.1.2.`, `5.2.2.`, `10.1.2.`, `10.2.2.` and categories `1.` through `19.`. Each has physical `page`, `label`, and 15 printed `cells`. |
| `indirect?: IndirectEvidenceReader` | Six separately hashed original byte buffers, keyed by `INDIRECT_SOURCE_PATHS`    | `IndirectEvidence`, with all sources, VAT, two fuels, every cigarette period and the NSI price/year-column evidence. It must match the separately pinned independent extraction.                         |
| `executionLaw?: ExecutionLawReader` | Verified forecast ZIP member PDF bytes plus archive/member identities and hashes | `ExecutionLawTable`: physical Annex 1 columns and rows, including `label`, `page`, `units`, `printed`, `values`. It must match the pinned forecast extraction table.                                     |

No runtime rule invokes Python or the corresponding production builder. The sole build-layer import in CONTRACT is the existing ZIP member byte decoder, not an expected-result builder. The established `CONTRACT` constants are reused; `execution-contract.ts` is unchanged.

## Scope and evidence boundaries

COMPONENTS preserves all donor checks: constituent budget identities, DOO/NZOK sums, law article 1 and headline comparisons, municipal totals, EU accounts, transfers, Sankey, national/EU/programme reconciliation, execution references, pending monthly split and notes. Its tolerances are unchanged. These are cross-dataset checks, not a new extraction of every law or ASBP source. The historical origin of the July component summary is still unknown. P02 remains pending without numbers.

RATES preserves the donor's scenario recomputation from verbatim ASBP assumptions, legal income limits, tax shares, TZPB activities, minimum-income cells/nulls, changes, NAP category coverage, quotes and stored-verdict checks. When NAP bytes are available, its pin is required and an absent reader binding fails. A bound reader adds fund-by-fund reconciliation of six NAP rows, scenario comparisons, civil-servant effects, printed income limits, and all 19 category page/label checks. When the NAP original is absent, a fact explicitly states that the checks use ASBP strings and that stored NAP verdicts are not an independent PDF re-read. This retains the donor's frozen-input outcome without claiming new source acquisition.

INDIRECT preserves the independent-evidence schema/pin/source inventory, all VAT/fuel/cigarette/NSI coefficients, units and dates, the untaxed calculation definition, retired-file checks, and all 52 measures' date/legal excerpts (16 date/phrase records, 14 legal records). Available raw source bytes are hashed even when other originals are missing. Missing originals are named and the original diagnostic is retained: `raw evidence unavailable: comparing against the pinned independent extraction`. If all six originals exist, an absent decoder fails; an injected decoder must reproduce the complete independently pinned evidence. A source hash mismatch remains a failure even if a callback returns the expected extraction.

CONTRACT parses `ctx.bytes('execution.json')` directly through strict JSON before any money projection. It checks all 3733 money positions using the block's fixed decimal-string precision, preserves nulls, rejects binary money and negative zero, and keeps percentages numeric. Provenance includes all 33 monthly originals, 32 cell rows, one computed row and 13 law plan locators. It independently reconstructs the expected locator records from the pinned forecast extraction, authenticating that extraction and its actual ZIP/PDF member bytes. It does not call `law_plan()` or a TypeScript plan builder.

The adopted-law plan uses **Annex 1**, with sparse national/EU denominators and explicit coverage reasons. The existing reconciliation rules refer to **Annex 3** report vintages. No historical source or missing denominator is reconstructed. Additional CONTRACT checks reject omitted years/rows/cells/report files, wrong worksheet/column/row locators, changed computed/derived rules, coordinated original hash changes, wrong original currencies/dates, and corrupt available XLS bytes. The monthly output deliberately has only `rev`, `exp.total`, and `balance`; cumulative data covers all execution rows.

Required report coverage comes from the committed original-file pins, independently of both execution outputs. Every pinned KFP year, month, filename and hash must occur in the cumulative data and provenance; monthly data must cover the same independently required years. A complete year cannot disappear by deleting it from both documents. Physical worksheet rows are checked against a separate 32-row validator mapping, so coordinated changes to the two output declarations fail. The newest pinned report also determines the required latest date/month; fixed row sets and derivation rules require the latest fields, complete-year pace rows and both historical Annex 3 reconciliation blocks. These are coverage and locator checks, not numerical re-reading of XLS cells.

Without the law PDF reader, CONTRACT records that it authenticated archive/member bytes and checked the pinned extraction, but did **not** re-extract the PDF. Missing XLS originals are explicitly listed. Comparing reported money to decoded XLS cells belongs to the independent KFP group; these CONTRACT checks do not replace it. The aggregate must retain these boundaries and await real bindings plus all required groups before claiming complete source validation.

## Frozen proof and reproducibility

New fixture family: `packages/ingest/test/fixtures/independent-rules/`. Older fixtures are unchanged. `manifest.json` names repository baseline `3424bc998c726d6d511d4284295c54c50c42d099`, the accepted Python candidate built from `b81203662a904c3dd6583d8277e92ae7f6e8fcd8`, build date **2026-11-10**, candidate manifest/receipt hashes, every copied dataset/donor hash and every required original/input pin. Copied snapshots are preserved evidence, not newly acquired originals.

The nine frozen Python donor/dependency files retain their exact bytes. Python **3.12.14** generated `oracle.json` for the baseline and 25 finite mutations. Regeneration uses `generate-oracle.py --repo <read-only-repository>` in the existing Python 3.12 data environment, with `PYTHONDONTWRITEBYTECODE=1`; all mutable inputs are copied into its own temporary root. The baseline's raw donor problems are empty, so accepted and raw outcomes coincide for these four groups; no new accepted exceptions are added.

| Group      | Frozen Python baseline checks | TypeScript baseline checks |
| ---------- | ----------------------------: | -------------------------: |
| COMPONENTS |                           270 |                        270 |
| RATES      |                           891 |                        891 |
| INDIRECT   |                           124 |                        124 |
| CONTRACT   |                          3837 |                       4134 |
| Total      |                          5122 |                       5419 |

The 297 additional baseline CONTRACT checks cover omissions, canonical provenance, independent report/row inventory and actual source pins/bytes. The number is an observation of this baseline, not a runtime minimum: coverage is determined from the independent inventory and worksheet contract. Null values are deliberately not counted as individual decimal-format assertions, matching the donor; the money-position fact counts them. Test assertions compare donor counts and diagnostics, allowing only Python's `1.0`/`1` and `None`/`null` rendering differences.

The NAP fixture includes a copy of the already pinned PDF (`b0a02141c14d4358f656711edcf0a7ae52b5f02a50c465f31ba97b542219e3f4`) and a fresh Python/PyMuPDF physical-table capture of 95 rows. `capture-nap.py <pdf>` verifies its pin and reproduces the capture hash. Runtime tests inject that capture as a clearly identified **test double**; this is not a delivered TypeScript PDF decoder.

`actual-evidence.json` records a Python independent extraction of the six available pinned INDIRECT originals from the read-only input root. It exactly matched `data/inputs/indirect_tax_evidence.json`. This is an original-byte Python verification, not source acquisition or a TypeScript reader implementation. Full-original TypeScript boundary tests use explicit synthetic transport doubles in CI; a separate local check used copies of all six actual pinned files and the captured Python result. Both require missing bindings to fail and independent decoded differences to fail.

## Verification

All commands ran on CPU 10/11 in the owned worktree, with no source fetching, Cloudflare operation, production Python change or user port use:

- `pnpm --filter @sigma-budget/ingest... build`
- `pnpm --filter @sigma-budget/ingest typecheck`
- `pnpm exec vitest run packages/ingest/src/validate` — 12 files, 534 tests passed, including 54 focused rules tests.
- Prettier check of the six added TypeScript files.
- Python 3.12 frozen oracle regeneration and independent actual-original INDIRECT/NAP checks.

The finite cases cover changed money, precision, negative zero, nulls, schema, units/dates/source metadata, legal excerpts, missing cells/rows/groups, coordinated provenance changes, wrong rules, corrupt originals, missing independent evidence, missing bindings and decoder disagreement. The old production Python path remains the accepted implementation until aggregate TypeScript acceptance and the real reader bindings are integrated.
