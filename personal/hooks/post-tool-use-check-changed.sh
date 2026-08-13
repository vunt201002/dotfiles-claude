#!/usr/bin/env bash
# PostToolUse (Edit|Write) — check RẺ trên ĐÚNG file vừa sửa (không bao giờ full check ở đây;
# full check là việc của stop-full-check.sh — tách changed-vs-project theo claudekit:
# full tsc mỗi edit đốt ~25 phút wall-clock/feature).
# Exit 2 + stderr = Claude thấy lỗi ngay và sửa trước khi đi tiếp.
# Cần: jq. Tune LINT_CMD theo repo (Wishlist: yarn eslint · Joy: npx eslint).
#
# Lint fail ghi 1 dòng gate log (plan §3.3). Cố ý KHÔNG ghi dòng pass: hook này chạy trên
# MỌI edit, một dòng/edit sẽ ngập sổ và thêm ~100ms vào đường nóng. Đổi lại, lint không có
# mẫu số — cột catch-rate của nó trong `gate-log stats` đọc là vô nghĩa, chỉ đọc cột share.

# Đường nóng (mọi Edit/Write) không được trả giá cho việc chỉ dùng khi lint FAIL.
log_caught() {
  local bin
  bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/bin/gate-log"
  [ -f "$bin" ] || return 0
  command -v bun >/dev/null 2>&1 || return 0
  bun "$bin" append --project "${repo:-unknown}" --gate lint \
    --family deterministic --verdict caught --caught "$1" >/dev/null 2>&1 || true
}

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
  out=$($LINT_CMD "$fp" 2>&1)
  status=$?

  # --no-warn-ignored chỉ tồn tại từ ESLint v9 — bản cũ hơn reject flag này ở
  # bước parse CLI, tức chặn nhầm MỌI edit (không chỉ file bị ignore). Nhận
  # đúng lỗi này thì bỏ flag, chạy lại 1 lần trước khi kết luận fail thật.
  if [ $status -ne 0 ] && printf '%s' "$out" | grep -q "warn-ignored"; then
    fallback_cmd=$(printf '%s' "$LINT_CMD" | sed 's/ --no-warn-ignored//')
    out=$($fallback_cmd "$fp" 2>&1)
    status=$?
  fi

  if [ $status -ne 0 ]; then
    log_caught "file=$(basename "$fp") $(printf '%s' "$out" | tail -5 | tr '\n\r\t' '   ' | cut -c1-260)"
    printf '%s\n' "LINT FAIL trên file vừa sửa ($fp) — sửa trước khi làm tiếp:" >&2
    printf '%s\n' "$out" | tail -30 >&2
    exit 2
  fi
fi
exit 0
