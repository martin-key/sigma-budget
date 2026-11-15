#!/bin/sh
# Negative controls for semgrep: the scanner must block an introduced issue and accept safe input.
# POSIX sh because the pinned semgrep/semgrep image (Alpine, busybox sh) has no Node.
# The gitleaks controls run on the runner: scripts/security-scanner-check.mjs.
# Usage: sh scripts/security-scanner-check.sh semgrep <semgrep-binary>
set -eu

if [ "$#" -ne 2 ] || [ "$1" != semgrep ]; then
  echo 'usage: security-scanner-check.sh semgrep <semgrep-binary> (gitleaks: security-scanner-check.mjs)' >&2
  exit 2
fi
kind=$1
binary=$2
root=$(cd "$(dirname "$0")/.." && pwd)
target=
log=
trap 'rm -rf "$target" "$log"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
target=$(mktemp -d "${TMPDIR:-/tmp}/security-control-XXXXXX")
log=$(mktemp "${TMPDIR:-/tmp}/security-control-log-XXXXXX")
export SEMGREP_ENABLE_VERSION_CHECK=0

scan() {
  status=0
  "$binary" scan --config "$root/.semgrep/security.yml" --metrics=off --error --strict "$target" >"$log" 2>&1 || status=$?
}

count=0
unsafe() {
  printf '%s' "$2" >"$target/$1"
  scan
  if [ "$status" -ne 1 ]; then
    cat "$log" >&2
    echo "$kind: negative control did not fail with a finding ($1, exit $status)" >&2
    exit 1
  fi
  rm "$target/$1"
  count=$((count + 1))
}

unsafe bad.js 'eval(input);'
unsafe bad.js 'new Function(input);'
unsafe bad.js "import * as cp from 'node:child_process'; cp.exec(input);"
unsafe bad.js 'db.prepare(`SELECT ${input}`);'
unsafe bad.py 'import pickle
pickle.loads(payload)'
unsafe bad.py 'import subprocess
subprocess.run(command, shell=True)'

printf '%s' "const key = '2028.forecast'; const laterKey = '2029.forecast';" >"$target/safe.js"
scan
if [ "$status" -ne 0 ]; then
  cat "$log" >&2
  echo "$kind: safe control failed (exit $status)" >&2
  exit 1
fi
echo "$kind: $count unsafe controls blocked; safe control passed"
