#!/usr/bin/env bash
LINT_CMD="${ORACLE_LINT_CMD:-eslint --no-warn-ignored}"
fp="$1"
out=$($LINT_CMD "$fp" 2>&1)
status=$?
if [ $status -ne 0 ] && printf '%s' "$out" | grep -q "warn-ignored"; then
  fallback_cmd=$(printf '%s' "$LINT_CMD" | sed 's/ --no-warn-ignored//')
  out=$($fallback_cmd "$fp" 2>&1)
  status=$?
fi
if [ $status -ne 0 ]; then
  printf '%s\n' "LINT FAIL on $fp" >&2
  printf '%s\n' "$out" >&2
  exit 2
fi
exit 0
