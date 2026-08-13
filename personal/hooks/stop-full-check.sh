#!/usr/bin/env bash
# Stop hook — cổng ĐẮT, chạy đúng 1 lần khi turn sắp kết thúc.
# Exit 2 + stderr = turn KHÔNG được kết thúc; Claude đọc output lỗi và tự sửa rồi thử lại.
# (Claude Code tự override sau 8 lần block liên tiếp — chống loop kẹt vĩnh viễn.)
# CLAUDE_STOP_CHECK (env, per-repo settings.json "env") override toàn bộ logic dưới —
# đặt biến đó nếu muốn ép 1 lệnh cụ thể bất kể auto-detect nói gì.
#
# Mỗi lần chạy ghi gate log (plan §3.3): FAIL = caught, PASS cũng ghi vì không có mẫu số
# thì detection rate vô nghĩa. Ghi log là best-effort, không đổi exit code.

log_gate() {
  local gate="$1" verdict="$2" detail="$3" bin project
  bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/bin/gate-log"
  [ -f "$bin" ] || return 0
  command -v bun >/dev/null 2>&1 || return 0
  if [ -n "$root" ]; then
    project=$(basename "$root" | tr '[:upper:]' '[:lower:]')
  else
    project="unknown"
  fi
  if [ -n "$detail" ]; then
    bun "$bin" append --project "$project" --gate "$gate" \
      --family deterministic --verdict "$verdict" --caught "$detail" >/dev/null 2>&1 || true
  else
    bun "$bin" append --project "$project" --gate "$gate" \
      --family deterministic --verdict "$verdict" >/dev/null 2>&1 || true
  fi
}

# Cổng nào thực sự nằm trong lệnh, theo thứ tự chạy của chuỗi `&&`.
gates_in() {
  local cmd="$1" gates=""
  printf '%s' "$cmd" | grep -Eq '(^| )(npx |yarn |pnpm |bunx )?tsc( |$)' && gates="tsc"
  printf '%s' "$cmd" | grep -Eq 'jest|vitest|mocha|bun test|npm test|yarn test|pnpm test|test\.(c?m?js|ts)' \
    && gates="${gates:+$gates }test"
  printf '%s' "${gates:-test}"
}

# tsc là cổng duy nhất phát mã lỗi `error TS####`; không thấy mã đó thì cổng gãy là cổng
# cuối trong chuỗi, vì `&&` nghĩa là mọi cổng trước nó đã xanh.
failing_gate() {
  local out="$1" gates="$2"
  if printf '%s' "$gates" | grep -qw tsc && printf '%s' "$out" | grep -Eq 'error TS[0-9]+'; then
    printf 'tsc'
  else
    printf '%s' "${gates##* }"
  fi
}

# --- Repo dispatch (cho global-hook mode) — repo lạ / không config → exit 0 im lặng,
# nên đăng ký global an toàn: chỉ repo có tên trong danh sách mới bị gate.
repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null | tr '[:upper:]' '[:lower:]')
root=$(git rev-parse --show-toplevel 2>/dev/null)

if [ -z "$CLAUDE_STOP_CHECK" ]; then
  case "$repo" in
    *wishlist*)
      # Monorepo đa package (vd packages/web-components là Lit/JS thuần,
      # không TS) — tsc chỉ chạy khi ROOT có tsconfig.json thật, jest chỉ
      # chạy khi package.json ROOT có script "test"/"jest" thật. Trước đây
      # hardcode "npx tsc && yarn jest" bất kể có tồn tại hay không, nên vỡ
      # trên repo này (không tsconfig.json, không script test ở root — npx
      # tsc rơi vào package "tsc" mồi trên npm, yarn jest báo no such script).
      ts_cmd=""
      [ -f "$root/tsconfig.json" ] && ts_cmd="npx tsc --noEmit"

      jest_cmd=""
      if [ -f "$root/package.json" ] && command -v jq >/dev/null 2>&1; then
        has_test=$(jq -r '.scripts.test // .scripts.jest // empty' "$root/package.json" 2>/dev/null)
        [ -n "$has_test" ] && jest_cmd="yarn jest --onlyChanged --silent"
      fi

      if [ -n "$ts_cmd" ] && [ -n "$jest_cmd" ]; then
        CLAUDE_STOP_CHECK="$ts_cmd && $jest_cmd"
      elif [ -n "$ts_cmd" ]; then
        CLAUDE_STOP_CHECK="$ts_cmd"
      elif [ -n "$jest_cmd" ]; then
        CLAUDE_STOP_CHECK="$jest_cmd"
      else
        exit 0  # gated nhưng không có tsc/jest thật để chạy — không giả bộ check
      fi
      ;;
    *joy*)
      # Joy: không có tsconfig.json ở root — 20+ tsconfig rải rác trong
      # extensions/*/packages/*, nên "npx tsc --noEmit" ở root không tìm
      # thấy config, chỉ in help text, và hook coi nhầm đó là FAIL trên
      # MỌI turn kể cả turn không đụng code. Áp dụng cùng pattern với nhánh
      # *wishlist*) ở trên: chỉ chạy khi root có tsconfig.json thật.
      if [ -f "$root/tsconfig.json" ]; then
        CLAUDE_STOP_CHECK="npx tsc --noEmit"
      else
        exit 0  # không có root tsconfig thật để check — không giả bộ check
      fi
      ;;
    *dotfiles-claude*)
      # Repo harness không có build/tsc, nhưng monthly-point-sync CÓ test thật
      # (logic-test.cjs, 35 case, nạp Code.gs thật vào node:vm). Chỉ gate khi
      # turn này thực sự đụng thư mục đó — turn sửa skill/doc không phải trả giá.
      if git diff --name-only HEAD 2>/dev/null | grep -q '^personal/monthly-point-sync/'; then
        CLAUDE_STOP_CHECK="cd '$root/personal/monthly-point-sync' && node logic-test.cjs"
      else
        exit 0
      fi
      ;;
    *) exit 0 ;;
  esac
fi

CHECK_CMD="$CLAUDE_STOP_CHECK"
GATES=$(gates_in "$CHECK_CMD")

out=$(eval "$CHECK_CMD" 2>&1) || {
  broke=$(failing_gate "$out" "$GATES")
  for g in $GATES; do
    [ "$g" = "$broke" ] && break
    log_gate "$g" pass ""
  done
  log_gate "$broke" caught "$(printf '%s' "$out" | tail -5 | tr '\n\r\t' '   ' | cut -c1-300)"
  printf '%s\n' "STOP-GATE FAIL — turn chưa được kết thúc. Lệnh: $CHECK_CMD" >&2
  printf '%s\n' "$out" | tail -40 >&2
  exit 2
}
for g in $GATES; do log_gate "$g" pass ""; done
exit 0
