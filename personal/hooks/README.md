# Hooks starter — chuyển kỷ luật từ prose sang máy móc

> Vì sao: quy tắc bằng prose ≈ 25-40% tuân thủ, blocking hook ≈ 95% (đo bởi cộng đồng — xem
> `personal/docs/claude-smarter-research-2026-07-20.md` Nhóm 1). Iron Law đang nằm ở tầng
> 25-40%; bộ này đưa nó lên tầng 95%.

> **Nguyên tắc:** mỗi hook chỉ thêm/siết SAU KHI quan sát một failure THẬT. Không build cho
> tình huống giả định. Bộ starter dưới đây generic — tune dần theo lỗi gặp thật.

## 4 hook

| File | Event | Làm gì | Cơ chế |
|---|---|---|---|
| `pre-tool-use-guard.sh` | PreToolUse (Bash·Edit·Write) | Chặn lệnh nguy hiểm (`rm -rf`, force-push, `--no-verify`...) + file nhạy cảm (`.env`, keys) | exit 2 + stderr = BLOCK, chạy trước cả permission check, kể cả bypass mode |
| `post-tool-use-check-changed.sh` | PostToolUse (Edit·Write) | Lint ĐÚNG file vừa sửa (rẻ, mỗi edit) | exit 2 = Claude thấy lỗi ngay, sửa trước khi đi tiếp |
| `stop-full-check.sh` | Stop | Full tsc/test — 1 lần cuối turn | exit 2 = turn KHÔNG kết thúc được khi chưa pass; Claude đọc lỗi tự sửa |
| `session-start-inject.sh` | SessionStart (startup·resume·**compact**) | Re-inject iron laws — sống sót qua compact | exit 0 + stdout = inject context |

Tách **changed vs project** (theo claudekit): check rẻ mỗi edit, check đắt 1 lần lúc Stop.
Đừng bao giờ full `tsc --noEmit` trong PostToolUse — đốt ~25 phút wall-clock mỗi feature.

## Deploy vào một repo app (Wishlist / Joy)

1. Copy 4 script vào `<repo>/.claude/hooks/` (hoặc symlink từ dotfiles).
2. Thêm vào `<repo>/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_LINT_CMD": "yarn eslint --no-warn-ignored",
    "CLAUDE_STOP_CHECK": "npx tsc --noEmit && yarn jest --onlyChanged --silent"
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Edit|Write",
        "hooks": [{ "type": "command", "command": "bash .claude/hooks/pre-tool-use-guard.sh" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "bash .claude/hooks/post-tool-use-check-changed.sh" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "bash .claude/hooks/stop-full-check.sh" }] }
    ],
    "SessionStart": [
      { "matcher": "startup|resume|compact",
        "hooks": [{ "type": "command", "command": "bash .claude/hooks/session-start-inject.sh" }] }
    ]
  }
}
```

3. Chỉnh 2 biến `env` theo repo (Joy chưa có test harness backend → `CLAUDE_STOP_CHECK` chỉ tsc).
4. Cần `jq` trên PATH (mac: `brew install jq`; Windows Git Bash: có sẵn trong nhiều bản, không thì `winget install jqlang.jq`).

## Ghi chú

- **KHÔNG bật trong repo dotfiles này** — đây là template store; `stop-full-check` chạy tsc ở repo
  không có tsconfig sẽ fail vô nghĩa.
- `session-start-inject.sh` cũng bật GLOBAL được (`~/.claude/settings.json`, cùng cú pháp) nếu
  muốn iron laws sống ở mọi project — giữ block ngắn vì nó chiếm context mọi session.
- Stop hook bị Claude Code tự override sau 8 lần block liên tiếp (chống kẹt vĩnh viễn) —
  nâng bằng `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` nếu cần.
- Nâng cấp tiếp theo (khi có failure thật gọi tên): prompt-hook (Haiku chấm điều kiện) và
  agent-hook (subagent verify lúc Stop) — xem https://code.claude.com/docs/en/hooks-guide.
