#!/usr/bin/env bash
# PostToolUse (Edit|Write) — check RẺ trên ĐÚNG file vừa sửa (không bao giờ full check ở đây;
# full check là việc của stop-full-check.sh — tách changed-vs-project theo claudekit:
# full tsc mỗi edit đốt ~25 phút wall-clock/feature).
# Exit 2 + stderr = Claude thấy lỗi ngay và sửa trước khi đi tiếp.
# Cần: jq. Tune LINT_CMD theo repo (Wishlist: yarn eslint · Joy: npx eslint).

LINT_CMD="${CLAUDE_LINT_CMD:-npx eslint --no-warn-ignored}"
EXT='ts|tsx|js|jsx'

fp=$(cat | jq -r '.tool_input.file_path // empty')
[ -z "$fp" ] && exit 0

if printf '%s' "$fp" | grep -Eq "\.($EXT)$"; then
  out=$($LINT_CMD "$fp" 2>&1) || {
    printf '%s\n' "LINT FAIL trên file vừa sửa ($fp) — sửa trước khi làm tiếp:" >&2
    printf '%s\n' "$out" | tail -30 >&2
    exit 2
  }
fi
exit 0
