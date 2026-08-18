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
| `statusline.cjs` | *(không phải hook — key `statusLine`)* | Hiện model·effort · dir · branch (+ahead/behind/dirty) · **% context đã dùng** (xanh/vàng/đỏ) · rate-limit **còn bao lâu tới reset** + 7d, **tự co theo bề ngang pane** | stdin JSON → in 1 dòng |

**Vì sao có `harness-check.sh`:** skill `fix-bug-loop` viết 20/07/2026 nhưng không ai
symlink — chết 2 tuần không một tín hiệu. `/sync-skills` sửa được nhưng chỉ chạy khi
nhớ gọi. Hook này là cái máy nhớ hộ. Nó chỉ in khi có việc phải làm; một cảnh báo in
mọi session sẽ bị ngó lơ sau 3 ngày, và cảnh báo thật chết theo.

**Vì sao có `statusline.cjs`:** iron law nói "context injection bốc hơi khi compact",
nhưng không thấy được còn bao nhiêu context thì không compact chủ động được. Ngưỡng đỏ
80% = vẫn còn chỗ để `/compact <chỉ thị>` có hướng, thay vì bị cắt giữa investigation.

**Cửa sổ 5h hiện đồng hồ đếm ngược thay cho chữ "5h"** (`3h10m 2%` = còn 3h10m nữa mới
reset, đã dùng 2%). Chữ "5h" là hằng số, không nói được gì; con số chỉ có nghĩa khi biết
còn bao lâu — 90% mà còn 8 phút là chuyện khác hẳn 90% mà còn 4 tiếng. Cửa sổ 7d giữ label
tĩnh vì đếm ngược nhiều ngày không đổi hành vi trong phiên. Rơi về "5h" khi `resets_at`
thiếu hoặc đã qua. Đếm ngược làm tròn xuống (`3h09m` = còn 3h09m00s–3h09m59s).

Phần trăm **làm tròn, không cắt cụt** — `Math.floor` biến 2.9% thành 2%, lệch 1 điểm so
với `/usage`. Script không tự tính phần trăm nào, lấy nguyên từ payload.

### Dòng tự co theo bề ngang pane, không để terminal cắt hộ

Mở nhiều pane thì mỗi pane hẹp lại, mà dòng status thì vẫn dài ~117 ký tự. Claude Code
cắt phần thừa ở **cuối dòng** — đúng chỗ đang để % context và rate-limit. Đo thật, 3 pane
cùng lúc trên máy này: `COLUMNS` = **189 / 94 / 46**. Ở pane 46 cột, cái còn nhìn thấy là
`Opus 5 (1M context)·max wishlist ⎇ fix/wis…` — nghĩa là toàn bộ phần đáng xem đã chết,
chỉ còn lại phần vô dụng nhất (tên model thì pane nào cũng giống nhau và không bao giờ đổi).

Claude Code **có** export `COLUMNS`/`LINES` riêng cho từng pane vào env của script
(payload JSON thì không có trường nào về bề ngang). Nên script tự cắt lấy: dựng dòng ở
mức chi tiết giàu nhất mà vẫn vừa, chứ không in tràn rồi phó mặc.

**Chỗ thật sự dùng được là `COLUMNS - 3`, không phải `COLUMNS`.** Đếm ký tự hiện trên
màn hình ở 3 pane, 2 bề ngang, 2 lần chụp khác nhau: 43/46, 43/46, 91/94 — hụt đúng 3
cả ba lần. Đặt reserve = 2 thì mọi dòng vừa khít đều mất 1 ký tự cuối, và ký tự cuối là
chữ số của `7d 95%`. Một cột sai = đúng cái bug đang sửa, chỉ nhỏ hơn. (Chưa tách được
"Claude Code chừa 3" với "chừa 2 nhưng `⎇` render 2 ô trong font này" — mọi mẫu đo đều
có đúng một `⎇`. Reserve = 3 đúng cho cả hai giả thuyết, xấu nhất là phí 1 cột khi ở
thư mục không phải git repo.)

`PROFILES` là **thứ tự hy sinh**, giàu → nghèo, cái nào đứng trước thì mất trước:

| Bỏ | Vì |
|---|---|
| `(1M context)` trong tên model | trùng với marker `1M` cạnh thanh bar, mất 13 ký tự mà không mất tin |
| bar 10 ô → 6 ô, rồi bỏ marker `1M` | bar là trang trí, con số `45%` mới là tin |
| khoảng trắng quanh `·` của rate-limit | `5h 42% · 7d 95%` → `5h42% 7d95%`, mất 6 ký tự |
| tên model + effort | giống hệt nhau ở mọi pane, và không đổi theo thời gian |
| bar hoàn toàn | `45%` vẫn còn, vẫn còn màu |
| tên thư mục | branch phân biệt pane tốt hơn dir khi nhiều pane cùng repo |

**% context và hai con rate-limit không nằm trong bảng này** — chúng không bao giờ bị bỏ.

Branch là biến **đàn hồi**: nó ăn hết chỗ còn thừa của profile giàu nhất còn vừa (binary
search trên bề rộng đã render, nên không phải cộng tay chi phí separator — sai một ký tự
là tràn). Cắt ở **giữa** chứ không cắt đuôi: `fix/wishlis…n-product-page` giữ cả loại
nhánh lẫn phần phân biệt, `fix/wishlist-car…` thì vứt mất phần phân biệt. Dưới 12 ký tự
thì bỏ hẳn branch — `⎇ f…` không nói được gì mà vẫn tốn chỗ.

Sàn budget từng viết là `Math.max(16, COLUMNS - reserve)`. Fuzz 4→200 cột bắt được: ở
pane 16–17 cột nó cho budget **lớn hơn** chỗ thật sự có, tức cũng là tự gây lại bug đang
sửa. Sàn giả đã bỏ; `clampVisible` lo phần cực hẹp và cắt an toàn qua escape ANSI.

Đo lại sau khi sửa: 0 tràn trên toàn dải 4–200 cột, và 43 ms/run — bằng đúng bản cũ
(chi phí nằm ở spawn node, không nằm ở vòng fit). Đặt `STATUSLINE_COLUMNS` để ép bề
ngang khi test.

### rate_limits là ảnh chụp per-session, không phải giá trị live

`rate_limits` trong payload đóng băng tại **API response gần nhất của riêng session đó**.
Nhiều session mở cùng lúc (nhiều repo trong Pane) → mỗi session giữ một số khác nhau cho
cùng một tài khoản. Đo thật, cùng một giây, cùng account: `5%`, `6%`, `7.000000000000001%`,
`9%` — và một session còn kẹt ở `resets_at` cũ hơn đúng 18000s (5 tiếng), tức đang hiển thị
cửa sổ đã hết hạn. Website hỏi live nên luôn dẫn trước. Đây là lý do statusline từng báo 5%
khi website báo 7%.

`refreshInterval` **không sửa được** chuyện này: nó chạy lại script, còn payload thì vẫn là
cache cũ của Claude Code cho tới khi session đó gọi API lần nữa.

Cách sửa: các session đều chạy chung script này nên cho chúng góp quan sát vào
`~/.claude/statusline-limits.json`. Trong một cửa sổ, usage chỉ tăng → lấy `max` là số mới
nhất. `resets_at` lớn hơn = cửa sổ đã lật, đếm lại từ đầu (so bằng `resets_at`, KHÔNG bằng
usage — usage tụt cũng là dấu hiệu lật cửa sổ, nhưng cũng là dấu hiệu session đọc cũ, phân
biệt được chỉ nhờ `resets_at`). Ghi bằng write-tmp-rồi-rename cho khỏi torn read khi nhiều
session ghi cùng lúc; mọi lỗi I/O đều bỏ qua rồi rơi về số của chính session.

Vẫn là xấp xỉ: nó chỉ tươi bằng session tươi nhất. Nếu mọi session đều idle thì website vẫn
dẫn trước. Đặt `STATUSLINE_LIMITS_CACHE` để trỏ cache đi chỗ khác (test dùng đường này).

Hai field null-được mà script phải né: `context_window.used_percentage` là `null` ở đầu
session và ngay sau `/compact`; `rate_limits.*` chỉ có với Pro/Max và chỉ sau API response
đầu tiên. Cả hai phải **ẩn segment**, không được rơi về `0%` — `Number(null)` trong JS ra
`0` chứ không phải `NaN`, nên guard bằng `Number.isFinite` là chưa đủ và sẽ báo láo rằng
context đang trống.

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
    "command": "node \"$HOME/Project/github/dotfiles-claude/personal/hooks/statusline.cjs\"",
    "refreshInterval": 15
  }
}
```

`harness-check` cố ý KHÔNG chạy ở `compact` — compact không đổi trạng thái symlink, in lại
cảnh báo cũ chỉ là nhiễu. `statusLine` nằm ngoài khối `hooks`, cùng cấp với nó.

**`statusLine` dùng `node`, không dùng `bash`+`jq`** (bản `.sh` cũ đã bỏ). Ba lý do, đều
là failure quan sát được trên máy Windows: `jq` không có sẵn kể cả trong Git Bash; `bash`
trên PATH của Windows là **WSL bash** (`C:\Windows\system32\bash.exe`) nên nhìn path Linux;
và `.js` trong repo này bị `"type":"module"` của `package.json` biến thành ESM, nên phải là
`.cjs`. Node thì Claude Code nào cũng phải có, parse JSON native, chạy giống nhau ở mọi OS.

`refreshInterval: 15` vì trigger của statusLine là event-driven và **im lặng khi main session
đứng chờ background agent** — mà đó là workflow mặc định (xem `global-CLAUDE.md`). Không có
nó thì % context và rate-limit đứng hình suốt lúc agent chạy. Script ~110ms nên 15s là ~1%
duty cycle.

Path trong `command` phải viết bằng **dấu `/`**: trên Windows, Claude Code chạy statusLine
qua Git Bash, và Git Bash nuốt `\` như ký tự escape — lệnh fail mà không có lỗi nào hiện ra.

(File settings đã có nội dung → merge khối `hooks` vào, đừng đè. Sửa xong mở session mới +
`/hooks` để xác nhận.)

### Wire trên Windows — 4 thứ đã cắn thật

**`jq` không có sẵn, kể cả trong Git Bash.** `pre-tool-use-guard.sh` và
`post-tool-use-check-changed.sh` đều khai `Cần: jq` ở header. Thiếu jq thì `cmd`/`fp` rỗng,
mọi check bị bỏ qua, hook luôn `exit 0` — **guard biến thành no-op câm**, tệ hơn không wire
vì tưởng được chặn mà không. Cài: `winget install --id jqlang.jq --exact`. PATH mới chỉ áp
cho process mới, mà hook cũng cần restart mới nạp, nên một lần restart giải quyết cả hai.

**Thêm `"shell": "bash"` vào từng hook.** Mặc định Claude Code chọn bash khi Git Bash có
mặt, PowerShell khi không — nhưng đừng để nó đoán: `bash` trên PATH của Windows là **WSL
bash** (`C:\Windows\system32\bash.exe`), nhìn path Linux, chạy là hỏng.

**Path viết bằng `/`, và trên Windows dùng path tuyệt đối của máy đó** thay cho `$HOME/...`
— Git Bash nuốt `\` như ký tự escape, lệnh fail mà không hiện lỗi nào.

**`harness-check.sh` tự suy path từ vị trí script**, không hardcode. Bản cũ ghi cứng
`$HOME/Project/github/dotfiles-claude` nên trên máy checkout ở `D:/Project/j/...` nó
`exit 0` câm ngay dòng đầu — đúng cái nó sinh ra để phát hiện.

Sau khi wire, kiểm bằng cách **cho hook một việc để kêu** rồi xem nó có kêu không (tạo
`personal/skills/__probe__/` rỗng → harness-check phải báo "skill CHƯA link", xoá đi phải
im lại). Hook im vì mọi thứ ổn và hook im vì hỏng nhìn giống hệt nhau.

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

## Thử hook bằng JSON giả? Đặt `GSTACK_GATE_LOG_ORIGIN=gate-test`

Ba hook đều ghi một dòng vào sổ cổng (`~/.gstack/gate-log/<project>.jsonl`) mỗi lần chặn
hoặc mỗi lần chạy. Chúng inherit env, nên **cách đóng dấu một lần probe là export biến trước
khi pipe JSON vào**:

```bash
printf '%s' '{"tool_input":{"command":"git add -A"}}' \
  | GSTACK_GATE_LOG_ORIGIN=gate-test bash personal/hooks/pre-tool-use-guard.sh
```

Quên là dòng probe vào sổ thành `work`, rồi chảy thẳng vào tỉ lệ `deterministic` của §7.3 và
ngưỡng mở P8 — bằng dữ liệu do việc thử cổng sinh ra, không phải do việc làm thật. Đây không
phải rủi ro giả định: lần đo đầu tiên phát hiện 10/14 dòng của sổ là fixture, và sổ trên máy
thứ hai lặp lại đúng vậy trong ngày đầu. Giá trị sai chính tả thì hook **báo lỗi**, không âm
thầm về `work`.

Đọc lại: `bun bin/gate-log stats` (mặc định chỉ đếm `work`, in rõ đã loại mấy dòng) ·
`--origin all` để xem hết · `recent` hiện dấu `<gate-test>`.

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
