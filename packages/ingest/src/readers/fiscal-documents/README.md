# Actual-source fiscal document adapters

Import from `packages/ingest/src/readers/fiscal-documents/index.ts`, or the corresponding compiled `dist/readers/fiscal-documents/index.js`. There is deliberately no new package-level export, shared graph registration, validator registration or production-default switch. Both prerequisites retain real merge ancestry: #46 at `567b66ccc7a10879bd696683b163b38afedfac42` and #44 at `e573f6533a99c694d36e142ba0c3a58718c2adff`. Their four existing package exports are retained together.

## Consumer contracts

Every source-level entry accepts `FiscalOriginal = { path: string; sha256: string; bytes: Uint8Array }`. The path must equal the existing registered original path; the bytes must match the supplied SHA-256. The production preparation wrapper additionally reads/authenticates the existing registry and `originals.sha256` using #44's `SnapshotReader`. Callers binding independent rules supply the verified identities they already receive; no alternate source registry is introduced.

| Export                                           | Direct consumer/result                                                                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractAsbp(asbp, bill)`                        | Eight raw table objects, 201 `{page, body}` clean pages, municipal quotations and the Annex 3 DOCX cross-check. The result adds physical cells, column names, row units, label fragments and PDF/DOCX hashes.                                                         |
| `asbpFiscalEvidence(result)`                     | Exactly the ASBP portion of `FiscalGraphInput.fiscal`: `{annex, tables, pages, differingRows}`. Combine with the parent's existing function/COFOG/population/measures/excerpts/forecast evidence.                                                                     |
| `extractNap(nap)`                                | `{rows, physicalRows, source}`. `rows` is `Record<string, ContributionRow>` with `page`, `label`, and **15 physical cells**; pass it to `buildRates({doo, nzok, bill, nap: result.rows}, date)`.                                                                      |
| `readNapRows(original)`                          | Synchronous structural match for #45's `NapRowsReader`. It decodes the supplied PDF; it never returns a capture/test double.                                                                                                                                          |
| `extractIndirectDocuments({nsi, customs, bill})` | Actual PDF text arrays and expanded DOCX tables, plus physical NSI product/year/price boxes, Customs clauses/product boxes and original physical DOCX ownership.                                                                                                      |
| `readIndirectTaxInput(sixOriginals)`             | `{input, documents}`. `input` directly satisfies existing `IndirectTaxReaderEvidence`; pass it to `buildIndirectTaxes(input, date)`.                                                                                                                                  |
| `readIndirectEvidence(sixOriginals)`             | Synchronous structural match for #45's `IndirectEvidenceReader`: complete `indirect-tax-evidence/1` expected evidence, with all six source hashes, VAT, fuel coefficients, every cigarette period and NSI price/year evidence. It does not call `buildIndirectTaxes`. |
| `readEmfTexts(bytes)`                            | Bounded actual `EMR_EXTTEXTOUTW` records `{offset,x,y,text}`, including signed coordinates.                                                                                                                                                                           |
| `prepareFiscalDocuments(options)`                | Scoped offline preparation into a **new separate owned directory**. Receipts cover all eight registered originals and all seven evidence files.                                                                                                                       |

`sixOriginals` is keyed exactly as #45's `INDIRECT_SOURCE_PATHS`: `prices`, `duties`, `gazette`, `customs`, `nsi`, `bill`. `FISCAL_DOCUMENT_PATHS` exposes those existing paths plus `asbp` and `nap`. The EC transport is intentionally limited to the three named tax worksheets; it reuses the existing ZIP decoder and bounded XML helpers, resolving workbook relationships and printed cells without a second spreadsheet dependency.

The independent path uses separate source-level selection and arithmetic from the producer: physical NSI words and year centers, Customs article evidence on PDF pages 41–42, EC country/product headers, article 39 sections/period sets, the DOCX percent-unit column, and exact integer EUR conversion/half-up rounding. Only low-level document/worksheet transport is shared. The builder adapter additionally verifies that its consumed NSI text agrees with the physical year columns and that whole-document Customs text agrees with the physical article clauses. DOCX cell text preserves leading spaces and paragraph breaks for exact source quotations.

## Source and monetary policy

All PDF decoding uses #46's `readPdf`, `spans`, `words`, `search` and `pdfTables`. There is no second PDF engine, Python subprocess, OCR, network request or fixture fallback in these adapters. NAP uses the actual vector grid with original merged-cell ownership. First occurrence wins, matching `_nap_rows`; all other physical occurrences remain in `physicalRows` with their page/table/row indices and boxes. Empty cells remain empty. Percent interpretation stays with the unchanged rates builder.

ASBP retains the original physical page-number rows in raw tables; `loadAnnex` already filters them. The donor's `x0` includes left-column ordinals such as Annex 6 `4,1` and `4,2`, even though those numeric ordinal fragments are excluded from `label`. Both those fragments and the donor's multiline `x0` carry-over are preserved; `labelParts` records their separate physical glyph positions. Numeric spans bind to the nearest printed header center using the donor's 2.2-point row grouping. Duplicate numeric assignments fail. Monetary values retain their original table scale: million EUR, thousand EUR, or printed GDP percentages; no amounts are silently rescaled. Table VI-1's row labels distinguish money and percentage rows. Table II-3/II-4 percent rows remain percentages within the million-EUR tables.

Annex 3 reads **actual DOCX ZIP media** `word/media/image19.emf` through `image22.emf`, verifies member CRC/local metadata, bounds every EMF record and UTF-16 string/advance array, and matches the numeric row multiset. The supplied vintage contains 127 numeric rows: 118 identical and nine different rows. The differences are retained in `differing_rows`, including all PDF and DOCX values and source record associations. No source is synthesized to remove them.

The known II-3/II-4 2024 GDP vintage disagreement and III-1 2025 programme/preliminary-actual disagreement remain documented and flow through the existing fiscal builders. Their tolerances are unchanged. The July component summary has no supplied raw original; this module neither regenerates it nor claims complete import/validation.

The narrow engine attribution is MuPDF **1.26.4** structured text/vector geometry instead of the Python donors' PyMuPDF **1.26.5** rawdict/find_tables and pdfplumber **0.11.10**. Glyph/font boxes and methods are attributed to that engine. Actual-source table labels, physical column association, values/nulls, all cleaned ASBP page text, NAP cells and final tested builder outputs are compared independently; the engine description is not used to excuse monetary/text differences. The supplied NSI PDF emits existing MuPDF flate/font warnings while decoding; no OCR or alternate source is substituted.

## Scoped preparation

Build with Node 24 and pnpm 10.33.0:

```sh
pnpm --filter @sigma-budget/etl... build
node --max-old-space-size=8192 apps/etl/dist/prepare-fiscal-documents.js \
  --sources /absolute/owned/copied-source-root \
  --registry /absolute/owned/copied-source-root/data/sources.yaml \
  --pins /absolute/owned/copied-source-root/data/originals.sha256 \
  --date 2026-11-10 \
  --out /absolute/new-owned-output
```

This standalone command is intentionally absent from the global CLI. It writes `asbp-tables.json`, `asbp-pages.json`, `nap-rows.json`, `nap-physical.json`, `indirect-input.json`, `indirect-documents.json`, `indirect-evidence.json`, and `fiscal-documents-receipt.json`. These names are scoped handoff evidence, not replacements in `data/originals`, `data/cache` or `data/release`. `asbp-tables.json.tables.IV_text` contains the municipal quotation form used by older component consumers; the in-memory result exposes the same object as `municipalText` to keep numeric table typing precise.

Before decoding, every destination and its ancestors are checked against source/registry/pin overlap, existing output reuse, symlinks, dangling symlinks, hardlinks and protected `originals`/`cache`/`release`/`.git` path segments. The parent destination must already exist. All decoding and serialisation finish before the first write. The complete destination preflight and source/metadata hashes are checked again before exclusive no-follow creation. A failed write removes only the newly created owned output. Existing originals, intermediates, registries, pins and outputs are never overwritten.

## Verification and parent integration

The fresh donor driver is `packages/ingest/test/fiscal-documents-python.py`. It requires Python 3.12, disabled bytecode writes and the pinned donor package versions. It imports code from an owned git export, reads copied actual originals, redirects the ASBP producer's only output to a new owned directory, and records donor/source/output hashes. Two fresh Python runs produced identical bytes for every expectation and manifest. No existing frozen fixture/oracle is changed.

```sh
PYTHONDONTWRITEBYTECODE=1 /home/user/work/sigma-budget/tmp/venv-data/bin/python \
  packages/ingest/test/fiscal-documents-python.py \
  --repo /absolute/owned/donor-export \
  --sources /absolute/owned/copied-source-root \
  --out /absolute/new-owned-python-expectations

FISCAL_DOCUMENT_TEST_ROOT=/absolute/owned/copied-source-root \
FISCAL_DOCUMENT_PYTHON_EXPECTATIONS=/absolute/owned/python-expectations \
NODE_OPTIONS=--max-old-space-size=8192 \
pnpm exec vitest run packages/ingest/src/readers/fiscal-documents/fiscal-documents.test.ts
```

Without those environment variables the real-original tests are explicitly skipped; synthetic geometry/EMF/path-safety tests still run. No test double is exposed as a production PDF decoder. Actual-original tests compare every ASBP row/page/label/null/value, all 201 clean pages, every Annex 3 cross-check result, every cell of all 95 NAP rows, complete fiscal/rates builder outputs, complete indirect builder output and the complete independent indirect evidence. Finite cases cover malformed EMF record/string/advance/EOF bounds, source identity/hash/missing bytes, duplicate ASBP columns, NSI physical column movement, changed amount/currency/unit, changed EC product association, missing source cells/rows and destination overlap/alias categories. Two separate new owned preparations must produce byte-identical contents and receipts, reject output reuse, and preserve every source hash.

Local verification on CPU 16/17: ingest typecheck, ingest/ETL build, Prettier, **21/21 adapter tests with all actual originals enabled**, and **45/45 regressions in seven existing suites** passed. An additional comparison matched all **195 raw ASBP rows** including `page`, `y`, `x0`, `label` and `values`. The compiled standalone CLI rejected an originals-overlapping output before writing. Both fresh Python expectation exports and both new TypeScript preparations were byte-identical. All eight actual originals and their copied input hashes remained unchanged.

Prerequisite functionality and its previously accepted tests are inherited; this task's source comparisons and scoped tests are run separately. Parent integration still owns merging the concurrent source union, composing the remaining `FiscalGraphInput` fields and law evidence, binding `nap: readNapRows` / `indirect: readIndirectEvidence` in #45, source freshness/aggregate registration, complete CI/readiness and the eventual remote merge. Python remains the production default pending that acceptance.
