# Offline Node release build lifecycle

The isolated entry is `packages/ingest/src/release-build/index.ts`. It implements commit export, input authentication/staging, candidate manifest/receipt construction, package checking and exact local replay. `apps/etl/src/release-build-operator.ts` is a standalone dispatcher. It deliberately uses the built deep entry; package exports, the default ingest barrel, unified CLI, graph, validation Context, Worker and source adapters are unchanged. PR47's accepted release-client is an ordinary merged prerequisite.

This foundation does not complete the real-source TypeScript import. The parent must bind the accepted graph to the real readers and all validation groups. There is no default producer, fixture assembler, network acquisition, finished-output donor or Python subprocess in this package.

## Parent API

```ts
import {
  buildRelease,
  reproduceRelease,
  checkReleaseDirectory,
  exportCommit,
  prepareInputs,
  stageInputs,
  transitiveInputClosure,
  recordedNodeExecutor,
  REQUIRED_VALIDATION_GROUPS,
  type ReleaseExecutor,
  type ExecutionContext,
  type ExecutorResult,
} from './packages/ingest/dist/release-build/index.js';

const executor: ReleaseExecutor = parentExportedCodeAdapter;
const result = await buildRelease({
  repositoryRoot,
  commit,
  inputRoot: acquiredSnapshotRoot,
  outputRoot: newCandidateDirectory,
  buildDate: '2026-11-10',
  executor,
  maxObjectBytes: 67108864,
});
// {releaseId, manifest, outputRoot}
await checkReleaseDirectory({
  releaseRoot: result.outputRoot,
  inputRoot: canonicalOriginalsRoot,
  maxObjectBytes: 67108864,
});
await reproduceRelease({
  repositoryRoot,
  releaseRoot: result.outputRoot,
  inputRoot: acquiredSnapshotRoot,
  outputRoot: anotherNewDirectory,
  executor,
  maxObjectBytes: 67108864,
});
```

`inputRoot` contains `data/originals/` and `data/cache/`, optionally the source-client PR48 `snapshot.json`, immutable receipts, raw responses and versioned files. `data/inputs/` comes exclusively from the processing commit. `transitiveInputClosure(sources, datasets)` follows both dataset and intermediate dependencies, including cycles and source/dataset IDs sharing a name. It returns external and committed declaration maps, with every consuming dataset. The older shared `io/registry.registryInputs` remains untouched.

`exportCommit(repositoryRoot, commit, newExportRoot)` exports local Git objects and returns `{commit, tree, files, snapshotSha256}`. `prepareInputs(exportRoot, inputRoot)` authenticates the complete closure and returns registries, manifest input facts, separate committed input facts, selected physical paths, registry hashes and snapshot identities. `stageInputs(prepared, ownedRoot)` makes private, read-only copies with verified bytes; it never hardlinks originals. These lower-level operations also let the parent create a persistent canonical original view when needed. The directory supplied to `exportCommit` must be new, with an existing owned parent.

The 119 external files in the accepted release remain `manifest.inputs`. Committed authored/extraction inputs are additionally recorded in `processing.committed_inputs` and the export hash. SHA-file and registry pins must agree; neither overrides the other. Unpinned external bytes fail unless the committed entry explicitly says `pinned: false`. Pins matching a wildcard are mandatory members even if another matching file remains on disk. An exact newly missing declared raw file fails before execution. Historical warnings cannot waive this check.

PR48 snapshots are verified against the processing commit's source-registry/pin identity, content-addressed receipt, successful selected bytes, raw HTTP evidence and compressed wire hashes. Versioned selections are staged at their logical registered paths. Drift or proposed pins do not authorize new build bytes. A failed row for a required input fails. Unrelated historical acquisition gaps do not establish a successful historical reconstruction; the complete declared build closure must still exist and authenticate. A source acquisition receipt is local provenance, not a publisher signature.

`checkReleaseDirectory` retains PR47's canonical-originals-root contract. When a snapshot selects `versions/...` without a canonical copy, use `prepareInputs` plus `stageInputs` to create a separate owned canonical view for PR47. Do not hand a raw versioned directory to `preflightRelease` and assume it resolves snapshot selections. `buildRelease` and `reproduceRelease` handle those selections internally.

## Exported-code executor contract

`ReleaseExecutor` contains `identity: {runtime: 'node-export/1', id, entry}`, optional `bridgeSha256`, optional `dependenciesRoot`, and `execute(context)`. The committed `entry` is checked and hashed independently. `dependenciesRoot`, when supplied for a trusted compiler/installed dependencies, must have exactly the exported `pnpm-lock.yaml`; a mismatch fails without installation or network fallback. The recorded environment distinguishes native execution from this local adapter.

`ExecutionContext` contains only the owned `exportRoot`, `candidateRoot`, `scratchRoot`, resolved full commit, build date and authenticated input facts. The adapter must load/compile the entry and production code from this export. It must never import current-checkout producers when reproducing another commit. It can read committed inputs and staged originals, write graph outputs under `candidateRoot/data/`, and put generated intermediates/extraction evidence in `scratchRoot`. It must not rewrite committed inputs, originals, code or lifecycle metadata. The lifecycle verifies exported code and staged bytes again after execution and before installation. A trusted in-process adapter is an explicit trust boundary, not an OS sandbox for hostile code.

`execute` returns:

```ts
{
  validation: {
    completeValidation: true,
    groups: [{
      group: 'INPUTS', status: 'OK', checks: 285,
      summary: 'actual checks and evidence', problems: [], warnings: [],
    }, /* every REQUIRED_VALIDATION_GROUPS entry */],
  },
  datasets: [{id: 'execution', action: 'built'}, /* every active output owner */],
  extractions: [/* optional actual reader evidence */],
}
```

The 26 required groups match the accepted production report, from INPUTS through CONTRACT. Each must have actual checks, no problems, and status OK or WARN. Missing, duplicate, failed, skipped or scoped/incomplete validation cannot produce a package. Additional groups such as REGISTRY are allowed and checked. The parent must adapt the real validators into this result; lifecycle tests that manufacture these groups are explicitly synthetic. Rule coverage is recorded separately from `historicalReconstruction: "unverified"`, committed historical limitations and preserved-input actions. The lifecycle does not infer that every historical raw chain was recovered.

Each active dataset's declared output patterns must exist, every file must have one dataset owner, and the executor must report its action. The existing `releases` metadata dataset is handled by lifecycle metadata rather than recursive data outputs. Core, catalog, execution and execution provenance are required. Actual files determine every output byte count/hash and schema identity. Old releases/current pointers are removed from the export and cannot enter the candidate. Catalogue facts must be built by the parent's existing graph from these actual inputs and outputs, not copied from an old catalogue.

### Native runtime and finite compilation boundary

`recordedNodeExecutor({entry, id}, timeoutMs?)` loads a committed module exporting `executeRelease(context)`. It supports runnable `.mjs`/`.js` and Node 24 erasable `.ts` with natively resolvable imports. It starts a fresh Node process with an empty credential environment, UTC date, filesystem permissions limited to the export/candidate/scratch, no addons or subprocess permission, network-module import guards and disabled fetch/WebSocket/EventSource. Time is bounded to at most five minutes, stdout/stderr to 1 MiB, result JSON to 32 MiB. Its small bridge hash is recorded. These restrictions supplement the trusted-code contract; they are not a claim of hostile-code isolation.

The current source graph's TypeScript `.js` imports may require offline compilation. That is an explicit parent adapter, not an implicit current-checkout fallback. A finite implementation should verify the supplied local dependency lock, bundle the exported entry and exported workspace modules into scratch using the already installed pinned compiler, resolve all workspace aliases to exported source, and reject unresolved/dynamic imports into the current checkout. Bound compilation time/output and run the bundle against the same context with no network. Record the committed entry/code snapshot and the actual runner/compiler hash through `bridgeSha256`; set `dependenciesRoot` for the verified lock. Never invoke install/build scripts that can fetch dependencies. This foundation intentionally does not add another graph builder or infer a production entry while the real-source owners are still integrating.

## Package and reproduction

All destinations must be new and disjoint from the complete repository checkout, acquired snapshot and optional dependency installation. This stronger restriction means a CLI candidate belongs outside the checkout, rather than in its `tmp/`. Existing components, broken symlinks, hardlinks and special files are rejected. Output names must satisfy the accepted Worker/client path contract. An executor cannot create manifest, validation, receipt, release pointer or undeclared output paths.

The lifecycle creates canonical JSON, deterministic validation, a byte-derived manifest and a `node-release-build/1` receipt binding release ID, commit, executor, snapshot, validation hash and output inventory hash. The receipt's `built` is the explicit build date at UTC midnight, not a wall-clock execution timestamp. The manifest records the actual resolved commit/tree/export hash, entry hash, Node version, lock hash and explicit date. Same commit/date/snapshot/runtime/executor yields the same package bytes. PR47 `preflightRelease` runs on every staged input/output before a whole candidate directory is renamed into place. No partial PASS package is exposed on failure. Only new private work directories are removed; an existing candidate or arbitrary stale tree is never pruned.

`reproduceRelease` requires a recorded Node executor identity and exact Node runtime, re-exports the recorded commit, reruns it with its recorded date and authenticated snapshot, and compares the complete manifest ID and every output byte hash. It checks the recorded package's output and receipt integrity as well. A differing replay is removed before installation. Historical Python releases explicitly fail with a historical-runtime message here; they retain the Python `budget reproduce` boundary with the recorded exported code and pinned Python 3.12 environment. They are never regenerated with current Node code under an old commit label.

There is no ZIP/report/pointer writer in this scope. Candidate metadata is inside the new owned directory; operator results go to stdout. Existing web packaging is reused only after package verification. The parent must apply the same destination preflight to any later archive, report or site-copy destination; it must never point such a writer at an authenticated source, manifest or checkout path. The existing 50 MiB release-client default remains unchanged; the 63,488,595-byte programme ZIP needs the explicit compatible 64 MiB allowance.

## Standalone operator and checks

```sh
pnpm --filter @sigma-budget/etl... build
node apps/etl/dist/release-build-operator.js --help
node apps/etl/dist/release-build-operator.js build \
  --root /repo --commit COMMIT --inputs /acquired-snapshot --out /new-candidate \
  --build-date 2026-11-10 --entry COMMITTED_ENTRY.mjs --executor-id reviewed-entry \
  --max-object-bytes 67108864
```

`releaseBuildOperatorCli(args, {executor?, stdout?})` is import-safe and returns an exit code: 0 success, 1 replay byte differences, 2 invalid input/runtime, 3 missing required local evidence. `ReproductionDifference` exposes the replay code to parent dispatch. Parent dispatch can inject its real adapter. Conflicting executor flags are rejected. `validate` verifies package bytes and the recorded validation receipt; it does not claim to rerun numerical validation. `reproduce` requires `--root --release --inputs --out` and an explicit executor. There is no fixture/default source, server, remote operation, account/auth discovery, upload or publication.

Focused tests create their own temporary Git repositories/snapshots and exercise transitive closure, missing/wrong/conflicting pins and wildcard members, versioned source snapshots, links/overlap, crashes, group failures/omissions, escaped writes/network/subprocess attempts, immutable input/code checks, deterministic double builds, actual recorded-commit replay despite newer checkout commits, every output hash, receipt identity and rejected replay cleanup. Native TypeScript execution is tested without dependency installation. Operator tests cover explicit dispatch/argument contracts.

```sh
pnpm --filter @sigma-budget/ingest exec vitest run src/release-build/lifecycle.test.ts
pnpm --filter @sigma-budget/etl exec vitest run src/release-build-operator.test.ts
BUDGET_BUILD_ACCEPTED_CANDIDATE=/tmp/pr40-independent-acceptance1/candidate \
BUDGET_BUILD_ACCEPTED_INPUTS=/path/to/canonical-source-root \
  pnpm --filter @sigma-budget/ingest exec vitest run src/release-build/compatibility.test.ts
```

The finite real-package check passed on 2026-11-10: 119 freshly authenticated declared external inputs matched the accepted manifest's bytes/hashes, all 70 output files passed PR47 checking, and the web candidate reader/copy retained ID `f6e78e74fba37602840310934821f4a6d95872a0d19af2512ba4763fefe5ca0b`. The frozen candidate was read-only compatibility evidence. It is not evidence that this branch ran a real-source Node numeric producer. Production source binding, the active reader/aggregate owners, complete validator execution on those outputs, and end-to-end acceptance remain parent integration work. Historical Eurostat/GVA, missing old source vintages and the unavailable full programme archive remain subject to the existing reproducibility documentation.
