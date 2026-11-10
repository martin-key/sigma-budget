# FEED validation evidence

The donor and corpus are pinned to Git revision `8b68ae1bd5617152dc45c6ed168f788345a27ec5` and build date 2026-11-08. `provenance.json` hashes the unchanged Python registration and import closure, FEED source, inputs, route catalogue, registries, original scenarios, generator and outputs. `extra-provenance.json` separately pins additional mutations and text boundaries. The generators run the frozen Python 3.12 donor on temporary corpus copies, without reading a live release, registry or source. The captured release bytes do not establish the historical acquisition of missing primary originals.

The donor baseline has 1,291 checks, no problems or warnings and no accepted exceptions. Raw, default and `--no-accepted` results are retained, including crashes. The donor's historical kinds wildcard accepts a newly introduced kinds finding in `event_kind`; the TypeScript runner applies no wildcard and accepts no findings on this baseline. Both its raw and selected results remain visible in the incomplete scoped report. A separate month-end check detects a coherent change to both the monthly source and event that the donor alone accepts; the donor's 1,291-check result remains unchanged.

The independent RSS reader uses the pinned [saxes parser](https://github.com/lddubeau/saxes), with namespace handling and no external resolution. It rejects all DTDs and external entities, a deliberate stricter rule than ElementTree. The frozen cases exercise XML fields, namespaces, CDATA, escaping, malformed markup, UTF-8 errors and selected encoding declarations. Saxes and ElementTree can produce different error wording or positions for malformed XML constructs outside the frozen cases; the report does not claim general parser equivalence.

```sh
PYTHONDONTWRITEBYTECODE=1 /path/to/python3.12 packages/ingest/test/fixtures/validate17b/generate.py --check
PYTHONDONTWRITEBYTECODE=1 /path/to/python3.12 packages/ingest/test/fixtures/validate17b/generate-extra.py --verify-extra
pnpm --filter @sigma-budget/ingest... build
pnpm --filter @sigma-budget/ingest exec vitest run src/validate/feed-text.test.ts src/validate/feed.test.ts src/validate/feed-cli.test.ts
pnpm validate:wave17b
```

The runner is FEED-only, reports `completeValidation: false`, and lists SEARCH and other groups outside its scope. It is not the production validator. The compiled CLI confines reports to candidate17b and preflights declared inputs before writing, including after a logical validation failure.

`population/generate.py --check` adds 16 separate full donor outcomes and exact
source preimages for population formatting. Invalid strings and containers retain
Python format errors; integer, boolean, float, exponent and large-integer controls
retain their printed form. Direct and compiled tests cover accepted and raw
modes. The original donor, scenarios and supplemental observations are unchanged.

The separate `years/generate.py` proof adds 36 complete donor outcomes for the
population, Maastricht and COFOG owner years. Numeric strings and containers
retain Python's `%d` errors; booleans, integer and float tokens, fractional
values and large integers retain its printed form. Exact source preimages are
tested directly and through the compiled CLI in both acceptance modes.
