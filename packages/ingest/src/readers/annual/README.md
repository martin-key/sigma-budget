# Offline annual PDF preparation

This package decodes the actual supplied 2027 ZIP/PDF bytes in Node. It completes
both `sources.prepare_inputs.prepare_budget_2027` generation/freshness gates and
feeds the existing `buildWave13a` builders. It does not change production dispatch,
the Python path, shared validator Context, registry pins, fixtures or published data.

## Production orchestration API

Import from `@sigma-budget/ingest/readers/annual`:

- `readAnnualRegistration(registryPath, pinsPath)` reads the existing `sources`
  registry and `originals.sha256`. Archive, acquisition and member pins remain
  independent of the source's acquisition self-description. It retains the resolved
  registry/pins input paths for overwrite protection during filesystem preparation;
  these local paths are not included in the serialized annual outputs.
- `extractAnnual2027({ registration, archive, acquisition, buildDate, limits? })`
  accepts registered metadata and actual byte arrays. It verifies the archive,
  acquisition record, role/member identity, member hashes and lengths before PDF
  decoding. It returns complete `forecast`, `bill`, and extraction `evidence`.
- `prepareAnnual({ sourceRoot, registration, buildDate, out, limits? })` reads those
  registered paths offline. `out` is a separate caller-owned candidate/export root;
  it may be in the source checkout's `tmp`, or an external owned temporary folder.
  It creates `data/inputs/budget_forecast_2027.json` and
  `data/inputs/budget_bill_2027.json` only when absent, plus
  `tmp/budget-2027-extractions.json`. Both gates are checked before either missing
  intermediate is written. Stale/corrupt existing files are never replaced.
- `serializeAnnual(value)` retains integral monetary floats such as `27573950.0`
  separately from integer page/table/year indices. Returned API values already
  carry the existing `parsePythonJson` annotations expected by `buildWave13a`.
  When loading written intermediates, use the existing `parsePythonJson` loader.

Preparation accepts a real ISO build date; source publication dates and printed
column vintages remain those of the PDF. Receipts contain source hashes, byte
counts, PDF page counts/document metadata, decoder method, output hashes and each
gate's `generated`/`verified` action. There are no wall-clock timestamps or fetches.

Existing intermediates compare by exact JSON values, including all printed cells,
labels, nulls, units, physical coordinates, document variants, source metadata,
diagnostics and checks. Object serialization order and check execution order are
not source-cell dimensions. The sole legacy attribution accepted is the exact old
`Internal PyMuPDF rawdict/words comparison...` method string; the receipt explicitly
records this compatibility case. Regenerated method attribution says MuPDF.js.
There is no numerical/geometry tolerance in freshness comparison.

## Standalone command

Build once with `pnpm --filter @sigma-budget/etl... build`, then run:

```sh
node apps/etl/dist/prepare-annual.js \
  --source-root /path/to/acquired-snapshot \
  --source-registry /path/to/export/data/sources.yaml \
  --pins /path/to/export/data/originals.sha256 \
  --out /path/to/owned-candidate \
  --build-date 2026-11-10
```

The command prints the receipt as JSON, returns 1 on failure, and requires every
path/date flag. The example date is not hard-coded. Output cannot overlap the
source root/originals, checkout data/release, fixtures or registries. Symlinks and
hardlinked input/intermediate/report files are rejected. The registry and pins
files are checked against both intermediate destinations and the receipt path
before PDF decoding or any write. Newly created files use
exclusive creation; existing intermediate bytes remain unchanged on successful
verification and failures. Caller ownership must exclude concurrent writers.

Unified build/prepare dispatch and full release orchestration are integration work
owned elsewhere. No downstream ASBP/programme/DBP/NAP/indirect adapters are included.

## Reusable physical PDF API

Import from `@sigma-budget/ingest/readers/pdf`:

- `readPdf(bytes, limits?)`: detached pages, PDF metadata and SHA-256; page text,
  block/line/span/character geometry, line direction/writing mode, font name/size/
  bold state, character origins/quads reduced to boxes, and vector edges/bounds.
- `spans(page)`: positioned printed fragments, including separated monetary cells.
- `words(page)`, `search(page, text)`, `textInBox(page, box)`, `pdfTables(page)`:
  physical words, caption positions, box text and ruled/Word-layout table grids.
  `pdfTables` retains empty and merged cells and caches only per-page results.

Coordinates use PDF points and a top-left origin. Physical grids use the donor's
3-point snap/join/intersection rules and 1-point input/3-point final edge bounds;
these are layout rules, not monetary tolerance. Default decoding bounds are 32 MiB,
500 pages, 5 million characters and 30,000 paths per page; callers may lower them.
Grid intersections are bounded at 100,000. Encrypted/non-PDF input and invalid
limits fail. Native document/page/text/device/font/path handles are closed on
normal and error paths.

The pinned Node/WASM engine is `mupdf@1.26.4`, selected from the
[official Artifex API](https://mupdfjs.readthedocs.io/en/latest/reference.html) and
[structured text documentation](https://mupdfjs.readthedocs.io/en/latest/classes/StructuredText.html).
Its package declares AGPL-3.0-or-later licensing; it is a Node-only ETL dependency,
not imported through the ingest root export or by the Worker. The independent
Python environment pins PyMuPDF 1.26.5 / MuPDF 1.26.10. On these two supplied PDFs,
all exposed extraction fields and all 4,248 validation checks match exactly after
ordering checks by name; no cross-engine numerical or geometry allowance was
needed. Only comparison-method attribution and serialization differ.

This is support for the supplied 201-page forecast and 159-page bill, not an OCR
engine, arbitrary future PDF/table-layout guarantee, or source recovery facility.
Mixed/date/formula assumptions remain printed text with null numeric values;
explicitly blank units remain null. The two printed GDP vintages retain their
existing documented discrepancy. Partial proposed limits, sparse `billMc`, 265
municipalities in both views and all 226 project rows remain distinct source facts.
Absent historical originals remain evidence limitations.

## Verification

```sh
pnpm exec vitest run \
  packages/ingest/src/readers/annual/annual.test.ts \
  apps/etl/src/prepare-annual.test.ts \
  packages/ingest/src/build/wave13a.test.ts \
  apps/etl/src/wave13a-build.test.ts --maxWorkers=1
pnpm --filter @sigma-budget/etl... typecheck
pnpm --filter @sigma-budget/etl... build
```

The tests decode tracked actual source bytes, compare both complete independent
Python intermediates, and feed the existing builders for all six exact Wave13a
outputs. They cover generation, existing freshness, stale second-gate atomicity,
corrupt owned sources, wrong members/pins, precise cell/text/unit/geometry/null
mutations, decoder bounds, real CLI paths/date and filesystem restrictions.
Temporary test directories are removed in `finally`/`afterAll`.

For an independent fresh Python TEST oracle, run the locked Python environment:

```sh
/path/to/locked-python packages/ingest/test/annual-python-expectations.py \
  --out /path/to/absent-owned-evidence
```

The test helper pins donor hashes, re-extracts actual PDFs with the independent
Python implementation, checks the complete intermediates and records its output
hashes. It is never called by TypeScript runtime readers. Existing Wave13a final
fixtures are inherited expected results; the new raw PDF decoding, preparation,
corruption/bounds tests and fresh donor execution are new evidence.
