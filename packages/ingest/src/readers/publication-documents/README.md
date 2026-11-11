# Offline publication document adapters

This opt-in slice uses PR 46's real MuPDF.js text/geometry/table reader and PR
44's ordered physical HTML/DOCX blocks. Both prerequisite commits are merge
ancestors. Python remains the production default. The shared context, graph,
global CLI, root ingest index, existing programme/plan builders and fixtures are
unchanged by this slice.

## Named APIs and contracts

Import from `packages/ingest/dist/readers/publication-documents/index.js` after
`pnpm --filter @sigma-budget/ingest... build`. Parent integration can add a public
package export when wiring the unified source preparation layer.

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
printed year-column positions. Derived figures use the donor's formulas and
Python rounding. `dbp-specifications.ts` is a transcription of donor source
declarations and editorial text; it never imports expected figure JSON. The
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

## Exact legacy programme verification

Fresh Python 3.12 and the Node physical grid differ in the old intermediate's
1000/1100 rows: Python `find_tables` merged/lost some physical rows. The new
reader recovers them. All independent PDF cells, conflicts, names and row labels
match the fresh Python reader for all 46 files. The complete unchanged budget
builder output is identical using either extraction.

`verifyLegacyProgrammeSource` permits only the exact full legacy cache together
with the exact complete fresh PDF evidence and legal cache, using three
canonical SHA-256 fingerprints. These are verification fingerprints, never
runtime producers. Any edited amount, name, diagnostic, year, null, evidence or
law cache fails. Existing legacy bytes are retained and the compatibility is
recorded in the receipt. Newly generated files use the real physical grid.
Other outputs use exact JSON-value freshness with no amount, text, null, row
order or provenance tolerance.

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
deadline, a bounded JS heap and unconditional awaited termination. No Python
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
involved. Parent integration owns the unified preparation graph, exports,
production selection, final CI/readiness and remote merge.

## Verification and reproducibility

`test/publication-documents-python.py` uses an explicit Python **3.12** executable,
reads the immutable actual donor and sources, removes only the `unpack()` call
from its in-memory programme donor invocation, disables bytecode writes, and
redirects all donor outputs into a new owned directory. It compares the whole
legal cache, DBP JSON, programme extraction and all PDF evidence, not selected
numbers. No fixture or frozen donor is rewritten.

```sh
taskset -c 18,19 env PYTHONDONTWRITEBYTECODE=1 \
  /home/user/work/sigma-budget/tmp/venv-data/bin/python \
  packages/ingest/test/publication-documents-python.py \
  /home/user/work/sigma-budget /absolute/new-python-output
taskset -c 18,19 node packages/ingest/test/publication-documents-real.mjs \
  /home/user/work/sigma-budget /absolute/new-python-output /absolute/new-acceptance-output
```

The actual-source test exercises absent generation, exact existing-byte
verification, exact legacy verification, nested archive SHA equivalence, bad
hashes, wrong physical column count, missing quotes, corrupt 7z, missing raw
originals, stale evidence and stale caches. A missing raw original fails as
unverified; no capture is presented as an actual-reader result.

**Inherited expectations:** the 44 published programme output files and existing
DBP builder output are additionally compared against the old fixture/oracle.
Those publication expectations are inherited captures, separate from fresh
actual-source Python comparisons.

The DBP declaration generator is development-only:

```sh
/home/user/.local/bin/python3.12 packages/ingest/test/publication-documents-generate-dbp.py \
  /absolute/donor/pipeline/budget_pipeline/extract/dbp2027.py > packages/ingest/src/readers/publication-documents/dbp-specifications.ts
pnpm exec prettier --write packages/ingest/src/readers/publication-documents/dbp-specifications.ts
```
