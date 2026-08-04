# Hooks starter — chuyển kỷ luật từ prose sang máy móc

> Vì sao: quy tắc bằng prose ≈ 25-40% tuân thủ, blocking hook ≈ 95% (đo bởi cộng đồng — xem
> `personal/docs/claude-smarter-research-2026-07-20.md` Nhóm 1). Iron Law đang nằm ở tầng
> 25-40%; bộ này đưa nó lên tầng 95%.

> **Nguyên tắc:** mỗi hook chỉ thêm/siết SAU KHI quan sát một failure THẬT. Không build cho
> tình huống giả định. Bộ starter dưới đây generic — tune dần theo lỗi gặp thật.

## 5 hook + 1 statusline

| File | Event | Làm gì | Cơ chế |
|---|---|---|---|
| `pre-tool-use-guard.sh` | PreToolUse (Bash·Edit·Write) | Chặn lệnh nguy hiểm (`rm -rf`, force-push, `--no-verify`...) + file nhạy cảm (`.env`, keys) | exit 2 + stderr = BLOCK, chạy trước cả permission check, kể cả bypass mode |
| `post-tool-use-check-changed.sh` | PostToolUse (Edit·Write) | Lint ĐÚNG file vừa sửa (rẻ, mỗi edit) | exit 2 = Claude thấy lỗi ngay, sửa trước khi đi tiếp |
| `stop-full-check.sh` | Stop | Full tsc/test — 1 lần cuối turn | exit 2 = turn KHÔNG kết thúc được khi chưa pass; Claude đọc lỗi tự sửa |
| `session-start-inject.sh` | SessionStart (startup·resume·**compact**) | Re-inject iron laws — sống sót qua compact | exit 0 + stdout = inject context |
| `harness-check.sh` | SessionStart (startup·resume) | Audit chính harness: skill/command/rules chưa link, symlink chết, CLAUDE.md drift, hook trỏ file không có | exit 0 + stdout; **im lặng khi mọi thứ ổn** |
| `statusline.sh` | *(không phải hook — key `statusLine`)* | Hiện model · dir · branch · **% context đã dùng** (xanh/vàng/đỏ) · rate-limit 5h | stdin JSON → in 1 dòng |

**Vì sao có `harness-check.sh`:** skill `fix-bug-loop` viết 20/07/2026 nhưng không ai
symlink — chết 2 tuần không một tín hiệu. `/sync-skills` sửa được nhưng chỉ chạy khi
nhớ gọi. Hook này là cái máy nhớ hộ. Nó chỉ in khi có việc phải làm; một cảnh báo in
mọi session sẽ bị ngó lơ sau 3 ngày, và cảnh báo thật chết theo.

**Vì sao có `statusline.sh`:** iron law nói "context injection bốc hơi khi compact",
nhưng không thấy được còn bao nhiêu context thì không compact chủ động được. Ngưỡng đỏ
80% = vẫn còn chỗ để `/compact <chỉ thị>` có hướng, thay vì bị cắt giữa investigation.

Tách **changed vs project** (theo claudekit): check rẻ mỗi edit, check đắt 1 lần lúc Stop.
Đừng bao giờ full `tsc --noEmit` trong PostToolUse — đốt ~25 phút wall-clock mỗi feature.

## Cách A — Global từ dotfiles (KHUYÊN DÙNG: không tạo file nào trong repo app)

Đăng ký 1 lần ở `~/.claude/settings.json` (per machine), script trỏ thẳng vào dotfiles
checkout. 2 script check đã **repo-aware**: tự nhận repo qua tên thư mục git toplevel
(`*wishlist*` → eslint + tsc/jest, `*joy*` → eslint + tsc, repo lạ → exit 0 im lặng) —
nên bật global an toàn, không phá các repo khác. Đổi lệnh cho 1 repo → sửa `case` trong
script (sync qua git cho mọi máy), hoặc override bằng env trong settings của repo đó.

Thêm vào `~/.claude/settings.json` (Mac — path dotfiles là `~/Project/github/dotfiles-claude`;
Windows sửa thành path máy đó, vd `D:/Project/j/dotfiles-claude`):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Edit|Write",
        "hooks": [{ "type": "command", "command": "bash \"$HOME/Project/github/dotfiles-claude/personal/hooks/pre-tool-use-guard.sh\"" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "bash \"$HOME/Project/github/dotfiles-claude/personal/hooks/post-tool-use-check-changed.sh\"" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "bash \"$HOME/Project/github/dotfiles-claude/personal/hooks/stop-full-check.sh\"" }] }
    ],
    "SessionStart": [
      { "matcher": "startup|resume|compact",
        "hooks": [{ "type": "command", "command": "bash \"$HOME/Project/github/dotfiles-claude/personal/hooks/session-start-inject.sh\"" }] },
      { "matcher": "startup|resume",
        "hooks": [{ "type": "command", "command": "bash \"$HOME/Project/github/dotfiles-claude/personal/hooks/harness-check.sh\"" }] }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "bash \"$HOME/Project/github/dotfiles-claude/personal/hooks/statusline.sh\""
  }
}
```

`harness-check` cố ý KHÔNG chạy ở `compact` — compact không đổi trạng thái symlink, in lại
cảnh báo cũ chỉ là nhiễu. `statusLine` nằm ngoài khối `hooks`, cùng cấp với nó.

(File settings đã có nội dung → merge khối `hooks` vào, đừng đè. Sửa xong mở session mới +
`/hooks` để xác nhận.)

## Cách B — Per-repo (khi muốn scope hẹp / lệnh đặc thù 1 repo)

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

- **Repo dotfiles này CÓ được gate, nhưng hẹp** (đổi từ 2026-08-04). Không chạy tsc — repo
  không có tsconfig. Nhánh `*dotfiles-claude*` của `stop-full-check` chỉ chạy
  `node logic-test.cjs` KHI diff đụng `personal/monthly-point-sync/`; turn sửa skill/doc
  không phải trả giá gì. Lý do gate: đó là code duy nhất trong repo có test thật (76 case)
  và là thứ hay được sửa.
- `session-start-inject.sh` cũng bật GLOBAL được (`~/.claude/settings.json`, cùng cú pháp) nếu
  muốn iron laws sống ở mọi project — giữ block ngắn vì nó chiếm context mọi session.
- Stop hook bị Claude Code tự override sau 8 lần block liên tiếp (chống kẹt vĩnh viễn) —
  nâng bằng `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` nếu cần.
- Nâng cấp tiếp theo (khi có failure thật gọi tên): prompt-hook (Haiku chấm điều kiện) và
  agent-hook (subagent verify lúc Stop) — xem https://code.claude.com/docs/en/hooks-guide.
