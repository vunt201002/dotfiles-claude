#!/usr/bin/env bash
# statusLine (đăng ký ở ~/.claude/settings.json key "statusLine") — KHÔNG phải hook.
# Nhận JSON session qua stdin, in ĐÚNG 1 dòng.
# Mục đích: thấy % context đã dùng để CHỦ ĐỘNG /compact, thay vì bị compact bất ngờ
# giữa investigation (iron law "context injection bốc hơi khi compact").
# Ràng buộc: phải NHANH (chạy lại rất thường xuyên) và không bao giờ fail —
# context_window.* là null ở đầu session và ngay sau /compact; rate_limits chỉ có
# với tài khoản Pro/Max và chỉ sau API response đầu tiên.

input=$(cat)

IFS=$'\t' read -r model dir pct limit5 <<EOF
$(printf '%s' "$input" | jq -r '[
  (.model.display_name // "?"),
  ((.workspace.current_dir // "?") | split("/") | last),
  ((.context_window.used_percentage // -1) | floor),
  ((.rate_limits.five_hour.used_percentage // -1) | floor)
] | @tsv' 2>/dev/null)
EOF

[ -z "$model" ] && model="?"
[ -z "$pct" ] && pct=-1
[ -z "$limit5" ] && limit5=-1

DIM=$'\033[2m'; RESET=$'\033[0m'
GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'

branch=$(git branch --show-current 2>/dev/null)

ctx=""
if [ "$pct" -ge 0 ] 2>/dev/null; then
  filled=$(( pct / 10 ))
  [ "$filled" -gt 10 ] && filled=10
  bar=""
  i=0
  while [ $i -lt 10 ]; do
    if [ $i -lt $filled ]; then bar="${bar}▓"; else bar="${bar}░"; fi
    i=$((i+1))
  done

  # 80% là ngưỡng nên compact CHỦ ĐỘNG: còn đủ chỗ để /compact kèm chỉ thị,
  # thay vì để harness tự cắt giữa chừng và mất mạch điều tra.
  if [ "$pct" -ge 80 ]; then color="$RED"
  elif [ "$pct" -ge 60 ]; then color="$YELLOW"
  else color="$GREEN"; fi

  ctx="${color}${bar} ${pct}%${RESET}"
fi

rl=""
if [ "$limit5" -ge 60 ] 2>/dev/null; then
  rl="${DIM} · 5h ${limit5}%${RESET}"
fi

out="${DIM}${model}${RESET} ${dir}"
[ -n "$branch" ] && out="${out}${DIM} ⎇ ${branch}${RESET}"
[ -n "$ctx" ] && out="${out}${DIM} │ ${RESET}${ctx}"
out="${out}${rl}"

printf '%s\n' "$out"
