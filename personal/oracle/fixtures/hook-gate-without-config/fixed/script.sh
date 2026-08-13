#!/usr/bin/env bash
root="$1"
repo=$(basename "$root" | tr '[:upper:]' '[:lower:]')
case "$repo" in
  *wishlist*)
    [ -f "$root/tsconfig.json" ] || exit 0
    CHECK="npx tsc --noEmit"
    ;;
  *joy*)
    [ -f "$root/tsconfig.json" ] || exit 0
    CHECK="npx tsc --noEmit"
    ;;
  *) exit 0 ;;
esac
out=$(cd "$root" && eval "$CHECK" 2>&1) || {
  printf '%s\n' "STOP-GATE FAIL: $CHECK" >&2
  printf '%s\n' "$out" >&2
  exit 2
}
exit 0
