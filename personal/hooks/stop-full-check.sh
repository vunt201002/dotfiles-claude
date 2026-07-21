#!/usr/bin/env bash
# Stop hook — cổng ĐẮT, chạy đúng 1 lần khi turn sắp kết thúc.
# Exit 2 + stderr = turn KHÔNG được kết thúc; Claude đọc output lỗi và tự sửa rồi thử lại.
# (Claude Code tự override sau 8 lần block liên tiếp — chống loop kẹt vĩnh viễn.)
# Tune CHECK_CMD theo repo, ví dụ:
#   Wishlist:  CLAUDE_STOP_CHECK="npx tsc --noEmit && yarn jest --onlyChanged --silent"
#   Joy:       CLAUDE_STOP_CHECK="npx tsc --noEmit"   (chưa có backend test harness)
# Đặt biến trong settings.json của repo ("env") hoặc sửa default dưới đây.

# --- Repo dispatch (cho global-hook mode) — repo lạ / không config → exit 0 im lặng,
# nên đăng ký global an toàn: chỉ repo có tên trong danh sách mới bị gate.
# CLAUDE_STOP_CHECK (env, per-repo settings) vẫn override được.
repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null | tr '[:upper:]' '[:lower:]')
if [ -z "$CLAUDE_STOP_CHECK" ]; then
  case "$repo" in
    *wishlist*) CLAUDE_STOP_CHECK="npx tsc --noEmit && yarn jest --onlyChanged --silent" ;;
    *joy*)      CLAUDE_STOP_CHECK="npx tsc --noEmit" ;;
    *)          exit 0 ;;
  esac
fi

CHECK_CMD="$CLAUDE_STOP_CHECK"

out=$(eval "$CHECK_CMD" 2>&1) || {
  printf '%s\n' "STOP-GATE FAIL — turn chưa được kết thúc. Lệnh: $CHECK_CMD" >&2
  printf '%s\n' "$out" | tail -40 >&2
  exit 2
}
exit 0
