# Wave 14 validation evidence

The baseline is `05d6f6eeca9991468f3c94c3c9c26e87d5b0fae0`. `corpus/` freezes the release files (including release manifests), input files, registries, original pins and route catalogue as bytes. Their hashes, the unchanged Python donor files and the scenario definitions are recorded in `groups-provenance.json`. `execution.json`, its unchanged donor and its independent projection oracle are separately pinned in `provenance.json`. The original production Python files are not used by regeneration.

`tracked-paths.json` captures the baseline tracked path list. The test harness materializes empty files for source and documentation paths to reproduce existence checks; these placeholders are not source bytes. `code-path-capture.json` records hashes and the result of the donor's baseline tracked-code absolute-path scan. The real scanner and input hashing are additionally tested on a small independent filesystem tree, including injected unsafe paths. The privacy scan of non-data web assets is likewise a captured clean baseline; a synthetic leaking web asset exercises the warning path. The two described editorial inputs are included as bytes so their hashes are recomputed.

Historical originals are not restored in this fixture. Consequently INPUTS reports the absent raw originals as a warning and verifies every included input from bytes. This does not claim to reconstruct data_europa, GISCO, debt originals or other historical source files. None of the fixture's placeholders is used as evidence for original file content.

Regenerate and check with Python 3.12 and the locked pipeline requirements:

```sh
python packages/ingest/test/fixtures/validate14/generate_oracle.py --check
python packages/ingest/test/fixtures/validate14/generate_groups_oracle.py --check
pnpm --filter @sigma-budget/dataset-schema build
WAVE14_PARITY_REPORT=tmp/ts-migration/candidates/14/report.json pnpm --filter @sigma-budget/ingest exec vitest run src/validate
```

For an explicit local diagnostic on a checkout, run `pnpm validate:wave14-live`. It validates that checkout and writes a report under `tmp/ts-migration/`; it does not compare live data with frozen expectations. For another local tree use `pnpm validate:wave14 --root <directory> --only INPUTS,ENVELOPE` (omit `--only` for the scoped wave14 groups). `--no-accepted` retains the donor's underlying findings. The report lists unsupported groups; an unsupported selection is an error. This is not the production validation command.
