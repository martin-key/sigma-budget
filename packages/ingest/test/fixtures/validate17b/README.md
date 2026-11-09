# FEED donor capture (work in progress)

This is an incomplete Wave 17b implementation. The corpus and unchanged Python package come from Git revision `8b68ae1bd5617152dc45c6ed168f788345a27ec5`, with build date 2026-11-08. `provenance.json` pins every included donor and corpus file, both scenario files, the generator and the oracle bytes. Inputs include the ten owning release files, RSS, the route catalogue and registries. The unchanged donor and its registration import closure preserve the real registration and wrapper imports. Regeneration uses a temporary copy of the corpus and does not read the working release or contact a source.

The baseline reports 1,291 FEED checks, no problems or warnings, and no accepted exceptions. The `event_kind` mutation demonstrates that the donor's broad historical kinds exception accepts a new finding; an implementation must not treat that wildcard as permission to hide new drift. The results record raw, default wrapper and `--no-accepted` equivalent findings, including exceptions and crashes. The raw source files are an exact frozen capture, not evidence that every historical primary source can be reacquired.

```sh
PYTHONDONTWRITEBYTECODE=1 /path/to/python3.12 packages/ingest/test/fixtures/validate17b/generate.py --check
pnpm --filter @sigma-budget/ingest exec vitest run src/validate/feed-text.test.ts
```

Only text helpers have been translated and tested so far. Event reconciliation, RSS validation, scoped reporting, safe report paths, full differential cases, CI and a full validation run remain outstanding. These fixtures and helper tests do not establish group parity or authorize a production switch.
