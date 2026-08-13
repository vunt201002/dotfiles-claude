#!/usr/bin/env bash
# PreToolUse guard — chặn lệnh nguy hiểm + file nhạy cảm.
# Exit 2 + stderr = BLOCK, Claude đọc được lý do và đổi hướng.
# Chạy TRƯỚC cả permission check, kể cả bypassPermissions mode.
# Cần: jq. Tune danh sách theo failure THẬT đã gặp — đừng thêm cho tình huống giả định.
#
# Mỗi lần chặn ghi 1 dòng vào gate log (plan §3.3) để về sau đếm được cổng này bắt đúng
# bao nhiêu / kêu oan bao nhiêu. Ghi log là best-effort: thiếu bun/jq thì bỏ qua, không
# bao giờ đổi exit code, không bao giờ in thêm gì.

SECRET_HINT='sk-|ghp_|gho_|ghu_|ghs_|github_pat_|xox[abprs]-|AIza|ya29\.|-----BEGIN|api[_-]?key|token|secret|passw|credential|authorization|bearer '

# Đường nóng (mọi Bash/Edit/Write) không được trả giá cho việc chỉ dùng khi CHẶN —
# nên mọi thứ liên quan tới sổ nằm trong hàm này, chỉ chạy lúc đã quyết định chặn.
log_caught() {
  local bin root project
  bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/bin/gate-log"
  [ -f "$bin" ] || return 0
  command -v bun >/dev/null 2>&1 || return 0
  root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$root" ]; then
    project=$(basename "$root" | tr '[:upper:]' '[:lower:]')
  else
    project="unknown"
  fi
  bun "$bin" append --project "$project" --gate guard \
    --family deterministic --verdict caught --caught "$1" >/dev/null 2>&1 || true
}

# Giá trị nhạy cảm không bao giờ vào sổ: khớp SECRET_HINT thì chỉ ghi tên rule.
redacted_detail() {
  local rule="$1" content="$2"
  if printf '%s' "$content" | grep -Eqi "$SECRET_HINT"; then
    printf 'rule=%s [redacted]' "$rule"
  else
    printf 'rule=%s %s' "$rule" "$(printf '%s' "$content" | tr '\n\r\t' '   ' | cut -c1-160)"
  fi
}

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

DENY_CMD='rm -rf /|rm -rf ~|rm -rf \.|git push --force|git push -f( |$)|git reset --hard|--no-verify|DROP TABLE|firebase deploy'

if [ -n "$cmd" ] && printf '%s' "$cmd" | grep -Eq "$DENY_CMD"; then
  echo "BLOCKED (pre-tool-use-guard): lệnh khớp danh sách nguy hiểm: $cmd" >&2
  echo "Nếu thật sự cần, giải thích cho user và để USER tự chạy — không tự chạy lại biến thể khác." >&2
  matched=$(printf '%s' "$cmd" | grep -Eo "$DENY_CMD" | head -1)
  log_caught "$(redacted_detail "${matched:-unknown}" "cmd=$cmd")"
  exit 2
fi

# Ranh giới ghi của tầng manager. Agent do manager spawn mang GSTACK_MANAGER_SCOPE;
# ghi ra ngoài đường đó là chạm repo của task khác. Trước bản này scope chỉ là một câu
# trong system prompt — tức không có gì thực thi. Chỉ chặn theo file_path (Edit/Write):
# đường đi qua Bash không phân tích được đáng tin, nên KHÔNG giả bộ chặn ở đó.
norm_path() {
  printf '%s' "$1" | tr 'A-Z\\' 'a-z/' | sed -E 's|^([a-z]):/|/\1/|'
}

if [ -n "$GSTACK_MANAGER_SCOPE" ] && [ -n "$fp" ]; then
  scope_n=$(norm_path "$GSTACK_MANAGER_SCOPE")
  fp_n=$(norm_path "$fp")
  case "$fp_n" in
    "$scope_n"|"$scope_n"/*) ;;
    *)
      echo "BLOCKED (pre-tool-use-guard): ghi ngoài scope của task này." >&2
      echo "scope=$GSTACK_MANAGER_SCOPE  file=$fp" >&2
      echo "Repo khác thuộc về task khác. Báo lại cho manager thay vì tìm đường vòng." >&2
      log_caught "$(redacted_detail manager-scope "file=$fp")"
      exit 2;;
  esac
fi

case "$fp" in
  *.env.example|*.env.sample|*.env.template)
    ;;
  *.env|*.env.*|*id_rsa*|*credentials*|*serviceAccount*.json)
    echo "BLOCKED (pre-tool-use-guard): không đọc/sửa file nhạy cảm: $fp" >&2
    log_caught "$(redacted_detail sensitive-file "file=$(basename "$fp")")"
    exit 2;;
esac

exit 0
