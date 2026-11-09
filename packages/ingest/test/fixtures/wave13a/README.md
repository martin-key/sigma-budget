# Current-publication law evidence

`law-donor.py` is the unchanged `pipeline/budget_pipeline/build/law.py` at
`9d7e91001d25c815f1dc93163ef5809c00e060c8`. Its SHA-256 is checked by the
generator. The generator compiles only the unchanged `next_budget` function,
without importing the pipeline or consulting release data, and captures both
fallback and current-publication cases. The date is an explicit input.

Verify with Python 3.12:

```sh
PYTHONDONTWRITEBYTECODE=1 python3.12 packages/ingest/test/fixtures/wave13a/generate_law_next.py --check
```

This fixture covers only the law pointer, not the other Wave13a owners or the
complete DAG.
