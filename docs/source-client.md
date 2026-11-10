# TypeScript source acquisition client

`@sigma-budget/ingest/source-client` is a Node-only operational client for source acquisition, manifest refetch, manual import, original status and reviewed drift. It uses the existing `data/sources.yaml` and pins. Python remains operational, and the default ingest export, root CLI, graph, validation Context, Worker and production registries are unchanged.

## Integration contracts

```ts
import { SourceClient, inspectDrift } from '@sigma-budget/ingest/source-client';

const client = await SourceClient.open({
  sourceRoot,
  registryPath,
  pinsPath,
  clock: () => new Date(), // injectable; no fixed fixture dates
  transport, // optional SourceTransport; defaults to node:http/node:https
  attempts: 3,
  timeoutMs: 30_000,
  maxBytes: 256 * 1024 * 1024,
  maxDecodedBytes: 256 * 1024 * 1024,
});
const result = await client.collect({
  snapshotRoot,
  seedRoot: sourceRoot,
  resume: true,
  checkDrift: true,
});
```

The exports include `SourceClient`, `SourceTransport`, `nodeSourceTransport`, `KfpDecoder`, `validateKfpGrid`, `reduceGisco`, `reduceOblast`, `inspectDrift` and the receipt types. `client.collect`, `client.refetch({manifestPath,snapshotRoot,...})` and `client.importSource({source,file,snapshotRoot,...})` return `{code,snapshot,snapshotSha256}`. Dry-run imports add `dryRun:true` and write nothing. `client.status()` returns per-file states and `latestAsOf`; the standalone operator uses the existing freshness helper for the next KFP report/deadline.

Transport receives `{url,signal,headers}` and returns `{status,headers?,body}`. Body can be bytes or an async byte iterable. Implementations must honor the abort signal and release their streams. The client bounds the complete attempt, byte count and gzip expansion, retries only finite attempts (maximum five), and refuses permanent HTTP errors. Each attempt has a maximum 30-second deadline. The default transport supplies no cookies or credentials and reads no environment/auth files. TLS verification stays enabled. Redirects require an explicitly supplied exact URL in `allowedRedirects`; loopback HTTP additionally requires `allowLocalHttp:true` in the API. Neither exception is exposed as an implicit CLI fallback.

The registry's exact automatic URLs form the allowlist. Known boundary-reducer entries expand only to the GISCO CSV/GeoJSON pair or the full 28-region Eurostat population request defined in `reducers.ts`. Unknown `via` entries fail. Registry and SHA-file pins must agree. Automatic wildcard paths fail; manual glob paths resolve only to their registered source. Public manual URLs must share an explicitly registered source/page origin. Credentials in URLs, browser-only Minfin acquisition and login/challenge HTML are rejected. File-extension byte-kind checks take precedence over a source-wide format because some registered sources mix HTML, JSON and workbook files.

## Standalone operator

Build with `pnpm --filter @sigma-budget/etl... build`. The executable module is `apps/etl/dist/source-operator.js`; importing its `sourceOperatorCli(args,deps)` function has no execution side effect. The parent can call it from unified dispatch later. It returns the exit code and allows injected transport, clock, KFP decoder and output sinks.

All commands take `--source-root DIR --registry FILE [--pins FILE] [--now UTC_TIMESTAMP]`. Paths are explicit rather than fixture defaults. Examples below describe future authorized operations; implementation and acceptance of this package executed HTTP only through fake transport and an owned ephemeral loopback server.

```text
collect --out SNAPSHOT [--seed SOURCE_ROOT] [--sources ID,ID] [--resume]
        [--check-drift] [--summary NEW_MARKDOWN_FILE]
refetch --manifest LOCAL_MANIFEST --out SNAPSHOT [--resume] [--summary NEW_FILE]
import-source --source kfp --file DOWNLOADED_XLS --out SNAPSHOT
              [--url PUBLIC_URL] [--replace] [--dry-run] [--decoder-module FILE]
status
drift --snapshot SNAPSHOT/snapshot.json [--review REVIEW_JSON]
      [--report NEW_JSON_FILE] [--summary NEW_MARKDOWN_FILE]
```

`--attempts`, `--timeout-ms`, `--max-bytes` and `--max-decoded-bytes` override finite acquisition limits. Errors and results have stable functional exit meanings: 0 successful operation, 1 drift/review pending or status problems, 2 invalid command/input, 3 unavailable acquisition/incomplete snapshot. `collect --check-drift` prioritizes unavailable sources over drift, matching Python. `refetch` prioritizes changed bytes over unavailable responses, also matching Python.

Python's `budget status` is release-server status; raw-original status lives in `sources/originals.py status`. Here `source-operator status` deliberately implements the latter. Python `collect` defaults its seed/output relative to its checkout; this operator requires explicit roots. Python `refetch` supports a remote manifest/current release; this module accepts an already acquired local manifest and checks every source identity against the supplied registry. Remote current-release resolution belongs to parent release-reader wiring. It is not an arbitrary URL download switch.

## Immutable bytes, checkpoints and review

Output trees must be disjoint from source/seed roots, registry, pins, manifest and manual input. Reports must additionally be outside the snapshot tree and be new files. Symlinks in any existing component, including broken links, are refused. Files are read with no-follow semantics and bounded regular-file checks. Exclusive writes never replace prior evidence. Reports cannot alias validated metadata; the only replaceable file is a recognized single-link `snapshot.json` pointer, installed atomically under a per-tree exclusive lock. A stale lock after a killed process requires the operator to establish that no operation is active before removing that owned lock.

`collect` copies existing `data/originals` and `data/cache` seed files without replacing older snapshot files. It acquires only automatic registry entries; manual/historical absence remains visible through `status`, rather than being invented or reported as a successful acquisition. Changed originals go under `versions/<full-sha256>/<registered-path>`. Decoded response bytes are also retained under `raw/<sha256>`; gzip HTTP responses retain both compressed wire bytes and decoded file bytes with their hashes. A successful reducer therefore retains every actual raw response it used.

Each completed entry writes a content-addressed immutable receipt and advances a checkpoint. An interrupted process can resume from the last completed checkpoint. `--resume` checks registry/pin identity, receipt hash, all selected file hashes and all recorded raw/wire hashes before skipping successful rows; failed rows are retried. Refetch also binds resume to exact manifest bytes. A normal invocation without `--resume` performs a new acquisition. Every prior receipt and original version remains available. Identical calls under an injected clock produce identical receipt bytes and IDs. This is local integrity and provenance, not a signature by the data publisher.

`source-snapshot/1` contains `identity`, `operation`, `started`, `completed`, `complete`, `collected` and `receipt`. Every row identifies its source, registered path, expected hash, method, status and selected file/hash when successful. Successful acquired rows also contain raw HTTP facts and retrieval time. `snapshotSha256` hashes the actual pointer bytes. Every snapshot explicitly states `numericalValidation: "not-run"` and `historicalReconstruction: "unverified"`.

`drift` verifies the receipt and files before producing a report. Optional review JSON uses this contract:

```json
{
  "schema": "source-drift-review/1",
  "snapshotSha256": "<sha256 of the exact snapshot.json bytes>",
  "reviewer": "Operator name",
  "decisions": [
    {
      "source": "eurostat",
      "path": "data/originals/eurostat/tps00001_BG.json",
      "sha256": "<candidate byte hash>",
      "decision": "preserve-historical",
      "reason": "New observations cannot establish the historical input vintage"
    }
  ]
}
```

Decisions are `accept-candidate`, `preserve-historical` or `reject`. Stale, mismatched and duplicate decisions fail. Unreviewed candidates remain pending; rejected ones fail review. Acceptance records an operator's intent for later validation and does not change pins, move originals or authorize publication. The JSON report keeps each exact decision and reason. The Markdown report gives the acquisition table and review counts.

## Manual KFP import and decoder boundary

Known archived bytes are restored by registered pin/hash without needing a decoder. An unknown monthly KFP XLS requires an explicit physical workbook decoder. Its contract is `decodeKfp(bytes) -> {sheet,rows,columns,title,unitText}`. The client checks sheet `стартова`, dimensions 54×4, the end-of-month date in A3, and D4's million-BGN unit through 2025 or million-EUR unit from 2026. Filename suffix `_N` is retained; the period comes from contents. New periods must match the provided registry's KFP patterns.

Parent integration should adapt PR43's real workbook API to this small contract, reading A3 and D4 from the decoded sheet and its actual dimensions. The CLI's explicit `--decoder-module` loads a trusted local module exporting that function. This package does not add a second XLS parser or start Python. A missing decoder causes a clear failure before import writes; tests use explicit finite grids and separately exercise actual pinned workbook bytes. KFP identification checks do not claim the full fiscal sum/headline validations ran.

Different versions of the same month, including an old pinned version absent from disk, require `--replace`. This records the old path/hash and a proposed pin; old files and actual pins remain unchanged. The receipt records the supplied basename, source/page, import time and byte hash. Its retrieval time is explicitly marked `import-time-only`; it does not assert the browser download time. Unknown non-KFP hashes are refused. `--dry-run` performs all identification and correction checks without writing a snapshot, receipt or source.

## Raw reducer coverage and historical limits

GISCO reduction implements the original `boundaries.py` steps: UTF-8 CSV decoding with quoted fields, country filtering, LAU code/name/population/area, exact 265-row cardinality, sorting, raw GeoJSON identity join, Polygon/MultiPolygon normalization and five-decimal coordinate rounding. Area uses the existing Python-compatible rounding helper at three decimals. Missing/duplicate geometry or invalid coordinates fail. The result has the existing cache shape, release and population date. Acquisition is bounded-buffer based, including the complete raw GeoJSON, so memory grows with the configured bound; this is not the Python stream-and-discard implementation. The raw source is retained to make the new acquisition inspectable. This stage checks structure, not final topology/numerical validation.

Oblast reduction makes the same full 28-region request as Python, reuses the existing JSON-stat helpers to require total-sex/all-age/person observations for each region, then writes the existing `{url,updated,jsonstat}` cache shape. The default bound accommodates the documented 100+ MB GISCO response and the 63.5 MB programme archive. A larger future response must be handled through an explicit finite limit or a later streaming implementation.

Reduced JSON is serialized deterministically by Node. Numerical content agrees with the original reduction steps; JS/Python float lexical differences can create a byte drift in a regenerated cache. Such a cache is a candidate for review, never a silent replacement. Raw response bytes remain exact. The old GISCO raw CSV/GeoJSON were not retained historically; algorithm tests reconstructed synthetic raw records from the frozen cache only to exercise the reduction, and explicitly do not certify historical raw recovery. Recorded oblast bytes are tested separately.

Missing historical Eurostat/GVA, July component workbooks, authored/editorial material and the full 2027–2029 programme archive remain historical/availability limitations. Revised responses cannot establish old numerical reproduction. No source fetching, data refresh, production registry/pin edit, account operation, upload or publication was authorized by this implementation. Future live acquisition requires explicit data-refresh authorization. Full publication wiring still needs parent-owned real readers, source binding, input/manifest staging and complete validation before any candidate can be accepted.

## Offline verification

Focused tests cover finite fake transport, an owned ephemeral loopback HTTP server, immutable versions/receipts, transient/permanent errors, deadlines, format/login HTML, bounded streaming and gzip, redirect allowlists, resume/tampering, manual import/corrections, deterministic clocks, report/input aliases and exact drift review binding. Actual supplied XLS/PDF/ZIP and recorded XLSX/XML bytes are acquired using fake transport and compared byte for byte. The 33 pinned KFP reports are checked against the real registry. The 265-row raw reduction is checked against the existing Python donor with HTTP replaced by owned finite bytes; production code has no Python subprocess. Fixtures, donors, pins and source bytes are preserved.
