# Offline publication document adapters

The adapters use the MuPDF.js text/geometry/table reader and ordered physical HTML/DOCX blocks.

## Named APIs and contracts

Import from `packages/ingest/dist/readers/publication-documents/index.js` after
`pnpm --filter @sigma-budget/ingest... build`. The production loader composes these adapters.

| API                                              | Inputs                                                                                                                                              | Result                                                                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `extractLawBill(html, docx)`                     | Actual adopted-law UTF-8 HTML bytes and submitted-bill DOCX bytes                                                                                   | Complete `law_bill` cache: `sources`, `law`, `bill`, `billMc`, `diff`, `sums`, `municipal`                                                                                     |
| `extractLawBillBlocks(lawBlocks, billBlocks)`    | Ordered physical `GazetteBlock[]` from the prerequisite readers                                                                                     | Same complete cache; article occurrences, identifiers, null/zero, policy parts, judiciary, commitments and municipal row order retained                                        |
| `extractDbp(bytes, outlook?)`                    | Actual October 15, 2026 PDF, SHA-256 `8c91cdf4778f2864e1eeb167f14b08d1f68a076ea4ad27a8a4305175a73f1182`; optional explicit outlook comparison input | Full donor-compatible JSON, including 304 reported figures, 14 derived figures, checks, quotes, document status, accounting bases and editorial context; satisfies `PlanInput` |
| `extractProgrammePdf(bytes)`                     | One actual programme PDF                                                                                                                            | Source table rows, printed table/year context, independent token rows, nine-column cells, ambiguity/conflicts, programme names and policy row labels                           |
| `extractProgrammes(pdfs, law, zdb?)`             | Complete 46-file inventory, complete legal cache; optional existing ZDB intermediate                                                                | `{ source, pdfs, receipts, law }`; `asProgrammeEvidence(result)` feeds the unchanged programme/budget builders                                                                 |
| `extractProgrammeArchive(bytes, { wasmModule })` | Registered Parliament ZIP bytes; absolute resolved `7z-wasm@1.2.0` module                                                                           | 46 PDF byte buffers and ordered archive-member chains with member SHA-256; never extracts into an original directory                                                           |
| `readRegisteredProgrammePdfs(options)`           | Explicit input root, source registry, original pins and read date                                                                                   | PDFs registered by the `data/originals/program_budgets/*` reproducible intermediate depending on `prb`; requires every original pin and the full inventory                     |
| `extractPublicationDocuments(options)`           | `ReaderOptions` plus optional roles, `programmeSource`, `sevenZip`, `outlookPath`, `zdbPath`                                                        | In-memory outputs keyed by their exact target paths, registered-source receipts, archive member receipts and explicit unavailable 2027 programme archive state                 |
| `preparePublicationDocuments(options)`           | Same options plus a separate caller-owned `out`                                                                                                     | Generates absent intermediates, verifies existing values, retains existing bytes, returns/writes a deterministic receipt                                                       |

`roles` is a unique, nonempty subset of `law`, `dbp`, `programmes`; all three is
the default. `programmeSource` defaults to `extracted`; select `archive`
explicitly to prepare from the nested ZIP/7z source. There is no silent fallback
when a source, registration, pin or 7z backend is missing.

For complete current DBP compatibility, supply the existing outlook JSON using
`outlookPath`. It is an explicit comparison input, not a producer of DBP figures.
Without it, the extraction records the missing comparison in
`basis_differences_vs_mock.mock_vs_dbp._error`. Supply `zdbPath` for the existing
programme reconciliation metadata; otherwise it is derived from the freshly
parsed legal tables. Auxiliary input paths/hashes/byte sizes appear in receipts.

The outputs are:

```text
data/cache/law_bill.json
data/cache/research/dbp-2027/dbp2027_figures.json
data/inputs/program_budgets_2026.json
data/inputs/programme_pdf_evidence.json
tmp/publication-documents-receipt.json
```

DBP keeps ESA_GG, ESA_NA, KFP_CASH, CASH_CB, EXT and EU_RULE distinct. Table
figures are read from actual physical cells; quote declarations must occur on
the specified physical PDF page and contain the reported value. The SAFE
advance's EUR-to-million-EUR conversion is checked explicitly. Table 7 uses
printed year-column positions. Derived figures use the declared formulas and decimal rounding. `dbp-specifications.ts` contains source declarations and editorial text; it never imports expected figure JSON. The
legacy `meta.generated_by` value is retained for artifact compatibility; the
receipt identifies the actual Node/MuPDF.js engine.

Programme amounts remain in printed thousand EUR. The source table reader uses
header columns, nine-number rows and positional fallback. The independent
evidence reader also resolves omitted blanks through accounting identities,
right-edge calibration, printed column-group headings and programme hierarchy.
Ambiguous or inconsistent rows stay unresolved. Existing builders retain their
publication and legal reconciliation policy. Forecast 2027/2028 columns inside
the **2026** programme PDFs keep their printed meaning; they are not programme
allocations from a 2027 archive. `programme2027Unavailable` explicitly records
the unavailable archive and generates no allocations.

## Archive and output safety

ZIP32 central/local names, flags, sizes, CRCs, duplicate/Unicode/case aliases,
member overlap, encryption, file types and traversal are checked before reading
selected members. Legacy Parliament names use IBM866 unless the UTF-8 flag is
set. Depth is fixed to the source's outer ZIP and inner ZIP/7z. Limits are 128 MiB
archive bytes, 32 MiB per member, 512 MiB expanded total, 2,048 entries and a
1,000:1 expansion ratio. Third-level archives and unexpected selected members
are rejected.

7z uses the pinned [official `7z-wasm` module API](https://github.com/use-strict/7z-wasm/blob/master/README.md)
(`FS`, `callMain`) inside an isolated worker and MEMFS; NODEFS/WORKERFS are never
mounted. Listing precedes extraction; path/link/encryption/size/dictionary guards
apply to all listed members. Only the one judicial programme PDF is selected;
its extracted size and CRC are checked. The worker has a maximum 60-second
deadline, a bounded JS heap and unconditional awaited termination. No external
runtime is used by these adapters.

Preparation rejects overlap between output and input roots or registry/pin/
auxiliary paths, and preflights every destination including the receipt before
any write. Symlinks and hardlinked destinations are rejected. Absent files are
written exclusively through owned temporary siblings and no-clobber hardlinks.
Every existing intermediate is verified before any new intermediate is written.
New files are rolled back if a later write fails. Receipts are immutable
verification inputs on rerun; a changed read date/source/selection requires a
new owned export. No original, existing stale cache, registry, pin, release,
fixture or source byte is replaced.

## Standalone invocation

The optional scoped package keeps the new WASM dependency out of shared
manifests. Node 24 and pnpm 10.33 are required.

```sh
pnpm --filter @sigma-budget/ingest... build
pnpm --dir apps/etl/publication-documents --ignore-workspace install --frozen-lockfile --ignore-scripts
node apps/etl/publication-documents/prepare.mjs \
  --input-root /absolute/read-only-source-root \
  --registry /absolute/read-only-source-root/data/sources.yaml \
  --pins /absolute/read-only-source-root/data/originals.sha256 \
  --out /absolute/owned-export \
  --date 2026-11-10 \
  --outlook /absolute/read-only-source-root/data/release/outlook.json \
  --zdb /absolute/read-only-source-root/data/inputs/zdb2026.json \
  --programme-source archive
```

No server, port, live source acquisition, credential access or deployment is
involved. The production loader composes these adapters into the preparation
graph; CI checks production selection and readiness.
