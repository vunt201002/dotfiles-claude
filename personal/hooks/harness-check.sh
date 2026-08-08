#!/usr/bin/env bash
# SessionStart hook — audit chính cái harness. Exit 0 + stdout = inject vào context.
#
# Vì sao tồn tại (failure thật, không phải phòng xa): skill `fix-bug-loop` được viết
# 20/07/2026, 12KB, nhưng không ai symlink — nó chết 2 tuần mà không có tín hiệu nào.
# /sync-skills sửa được chuyện đó nhưng CHỈ CHẠY KHI NHỚ GỌI. Đây là cái máy nhớ hộ.
#
# Luật vàng: IM LẶNG khi mọi thứ ổn. Một cảnh báo in ra mọi session sẽ bị bỏ qua
# trong 3 ngày, và lúc đó cảnh báo thật cũng chết theo. Chỉ in khi có việc phải làm.

# Tự suy ra từ vị trí script (hooks/ nằm trong personal/) — hardcode "$HOME/Project/
# github/dotfiles-claude" thì máy nào checkout chỗ khác là hook chết câm ngay dòng đầu,
# đúng cái nó sinh ra để phát hiện.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -d "$REPO" ] || exit 0

findings=""
add() { findings="${findings}$1
"; }

for d in "$REPO"/skills/*/; do
  [ -d "$d" ] || continue
  n=$(basename "$d")
  [ -e "$HOME/.claude/skills/$n" ] || add "- skill CHƯA link: $n  → /sync-skills"
done

for f in "$REPO"/commands/*.md; do
  [ -f "$f" ] || continue
  n=$(basename "$f")
  [ -e "$HOME/.claude/commands/$n" ] || add "- command CHƯA link: $n  → /sync-skills"
done

if [ -d "$REPO/rules" ]; then
  [ -e "$HOME/.claude/rules" ] || add "- ~/.claude/rules CHƯA link → ln -snf $REPO/rules ~/.claude/rules"
fi

for l in "$HOME"/.claude/skills/* "$HOME"/.claude/commands/* "$HOME"/.claude/rules/*; do
  [ -L "$l" ] && [ ! -e "$l" ] && add "- symlink CHẾT: $(basename "$l") -> $(readlink "$l")"
done

if [ -f "$REPO/global-CLAUDE.md" ] && [ -f "$HOME/.claude/CLAUDE.md" ]; then
  cmp -s "$REPO/global-CLAUDE.md" "$HOME/.claude/CLAUDE.md" \
    || add "- ~/.claude/CLAUDE.md LỆCH personal/global-CLAUDE.md → diff rồi đồng bộ 1 chiều"
fi

# Hook nào đang được settings.json trỏ tới mà file không còn = harness thủng lặng lẽ:
# Claude Code không báo lỗi khi command của hook không tồn tại.
# Phải thay literal $HOME TRƯỚC khi grep path — command trong settings.json viết dạng
# bash "$HOME/..." nên grep thẳng sẽ ra path cụt và báo nhầm là thiếu file.
if [ -f "$HOME/.claude/settings.json" ] && command -v jq >/dev/null 2>&1; then
  hookmiss=$(jq -r '.hooks // {}, .statusLine // {} | .. | .command? // empty' \
      "$HOME/.claude/settings.json" 2>/dev/null \
    | sed "s|\$HOME|$HOME|g; s|~|$HOME|g" \
    | grep -o "$HOME/[^\" ]*\.sh" | sort -u \
    | while read -r p; do
        [ -f "$p" ] || echo "- hook/statusLine TRỎ VÀO FILE KHÔNG CÓ: $p"
      done)
  [ -n "$hookmiss" ] && findings="${findings}${hookmiss}
"
fi

[ -z "$findings" ] && exit 0

printf '%s\n' "[HARNESS CHECK — có việc cần dọn]"
printf '%s' "$findings"
exit 0
