#!/usr/bin/env bash
LINT_CMD="${ORACLE_LINT_CMD:-eslint --no-warn-ignored}"
fp="$1"
out=$($LINT_CMD "$fp" 2>&1) || {
  printf '%s\n' "LINT FAIL on $fp" >&2
  printf '%s\n' "$out" >&2
  exit 2
}
exit 0
