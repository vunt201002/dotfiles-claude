#!/usr/bin/env bash
# Stop hook — cổng ĐẮT, chạy đúng 1 lần khi turn sắp kết thúc.
# Exit 2 + stderr = turn KHÔNG được kết thúc; Claude đọc output lỗi và tự sửa rồi thử lại.
# (Claude Code tự override sau 8 lần block liên tiếp — chống loop kẹt vĩnh viễn.)
# Tune CHECK_CMD theo repo, ví dụ:
#   Wishlist:  CLAUDE_STOP_CHECK="npx tsc --noEmit && yarn jest --onlyChanged --silent"
#   Joy:       CLAUDE_STOP_CHECK="npx tsc --noEmit"   (chưa có backend test harness)
# Đặt biến trong settings.json của repo ("env") hoặc sửa default dưới đây.

CHECK_CMD="${CLAUDE_STOP_CHECK:-npx tsc --noEmit}"

out=$(eval "$CHECK_CMD" 2>&1) || {
  printf '%s\n' "STOP-GATE FAIL — turn chưa được kết thúc. Lệnh: $CHECK_CMD" >&2
  printf '%s\n' "$out" | tail -40 >&2
  exit 2
}
exit 0
