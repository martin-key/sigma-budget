# Offline document and saved API readers

These are Node-only production readers for registered, pinned files. They do not acquire sources, change pins, calculate the registry's transitive input closure, run Python, or replace the current production dispatch. The package exports two independent entry points:

```ts
import {
  SnapshotReader,
  readBnbSnapshot,
  readEurostatSnapshot,
  readParliamentSnapshot,
  readGiscoSnapshot,
  readOblastSnapshot,
  readGvaSnapshot,
  eurostatSeries,
  reduceParliament,
} from '@sigma-budget/ingest/readers/snapshots';
import { readLegalHtml, readLegalDocx } from '@sigma-budget/ingest/readers/documents';

const reader = await SnapshotReader.open({
  inputRoot: '/path/to/acquired-snapshot',
  registryPath: '/path/to/data/sources.yaml',
  pinsPath: '/path/to/data/originals.sha256',
  readDate: '2026-11-10',
});
const law = await readLegalHtml(reader, 'zdb', 'data/originals/dv/zdb2026_dv69_idMat245041.html');
// law.data: GazetteBlock[] = (['p', string] | ['t', string[][]])[]
const bill = await readLegalDocx(reader, 'bill', 'data/originals/parliament/52-602-01-19.docx');
// bill.data.blocks: GazetteBlock[]; bill.data.tables: PhysicalTable[]
const debt = await readBnbSnapshot(reader, 'data/originals/bnb_sdmx/ggd.xml', 'GGALN_G01_XDC');
// debt.data is exactly DebtInput['bnbGg']; debt.evidence retains raw tokens/attributes.
```

Every `read*` result has `data` and a receipt with source ID, registered relative path, verified SHA-256, byte length, read date, declared URL, and registry/pin-file paths and hashes. `pinsPath` is optional only when the matching registry file entry declares its hash. Conflicting hashes fail. The loader accepts only `data/originals/` and `data/cache/` paths belonging uniquely to the requested source; traversal, symlinks, non-files, oversized files and missing pins fail. Missing inputs throw. A loader keeps the registry/pin metadata it opened; open a new loader after deliberately selecting a different inventory.

| API                                            | Actual saved shape                                                               | Existing consumer                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `readLegalHtml(reader, source, path)`          | UTF-8 DV Word-export HTML, leaf data tables inside layout tables                 | `gazetteFacts`, `transformDoo`, `transformNzok`, `transformRatesLaw`, debt legal paragraphs |
| `readLegalDocx(reader, source, path)`          | ZIP with Transitional OOXML `word/document.xml`                                  | `transformAssumptions` and ordered legal block consumers                                    |
| `readBnbSnapshot(reader, path, indicator)`     | BNB structure-specific SDMX 2.1; BG, Q, UNIT_MULT=6, final A observations        | `buildDebt` BNB input; separate raw observation evidence                                    |
| `readEurostatSnapshot(reader, path)`           | Eurostat JSON-stat 2.0, dense or sparse, directly saved or in `jsonstat` wrapper | `jsonstatCells`, `jsonstatSeries`, debt, population and fiscal reducers                     |
| `readGvaSnapshot(reader, path)`                | Sparse Eurostat JSON-stat with UPDATE_DATA annotation                            | Existing `buildGva`, preserving integer/float token distinctions                            |
| `readParliamentSnapshot(reader, path, billId)` | Saved Parliament bill object with matching `L_Act_id`                            | `LawEvidence.parliament`; `reduceParliament` aliases existing `parliamentFacts`             |
| `readGiscoSnapshot(reader, path)`              | Registered reduced GISCO `{items, populationSum, ...}` cache                     | `MunicipalityInput.gis`; existing builders own simplification/topology                      |
| `readOblastSnapshot(reader, path)`             | Registered `{updated, jsonstat}` population cache                                | `MunicipalityInput.oblast`                                                                  |

`eurostatSeries(data, dimension, fixed)` reuses the existing reducer, preserving statuses and omitting missing/null observations without converting them to zero. The raw `data.value` still retains explicit nulls. Sparse source order is retained by the existing text-based JSON-stat decoder. GVA uses the existing numeric-token parser. Call the reader again on original text after serialization: plain JSON serialization loses float token distinctions and sparse numeric-key order.

Parliament input supports the observed array of file objects and a constrained legacy string representation: JSON or a Python-style list of string-valued dictionaries, including quoted-string escapes. It rejects executable expressions and other Python literal types; no `eval`, Python or arbitrary object construction is used. The returned evidence selects only builder-consumed fields, retaining document filenames and all article/bill identities. `billMc` is not flattened into the first occurrence: the DOCX block stream retains both occurrences of articles 1 and 2.

## Standalone command

Build first, then invoke the standalone module with real paths. The root CLI and Python default remain unchanged.

```sh
pnpm --filter @sigma-budget/etl... build
mkdir -p tmp/prepared
node apps/etl/dist/prepare-documents.js \
  --kind docx --input-root /path/to/acquired-snapshot \
  --registry data/sources.yaml --pins data/originals.sha256 \
  --source bill --path data/originals/parliament/52-602-01-19.docx \
  --date 2026-11-10 --out tmp/prepared/bill
```

`--kind` accepts `html`, `docx`, `bnb`, `eurostat`, `gva`, `parliament`, `gisco` and `oblast`. BNB requires `--indicator`; Parliament requires `--bill-id`. The output parent must already exist and resolve without symlinks; the output directory must be new. Checkout outputs belong under `tmp/`. Source/data overlap is rejected. The owned directory contains `data.json`, `receipt.json` and exact `source.bin` bytes. For BNB, `data.json` contains `{series, observations, attributes}`. For later JSON-stat/GVA consumption reparse `source.bin`, rather than treating the prepared JSON as original source text.

## Parser boundaries

HTML parsing follows the DV donor's leaf-table/prose-row projection. It collapses whitespace, decodes entities, preserves empty cells, printed decimal strings and paragraph/table order, and requires article 1. `htmlparser2` tolerates optional/malformed HTML closing tags; this is not a visual HTML rendering engine. It executes no scripts and performs no resource requests.

DOCX reuses the existing bounded ZIP member reader and adds main-part CRC and local header checks. It rejects duplicate/missing main parts, encryption, ZIP64, unsupported compression, malformed XML, unsupported body content and invalid cell merge properties. It preserves physical table indices, parent table identities, rows, cell text, `gridSpan` and `vMerge`; it does not expand merged cells or invent values. The ordered legal projection matches the donor's main-body paragraphs/tables and splits prose-like rows. Text inside nested tables is also included in its containing cell, as in the donor, while each nested physical table remains independently inspectable. Bookmark/section properties are metadata. Strict OOXML namespaces, headers/footers, styles, automatic numbering, drawing/EMF text, equations and tracked-deletion rendering are not reconstructed. Unsupported body wrappers fail explicitly. This is a structural text reader, not a page-layout engine.

XML uses `saxes@6.0.0`, matching pending PR37's pinned choice. DTDs are rejected, unknown entities and malformed XML fail, and nothing fetches external entities, schemas or resources. Limits are 100 MiB XML, 256 nesting levels and two million elements; source files are bounded at 128 MiB and HTML at 32 MiB. SDMX supports the supplied structure-specific attribute observations, not generic SDMX or future schemas. Selected series must be unique; duplicate/gapped quarters, nonfinite values, nonfinal observations and changed units/frequency/area fail. Raw decimal tokens remain separate from the existing two-place numerical projection.

GISCO validation preserves pinned coordinates, including the documented historical Chirpan defect, without silently repairing geometry. Production topology policy remains with the existing municipal builder. Its acceptance here explicitly uses that builder's existing, exact-hash `preserveHistoricalChirpan` option for historical reproduction.

The parser dependencies were already in the lockfile through the development toolchain; they are now explicit pinned ingest dependencies with no unrelated upgrades. Primary package documentation: [htmlparser2 callback API](https://github.com/fb55/htmlparser2#usage), [saxes XML/DTD limits](https://github.com/lddubeau/saxes#regarding-doctype-and-entity). The installed packages' README/type declarations were inspected during implementation.

## Verification and evidence

Portable tests contain only owned structural inputs and archived TEST expectations:

```sh
pnpm --filter @sigma-budget/ingest exec vitest run src/readers
pnpm --filter @sigma-budget/etl exec vitest run src/prepare-documents.test.ts
```

Real-input acceptance has mandatory arguments and **fails** if originals are missing. It is separate from the portable unit suite, so a normal unit run cannot masquerade as a real-source pass:

```sh
mkdir -p tmp/raw-reader-evidence
node packages/ingest/test/readers/real-inputs.mjs \
  --input-root /path/to/acquired-snapshot \
  --report tmp/raw-reader-evidence/real-inputs.json
```

On 2026-11-10 this reread the supplied originals read-only from `/home/user/work/sigma-budget`. All 22 checks passed, including full ordered block equality for three DV laws (1009/207/154 blocks), the actual DOCX (2604 blocks, 45 physical tables, 3683 rows), both BNB series, six Eurostat snapshots, three Parliament bills, GISCO/oblast caches, and owned real-byte corruptions. All eight standalone CLI kinds also succeeded on real inputs, retained exact source bytes, rejected existing outputs and cleaned up their test outputs. Actual legal inputs pass the existing rates/social/assumptions reducers against archived Python expectations. Existing debt/municipality/geometry builders match their archived donor outputs with the freshly read scoped inputs and explicitly preserved other inputs. Input hashes are checked again afterward. No runtime invokes Python.

`docx-expectation.json` was independently generated with the pinned stdlib Python donor from the actual pinned DOCX, comparing every ordered block and every physical table/cell/merge through canonical hashes. `generate-docx-expectation.py` is TEST-only, refuses unpinned input/donor bytes and writes a new expectation file exclusively. The other archived fixtures/donors were only read, never regenerated or edited. These are scoped proofs; PR40's overall import acceptance remains inherited evidence, not an execution claim here.

Missing historical Eurostat vintages, the unavailable original GISCO stream, absent historical authored inputs and programme archives remain documented evidence gaps. The package does not claim fresh regeneration of those inputs, XLS/XLSX/SEBRA decoding, PDF decoding, final `law_bill.json` comparison generation, a complete release build, unified dispatch, full validation or Python replacement acceptance. Subsequent integration must assemble these reader results with the separately owned workbook/PDF APIs and the existing builders/registry orchestration.
