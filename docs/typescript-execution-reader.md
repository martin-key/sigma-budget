# Workbook decoding and monthly execution preparation

This Node-only package reads actual pinned BIFF `.xls` and OOXML `.xlsx` bytes.
It produces the complete monthly `execution.json` and
`execution-provenance.json` without running Python. It adds an
`execution-reader-evidence.json` receipt containing original file hashes, raw
unit strings, used cell coordinates and hashes, cache/blank/missing counts,
known source differences and the prepared annual input boundary.

Python remains the production default. This module does not change the root
CLI, shared validation context, build graph or release data. Later integration
must connect these APIs to the existing graph and complete validation.

## Operational APIs

Import from `@sigma-budget/ingest/readers/workbooks`:

- `readWorkbook({ path, sha256, format: 'xls' | 'xlsx' })` verifies the pin and
  decodes the real file. `decodeWorkbook(bytes, { sha256, format })` is the
  byte-based equivalent.
- `sheetByName(workbook, name)` resolves a named worksheet; missing names fail.
  Sheets retain sparse A1 cell coordinates, effective dimensions, the engine's
  declared range, merged ranges and the workbook's 1900/1904 date system.
- `workbookCell(sheet, 'B11')` and `workbookGrid(sheet, optionalRange)` retain
  number, text, boolean, error, explicit blank and absent-cell distinctions.
  Coordinates are zero-based in the cell objects and A1 in the address.
- `numericCell(sheet, address)` requires a finite numeric value and a saved
  cache when a formula exists. Formulae are retained and never evaluated.
  Missing caches remain null. Excel errors cannot become numbers. Original OOXML
  numeric tokens, including formula caches, must have a complete finite numeric
  lexical form; truncated text such as `123garbage` is rejected before engine decoding.
- `workbookCellText(cell)` returns exact OOXML numeric `<v>` text for decimal
  consumers, resolved shared strings for labels and null for missing values.
  `cell.rawValue` retains the original OOXML scalar token, including shared
  string indices. BIFF values retain their original decoded IEEE-754 numbers.
- `sourceCellSha256(workbook, sheet, address)` binds the file digest, sheet,
  address, type, value, formula, cache and available original numeric token.

Import from `@sigma-budget/ingest/readers/execution`:

- `readExecutionReport({ path, sha256 })` reads a real BIFF report, checks the
  effective 54×4 layout, every published row label, split label at rows 47/48,
  blank rows, month-end title, filename/month match, units, source identities
  and the two bounded 2024 source exceptions.
- `readExecutionAnnual(files)` accepts five pinned file descriptors:
  `forecast`, `bill`, `forecastArchive`, `billArchive`, `historicalAnnex3`.
  It reuses `AnnualLineage`, ZIP member verification and `loadAnnex`. It checks
  prepared JSON pins, archive/member hashes, law year/vintage/unit/printed
  evidence and historical table labels/sums.
- `executionAnnualFromPrepared(lineage, historicalTables)` accepts the existing
  typed `AnnualLineage` and `AnnexTables` for integration with a verified annual
  preparation stage. Its output is `ExecutionAnnualInput`.
- `prepareExecution({ reports, annual, buildDate, headlines? })` reads every
  supplied pinned XLS and returns `{ execution, provenance, evidence }` in
  memory. `reports` is a complete list of `{ path, sha256 }`, not captured grids.
- `prepareExecutionFiles(config, buildDate)` loads annual files and calls the
  same producer. This is the standalone CLI adapter.

The current production model is explicitly 2024–2026: 2024 and 2025 require
12 reports each, and 2026 requires months 1 through the independently reviewed
latest headline. Duplicate/missing months and stale/latest-report regressions
fail. The default reviewed headlines cover July–September 2026; callers may
supply a reviewed `ExecutionHeadline[]` for additional 2026 months. A 2027
monthly report requires generalising the existing model before acceptance.
The complete list is the caller's snapshot/input-closure responsibility; the
API neither discovers nor acquires new reports.

All amounts preserve the published execution/2 decimal-string contract.
2024/2025 BGN is divided by 1.95583 before rounding to three places; 2026 is
already EUR. Cumulative-to-monthly differences use decimal arithmetic, and
annual pace exists only for complete years. Law denominators come exclusively
from the sparse adopted-law Annex 1 map. Every consumed law cell must be in
`млн. €`; a differently denominated, re-pinned column and its agreeing rows fail
before their values can enter the EUR plan. National/EU law splits and unavailable
row denominators remain absent, with the existing coverage reasons. Historical
Annex 3 is used only for December reconciliation.

## Standalone command

Build the Node packages, then run the standalone module:

```sh
pnpm --filter @sigma-budget/etl... build
node apps/etl/dist/prepare-execution.js \
  --config /path/to/execution-inputs.json \
  --build-date 2026-11-08 \
  --out /existing/owned/parent/new-candidate
```

`--out` must be a **new** directory under an existing real parent. Existing
outputs are never replaced. Inputs, pins, fiscal checks and all serialisation
finish before any directory is created. The command writes all three files
through a temporary sibling directory and reserves its destination exclusively.
It rejects symlink inputs/parents and output overlap with source directories,
originals, releases and fixtures. Failed source checks leave existing outputs
and sources unchanged. Arguments are exact pairs; there are no fixture roots,
fixed output paths, upload operations or network acquisition modes.

The config is ordinary JSON. File paths are absolute or relative to the config
file's directory. Every `sha256` must be a reviewed lowercase 64-digit digest:

```json
{
  "schema": "execution-inputs/1",
  "reports": [
    { "path": "raw/kfp_2024/2024-EU_funds_0124_BG_WEB.xls", "sha256": "<reviewed SHA-256>" }
  ],
  "annual": {
    "forecast": { "path": "prepared/budget_forecast_2027.json", "sha256": "<reviewed SHA-256>" },
    "bill": { "path": "prepared/budget_bill_2027.json", "sha256": "<reviewed SHA-256>" },
    "forecastArchive": { "path": "raw/ZDBRB-2027.zip", "sha256": "<reviewed SHA-256>" },
    "billArchive": { "path": "raw/ZDBRB-2027.zip", "sha256": "<reviewed SHA-256>" },
    "historicalAnnex3": { "path": "prepared/asbp_tables.json", "sha256": "<reviewed SHA-256>" }
  }
}
```

The example abbreviates the report list; the supplied publication needs all
33 real monthly files. Forecast and bill may refer to the same pinned archive.
These fields accept real snapshot paths, not an expected-output JSON file.

## Evidence and boundaries

Own checks use all 33 tracked original XLS reports under the existing wave18
input closure. All 7,128 effective cells are compared to independently saved
xlrd 2.0.2 sheet captures. Both complete output documents match the existing
published JSON content, including all money strings and lineage fields.
The exact sparse law map, cumulative/monthly series, annual availability,
rounding and known exceptions are therefore covered by full-document comparisons.

`packages/ingest/test/readers/execution-donor.py` is a separate **test-only**
Python 3.12/xlrd 2.0.2 generator. It verifies pinned donor module hashes, reads
actual frozen originals, writes only a new explicit owned directory and records
input/output hashes. It never substitutes captured grids for XLS decoding.
Comparison is parsed JSON equality: Python's `11.0` versus JavaScript's `11`
number spelling is not a monetary difference. The Node outputs are byte
identical across repeated builds of the same inputs/date.

The three tracked SEBRA workbooks are compared with saved independent row
readings. For available external originals, run the explicit additional check:

```sh
node packages/ingest/test/readers/workbook-acceptance.mjs \
  --originals /path/to/data/originals \
  --out /path/to/new-owned-report.json
```

It verifies source pins, compares the complete EC `Sheet1`, `Excise duties`
and `VAT` scalar grids plus SEBRA's `Sheet1` with independent saved Python
reader evidence, and confirms the originals' hashes afterward. Missing required
originals fail this command; they are never counted as a skipped PASS. These EC
files are available in the existing acquisition checkout but are not added to
this worktree or silently downloaded by tests.

Saved captures and published documents are inherited test expectations. The
new Node decoding, independent donor regeneration, corruption/label/unit/blank/
identity/pin/missing/stale failures, CLI deterministic-output checks and output
safety checks are own execution evidence. Tests remove their owned temporary
files. Existing frozen fixtures and donors remain unchanged.

Annual data is a deliberate integration boundary: this module verifies
prepared annual JSON and original archive/member hashes, **not physical PDF
extraction or freshness**. `annualBoundary.rawPdfDecoded` is false, with the
five prepared input pins in the file-based receipt. The separate annual PDF
preparation stage must establish that freshness before production graph wiring.
Missing historical originals remain limitations; no synthetic replacements
are generated here. The unit is million EUR in execution and EUR in the SEBRA
source; the workbook engine does not invent conversions or source dates.

The reader dependency is the official [SheetJS 0.20.3 Node distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/),
pinned by URL and lockfile integrity. Formula/cache and stub handling follow
its [cell model](https://docs.sheetjs.com/docs/csf/cell/) and
[read options](https://docs.sheetjs.com/docs/api/parse-options/).
[Saxes 6.0.0](https://github.com/lddubeau/saxes) parses OOXML relationships and
exact scalar tokens; external entities/DOCTYPE are rejected. Both dependencies
are used only behind the Node reader subpaths, with no Worker imports.
