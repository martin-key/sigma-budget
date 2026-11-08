# Law builder fixtures

`inputs/` freezes the law cache, Parliament fields, parsed DV blocks, ministry
input and source definitions used by the Python builder at revision `1843be0`.
`original-hashes.json` records the hashes of the original archive members from
which the parser evidence was captured. `provenance.json` pins both the frozen
inputs and generated outputs. No live repository data is read by the generator.

Verify that Python 3.12 regenerates every output byte for byte:

```sh
PYTHONPATH=pipeline tmp/venv-data/bin/python packages/ingest/test/fixtures/law/generate_oracle.py --check
```

Remove `--check` to regenerate. The cached Parliament proposals in this release
already contain decoded arrays. `literal-data.json` additionally records
representative Python `ast.literal_eval` results; TypeScript accepts decoded
data and does not evaluate Python literals. The optional Parliament ZIP was
absent from the input archive, so its real size is not verified. The 2027
wording has its own fixture. The raw legal parsers remain in Python.

The mandatory CI check compares against the frozen Python oracle and writes a
`law-parity` report. To compare the TypeScript candidate with the current
release manually, run:

```sh
pnpm --filter @sigma-budget/etl... build
pnpm exec budget-ts build --inputs packages/ingest/test/fixtures/law --out tmp/ts-migration/candidates/04 --scope law --build-date 2026-11-08
pnpm exec budget-ts parity --oracle data/release --candidate tmp/ts-migration/candidates/04/data --scope law --policy packages/ingest/test/fixtures/law/policy.json --report tmp/ts-migration/candidates/04/diff.json
```
