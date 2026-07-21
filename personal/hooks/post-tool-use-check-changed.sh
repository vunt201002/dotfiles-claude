#!/usr/bin/env bash
# PostToolUse (Edit|Write) — check RẺ trên ĐÚNG file vừa sửa (không bao giờ full check ở đây;
# full check là việc của stop-full-check.sh — tách changed-vs-project theo claudekit:
# full tsc mỗi edit đốt ~25 phút wall-clock/feature).
# Exit 2 + stderr = Claude thấy lỗi ngay và sửa trước khi đi tiếp.
# Cần: jq. Tune LINT_CMD theo repo (Wishlist: yarn eslint · Joy: npx eslint).

# --- Repo dispatch (cho global-hook mode: đăng ký 1 lần ở ~/.claude/settings.json,
# không cần file nào trong repo app). Repo lạ / không config → exit 0 im lặng.
# CLAUDE_LINT_CMD (env, per-repo settings) vẫn override được mọi thứ dưới đây.
repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null | tr '[:upper:]' '[:lower:]')
if [ -z "$CLAUDE_LINT_CMD" ]; then
  case "$repo" in
    *wishlist*) CLAUDE_LINT_CMD="yarn eslint --no-warn-ignored" ;;
    *joy*)      CLAUDE_LINT_CMD="npx eslint --no-warn-ignored" ;;
    *)          exit 0 ;;
  esac
fi

LINT_CMD="$CLAUDE_LINT_CMD"
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
