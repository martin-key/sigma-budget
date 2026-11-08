# Components and rates evidence

The frozen inputs were captured at `bd973a0a3dfbc8d8bd03ac85e6aa1f0784669bf2` on 2026-11-08. `inputs/capture-source-hashes.json` records every file used for capture; the inputs and outputs have separate hashes in `provenance.json`. The raw law blocks, NAP contribution rows, and bill grid are results of the unchanged Python readers. The other files are the context consumed by the components builder. The July component summary's original source is unknown and remains a frozen limitation.

`generate_oracle.py --check` invokes the unchanged Python builders with only this evidence and checks byte-for-byte regeneration, without reading the live data tree. To repeat the initial capture, restore the documented archive in a disposable worktree and run `capture.py` with Python 3.12 and locked dependencies. It verifies all source hashes before reading them. Capture is a manual offline operation, not a CI step.

The scoped tests compare both complete TypeScript outputs with the frozen Python outputs, with exact numeric comparison and no accepted differences. `pnpm components-rates:compare-live` separately compares the candidate against the current release; it is a local diagnostic and is not a frozen CI test. The test-only builder writes only under `tmp/ts-migration/candidates/06`.
