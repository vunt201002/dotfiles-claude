#!/usr/bin/env bash
# PreToolUse guard — chặn lệnh nguy hiểm + file nhạy cảm.
# Exit 2 + stderr = BLOCK, Claude đọc được lý do và đổi hướng.
# Chạy TRƯỚC cả permission check, kể cả bypassPermissions mode.
# Cần: jq. Tune danh sách theo failure THẬT đã gặp — đừng thêm cho tình huống giả định.

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

DENY_CMD='rm -rf /|rm -rf ~|rm -rf \.|git push --force|git push -f( |$)|git reset --hard|--no-verify|DROP TABLE|firebase deploy'

if [ -n "$cmd" ] && printf '%s' "$cmd" | grep -Eq "$DENY_CMD"; then
  echo "BLOCKED (pre-tool-use-guard): lệnh khớp danh sách nguy hiểm: $cmd" >&2
  echo "Nếu thật sự cần, giải thích cho user và để USER tự chạy — không tự chạy lại biến thể khác." >&2
  exit 2
fi

case "$fp" in
  *.env|*.env.*|*id_rsa*|*credentials*|*serviceAccount*.json)
    echo "BLOCKED (pre-tool-use-guard): không đọc/sửa file nhạy cảm: $fp" >&2
    exit 2;;
esac

exit 0
