# Wave13a evidence

The unchanged `annual_periods.py`, `budget_2027.py`, `data_io.py` and `law.py`
are frozen from `9d7e91001d25c815f1dc93163ef5809c00e060c8`; the generators
check their SHA-256 values. `generate_budget.py` loads the annual and budget
donors in a temporary Python package with injected paths into the existing
fiscal fixture. It denies network access and does not read the live release,
cache or registry. Its inputs include the tracked ZIP and both extracted JSON
files; the donor verifies the archive and each PDF member. The cleaned extraction
is a retained intermediate, not a claim of a new PDF extraction.

The independent fiscal donor-stage captures and accepted raw law fixture are
upstream inputs. Python adds the annual records, then builds the bill and the
complete provenance; the frozen `next_budget` donor changes the law pointer.
`oracle/` holds annual records, annual entries, bill, final entries and
changed-input cases. `final/` holds the six resulting owner projections.
`published/` is a separate snapshot, used only as an additional expectation and
never as builder input. Exact equality is required at each stage. The frozen
registry and source records describe this scope; they do not refresh sources.
The separate `generate_law_next.py` captures missing, empty and changed-date
law cases. All generators require Python 3.12:

The donor's explicitly identified bill tables fall back to formatting the
number when no printed text matches. The TypeScript builder instead rejects
that missing physical evidence and a mismatched table page. The frozen corpus
has matching printed cells for every such value; the additional rejection does
not alter its oracle output.

```sh
PYTHONDONTWRITEBYTECODE=1 python3.12 packages/ingest/test/fixtures/wave13a/generate_budget.py --check
PYTHONDONTWRITEBYTECODE=1 python3.12 packages/ingest/test/fixtures/wave13a/generate_law_next.py --check
```

This is the current-publication function family, not the complete Wave13 DAG.
The forecast and bill publication of 6 November remains distinct from the
October draft budgetary plan. Historical missing originals described in the
fiscal fixture remain limitations; these fixtures do not assert their recovery.

The label oracle exercises the unchanged donor's required `row["text"]`
subscription in both bill variants and all three budget row sections. It
distinguishes an absent field from explicit null/empty text and retains the
donor's skip before that subscription for rows without a numeric value. The 24
cases use fresh verified inputs and the real `add_budgets` function.

The 20 metadata cases cover required budget names, municipal regions, project
identities, debt pages, forecast labels and source archive paths. Explicit
null/empty budget names remain copied values. Missing forecast labels are
rejected even when every observation is blank. These expectations come from
the unchanged donor functions and constructor, including their actual order
of field access.

The TypeScript budget components follow the donor's `add_budgets`,
`add_municipalities`, `add_projects`, `add_debt_limits` and `add_forecast`
boundaries. Focused changed-input tests call those components, while the full
builder still composes all of them in order and retains the complete budget,
provenance and six-owner integration comparisons. This avoids rebuilding the
entire publication for each label case without changing test timeouts.

The reader oracle adds seven row-number cases and nine physical-cell cases.
Serialized Python row preimages retain integer/float distinctions for the
provenance display. The small synthetic physical-cell inputs exercise required
table/page fields and the donor's defaults for absent, null and empty values;
they are algorithm evidence, not additional original PDF evidence. The full
pinned publication still verifies its real archive, member and physical cells.
All preceding oracle bytes, input hashes and six final/published outputs remain
unchanged.
