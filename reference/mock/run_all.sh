#!/usr/bin/env bash
# One command that rebuilds every dataset of the Mock prototype and validates it.
#
#   pipeline/budget_pipeline/build/run_all.sh            fetch (cached) -> extract -> datasets -> editorial + examples (DATA2) -> datasets again -> validate
#   pipeline/budget_pipeline/build/run_all.sh --check    writes nothing: every builder in --check mode, then validate (what CI would run)
#
# Order matters: DATA2's builders read my files (ministries, programs, measures, ...) and my catalog, search index and core read
# DATA2's files (glossary, guide, mock/*.json), so datasets runs twice. data/release/mock/, glossary.json and guide.json are never
# cleaned or deleted by anything here. Needs tmp/venv-data (pipeline/requirements.txt: xlrd, PyMuPDF 1.26.5, python-docx) and the raw files in data/originals (docs/data-sources.md). The fetchers use the network only when their cache
# in data/cache is missing; the build itself is offline. Exit status 0 only when every step and the validator passed.
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2          # repository root
PY="${PY:-tmp/venv-data/bin/python}"             # the data env (pipeline/requirements.txt): PyMuPDF 2.0 of tmp/venv reads 1 of 46 program budgets
T="pipeline/budget_pipeline/build"
MODE="build"
case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac
[ -x "$PY" ] || { echo "run_all: $PY not found (create the venv first)" >&2; exit 2; }

FAILED=()
# must: a step the rest depends on, stop at the first failure.  try: a step whose failure is reported but does not stop the run.
must() { echo; echo "== $*"; "$@" 2>&1 | grep -v -i deprecat | grep -v pymupdf_layout; local rc=${PIPESTATUS[0]}; if [ "$rc" -ne 0 ]; then echo "!! failed (exit $rc): $*"; exit "$rc"; fi; }
try()  { echo; echo "== $*"; "$@" 2>&1 | grep -v -i deprecat | grep -v pymupdf_layout; local rc=${PIPESTATUS[0]}; if [ "$rc" -ne 0 ]; then echo "!! failed (exit $rc): $*"; FAILED+=("$*"); fi; }

if [ "$MODE" = "build" ]; then
  must "$PY" "pipeline/budget_pipeline/sources/boundaries.py"
  must "$PY" "pipeline/budget_pipeline/sources/payments.py"
  must "$PY" "pipeline/budget_pipeline/extract/kfp_full.py"
  must "$PY" "pipeline/budget_pipeline/extract/bill.py"
  must "$PY" "$T/datasets.py"
  try  "$PY" "$T/editorial.py"
  try  "$PY" "$T/examples.py"
  must "$PY" "$T/datasets.py"                # again: catalog, search index and core now see glossary, guide and the mock sets
else
  try  "$PY" "$T/datasets.py" --check
  try  "$PY" "$T/editorial.py" --check
  try  "$PY" "$T/examples.py" --check
fi
try "$PY" "pipeline/budget_pipeline/validate/base.py" --no-rebuild --no-mock    # the REBUILD and MOCK groups are run by the steps above
try "$PY" "reference/mock/validate_mock.py"

echo
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "run_all: OK"
  exit 0
fi
echo "run_all: FAILED (${#FAILED[@]}):"
printf '  %s\n' "${FAILED[@]}"
exit 1
