#!/usr/bin/env bash
# PreToolUse guard — hai bậc.
#
#   Bậc 1 (DENY_HARD)  → exit 2 + stderr. Chặn cứng, không có đường vòng.
#   Bậc 2 (ASK_CMD)    → permissionDecision "ask". Hỏi user, user quyết.
#
# Chạy TRƯỚC cả permission check, kể cả bypassPermissions mode. Cần: jq.
#
# Vì sao hai bậc, đo được chứ không cảm tính (12/08): cổng một-bậc sai CẢ HAI
# chiều — 28,6% số lần chặn trên việc thật là oan, và nó bắt 0/2 fixture thật sự
# phá hoại. Thêm pattern vào một cổng đang ồn thì cổng bị bỏ qua, và bảo vệ mới
# chết theo. Nên: giảm ồn trước (bóc chuỗi trích dẫn), rồi mới thêm bảo vệ (bậc 2).
#
# Mỗi lần chặn/hỏi ghi 1 dòng gate log (plan §3.3) để precision đo được. Ghi log là
# best-effort: thiếu bun/jq thì bỏ qua, không đổi exit code, không in thêm gì.

SECRET_HINT='sk-|ghp_|gho_|ghu_|ghs_|github_pat_|xox[abprs]-|AIza|ya29\.|-----BEGIN|api[_-]?key|token|secret|passw|credential|authorization|bearer '

# Bậc 1 — không bao giờ chính đáng. Đích phải KẾT THÚC ở đó: `rm -rf /tmp/x` và
# `rm -rf ./dist` là việc bình thường và từng bị regex cũ bắt oan vì khớp cả tiền tố.
# Ký tự kết thúc không chỉ là khoảng trắng — trong `bash -c "rm -rf /"` nó là dấu nháy.
DENY_HARD='rm -(rf|fr) /([^A-Za-z0-9_.-]|$)|rm -(rf|fr) ~([^A-Za-z0-9_/.-]|$)|rm -(rf|fr) \.([^A-Za-z0-9_/.-]|$)|mkfs\.|dd if=.* of=/dev/'

# SQL không bóc nháy được — nó LUÔN là tham số trong nháy. Nên phân biệt bằng thứ
# khác: có client DB thật chạy nó hay không. `grep "DROP TABLE" migrations/` là văn
# bản; `psql -c "DROP TABLE x"` là lệnh. Cả hai chứa cùng một chuỗi.
DB_CLIENT='(^|[[:space:];&|(])(psql|mysql|mysqldump|sqlite3|mongo|mongosh|clickhouse-client|cockroach|redis-cli)([[:space:]]|$)'
SQL_HARD='DROP[[:space:]]+TABLE|DROP[[:space:]]+DATABASE|DROP[[:space:]]+SCHEMA|TRUNCATE[[:space:]]+TABLE|FLUSHALL'
SQL_ASK='DELETE[[:space:]]+FROM|UPDATE[[:space:]]+.*[[:space:]]SET[[:space:]]|ALTER[[:space:]]+TABLE'

# Bậc 2 — tuỳ ngữ cảnh. Có lúc đúng, có lúc là tai nạn; chỉ user phân biệt được.
ASK_CMD='git push --force|git push -f( |$)|git reset --hard|git clean -[a-zA-Z]*f|git add -A( |$)|git add \.( |$)|--no-verify|--force-with-lease|firebase deploy|npm publish'

# Lệnh tự nó là một lớp vỏ shell: thứ nằm TRONG dấu nháy mới là lệnh thật, nên
# không được bóc. `bash -c "rm -rf /"` phải bị bắt.
SHELL_WRAPPER='(^|[[:space:];&|(])(bash|sh|zsh|dash)[[:space:]]+-[a-zA-Z]*c([[:space:]]|$)|(^|[[:space:];&|(])eval([[:space:]]|$)|\|[[:space:]]*(bash|sh|zsh)([[:space:]]|$)'

# Bóc chuỗi trích dẫn và thân heredoc. Đây là chỗ giảm ồn: cả 5 lần bắt oan quan
# sát được trong ngày đều là chuỗi nguy hiểm nằm trong nháy hoặc trong fixture —
# lệnh đang NHẮC TỚI thứ nguy hiểm chứ không LÀM nó. \047 là dấu nháy đơn, viết
# vậy để chương trình awk không cần chứa nháy đơn nào.
STRIP_QUOTED_AWK='BEGIN{hd=""} { line=$0; if(hd!=""){ if(line ~ ("^[ \t]*" hd "[ \t]*$")) hd=""; next } if(match(line,/<<-?[ \t]*\047?[A-Za-z_][A-Za-z0-9_]*\047?/)){ tag=substr(line,RSTART,RLENGTH); sub(/^<<-?[ \t]*\047?/,"",tag); sub(/\047?$/,"",tag); hd=tag } gsub(/\047[^\047]*\047/," ",line); gsub(/"[^"]*"/," ",line); print line }'

# Đường nóng (mọi Bash/Edit/Write) không được trả giá cho việc chỉ dùng khi CHẶN —
# nên mọi thứ liên quan tới sổ nằm trong hàm này.
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

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r\t' '   '
}

ask_user() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$(json_escape "$1")"
  exit 0
}

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

# Ranh giới ghi của tầng manager. Agent do manager spawn mang GSTACK_MANAGER_SCOPE;
# ghi ra ngoài đường đó là chạm repo của task khác. Chỉ chặn theo file_path
# (Edit/Write): đường đi qua Bash không phân tích được đáng tin, nên KHÔNG giả bộ
# chặn ở đó — khe hở thành thật tốt hơn một hàng rào giả.
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

if [ -n "$cmd" ]; then
  if printf '%s' "$cmd" | grep -Eq "$SHELL_WRAPPER"; then
    scan="$cmd"
  else
    scan=$(printf '%s' "$cmd" | awk "$STRIP_QUOTED_AWK")
  fi

  runs_sql=""
  printf '%s' "$cmd" | grep -Eqi "$DB_CLIENT" && runs_sql=1

  deny_hit=$(printf '%s' "$scan" | grep -Eo "$DENY_HARD" | head -1)
  if [ -z "$deny_hit" ] && [ -n "$runs_sql" ]; then
    deny_hit=$(printf '%s' "$cmd" | grep -Eoi "$SQL_HARD" | head -1)
  fi
  if [ -n "$deny_hit" ]; then
    echo "BLOCKED (pre-tool-use-guard): lệnh khớp danh sách chặn cứng: $cmd" >&2
    echo "Nếu thật sự cần, giải thích cho user và để USER tự chạy — không tự chạy lại biến thể khác." >&2
    log_caught "$(redacted_detail "$deny_hit" "tier=deny cmd=$cmd")"
    exit 2
  fi

  ask_hit=$(printf '%s' "$scan" | grep -Eo "$ASK_CMD" | head -1)
  if [ -z "$ask_hit" ] && [ -n "$runs_sql" ]; then
    ask_hit=$(printf '%s' "$cmd" | grep -Eoi "$SQL_ASK" | head -1)
  fi
  if [ -n "$ask_hit" ]; then
    log_caught "$(redacted_detail "$ask_hit" "tier=ask cmd=$cmd")"
    ask_user "[guard] Lệnh này tuỳ ngữ cảnh mới đúng — khớp \"$ask_hit\". Xem kỹ rồi quyết: $cmd"
  fi
fi

exit 0
