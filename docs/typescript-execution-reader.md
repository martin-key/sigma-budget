# Workbook decoding and monthly execution preparation

This Node-only package reads actual pinned BIFF `.xls` and OOXML `.xlsx` bytes.
It produces the complete monthly `execution.json` and
`execution-provenance.json`. It adds an
`execution-reader-evidence.json` receipt containing original file hashes, raw
unit strings, used cell coordinates and hashes, cache/blank/missing counts,
known source differences and the prepared annual input boundary.

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

The workbook-reader acceptance command runs separately against actual originals after `pnpm --filter @sigma-budget/ingest... build`:

```sh
node packages/ingest/test/readers/workbook-acceptance.mjs --originals ROOT --out NEW_REPORT.json
```

`ROOT` is the restored inputs' `data/originals/` directory. `NEW_REPORT.json` must be a new file with an existing parent directory. The command checks EC `Sheet1`, `Excise duties` and `VAT`, SEBRA `Sheet1`, source SHA-256 and unchanged original bytes. A missing original fails the command; it is not skipped.
