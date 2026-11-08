# Budget and programme fixtures

The frozen inputs consist of the programme extraction and law cache at
`e2954c9`, plus resolved cells, PDF headings and row labels from the independent
Python `program_budget_pdf` reader. `capture_pdf.py` reads all 46 pinned PDFs,
checks each against `data/originals.sha256`, and records their hashes and parsed
evidence. The archive used to restore them is identified by SHA-256 in
`provenance.json`. The PDF reader remains in Python.

`generate_oracle.py` invokes the unchanged Python normalization and budget
builders against these frozen inputs. It never reads live repository datasets or
originals. Verify byte-for-byte regeneration with Python 3.12:

```sh
PYTHONPATH=pipeline tmp/venv-data/bin/python packages/ingest/test/fixtures/programmes/generate_oracle.py --check
```

The generator also records Python expectations for a null source year cell and
Unicode word boundaries in names. The required tests compare all 44 scoped
files, including the null-cell case, with the Python oracle, verify
input and oracle hashes, and exercise damaged inputs. There are no accepted
differences. The current published release can be compared separately:

```sh
pnpm --filter @sigma-budget/etl... build
pnpm exec budget-ts build --inputs packages/ingest/test/fixtures/programmes --out tmp/ts-migration/candidates/05 --scope ministries,ministries-programs,programs --build-date 2026-11-08
pnpm exec budget-ts parity --oracle data/release --candidate tmp/ts-migration/candidates/05/data --scope ministries,ministries-programs,programs --policy packages/ingest/test/fixtures/programmes/policy.json --report tmp/ts-migration/candidates/05/live-diff.json
```
