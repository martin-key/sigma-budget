#!/usr/bin/env bash
set -euo pipefail

# Retry dependency/network setup only. Each attempt is bounded; the final
# non-zero status remains fatal. Playwright/apt keep their signature checks.
for attempt in 1 2 3; do
  if timeout --kill-after=10s 300s python -m playwright install --with-deps chromium; then
    exit 0
  else
    status=$?
  fi
  if (( attempt == 3 )); then
    exit "$status"
  fi
  delay=$((15 * attempt))
  printf 'Browser dependency install failed (attempt %s/3, exit %s); retrying in %ss\n' "$attempt" "$status" "$delay" >&2
  sleep "$delay"
done
