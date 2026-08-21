# Tầng manager + Telegram — plan chi tiết 12/08/2026

> **Bản 2 — đã sửa theo red team 12/08.** Bản 1 bị 5 blocker; thứ tự phase đổi hẳn.
> Xem §11 để biết sửa gì và vì sao.
>
> Tiếp nối [[harness-benchmark-2026-08-09.md]] và phần đối chiếu "Steps of AI Adoption"
> (Boris Cherny, 16/07/2026): mình chắc chân **bậc 2 — Parallel**, đã có guardrail/context
> của bậc 3, thiếu **oracle đo được** và **việc chạy nền**.
>
> Workflow từng task **không đổi** — vẫn là [[workflow.md]]. Doc này xây tầng **trên** nó.

---

## 0. Mục tiêu, quyết định đã chốt, và tiêu chí giết

**Mục tiêu:** thêm một tầng điều phối trên tất cả project, giao tiếp được từ điện thoại,
và chuyển dần review từ tay sang cổng — **theo số, không theo cảm giác**.

### QĐ-1 — Tách hai cuộc di cư
Dựng manager TRƯỚC. Việc đầu tiên của nó **không phải tự trị, mà là làm dụng cụ đo**.

*Lý do:* làm cùng lúc thì chất lượng tụt sẽ không tách được là do tầng điều phối mới hay do
mất review, và phát hiện muộn vì không còn ngồi máy.

### QĐ-2 — Telegram v1 = báo cáo + gật/lắc + prompt ngắn
Mọi việc không đảo ngược được (push, deploy, merge, xoá, đụng prod) phải xin gật.

### QĐ-3 — Kiểm chứng tiền đề trước khi xây *(mới sau red team)*
Không viết manager cho tới khi biết **ràng buộc thật sự đang chặn là gì**. Xem §2.

### QĐ-4 — Bản rẻ trước, manager đầy đủ sau *(mới sau red team)*
Bot tối giản (§4) chạy 1-2 tuần làm probe. Có cổng quyết định trước khi xây manager đầy đủ.

### ▣ Tiêu chí GIẾT cả chương trình — viết trước, lúc còn khách quan

Sau **3 tuần** kể từ khi bot rẻ chạy, dừng toàn bộ và quay về flow cũ nếu:

- Thời gian anh thực sự bỏ ra cho mỗi task **không giảm**, **hoặc**
- `human_touches` trong **lô mẫu mù** (§3.2) **không giảm**, **hoặc**
- Số lần anh phải sửa tay sau khi agent báo xong **tăng**

Ba điều kiện này đo được từ gate log. Không thương lượng lại lúc đó — đọc số rồi quyết.

### Nguyên tắc lõi

1. **Trust không được cấp, nó được kiếm — theo từng lane, bằng số đo trong điều kiện đúng.**
2. **Manager phải mỏng.** Định tuyến, tổng hợp, báo cáo. Trạng thái ở file.
3. **Model khác không thay được context độc lập** — và **context độc lập không thay được
   failure mode độc lập**. Xem luật ensemble §7.3.
4. **`oracle_available: false` → không vào lane tự trị**, bất kể size.
5. **Một repo, một agent chính tại một thời điểm.**

---

## 1. Kiến trúc đích

```
                    ┌──────────────┐
                    │   Telegram   │  báo cáo · gật/lắc · prompt ngắn
                    └──────┬───────┘
                    ┌──────▼───────┐
                    │   MANAGER    │  fable · 1 instance · cross-project
                    │   (daemon)   │  định tuyến · tổng hợp · brainstorm
                    └──────┬───────┘  KHÔNG code, KHÔNG giữ chi tiết implement
              ┌────────────┼────────────┐
        ┌─────▼─────┐ ┌────▼────┐ ┌─────▼─────┐
        │ AGENT CHÍNH│ │  ...    │ │  ...      │  opus · spawn theo task
        └─────┬─────┘ └─────────┘ └───────────┘
        ┌─────▼──────┐
        │  SUBAGENT  │  sonnet · execute một lane của workflow.md
        └─────┬──────┘
        ┌─────▼──────────────────────────────┐
        │  ORACLE CHAIN + luật ensemble §7.3 │
        └────────────────────────────────────┘
```

**Đây là đích, không phải điểm bắt đầu.** §2 và §4 quyết định có đi tới đây không.

### Vai và ranh giới

| Tầng | Model | Được làm | KHÔNG được làm |
|---|---|---|---|
| **Anh** | — | quyết định cuối, gật/lắc, đọc lô mẫu mù | — |
| **Manager** | fable | định tuyến, tổng hợp, báo cáo, brainstorm, spawn agent chính | viết code, sửa file trong repo, tự quyết việc không đảo ngược |
| **Agent chính** | opus | size issue, chọn lane, spawn subagent, chạy oracle chain | push/deploy/merge, sửa `design-eye.md` hay `personal/hooks/` (đề xuất thôi) |
| **Subagent** | sonnet | execute đúng lane, sửa code trong scope | commit, push, mở rộng scope, **đụng repo khác** |
| **Reviewer** | opus fresh-context | đọc diff, nộp finding | sửa code — report-only |
| **Judge (UI)** | opus | chấm rubric design-eye §B, tự mở Chrome | sửa code |

> **Codex chưa có trên máy này** (`~/.codex/auth.json` còn nhưng binary không trên PATH).
> Tầng review dùng **opus fresh-context** cho tới khi cài lại codex. Ghi rõ vì điều này
> làm yếu luật ensemble §7.3 — Claude chấm Claude, xem BLOCKER 4 ở §11.

**Việc không thuộc về ai — luôn cần anh gật:** `git push` · deploy · merge MR · xoá dữ liệu ·
mọi thao tác chạm prod. `git commit` tự động **chỉ mở ở lane đã qua P7**.

---

## 2. Tuần 0 — Kiểm chứng (gần như không code)

**Ba việc này chạy trước/song song mọi thứ. Kết quả có quyền đổi trọng tâm cả plan.**

### 2.1 Đo tiền đề — 7 ngày *(giải BLOCKER 2)*

Plan này tăng throughput **thực thi**. Nhưng nhận định trước đó là ràng buộc thật có thể là
**quyết định làm gì** và **chi phí đổi ngữ cảnh giữa ~8 repo**. Nếu vậy, manager làm tệ hơn:
nhiều việc chạy hơn ⟹ nhiều quyết định cần anh hơn mỗi giờ ⟹ dồn hết qua một cái điện thoại.

**Cách đo:** mỗi lần một task bị treo, ghi một dòng (`/my-worklog` hoặc file phẳng) kèm lý do:

| Nhãn | Nghĩa |
|---|---|
| `wait-review` | chờ anh đọc diff / duyệt |
| `wait-decide` | chờ anh quyết một lựa chọn |
| `wait-switch` | chờ anh đổi ngữ cảnh sang repo/task khác |
| `wait-agent` | agent đang chạy, anh rảnh |
| `wait-external` | chờ QC, chờ CI, chờ người khác |

**▣ CỔNG:** sau 7 ngày, nếu `wait-review` **không phải nhóm lớn nhất** → plan phải đổi trọng
tâm trước khi đi tiếp. Không sửa số liệu cho khớp plan.

### 2.2 Kiểm chứng router bằng tay — 30 phút *(giải #9)*

Lấy **10 issue thật đã xong** (kivora + Joy + Wishlist). Tự phân lane theo rubric §7.1,
rồi so với công sức thực tế đã bỏ ra.

**▣ CỔNG:** sai > 3/10 → rubric hỏng, **sửa rubric trước khi xây router**. Rẻ hơn phát hiện
sau khi đã code xong một ngày.

### 2.3 Kiểm kê assertion headless — 1 giờ *(giải BLOCKER 5)*

Với **từng project**, đếm: *hôm nay có bao nhiêu assertion chạy headless được, không cần Chrome thật?*

| Project | Assertion headless hiện có | Kết luận |
|---|---|---|
| `monthly-point-sync` | 35 case (`logic-test.cjs`, `node:vm`) | đủ |
| Wishlist | Jest (`jest-patterns.md`) | đủ để bắt đầu |
| Joy backend | **0** | thiếu hẳn |
| kivora | **chưa kiểm tra** | phải đếm |

**▣ CỔNG:** project nào dưới ngưỡng thì **P3 với project đó = viết assertion**, không phải
xây cơ chế token. Tách B8 mà không có gì để chạy headless thì giao ra một hàng đợi rỗng.

---

## 3. Mô hình dữ liệu

### 3.1 Task envelope — agent chính → manager

```json
{
  "project": "kivora",
  "issue": "t105",
  "title": "Checkout không áp mã giảm giá khi giỏ có sản phẩm sale",
  "size": "M",
  "uncertainty": "med",
  "lane": "bug-lon",
  "why": "chạm logic tính giá dùng chung 3 nơi, chưa rõ nguồn ở FE hay rule engine",
  "oracle_available": true,
  "oracle_kind": ["vitest", "tsc", "eslint"],
  "needs_human": false,
  "blocking_questions": [],
  "assumptions": [],
  "assumption_count": 0,
  "est_cost_usd": 1.2,
  "est_turns": 40,

  "kind": "code",
  "round_2_fail": false,
  "touches_sensitive": false,
  "in_scope": true,
  "defer_reason": null
}
```

- `size ∈ S|M|L|XL` · `uncertainty ∈ low|med|high` — thang `/joy-point-assign`
- `oracle_kind` rỗng ⟹ `oracle_available: false` ⟹ **bắt buộc** `needs_human: true`
- **`assumption_count > 2` ⟹ task tự nâng lên `needs_human: true`** *(giải #10)* — nhiều giả
  định nghĩa là router đã phân sai lane. Giả định sai mà không chặn chính là lớp lỗi hay ship nhất.

**Năm field cuối thêm sau calibration thật trên eivno (12/08).** Tất cả optional, mặc định
vắng mặt, nên envelope cũ vẫn validate:

| Field | Vì sao phải có |
|---|---|
| `kind` ∈ `code`\|`investigate`\|`provision`\|`decide` | **Bốn lane giả định deliverable là một diff.** 3/15 case thật không phải: *"verify editor trong browser thật"*, *"xác nhận cron có chạy không"*, và gần như toàn bộ Stage 4 của eivno là provision/decide. Workflow B không chạy được khi chưa chắc có defect. Khác `code` ⟹ `needs_human: true` |
| `round_2_fail` | Luật ghi đè 2 **không kiểm chứng được** nếu envelope không mang được nó |
| `touches_sensitive` | Luật ghi đè 3, cùng lý do |
| `in_scope` + `defer_reason` | *"Việc này verify được, và vẫn không được chạy"* là câu hỏi **khác** với `needs_human` (*"ta không verify được"*). T-105 là ca thật: hoàn toàn verify được, launch plan §8 xếp ngoài scope. Có field thì lọc và đếm được; nhét vào `blocking_questions` thì không |

### 3.2 Task record — state của manager

```json
{
  "id": "kivora-t105-01",
  "state": "running",
  "envelope": { },
  "attempt": 1,
  "max_attempts": 3,
  "review_depth": "summary",
  "blind_sample": false,
  "agents": [ { "role": "main", "model": "opus", "session": "…", "status": "alive" } ],
  "gates_run": ["lint", "tsc", "red-test"],
  "holds": ["browser-token"],
  "cost_usd_actual": 0.91,
  "human_touches": 0,
  "created_at": "…", "updated_at": "…"
}
```

#### Lấy mẫu mù — cơ chế quan trọng nhất của cả hệ *(giải BLOCKER 1)*

`human_touches = 0` có **hai** cách xảy ra: cổng bắt hết thật, hoặc anh đang lướt tóm tắt trên
điện thoại nên không thấy gì để chỉ. Chỉ số thô **không phân biệt được**, nên nếu dùng nó để
mở P7 thì ta đang **đo độ suy giảm chú ý của anh và gọi nó là chất lượng oracle**.

Cơ chế:

- **1 trong 5 task** được chọn ngẫu nhiên **SAU khi task xong**, đánh dấu `blind_sample: true`.
- Manager **không cho anh biết trước** task nào sẽ bị chọn.
- Task được chọn: anh **phải** đọc full diff → `review_depth: "full-diff"`.
- **Chỉ `human_touches` trong lô mẫu mù mới được dùng để mở P7.** Số ngoài lô chỉ để tham khảo.
- Không có `review_depth` thì mọi con số về sau không diễn giải được — field bắt buộc.

### 3.3 Gate log — JSONL, `~/.gstack/gate-log/<project>.jsonl`

```json
{"ts":"2026-08-12T09:14:22Z","project":"kivora","issue":"t105","lane":"bug-lon",
 "gate":"spec-check","gate_family":"llm","verdict":"caught","attempt":1,"cost_usd":0.12,
 "caught":"thêm endpoint /discount/preview không có trong scope",
 "review_depth":"summary","human_intervened":false}
```

| Field | Giá trị |
|---|---|
| `gate` | `guard` · `lint` · `tsc` · `red-test` · `B8-assert` · `B8-judge` · `design-judge` · `spec-check` · `tech-review` · `impact-review` · `codex-review` |
| **`gate_family`** | **`deterministic` \| `llm`** *(mới — giải BLOCKER 4)* |
| `verdict` | `pass` · `caught` · `false-positive` · `skipped` · `error` |
| `caught` | một câu, cụ thể. Rỗng khi `pass` |
| `review_depth` | `summary` \| `full-diff` — điều kiện lúc quan sát |
| `human_intervened` | `true` nếu anh phải chỉ ra thứ cổng bỏ sót |
| **`origin`** | **`work` (mặc định) \| `gate-test`** — xem dưới |

**`origin` — tách dòng làm-việc khỏi dòng thử-cổng** *(thêm 12/08, sau phép đo đầu tiên)*.
Phép đo thật đầu tiên phát hiện **10 trong 14 dòng của sổ là fixture cố tình nguy hiểm bơm
vào guard trong lúc TEST guard**. Chúng là true positive — cổng trả lời đúng — nên đánh dấu
`false-positive` sẽ là nói dối và làm precision tụt sai. Nhưng chúng thổi `caught` lên 10/14
và chảy thẳng vào tỉ lệ `deterministic` của §7.3 lẫn ngưỡng của P8, **bằng dữ liệu sinh ra từ
việc thử cổng chứ không phải từ việc làm thật**.

Không có `origin` thì mọi con số của P8 đều nhiễm. Harness bơm fixture vào hook đặt
`GSTACK_GATE_LOG_ORIGIN=gate-test`; hook truyền xuống. **§7.3 và P8 chỉ đếm `origin: work`.**

> **Cài thật 13/08 — trước đó đoạn trên là mô tả một thứ KHÔNG tồn tại.** `grep -rn
> "GSTACK_GATE_LOG_ORIGIN"` toàn repo cho đúng một hit: chính dòng này. Không có `origin`
> trong `gate-log.ts`, không có trong hook, không có trong bất kỳ reader nào. Đây là §7.3b
> bài học 1 xảy ra ngay trong doc mô tả nó — **văn bản khiến người đọc sau tin rằng có hàng
> rào**. Bằng chứng nó có hại: sổ trên máy mới vừa sinh ra đã có 10/10 dòng là probe guard
> ghi thành `work`.

**Bốn đầu dây, cắt một cái là probe lại chảy vào số:**

| Đầu dây | Ở đâu |
|---|---|
| Đóng dấu lúc ghi | `resolveOrigin` trong `gate-log.ts` — tham số > env > `work`. Env sai chính tả **ném lỗi**, không âm thầm về `work` |
| Harness đóng dấu probe | `runGuardGate` trong `oracle/lib/gates.ts` đóng dấu **child**, không đóng `process.env` — test chạy chung process không dính lây |
| Reader §7.3 | `verifyDeterministicGates` chỉ nhận dòng `work` làm chứng từ; `collectLoggedGates` lọc qua `workOnly()` |
| Reader P8 | `gate-log stats` mặc định chỉ đếm `work`, in rõ đã loại bao nhiêu dòng; `--origin all` để xem hết |

Bốn cái được khoá bằng tripwire tĩnh 22-25 trong `personal/manager/test/tripwire.test.ts`, vì
một đảm bảo chỉ nằm trong bảng này thì lần refactor sau sẽ gỡ mà không có gì đỏ.

**Dòng ghi trước 13/08 không có `origin`.** Chúng đọc ra `work` theo đúng mặc định §3.3, nhưng
`stats` đếm riêng và in *"provenance assumed, not measured"* — một con số trộn xuất xứ đo được
với xuất xứ suy ra mà không nói thì đúng là thứ sổ này sinh ra để chặn.

**Đã biết, chưa vá:** guard **chỉ log rule ĐẦU TIÊN khớp**. Một lệnh bị chặn có thể khớp nhiều
rule mà sổ chỉ ghi một, nên **precision theo từng RULE không khôi phục được từ sổ này — chỉ có
precision theo từng GATE.** Muốn tune từng rule thì phải ghi mọi rule khớp.

**`false-positive` bắt buộc phải có.** Không có nó thì không đo được precision, và cổng hay
kêu oan sẽ bị bỏ qua trong ba ngày — lúc đó cảnh báo thật chết theo.

**`gate_family` bắt buộc phải có.** Nếu 90% số lần `caught` đến từ `llm` thì "trust" đang
đứng trên một chân duy nhất. Phải biết bằng số, không bằng cảm giác.

---

## 4. Bản rẻ — probe, và có thể là đích luôn *(giải BLOCKER 3)*

Bản 1 nhảy thẳng vào daemon + state machine + 4 schema + model routing, **không cân nhắc
phương án nào rẻ hơn**. Đó là lỗi review thiết kế cơ bản.

**Bản tối giản:**

> Telegram bot → **một session Claude đang chạy sẵn** + **một file task**.
> Không manager agent, không state machine, không model routing.
> Anh nhắn `kivora t105` → session đó đọc `workflow.md`, tự size, tự spawn subagent
> (nó đã làm được rồi), báo lại qua bot.

| | Bản rẻ | Manager đầy đủ |
|---|---|---|
| Công | ~2 ngày | ~10-20 ngày (§9) |
| Giao việc từ điện thoại | ✅ | ✅ |
| Báo cáo + gật/lắc | ✅ | ✅ |
| Brainstorm từ điện thoại | ✅ | ✅ |
| Nhiều project **thật sự** song song | ❌ | ✅ |
| Kế toán chi phí, trần | ❌ | ✅ |
| Crash recovery | ❌ | ✅ |

Bản rẻ **cũng chính là dụng cụ đo** cho §2.1 — nó tạo ra gate log thật trong điều kiện thật.

### ▣ CỔNG QUYẾT ĐỊNH — sau 1-2 tuần chạy bản rẻ

Xây manager đầy đủ **chỉ khi** log cho thấy ít nhất một trong:

- Thường xuyên muốn chạy ≥2 project song song và bị nghẽn thật
- Chi phí trôi mà không ai thấy cho tới lúc nhìn hoá đơn
- Session chết giữa chừng làm mất việc, đủ nhiều để đau

Không cái nào đúng → **bản rẻ là đích**. Dừng ở đó, dồn công sang oracle (P6).

---

## 5. Vòng đời một task

```
  INTAKE ──► SIZED ──► [APPROVAL] ──► RUNNING ──► VERIFYING ──► REVIEW ──► REPORTED
                │           │             │           │            │
                ▼           ▼             ▼           ▼            ▼
             BLOCKED    REJECTED       BLOCKED    RETRY(≤3)     BLOCKED
```

| Chuyển | Ai làm | Ghi gì |
|---|---|---|
| `INTAKE → SIZED` | agent chính trả envelope | envelope + size **dự đoán** vào gate log |
| `SIZED → APPROVAL` | manager, nếu vượt trần hoặc `needs_human` | — |
| `APPROVAL → RUNNING` | anh gật | — |
| `RUNNING` | subagent chạy lane | mỗi hook `exit 2` = một dòng gate log |
| `RUNNING → VERIFYING` | agent chính | giữ `browser-token` nếu cần Chrome |
| `VERIFYING → RETRY` | B8 fail | attempt++, dừng ở 3 (tripwire) |
| `VERIFYING → REVIEW` | B8 pass | — |
| `REVIEW` | spec-check (fresh) → reviewer | mỗi cổng một dòng + `gate_family` |
| `→ REPORTED` | manager tổng hợp | `cost_usd_actual`, `human_touches`, `assumption_count` |
| sau `REPORTED` | manager | **quay xổ số mẫu mù** (1/5) |

**Luật retry giữ nguyên `/fix-bug-loop`:** chỉ B8 fail mới retry. Blocked ở B2 (root cause
chưa chứng minh) hay B4 (red-team thủng) → **dừng ngay, không retry**.

---

## 6. Manager (chỉ xây sau cổng §4)

### 6.1 Process model
- **Daemon nhẹ** `manager daemon` + **CLI**: `manager run|status|stop|stopall|report|cost|fleet|worktrees`

**Agent khởi động daemon/bot phải đi qua `bin/gstack-detach`.** CLAUDE.md đã bắt
làm thế cho eval dài; nó áp cho **service** còn gắt hơn, và tôi ăn đúng lỗi này
ngày 13/08: daemon + bot chạy bằng background task thường thì nằm trong process
group của harness, nên một SIGTERM "xin nghỉ lịch sự" ở ranh giới lượt giết cả
hai. Chúng tắt *sạch sẽ* — log ghi "shutting down" — nên nhìn không giống lỗi,
chỉ giống đã xong. Sau đó `/fleet` trên điện thoại im lặng và không ai biết tại sao.

```bash
bin/gstack-detach --label manager-daemon --log ~/.gstack/manager/daemon.log \
  -- env EVALS_HERMETIC=0 bun personal/manager/cli.ts daemon
bin/gstack-detach --label telegram-bot --log ~/.gstack/manager/telegram-bot.log \
  -- bun personal/manager/telegram/bot.ts
```

Không `--timeout` cho service (mặc định 0 = không watchdog). `EVALS_HERMETIC=0`
là bắt buộc cho daemon: hermetic env dựng `CLAUDE_CONFIG_DIR` mới, và agent sẽ
báo `Not logged in`. Kiểm đã tách thật bằng `ps -o pgid=` — pgid của service phải
KHÁC pgid của shell gọi nó.
- **State ở đĩa:** `~/.gstack/manager/state.json`, `tasks/<id>.json`, `~/.gstack/gate-log/`

### 6.2 Spawn primitive — dùng đồ đã có, KHÔNG lái Warp

| Dùng | Cho |
|---|---|
| `test/helpers/agent-sdk-runner.ts` → `runAgentSdkTest` | spawn agent, **semaphore cap concurrency**, bắt rate-limit + max-turns |
| `test/helpers/session-runner.ts` → `runSkillTest` | spawn `claude -p`, stream NDJSON, `CostEstimate` |
| `test/helpers/pricing.ts` → `estimateCostUsd` | tiền theo model |
| `test/helpers/eval-store.ts` → `assertNoBudgetRegression` | báo động chi phí phình |
| `test/helpers/hermetic-env.ts` | env sạch cho child |
| `test/helpers/codex-session-runner.ts` | **để dành** — khi nào cài lại codex |

Lái Warp bằng GUI là mảnh giòn nhất có thể chọn: không đọc được kết quả có cấu trúc, không
cap được concurrency, không đo được tiền, chết câm khi cửa sổ đổi.

#### 6.2b Bốn phản đối trên KHÔNG đúng với cmux — đo lại ngày 13/08

Bốn lý do ở trên viết cho Warp. Đem nguyên si sang cmux thì ba trong bốn cái sai,
và cái sai đó đã được kiểm bằng cách đọc `~/.cmuxterm/claude-hook-sessions.json`
trên máy này chứ không phải bằng cách đọc tài liệu cmux.

| Phản đối (viết cho Warp) | Với cmux | Bằng chứng |
|---|---|---|
| không đọc được kết quả có cấu trúc | **sai** — `agentLifecycle` (running·idle·needsInput) + `transcriptPath` | `lib/cmux-sessions.ts` |
| không cap được concurrency | **sai, và tốt hơn semaphore** — đếm session sống trong store, thấy CẢ pane user tự mở | `busyCount()`, `waitForSlot()` |
| không đo được tiền | **sai** — usage nằm trong transcript agent tự ghi cho mình | `usageFromTranscript()` |
| chết câm khi cửa sổ đổi | **đúng một nửa** — pid chết mà lifecycle còn `running` là crash, phát hiện được; nhưng vẫn phải cross-check pid | `healthOf()` |

Cái thứ ba mới là cái đáng giá: transcript là **kênh thứ được đo không viết cho
manager**, đúng yêu cầu §7.3b bài 2 cho mọi con số được phép mở autonomy. Semaphore
trong SDK runner ngược lại chỉ thấy spawn của chính manager — một người mở 3 pane tay
đẩy máy lên 11 agent trong khi mọi con số manager báo vẫn là 8.

**Đổi lại được gì:** work chạy trong pane user nhìn thấy, ngắt được, cướp lái được
giữa chừng. Đó là thứ SDK runner không bao giờ cho.

**Giá phải trả, ghi rõ chứ không giấu:**
- `cmux send` là **gõ vào TUI**, không phải API. Gửi lúc agent đang chạy = chèn ký tự
  vào giữa lượt; gửi chuỗi có `\n` = submit sớm, phần còn lại thành lệnh thứ hai.
  Nên: prompt đầu **không bao giờ được gõ** — ghi ra file, launch command đọc bằng
  `"$(cat …)"`; và `sendText` từ chối khi lifecycle không phải idle/needsInput.
- Pane chạy `claude` thật với settings của user, nên `--dangerously-skip-permissions`
  chỉ chấp nhận được khi `pre-tool-use-guard.sh` có thật — `guardIsWired()` kiểm
  trước, từ chối spawn chứ không tin cái cờ.
- Chỉ role trong `cmuxRoles` (mặc định `main`, `subagent`) mới có pane. Gate
  report-only đi SDK: 5 pane phụ cho mỗi task sẽ chôn mất cái pane đáng nhìn.

#### 6.2c Một repo, N worktree — thay cho joy-1/joy-2/joy-3

Trước: mỗi task một bản copy repo, nên hai task cùng repo không chạy song song được;
manager lấy khoá theo project để che, mà khoá theo project là **hàng đợi mặc áo
concurrency** — 8 repo là trần 8 agent bất kể máy bao nhiêu core.

Giờ: `lib/worktrees.ts`, mỗi task một `git worktree` riêng + branch riêng
`manager/<taskId>`, đặt ở `~/.gstack/manager/worktrees/<project>/<taskId>` —
**ngoài repo**, vì để trong repo thì scope của task A chứa checkout của task B và
guard sẽ cho qua write từ A sang B.

Hai điều module này TỪ CHỐI làm, và lý do:
1. **Không xoá thư mục nó không tạo ra.** Mọi worktree ghi vào `worktrees.json`
   trước, `remove` đối chiếu file đó. Máy này đang có `joy-2`, `joy-3`,
   `wishlist-2`, `wishlist-3` nằm cạnh bản gốc giữ 19 stash; một pass dọn dẹp đi
   theo pattern tên thay vì theo sổ sẽ ăn mất chúng.
2. **Không xoá worktree còn thay đổi chưa commit** trừ khi ép. Việc dở của agent
   là thứ đắt nhất trên đĩa.

### 6.3 Concurrency và tài nguyên khan hiếm

| Tài nguyên | Cap | Cơ chế |
|---|---|---|
| Agent toàn cục | `min(8, cores-2)` | semaphore SDK; runner cmux đếm `busyCount(fleet())` |
| Agent chính / project | **1** | khoá theo `project` |
| Chrome thật (`/my-chrome`, DevTools MCP) | **1 token toàn cục** | FIFO, `holds: ["browser-token"]` |
| Playwright headless | không giới hạn | không tranh Chrome |

**Khoá theo project còn cần không?** Với runner cmux thì mỗi task đã có worktree
riêng, nên hai task cùng repo không còn giẫm file của nhau — lý do gốc của khoá đã
mất. Khoá vẫn giữ nguyên chưa gỡ, vì nó còn che một thứ khác: lệnh install
(`bun install`) ghi vào `node_modules` **dùng chung qua symlink** giữa mọi worktree.
Gỡ khoá là việc riêng, phải làm sau khi tách được install ra khỏi task, không phải
tiện tay lúc thêm cmux.

### 6.4 Model routing

| Vai | Model | Fallback |
|---|---|---|
| Manager | fable | opus |
| Agent chính | opus | — |
| Subagent execute | sonnet | opus khi `bug-lon` retry lần 3 |
| Review | **opus fresh-context** (codex khi cài lại) | — |
| Judge UI | opus | — |
| Search ngoài | grok (X) / WebSearch | WebSearch |

### 6.5 Trần chi phí *(giải #6)*

**Không** lấy trần từ `est_cost_usd × 2` — ước lượng do chính agent đưa ra, và LLM hay ước
lượng thấp có hệ thống. Trần thấp ⟹ task bị giết giữa chừng ⟹ **tốn tiền mà không ra gì,
tệ hơn không có trần.**

- **Bootstrap:** trần phẳng, rộng rãi (vd $5/task), cùng trần cứng theo ngày.
- **Sau ~20 task/lane:** trần = **p90 của actual** theo lane, lấy từ gate log.
- `est_cost_usd` vẫn ghi, nhưng chỉ để **đo xem agent ước lượng lệch bao nhiêu**.

### 6.6 Brainstorm mode
Prompt không có `project`/`issue` → manager trả lời trực tiếp bằng fable, đọc doc trong
`personal/docs/` và `~/.gstack/`, **không spawn gì cả**.

### 6.7 Crash recovery
Boot lên reconcile `state.json`: task `RUNNING`/`VERIFYING` mà session chết → `FAILED`, báo,
**không tự chạy lại** · `browser-token` mồ côi → thu hồi · task `APPROVAL` → gửi lại yêu cầu gật.

### 6.8 Blast radius *(giải #8)*

Manager spawn agent bypass-permissions trên ~8 repo, điều khiển từ điện thoại. Guard hiện tại
là regex denylist mà chính benchmark gọi là tầng yếu nhất.

- **Ràng scope theo project.** Task cho repo A **không được đụng** repo B — dùng cơ chế của
  `/freeze` (chặn Edit/Write ngoài đường dẫn cho phép), manager set scope khi spawn.
- **Kill switch chạy được từ điện thoại:** `/stopall` dừng mọi task đang chạy, không chỉ
  `/stop <task-id>`.
- Task khởi phát từ Telegram chạy dưới **denylist chặt hơn** task gõ tại máy.

---

## 7. Workflow — router, review, verify

### 7.1 Router — đánh giá issue

| Lane | Điều kiện | Chạy gì |
|---|---|---|
| `trivial` | typo/label/color/copy/1 dòng, uncertainty `low` | fix thẳng |
| `bug-nho` | size `S`, uncertainty `low`, oracle có | Workflow B rút gọn — bỏ B4, B6 |
| `bug-lon` | size ≥ `M` **hoặc** uncertainty ≥ `med` **hoặc** round-2-fail | Workflow B đầy đủ, **B2 prove bắt buộc** |
| `feature` | việc mới cần xây | Workflow A đầy đủ |

**Bốn luật ghi đè:**
1. `oracle_available: false` → `needs_human: true`, không vào lane tự trị.
2. Bug đã bị QC trả về lần 2 → luôn `bug-lon`, bất kể size.
3. Chạm auth / thanh toán / migration dữ liệu → tối thiểu `bug-lon`.
4. `assumption_count > 2` → `needs_human: true`.

**Ghi size dự đoán vào gate log.** Router đoán sai cũng là một lớp lỗi cần hiệu chuẩn.

### 7.2 Oracle chain theo lane

| Lane | Chain |
|---|---|
| `trivial` | hook (lint/tsc) |
| `bug-nho` | hook → red test → B8-assert |
| `bug-lon` | hook → red test → B8-assert → B8-judge → **spec-check (fresh)** → **reviewer** |
| `feature` | hook → acceptance test → B8-assert + design-verify → spec-check → tech+impact → reviewer |

`pass` **không** đẩy lên Telegram. Chỉ `caught`, `false-positive`, `error`.

### 7.3 Luật ensemble — cổng LLM đơn lẻ KHÔNG tự chặn *(giải BLOCKER 4)*

Ba cổng mạnh nhất (`spec-check`, `reviewer`, `design-judge`) đều là LLM, và hiện đều là
Claude chấm Claude (chưa có codex). Chúng độc lập về **context**, không độc lập về
**failure mode** — cùng họ model, cùng thiên kiến "trông hợp lý là được".

Đối chứng ngay trong repo: `CLAUDE.md` của gstack quy định ensemble **2-trong-3 mới BLOCK**,
và *"single-layer high confidence degrades to WARN"*.

**Luật cho lane `bug-lon` và `feature`:**

| Tình huống | Xử |
|---|---|
| Cổng `deterministic` báo lỗi | **BLOCK** — chặn thật, tự sửa |
| **≥2** cổng `llm` khác nhau cùng nêu một finding | **BLOCK** |
| **1** cổng `llm` đơn lẻ báo động | **WARN** → đẩy lên anh, **không tự chặn, không tự sửa** |

Và theo dõi tỉ lệ `caught` theo `gate_family`. Nếu `llm` chiếm > 80% thì trust đang đứng
trên một chân — đó là tín hiệu phải dựng thêm cổng deterministic, không phải tín hiệu tốt.

### 7.3b Ba bài học cấu trúc, rút từ vòng review Wave 1 (12/08)

Cổng `/review` chạy trên ~9000 dòng do 4 agent viết song song, khi **339 test đang xanh**.
Nó bắt được 3 lỗi critical. Cả ba đều thuộc loại test không bắt được, và cả ba đều nằm ở
**chỗ giao nhau giữa hai component do hai agent khác nhau viết** — không agent nào thấy code
của agent kia. Đó là bằng chứng đầu tiên, trên chính hệ này, cho luận điểm của eivno:
*"reviewing is the cheaper detector."*

**1. Một directive trong prompt không phải một hàng rào.**
Write scope từng được cài bằng một câu trong system prompt, cộng một docblock nói *"the hook
layer enforces it"* — trong khi `GSTACK_MANAGER_SCOPE` có **một chỗ ghi và không chỗ nào đọc**.
Chỗ nguy hiểm không phải là thiếu hàng rào, mà là **cái comment khiến người đọc sau tin rằng
có**. Đã vá: `pre-tool-use-guard.sh` đọc biến đó và `exit 2` khi `file_path` nằm ngoài scope,
cộng tripwire tĩnh để CI đỏ nếu ai gỡ ra.

*Giới hạn còn lại, ghi cho trung thực:* guard chỉ soi `tool_input.file_path`, tức chỉ phủ
Edit/Write. **Đường ghi đi qua Bash không được phân tích và không bị chặn.** Văn bản shell
không thể phân tích ra đường đích một cách đáng tin, và giả vờ chặn được còn tệ hơn khe hở
thành thật. Bash vẫn bị chặn bởi denylist lệnh và bởi cwd, không bởi scope.

**2. Một cổng deterministic được TỰ KHAI không phải bằng chứng deterministic — nó là một lời
nói của LLM *về* bằng chứng deterministic.**
Manager từng nhận `gates[]` thẳng từ JSON của agent, gồm cả `gate_family`. Một model muốn xong
việc khai được `{gate:"tsc", gate_family:"deterministic", verdict:"pass"}` mà chưa từng chạy
`tsc`. Luật ensemble §7.3 và điều kiện mở P8 (`deterministic ≥ 20%`) khi đó đứng trên **con số
do chính thứ đang bị đo cung cấp**.

Đã vá bằng đối chứng: hook ghi `guard`/`lint`/`tsc` qua đường agent không giả được, và mọi
gate agent khai là `deterministic` phải có chứng từ khớp trong gate log — không có thì **hạ
xuống `llm`**. Luật chung rút ra: **mọi con số dùng để mở tự trị phải đến từ một kênh mà thứ
đang được đo không ghi vào được.** Cùng một lý do lấy mẫu mù (§3.2) tồn tại.

**3. Lỗi đồng thời sống ở điểm `await`, và test xanh không nhìn thấy chúng.**
`acquire()` đăng ký waiter *sau* khi vào hàng đợi; giữa hai bước có một `await` thật. Một
`release()` rơi đúng khe đó ghi task thành holder rồi đánh thức **không ai**, và vì
`browser-token` chỉ có một, mọi task cần Chrome sau đó chết theo. Đọc mã bắt được; 339 test
xanh thì không.

### 7.4 Định tuyến verify

| Cần gì | Dùng | Tranh Chrome? |
|---|---|---|
| Assertion lặp lại được, song song N project | **runner của chính project** — `B8-assert` | ❌ |
| Login thật (Shopify Admin device-bound, Cloudflare) | **`/my-chrome`** (`B8-judge`) | ✅ 1 token |
| Debug runtime sâu — CDP, network, perf | **Chrome DevTools MCP** | ✅ 1 token |
| Chấm design (judge tự nhìn) | `/my-chrome` | ✅ 1 token |

### Ba luật về oracle, rút từ lần dò thật đầu tiên (eivno, 12/08)

**1. DÒ, đừng giả định.** Bản 1 và 2 của doc này viết "Playwright headless" như thể mọi
project đều có. **eivno KHÔNG có Playwright** — `.playwright-cli/` chỉ là console log và page
snapshot của một skill CLI tương tác, không một file test nào, không dependency, không config.
Oracle thật của eivno là **vitest + tsc + eslint, 93 file assertion**. Đặt tên một oracle
không tồn tại là một lời nói dối sống sót cho tới lúc có thứ gì đó thử chạy nó.
`oracle_kind` vì vậy là **vocabulary mở**, không phải enum đóng — `monthly-point-sync` chạy
35 case qua `node logic-test.cjs`, không khớp cái tên chuẩn nào cả.

**2. Test skip im lặng là oracle GIẢ, nguy hiểm hơn không có oracle.** Integration test của
eivno **skip không kêu** khi thiếu `TEST_DATABASE_URL`. Cùng repo, cùng commit, máy này chạy
(có `.env.test`), máy khác báo xanh mà không chạy gì. `oracle_available` phải trả lời
*"ở ĐÂY, BÂY GIỜ, nó có thật sự chạy không"* — không phải *"repo có test không"*. Manager phải
ghi số test **đã chạy**, không phải trạng thái pass/fail.

**3. Coverage không đều thì tự trị cũng không đều.** eivno: 72/93 file assertion nằm ở tầng
service, **frontend chỉ 2**. Nghĩa là issue UI ngoài hai component đó gần như không có lưới —
và đó đúng là chỗ ca calibration nguy hiểm nhất đã lọt. Hệ quả cho P8: **tự trị mở theo
`(project, lane, vùng code)`, không phải theo `(project, lane)`.**

---

## 8. Phase plan

**Thứ tự đã đổi sau red team.** Tuần 0 và P2 (bản rẻ) đứng trước mọi thứ; P6 (đo oracle)
chạy song song chứ không xếp cuối.

| P | Tên | Phụ thuộc | Ước lượng |
|---|---|---|---|
| **T0** | Kiểm chứng — tiền đề, router tay, kiểm kê assertion | — | 7 ngày (chạy nền) |
| **P1** | Sổ cổng + lấy mẫu mù | — | ~1 ngày |
| **P2** | **Bản rẻ**: bot → 1 session + file task | P1 | ~2 ngày |
| **▣** | **CỔNG QUYẾT ĐỊNH** (§4) | T0, P2 chạy 1-2 tuần | — |
| **P3** | Làn verify song song hoá được | T0.3 | 1-4 ngày *(phụ thuộc kiểm kê)* |
| **P4** | Envelope + router | T0.2, P1 | ~2 ngày |
| **P5** | Manager core | P1, P3, P4 | ~4-6 ngày |
| **P6** | Oracle hardening + đo | P1 | ~4-6 ngày — **song song P5** |
| **P7** | Telegram đầy đủ | P5 | ~2-4 ngày |
| **P8** | Tắt review theo lane | P1+P6, ≥3 tuần mẫu mù | mở dần |

*Ước lượng đã nhân đôi so với bản 1 (giải #12): đây là hạ tầng chạy không người trông, có
quyền ghi repo và tiêu tiền. Phần đuôi — crash recovery đúng, token rò, khoá mồ côi, trạng
thái hỏng nửa chừng — thường gấp 2-3 lần happy path.*

### P1 — Sổ cổng + lấy mẫu mù
**Deliverable:** `bin/gate-log` (schema §3.3, có `gate_family` + `review_depth`); nối vào
`pre-tool-use-guard.sh` (mỗi lần chặn — hiện **không log gì**), `stop-full-check.sh` (mỗi
`exit 2`), bước đóng A8/B9; cơ chế quay xổ số mẫu mù 1/5.
**DoD:** chạy một task tay trọn vẹn → gate log đủ dòng, đọc lại ra được "cổng nào bắt gì,
trong điều kiện quan sát nào"; xổ số mẫu mù chạy được và không lộ trước.

### P2 — Bản rẻ
**Deliverable:** Telegram bot §4, allowlist chat-id, token trong `.env`, 4 loại tin §10.2,
approval bắt buộc cho việc không đảo ngược, `/stopall`.
**DoD:** giao một task từ điện thoại, nhận báo cáo, gật commit; chat-id lạ bị từ chối + ghi
log; lệnh push từ Telegram bắt buộc qua approval.

### P3 — Làn verify
**Hình dạng phụ thuộc T0.3.** Project đủ assertion → xây tách `B8-assert`/`B8-judge` + token.
Project thiếu → **P3 với project đó là viết assertion**.
**DoD:** đo trên **repo thật**, không phải fixture — 3 task cùng chạy `B8-assert` đồng thời
không tranh nhau; `B8-judge` xếp hàng đúng.

### P4 — Envelope + router
**Deliverable:** skill `/size-issue` trả envelope §3.1 (JSON, có validator từ chối thiếu
field); ánh xạ lane; 4 luật ghi đè §7.1.
**DoD:** rubric đã qua T0.2; 10 issue mới → sai ≤2.

### P5 — Manager core
**Deliverable:** §6 đầy đủ — daemon+CLI, state, spawn, concurrency, model routing, trần
chi phí p90, brainstorm, crash recovery, scope theo project, `/stopall`.
**DoD:** `manager run kivora t105` chạy trọn vòng đời §5; giết daemon giữa chừng rồi bật lại
→ reconcile đúng, không token mồ côi; agent của repo A không ghi được vào repo B.

### P6 — Oracle hardening + đo *(song song P5)*
**Deliverable:**
- **Planted-bug fixture cho chính cổng của mình** — 10-15 bug đã fix thật (git history +
  `design-eye §D1`, pattern 21 và 22 có cột "Gặp" = 1). Dùng lại `outcomeJudge` trong
  `test/helpers/llm-judge.ts` và format `test/fixtures/qa-eval-ground-truth.json`.
- **Cưỡng chế red test** — B5 hiện chỉ là prose. Test viết *sau* fix luôn xanh và **không
  chứng minh gì**. Loop phải lưu output lần chạy đỏ trước khi sửa, B8 đối chiếu.
- **Baseline** kiểu `eval-baselines.json`, diff mỗi lần chạy để thấy oracle **tụt**.

**DoD:** có `detection_rate` + `false_positives` thật cho từng cổng, thay con số đi mượn
`~60-70%` đang nằm trong `workflow.md`.
**→ ĐẠT 13/08** cho phần đo (bảng ngay dưới, cả 6 cổng đều có số thật). **Còn nợ**: cưỡng chế
red test — B5 vẫn chỉ là prose, chưa lưu output lần chạy đỏ để B8 đối chiếu.

#### Kết quả đo — 19 fixture từ lỗi THẬT (12/08, đo lại đầy đủ 13/08)

Fixture lấy từ git history của repo này, `design-eye §D1` (pattern 21/22, cột "Gặp" = 1), và
chuỗi T-124 → T-148 trong `DEBT.md` của eivno. **19/19 verify đỏ trên `buggy`, xanh trên
`fixed`** — không fixture nào là mô tả suông.

| Cổng | family | detect | coverage | FP rate | **precision** |
|---|---|---:|---:|---:|---:|
| `guard` | deterministic | **0%** | 11% | 13% (1/8) | **0%** |
| `lint` | deterministic | 0% | 32% | 0% (0/6) | n/a |
| `tsc` | deterministic | 0% | 42% | 0% (0/8) | n/a |
| `red-test` | deterministic | 90% | 100% | 0% (0/19) | **100%** |
| `spec-check` | llm | 90% | 100% | **68%** (13/19) | **57%** |
| `reviewer` | llm | 72% | 95% | **44%** (8/18) | **62%** |

`precision` = `caught / (caught + false_positives)` — trong bao nhiêu lần cổng kêu "có bug"
thì thật sự có bug. Cột này thêm vào 13/08 vì **xếp hạng theo `detect` sẽ chọn nhầm cổng**,
xem hai đoạn ngay dưới bảng.

> **13/08 — đã bấm nút chạy, 24 phút, 19 fixture. Hai cổng LLM lần đầu có số.**
> Hai cổng từng gọi thẳng Anthropic SDK nên bắt buộc có `ANTHROPIC_API_KEY`. Giờ chúng chạy qua backend
> tách rời (`personal/oracle/lib/llm-backends.ts`): **cổng bằng `codex`** (auth từ
> `~/.codex/`), **chấm bằng `claude -p`** (auth subscription). Không có key nào
> trong env, cả lượt smoke 2 fixture lẫn lượt đầy đủ 19 fixture.
>
> Cái được lớn hơn tiền: **BLOCKER 4 vá được một nửa**. §7.3 nói ba cổng LLM độc
> lập về context nhưng không độc lập về failure mode vì cùng họ Claude. Giờ nửa
> sinh-report là openai, nửa chấm là anthropic. Mỗi lần chạy in ra cặp backend và
> **kêu lên khi hai nửa trùng họ**.
>
> Chạy thật hết **24 phút** (ước lượng trước đó ~28), ăn hạn mức CLI chứ không phải
> dollar API. Chạy: `ORACLE_LLM=1 bun test personal/oracle/`
> (`ORACLE_LLM_LIMIT=2` để smoke trước). Log đầy đủ — gồm danh sách false positive
> từng fixture kèm nguyên văn lý do của judge — cất ở
> `~/.gstack/manager/evidence/20260813/oracle-full.log`, vì lần chạy sau **ghi đè** bản gốc.

**Sáu điều đọc ra được, theo thứ tự quan trọng:**

1. **Cổng LLM báo bug ở bản ĐÃ SỬA gần bằng ở bản lỗi.** `spec-check` detect 90% nghe như
   cổng tốt nhất bảng — nhưng nó kêu ở **13/19 bản `fixed`**. Precision thật **57%**, so với
   **50%** của một cổng lúc nào cũng kêu "có bug". `reviewer` headline xấu hơn (72%) nhưng
   sức phân biệt (detect − FP) là **28 điểm** so với **22** của spec-check, tức nó là cổng
   *tốt hơn*. **Xếp hạng theo cột `detect` sẽ chọn nhầm cổng.** Cả hai còn xa ngưỡng
   `precision ≥ 90%` của P8 → LLM chain hiện **không đủ điều kiện mở autonomy cho lane nào**.
2. **`guard` sai cả HAI chiều — nhưng chiều FP đã vá được và có số chứng minh.** Nó vẫn bắt
   **0/2** fixture thật sự phá hoại: `git clean -fdx` đi thẳng qua denylist, `git add -A`
   trong đường deploy cũng vậy — cái thứ hai đặc biệt đáng nói vì `git add -A` bị CẤM rõ
   trong `CLAUDE.md` mà cổng không thấy. Chiều còn lại: FP từ **4/8 (50%) xuống 1/8 (13%)**
   nhờ commit `e6e1efae` tách denylist thành hard-block và ask, và thôi khớp chuỗi nằm trong
   nháy — ca `echo "...đừng dùng rm -rf ~"` mà benchmark ghi ngày 08/08 giờ đi qua được.
   *Caveat của chính phép đo: probe set dựng để ép precision, không phải traffic quan sát được.*
3. **`tsc` và `lint` bắt 0 — đúng như kỳ vọng, và đó mới là điểm.** Đây là những bug đã
   **lọt qua** chúng. Giá trị của `tsc` nằm ở cột **ratchet**: hai fixture mà bản vá thật siết
   kiểu (`twin-mapper-drift` T-124, `ignored-input-field` T-81) giờ làm `tsc` đỏ ở call site cũ.
   Đó là việc của tsc ở đây — **chặn tái phát, không phải phát hiện**.
   `applicable` của tsc nghĩa là **"fixture này là file .ts"**, KHÔNG phải "ground truth nói
   tsc phải bắt được" — đọc nhầm chỗ này thì `0/8` trông như cổng hỏng. Nó là câu trả lời đúng.
4. **`red-test` là cổng tốt nhất bảng, và giờ có cột để thấy điều đó**: detect 90% với
   precision **100%** — 17 lần kêu, 17 lần đúng. Nhưng 90% **KHÔNG phải detection rate**: mọi
   fixture đều là bug rốt cuộc đã được tìm ra và viết lại, nên đây là **cận trên của B5 khi đã
   có ticket**. Hai ca trượt là hai lớp không ticket nào mô tả. Runner in caveat này ngay cạnh
   số để không ai trích trần.
5. **`caught_by_nothing` từ 2/19 xuống 0/19 khi cổng LLM bật.** Hai ca cũ không ai bắt —
   `scope-drift-extra-endpoint` và `cross-surface-token-drift` — đúng là `spec-check` bắt,
   đúng lớp lỗi nó nhận là của mình. Giả thuyết "spec-check không bắt thì không gì bắt" giờ
   là **số đo chứ không phải kỳ vọng**. Đây là lý do không được bỏ cổng LLM chỉ vì precision xấu:
   nó là cổng DUY NHẤT phủ lớp scope-drift.
6. **`deterministic_catch_share` = 36%** (17 trong 47 lần bắt), so với ngưỡng P8 là ≥20%. Đạt —
   nhưng xem lưu ý P8 ngay dưới về việc con số này từng đọc ra 100% vì lý do sai.

**Một bug tìm thấy trong chính dụng cụ đo.** Lần chạy đầu báo *"tsc caught 0/8"* — **sai**:
tsc in path tương đối, matcher so path tuyệt đối, nên mọi lỗi biên dịch bị quy về không ai.
Chỉ lộ ra vì có người bơm một lỗi đã biết vào để thử phần quy trách nhiệm. Giờ mỗi lần chạy có
**canary**: một file hỏng sẵn phải bị gắn cờ *và* truy được về đúng path; canary im ⟹ cổng bị
đánh `error`, **không bao giờ đánh "0 catches"**. Cùng lớp lỗi với fixture
`silent-skip-without-env` — và nó sống trong chính cái máy đo. Đây là lý do §3.2 có lấy mẫu mù
và §7.3b có luật "kênh độc lập": **một phép đo im lặng sai trông y hệt một phép đo đạt.**

**Lưu ý khi đọc P8:** tỉ lệ "deterministic ≥ 20%" từng đọc ra **100%** — chỉ vì cổng LLM chưa
được đo, và bản kế hoạch này đã đoán trước là nó sẽ tụt khi đo. Đo 13/08: **36%**. Vẫn qua
ngưỡng, nhưng khoảng an toàn hẹp hơn nhiều so với con số cũ. Nguồn đúng cho tỉ lệ này lúc chạy
thật vẫn là gate log (P1), không phải file này.

### P8 — Tắt review theo lane
**Điều kiện mở** cho một `(project, lane)`:
- **≥15 task trong LÔ MẪU MÙ** (không phải tổng), `human_touches = 0` toàn bộ lô
- **`precision ≥ 90%`** cho mọi cổng trong chain, với **mẫu số nêu rõ**:
  `precision = caught / (caught + false-positive)` — *"trong những thứ cổng này nêu, bao nhiêu
  phần trăm đúng"*. Bản 1 viết `false_positive < 10%` mà **không nói mẫu số**; cách đọc kia
  (fp trên TỔNG số dòng, gồm cả `pass`) cho ra một cái ngưỡng mềm đến vô nghĩa vì `pass` luôn
  áp đảo. Chốt cách đọc thứ nhất.
- `caught` từ `gate_family: deterministic` chiếm ≥ 20% *(không để trust đứng một chân)*
- **Chỉ đếm dòng `origin: work`** — dòng `gate-test` không bao giờ vào công thức (§3.3)
- oracle chain đủ theo §7.2

**Phép đo thật đầu tiên (12/08), để đối chiếu về sau:** cổng `guard` — precision **71.4%**
(10 caught / 4 false-positive), tức FP chiếm 28.6% so với ngưỡng 10%. **Guard còn xa mới đủ
điều kiện tự trị, và giờ đó là một con số chứ không phải một cảm giác.** Trước khi có đường
đánh dấu, cùng cổng đó hiện 100% — con số đẹp duy nhất vì chưa ai đếm được cái sai.

> **Con số 71.4% này có TRƯỚC commit `e6e1efae`, và chưa đo lại.** Trên probe set 8 lệnh của
> oracle, cùng bản vá đó kéo FP từ 4/8 xuống 1/8 — nên precision thật của guard hôm nay gần
> như chắc chắn cao hơn 71.4%. Nhưng hai phép đo có **mẫu số khác nhau** (14 lệnh so với 8),
> nên không được suy con số này ra từ con số kia. Muốn có số mới thì phải chạy lại chính
> benchmark 14 lệnh. Chưa chạy — để nguyên số cũ còn hơn ghi một số suy diễn.

**Cách mở:** từng lane một, `trivial` → `bug-nho`. `bug-lon`/`feature` giữ review lâu nhất.
Tắt rồi mà lô mẫu mù có `human_touches > 0` → **bật lại ngay**, không thương lượng.

**Mức sẵn sàng theo surface:** `monthly-point-sync` sẵn nhất · Wishlist có Jest ·
**Joy backend 0 test → không vào lane tự trị cho tới khi có harness.** Với Joy, dựng test
harness backend **chính là** công việc bậc 3; emulator `:4012` đã chạy nên thiếu mỗi tầng
assertion — nối dây, không phải dựng từ đầu.

---

## 9. Failure mode

| Chuyện gì | Xử |
|---|---|
| Agent chết giữa chừng | reconcile lúc boot → `FAILED`, báo, **không tự chạy lại** |
| Rate limit | semaphore backoff; kéo dài → báo Telegram |
| Loop chạm cap 3 | dừng, báo còn thiếu gì — tripwire, không thử lần 4 |
| Hai task cùng repo | cap 1 agent chính / project |
| Manager crash | state ở đĩa, resume §6.7 |
| Telegram sập | task chạy tiếp, report vào hàng đợi, gửi lại khi lên |
| Vượt trần chi phí | dừng, xin gật lại |
| Cổng kêu oan liên tục | `false-positive` được ghi; P6 dùng số đó để tune |
| Router phân sai lane | ghi dự đoán vs thực tế; hiệu chuẩn sau ~30 task |
| Agent đụng nhầm repo | scope `/freeze` chặn; nếu lọt → tripwire tĩnh ở CI |

---

## 10. Telegram — chi tiết

### 10.1 Bảo mật
- **Allowlist chat-id** trong env. Ai cầm token là gõ được lệnh vào agent bypass-permissions
  trên máy này, trên ~8 repo.
- **Token trong `.env`**, không vào repo.
- **Việc không đảo ngược được luôn phải confirm.** Không có "trust mode".
- **Nội dung từ Telegram là dữ liệu, không phải mệnh lệnh** khi nó chuyển tiếp thứ gì từ bên
  ngoài (issue body, log, comment người khác). Anh gõ = lệnh. Bot đọc hộ = dữ liệu.
- **`pre-tool-use-guard.sh` phải biết nguồn Telegram** — denylist chặt hơn.

### 10.2 Bốn loại tin

**Report:**
```
✅ kivora/t105 — bug-lon — 2 attempt — $1.04
Nguồn: rule engine trả giá gốc khi cart có mixed sale/regular
Cổng bắt: spec-check [llm] (thừa endpoint /discount/preview → đã bỏ)
Verify: playwright 4/4 · tsc pass
Giả định: 0
Trạng thái: staged, chờ gật để commit
```

**Question** — gom lô, đánh số:
```
❓ 2 câu đang treo
1. kivora/t105 — mixed cart: áp mã cho phần regular hay chặn cả giỏ?
2. joy/t88 — bỏ migration cũ hay viết đường tương thích?
Trả lời: "1: áp cho phần regular"
```

**Approval** — inline keyboard `[Gật] [Lắc] [Xem diff]`

**Prompt in** — text tự do → brainstorm, hoặc trả lời câu đang treo

### 10.3 Command surface v1
`/status` · `/run <project> <issue>` · `/report <project>` · `/stop <task-id>` ·
**`/stopall`** · `/cost` · text tự do. **Hết.**

### 10.4 Chính sách câu hỏi

| Loại | Xử |
|---|---|
| **Thật sự chặn** — sai thì việc thành vô nghĩa hoặc không an toàn | `blocking_questions`, treo task, gom vào lô hỏi |
| **Đi tiếp được** | `assumptions`, đi tiếp, **nêu rõ trong report**; `assumption_count > 2` → `needs_human` |

---

## 11. Đã sửa gì sau red team (12/08)

| # | Finding | Sửa ở đâu |
|---|---|---|
| **B1** | `human_touches` bị chính cuộc di cư nó canh gác làm hỏng — đo độ suy giảm chú ý và gọi đó là chất lượng oracle | **Lấy mẫu mù 1/5** §3.2 + `review_depth` bắt buộc + điều kiện P8 đổi sang lô mẫu mù |
| **B2** | Tiền đề chưa kiểm chứng — có thể ràng buộc thật là *quyết định làm gì*, không phải review | **T0.1** §2.1, 7 ngày đo, có cổng đổi trọng tâm |
| **B3** | Không cân nhắc phương án rẻ hơn | **§4 bản rẻ** thành P2, đứng trước manager, có **cổng quyết định** |
| **B4** | Oracle chain là ensemble tương quan (Claude chấm Claude), không phải góc nhìn độc lập | **`gate_family`** §3.3 + **luật ensemble 2-trong-3** §7.3 + ngưỡng deterministic ≥20% ở P8 |
| **B5** | P2 cũ có thể giao ra hàng đợi rỗng — tách B8 mà không có assertion để chạy | **T0.3** kiểm kê §2.3; P3 đổi hình dạng theo kết quả; DoD đo trên repo thật |
| 6 | Trần chi phí lấy từ chính cái đang cần đo | §6.5 — bootstrap phẳng, sau đó **p90 actual** |
| 7 | P5 (đo oracle) xếp sau manager | **P6 chạy song song P5** §8 |
| 8 | Blast radius của chính manager | §6.8 — scope theo project (`/freeze`), **`/stopall`** từ điện thoại |
| 9 | Router chưa kiểm chứng trước khi xây | **T0.2** §2.2 — 30 phút, 10 issue, bằng tay |
| 10 | `assumptions` tích tụ âm thầm | `assumption_count` bắt buộc; **> 2 → `needs_human`** §3.1, §7.1 |
| 11 | Không có tiêu chí giết cả chương trình | **§0** — ba điều kiện, viết trước |
| 12 | Ước lượng lạc quan | §8 — nhân đôi |

---

## 11b. Trạng thái bàn giao — cuối ngày 12/08

**Đã xây xong Wave 1 + Wave 2 trong một ngày. `466 pass · 3 skip · 0 fail` trên 21 file.
CHƯA COMMIT GÌ, CHƯA PUSH GÌ.** 18 file dirty trong `git status`.

| Mảnh | File | Trạng thái |
|---|---|---|
| Sổ cổng + mẫu mù | `bin/gate-log`, `personal/manager/lib/gate-log.ts`, 3 hook | ✅ đang ghi dữ liệu thật |
| Manager core | `personal/manager/` | ✅ 7 finding review đã vá |
| Telegram bot | `personal/manager/telegram/` | ✅ chờ token |
| Router lane | `personal/skills/size-issue/` | ✅ calibrate eivno, lệch 2/15 |
| Đánh dấu FP | `personal/skills/gate-fp/` | ✅ guard precision **71.4%** |
| Đo oracle | `personal/oracle/` | ✅ 19 fixture, có canary |
| Chuỗi đóng + tách làn verify | `lib/closing-chain.ts`, `lib/assert-runner.ts` | ✅ `B8-assert` là chứng từ thật |

### Bốn việc chờ quyết định — cập nhật 13/08

**1. ✅ XONG — guard chia hai bậc.** Vunt chốt phương án hai bậc 13/08.

| Bậc | Xử | Gồm |
|---|---|---|
| **Chặn cứng** (`exit 2`) | không có đường vòng | `rm -rf /` · `rm -rf ~` · `rm -rf .` trần · `mkfs` · `dd of=/dev/` · SQL huỷ diệt **khi có client DB thật chạy nó** |
| **Hỏi rồi chạy** (`permissionDecision: "ask"`) | vunt quyết từng lần | `git push --force` · `git reset --hard` · `git clean -*f` · `git add -A` · `git add .` · `--no-verify` · `firebase deploy` · `npm publish` · `DELETE FROM`/`UPDATE … SET` qua client DB |

**Giảm ồn bằng cách bóc chuỗi trích dẫn, không phải neo vị trí.** Cả 5 lần bắt oan quan sát
được đều là chuỗi nguy hiểm nằm **trong dấu nháy hoặc thân heredoc** — lệnh đang NHẮC TỚI thứ
nguy hiểm chứ không LÀM nó. Nên guard bóc nháy/heredoc trước khi khớp. Ngoại lệ: lệnh tự nó là
vỏ shell (`bash -c`, `eval`, `| sh`) thì **không bóc**, vì lúc đó thứ trong nháy mới là lệnh
thật — nhờ vậy `bash -c "rm -rf /"` vẫn bị bắt.

*Neo vị trí khớp đã bị loại*: nó để lọt đúng ca `bash -c` đó.

**SQL không bóc nháy được** — nó LUÔN là tham số trong nháy. Phân biệt bằng thứ khác: có client
DB thật chạy nó hay không. `grep "DROP TABLE" migrations/` là văn bản; `psql -c "DROP TABLE x"`
là lệnh. Cùng một chuỗi, hai bản chất.

Test: **37/37 pass** cả ba kết cục, gồm 5 FP quan sát được (nay đều qua) và recall mới bắt được
(`bash -c`/`eval`/`| sh` bọc lệnh, `git clean -fdx`, `git add -A`).

**2. Khe Bash + chuỗi leo thang** — đang vá, hướng đã chốt. Ghi lại một điều **quan trọng hơn
phương án**: chỉ làm phần "duyệt" thì KHÔNG cắt được chuỗi, vì kho trạng thái duyệt cũng ghi
được qua đúng khe Bash đó — ai ghi được lệnh thì ghi được cả dấu duyệt cho nó. **Duyệt cho khả
năng nhìn thấy, không cho tính toàn vẹn.** Phần cắt thật là cấu trúc: chạy lệnh **không qua
shell**, từ chối metachar, và **allowlist** binary đầu lệnh thay vì denylist — vì denylist luôn
thua, đúng như guard đã chứng minh bằng số (bắt 0/2 lệnh phá hoại thật).

**3. Token Telegram + một vòng chạy thật** — vẫn chờ vunt (`@BotFather` → `/newbot`, xem
`personal/manager/telegram/README.md`), và một lần chạy thật để chốt tên tool MCP cho làn judge.

**4. ✅ XONG — `/sync-skills`.** Cả 8 chỗ link chuyển sang `MSYS=winsymlinks:nativestrict` +
verify `[ -L ]`, thất bại thì in `FAILED` kèm cách xử lý. Thêm mục Windows giải thích cái bẫy.
**Luật mới trong HARD GATES: một liên kết không phải symlink là THẤT BẠI, không phải phương án
dự phòng** — bản sao đông cứng tệ hơn mọi lỗi, vì nó chạy đúng cho tới lúc anh sửa file rồi
không có gì thay đổi và không có gì báo. Verify bằng cách ghi qua nguồn, đọc qua liên kết.

### Ba giới hạn đã biết, ghi rõ chứ không giấu

- **Làn `B8-judge` HIỆN KHÔNG CHẠY ĐƯỢC.** `allowedTools` là
  `['Read','Glob','Grep','Bash','Edit','Write','TodoWrite']` — **không một tool browser nào**.
  Manager trao `browser-token` cho một agent không có gì để lái Chrome. Cần một vòng chạy thật
  để chốt tên allowlist; agent xây phần này **từ chối đoán** một dòng trong danh sách quyền.
- **`red-test` luôn bị hạ xuống `llm`.** Manager không phân biệt được test đỏ viết TRƯỚC fix
  với test viết sau. Đóng được thì phải lưu output lần chạy đỏ rồi đối chiếu — đúng phần P6.
- **Hook row không mang task id.** Manager khớp theo cửa sổ thời gian + project, nên một session
  vunt tự mở trên cùng repo sẽ có dòng bị tính cho task.

## 11c. Tiếp tục trên MÁY KHÁC — đọc mục này trước

> Viết 13/08 khi chuyển máy giữa chừng. Doc này nằm trong repo nên nó đi theo;
> **worklog thì không.** Mục này là kênh bàn giao duy nhất đáng tin.

### Cái gì KHÔNG đi theo repo

Đây là chỗ dễ tưởng nhầm nhất — code sang được, nhưng phần lớn *trạng thái đã đo* thì không.

| Thứ | Ở đâu | Sang máy mới? |
|---|---|---|
| Toàn bộ code + doc này | repo | ✅ |
| **Sổ cổng** (`gate-log`) — gồm phép đo guard precision **71,4%** | `~/.gstack/gate-log/` | ❌ **máy-local**. Máy mới bắt đầu từ sổ RỖNG |
| Worklog / checkpoint | `~/.gstack/projects/<slug>/checkpoints/` | ❌ máy-local |
| `projects.json` + sổ duyệt lệnh assert | `~/.gstack/manager/` | ❌ máy-local. Phải đăng ký + duyệt lại từ đầu |
| Symlink skill/command/rules | `~/.claude/` | ❌ phải chạy `/sync-skills` |
| Đăng ký hook | `~/.claude/settings.json` | ❌ máy-local, phải dán lại |
| `node_modules` | repo (gitignored) | ❌ `bun install` |

**Hệ quả phải nhớ:** mọi con số trong doc này (`71,4%`, `28,6%`, bảng đo oracle) là **đo trên
máy cũ**. Đừng cộng dồn số của hai máy như một dãy — chúng là hai phép đo độc lập. Ngưỡng P8
tính theo từng máy cho tới khi có chỗ gộp sổ.

### Bốn bước đầu trên máy mới

1. `git pull` rồi `bun install`.
2. **`/sync-skills`** — và **đọc kỹ output**. Thấy `FAILED` thì bật Windows Developer Mode rồi
   chạy lại; thấy `REALDIR` ở skill lẽ ra phải là link thì đó là bản sao đông cứng từ lần
   trước, xoá rồi chạy lại. Chi tiết trong mục Windows của chính skill đó.
3. **Dán lại đăng ký hook** vào `~/.claude/settings.json` (4 hook: PreToolUse, PostToolUse,
   Stop, SessionStart + statusline). Hook tự suy ra repo từ vị trí script nên **không cần sửa
   path bên trong**, chỉ cần trỏ đúng checkout mới. Mẫu ở `personal/hooks/README.md`.
4. Kiểm tra guard còn sống, cả hai chiều — một hook không bao giờ kêu và một hook hỏng **nhìn
   giống hệt nhau**. Pipe JSON giả vào: một ca phải cho qua, một ca phải chặn, một ca phải hỏi.

### Trạng thái lúc bàn giao (13/08)

**Đã xong và đã push:** sổ cổng · manager core · Telegram bot (chờ token) · `/size-issue` ·
`/gate-fp` · `personal/oracle/` · chuỗi đóng A8/B9 + `B8-assert` · guard hai bậc ·
`/sync-skills` · cắt chuỗi leo thang qua `projects.json`.

**Test:** `bun test personal/manager/ personal/skills/size-issue/ personal/oracle/` →
**491 pass · 3 skip · 0 fail**. Đây là mốc; tụt là có hồi quy.

### Việc còn lại, xếp theo thứ tự nên làm

1. **Token Telegram** — `@BotFather` → `/newbot`, token + chat-id vào `.env`
   (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`). Xem
   `personal/manager/telegram/README.md`. **Chỉ vunt làm được.**
2. **Một vòng chạy THẬT** để chốt tên tool MCP cho làn `B8-judge`. Hiện `allowedTools` trong
   `personal/manager/config.ts` là `['Read','Glob','Grep','Bash','Edit','Write','TodoWrite']` —
   **không tool browser nào**, nên manager trao `browser-token` cho một agent không có gì để lái
   Chrome. Làn judge xây xong nhưng **chưa chạy được**. Không đoán tên allowlist; chạy thật một
   lần rồi xem agent xin tool gì.
3. **Cưỡng chế red test** (P6 còn nợ) — lưu output lần chạy đỏ TRƯỚC khi sửa rồi đối chiếu.
   Chưa có thì `red-test` mãi bị hạ xuống `llm` và ngưỡng deterministic của P8 khó đạt.
4. **Hai FP nhỏ đã biết trong `assert-runner.ts`**, cùng lớp "giảm ồn" của quyết định #1:
   `UNSAFE_COMMAND` từ chối `npx --no-install …` vì `-install` khớp regex; và `deno`/`make` có
   trong regex dò của `discoverFromClaudeMd` nhưng không có trong `RUNNER_ALLOWLIST`, nên project
   dùng chúng sẽ báo "không tìm thấy lệnh assert".
5. Chạy thử thật: `manager run <project> <issue>` với runner thật (tới giờ mới chỉ chạy mock).

---

## 12. Câu hỏi còn mở

- Agent chính: spawn theo task hay session thường trú? **Đề xuất: spawn theo task**, state ở
  file — rẻ hơn, không phình context, hợp nguyên tắc manager mỏng.
- Trần chi phí bootstrap cụ thể: bao nhiêu USD/task và USD/ngày trước khi có p90?
- "Chế độ tập lái" giữa P6 và P8: tắt review nhưng manager vẫn gửi diff để anh liếc, không
  bắt buộc trả lời — có đáng làm như bước đệm không?
- Grok/X search nối vào manager (brainstorm) hay agent chính (research lúc size)?
- ~~Cài lại codex?~~ **ĐÃ TRẢ LỜI 13/08: codex đã có sẵn trên máy** (`codex-cli
  0.147.0`, auth trong `~/.codex/`). Câu hỏi này mở suốt vì không ai kiểm tra lại
  — chính nó là lý do §11c bảo phải dò chứ đừng giả định. Tầng đo đã chuyển sang
  dùng codex. **ĐÃ ĐÓNG NỐT 14/08:** mặc định `reviewProvider` là `codex`, nên
  `spec-check` / `tech-review` / `impact-review` ở đường chạy thật là OpenAI chấm
  Claude. `reviewIndependence()` in ra cặp family lúc daemon khởi động và kêu khi
  hai nửa trùng family; một provider gõ sai trong config rơi về mặc định (codex)
  chứ không rơi về `opus-fresh` như trước — gõ nhầm một chữ không được phép âm
  thầm gỡ tính độc lập.
- **Chưa đóng, thuộc BLOCKER 4:** hai cổng judge (`B8-judge`, `design-judge`) vẫn
  là Claude. `roleForGate()` xếp chúng vào role `judge`, và orchestrator định
  tuyến `judge` sang `spawnPort` chứ không sang `reviewPort`. Đó không phải sơ
  suất: hai cổng này cần `browserTools` để mở trang thật, còn cổng codex chạy
  `sandbox: 'read-only'` và không lái được Chrome. Muốn chuyển thì phải có
  transport browser cho codex trước.
- Chi phí review giờ **không đo được bằng USD**: codex tiêu quota CLI chứ không
  phải dollar API. Mọi lượt review trả về `costKnown: false`, đếm vào
  `cost_unmeasured_runs` trên task, và **không** ghi `cost_usd` vào gate log —
  trần §6.5 đọc một con số thiếu chứ không đọc một con số bịa. Task nào có lượt
  chưa đo thì bị loại khỏi mẫu p90 (một cái sàn không phải một mẫu).
- **Hệ quả phải nói thẳng:** vì mọi task `bug-lon`/`feature` đều có lượt review
  chưa đo, hai làn đó **không bao giờ đủ mẫu để lên p90** khi còn chạy codex —
  chúng nằm mãi ở trần bootstrap. `laneCeiling` báo `rejected_partial` (đếm theo
  TỪNG làn) để chỗ đó hiện ra thành lý do chứ không thành một làn im lặng không
  bao giờ rời bootstrap. Bù lại, thứ chặn lượt chưa đo không còn là tiền mà là
  `maxUnmeasuredRunsPerTask` — nó chặn SỐ LƯỢT, không chặn tiền.
- **Một cổng không trả lời không phải một cổng không tìm thấy gì.** Hai cổng
  review cùng hỏng trả về đúng một chuỗi hằng của `parseVerdict`, và ensemble
  vốn khớp theo văn bản nên hai cái hỏng **tự xác nhận lẫn nhau** thành
  `block: "two llm gates agree"` — đúng câu §7.3 dành cho corroboration độc
  lập, trong khi chẳng cổng nào phán xử gì. Nay dòng `error` không tham gia
  cross-confirm; nó vào `broken`, và `phaseReview` park chờ người y như làn
  VERIFYING vẫn làm với oracle của nó.
- Ensemble ghi thêm `family` cho mỗi dòng llm. Hai cổng cùng family vẫn block
  (an toàn hơn), nhưng câu chữ nói rõ là cùng nhà — không được gọi đó là
  corroboration. Family không ghi được thì báo `không xác minh được`, không suy
  bừa là cùng nhà.

---

## 13. Mượn từ deepseek-harness

Nguồn: [`github.com/deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
— MIT, `dsh 0.1.0-rc.7`, đọc 21/08. Agent harness của DeepSeek, kiến trúc "everything is a
plugin" trên Cordis.

**Phần đáng mượn không phải runtime.** Nó là cách họ ép kỷ luật văn bản thành thứ CI kiểm
được: `AGENTS.md` phân tier có trần từ, `.agents/notes/` có vòng đời, `.agents/skills/`, và
~40 gate `verify-*`. Mục này ghi cái mượn, cái không, và chỗ nối vào phase — để lần sau khỏi
đọc lại 7.458 file.

### 13.1 Con trỏ chết trong văn bản vĩnh viễn — phép đo đầu tiên

Bệnh có tên trong repo đó: **chain-of-thought leakage** — văn viết từ điểm nhìn của phiên làm
việc chứ không phải của repo. Một câu test: *người đọc ở HEAD, không có transcript hay draft
chưa commit, có resolve được mọi tham chiếu không?*

**Đo trên `05df5126`, máy này, chỉ mặt phẳng nguồn** (loại `node_modules/`, bản SKILL.md sinh
ra cho 9 host, fixture ghi sẵn):

| Dạng | Số site | Kết luận |
|---|---|---|
| `plan §X` trống chủ ngữ | **27** (21 ngoài mục này) | chết — trỏ vào `~/.gstack/.../ceo-plans/`, **không tồn tại trên máy này** |
| Ordinal trần `(D4)` `(D8)` `per D1` | **96** (90 ngoài mục này) | chết — không file nào trong repo trả lời `(D4)` là gì |
| `plan §X` có nêu path plan | **11** | resolve tốt — **khuôn đúng** |
| `design-eye §D1` | **12** | resolve tốt — **khuôn đúng** |
| `Source: this branch's ...` trong CHANGELOG | **6** (26 dòng mang điểm nhìn branch) | vi phạm luật CHANGELOG của chính repo |

**Mục 13 này tự khớp 6 + 6 lần** qua chính các ví dụ nó trích, và góp 1 vào cột keep. Đọc
chúng là bằng chứng, không phải là dùng sai — cùng cách deepseek xử lý note sở hữu luật của
họ. Hệ quả: **sửa mục này là số đổi.** Đo lại sau mỗi lần sửa, đừng chép số cũ.

Lệnh chạy lại. Dụng cụ là **`git grep`** — `ripgrep` KHÔNG có trên máy này (`rg` chỉ là shell
function do Claude Code nạp, `which rg` không ra path), nên một lệnh viết bằng `rg` là con trỏ
chết ngay trong mục nói về con trỏ chết. `git grep` còn khớp đúng định nghĩa cần đo: chỉ file
đã commit, tức đúng thứ người đọc ở HEAD nhìn thấy.

Mẫu số là **số site khớp**, không phải số dòng prose, và nó phụ thuộc hoàn toàn vào tập loại
trừ, nên tập đó hiện ra chứ không giấu trong flag:

```sh
SCOPE=(':(exclude).*/**' ':(exclude)test/fixtures/golden/**'
       ':(exclude)CHANGELOG.md' ':(exclude)TODOS.md')

git grep -nE '(^|[^-a-z])plan §' -- $SCOPE \
  | grep -Ev 'manager-layer plan|validate\.test\.ts' | wc -l   # 27
git grep -noE '\(D[0-9]+\)|per D[0-9]+' -- $SCOPE \
  | grep -v design-eye | wc -l                                   # 96
git grep -nE 'manager-layer.plan.*§'   -- $SCOPE | wc -l         # 11  (keep)
git grep -noE 'design-eye §D[0-9]'     -- $SCOPE | wc -l         # 12  (keep)
git grep -ci 'Source: this branch'     -- CHANGELOG.md           # 6
```

`:(exclude).*/**` gom mọi thư mục host sinh ra (`.claude/skills/`, `.factory/`, `.slate/`,
`.opencode/`, `.kiro/`, `.cursor/`, `.gbrain/`, `.hermes/`, `.openclaw/`, `.agents/skills/`)
thành một dòng. Mảng `SCOPE` là cú pháp zsh; bash thì bỏ ngoặc và dùng `$SCOPE` không nháy.

**Khuôn đúng đã có sẵn trong repo — hai cái, cùng nằm ở nửa `personal/`.** Cả hai đều trích
một file **đã commit**, bằng path hoặc bằng tên tìm được:

```
✅ personal/manager/lib/gate-log.ts:4
     Schema is the data contract in `personal/docs/manager-layer-plan-2026-08-12.md` §3.3.
✅ personal/skills/my-frontend-fix/SKILL.md:78
     mở bảng pattern §D1 (design-eye §D1)
❌ browse/src/security.ts:34
     See plan §"Threshold Spec" for calibration methodology.
❌ browse/src/browser-manager.ts:423
     faking those to fixed values flags more bot-like, not less (D7).
```

Nặng nhất là `security.ts:34`: ba ngưỡng an ninh `BLOCK 0.85 / WARN 0.75 /
SOLO_CONTENT_BLOCK 0.92`, và lý do chọn chúng nằm sau một con trỏ chết. Ai chỉnh ngưỡng sáu
tháng nữa sẽ chỉnh mù. Phần lớn số site còn lại rẻ hơn nhiều — mệnh đề sự kiện **đã nằm ngay
sau citation**, xoá citation là xong.

**111 site là một pattern hệ thống, không phải vài chỗ lỡ tay.** Nó là dạng bệnh riêng của
văn do agent viết: lúc viết, agent đang giữ cả design session trong context nên `(D7)` hoàn
toàn rõ ràng — với chính nó, ngay lúc đó. Và harness này ship prose cho **9 host adapter** cộng
ClawHub cộng `~/.claude/skills/gstack/` trên máy khác; mọi reader đó đều là "người đọc ở HEAD
không có transcript". Ở đây nó là lỗi đúng-sai của thứ đang ship, không phải chuyện văn phong.

**Luật rút ra, dạng dùng được:** văn bản vĩnh viễn chỉ trích artifact **đã commit**. Ordinal
của phiên làm việc ở lại trong phiên. Nêu path một lần mỗi file, các lần sau dùng tên tìm
được. Ba kho quyết định hiện tại — `decisions.jsonl`, `ceo-plans/`, `~/.gstack-dev/plans/` —
đều máy-local, nên trích chúng **không** sửa được gì; quyết định phải hạ cánh vào một file
đã commit (`personal/docs/` hoặc `docs/designs/`) trước khi code được phép trích.

**Giới hạn đã biết:** 4 site `plan §` và 12 site ordinal đã mở ra đọc — cả 16 đều chết đúng
như pattern đoán. Số còn lại phán theo pattern, chưa mở từng cái, nên **111 là cận trên**. Chưa
đo lại sau `05df5126`.

**Một luật về chính cách đo:** batteries chạy lần đầu ra **zero hit** vì biến shell làm hỏng
glob — suýt báo "repo sạch". Đúng luật của họ: *một pattern không khớp gì không chứng minh gì
cho tới khi thấy nó khớp một chuỗi biết chắc là dương.* Áp cho mọi cổng grep trong sổ cổng.

### 13.2 Ba thứ mượn — xếp theo ROI

| Mượn gì | Nó làm gì | Nối vào đâu |
|---|---|---|
| **Skill `/trim-leak`** | Một câu test + taxonomy 8 loại + keep-rules + 4 bẫy cắt-hỏng. Bắt loại văn mà chỉ phiên viết ra nó mới đọc được | Việc độc lập. Chạy trước, purge sau, gate cuối — gate viết trước purge sẽ đỏ 40 chỗ ngay rồi bị tắt |
| **Luật "quyết định phải hạ cánh trước khi được trích"** | Trị gốc của §13.1 | Ràng buộc lên chính doc này và `docs/designs/` |
| **Bộ đếm tool-call lặp thành hook** | Đếm call liên tiếp trùng argument đã canonicalize, ngưỡng `[3,5,8]`, inject nhắc leo thang. **Không veto, không block** — quyết định vẫn của model | **P1/P8.** Đây là một cổng `gate_family: deterministic` thuần: không token, không oracle, cộng thẳng vào sàn ≥20% mà P8 đòi. Cơ khí hoá tripwire "3-4 lần fail cùng một thứ thì DỪNG" đang dựa vào model tự nhớ |

### 13.3 Nhặt lẻ

- **`## Alternatives considered` bắt buộc trong mọi decision record.** Lý do họ ghi: *một quyết
  định ghi lại mà không kèm cái nó đã thắng thì mời người ta cãi lại.* `decisions.jsonl` hiện
  ghi "đã quyết gì", không ghi "nó thắng cái gì".
- **Vòng đời note:** `proposed` → `implemented` → `rejected` → `archived`. `implemented` viết ở
  **thì hiện tại, mô tả cái đã ship**; gate của họ từ chối `## Proposal` / `## Migration plan`
  trong một note đã implement. `archived` đông cứng, có hash, **không được coi là authority cho
  hành vi hiện tại**.
- **Công thức counterfactual-present**: `"without the byte-length guard, X double-encodes"` thay
  cho `"this used to double-encode"`. Giữ được thông tin regression mà không thành khảo cổ repo.
- **Chữ `measured` là load-bearing.** `security.ts:220` ghi đủ (`25 TPs, 0 FPs`);
  `security-classifier.ts:446` ghi `~70%` không nguồn — không ai đo lại trước khi tune. Cùng
  một luật với `71,4%` ở §8/P8.
- **"Verify the world, not the self-report"**: e2e phải chạy lại lệnh / đọc lại file **từ
  ngoài**; probe từ khoá trên output của chính agent là để nó gian lận qua. Đúng tinh thần
  `B8-assert`, viết thành một câu.
- **"This skill is guidance, not a checklist"** đặt trong mọi skill — chặn agent đọc skill như
  bash script.
- **Model Experience**: mỗi package khai *model thấy gì / tốn token thế nào / **có phá KV cache
  không***, có gate ép. Phần KV cache là thứ chưa ai đo ở đây.
- **Spill**: tool output quá lớn ghi ra file, trả locator + gợi ý cách lấy lại, không nhồi vào
  context.
- **Sửa từ owner trước**: `SKILL.md` sinh từ `.tmpl` — vá bản `.md` sẽ bị `gen:skill-docs` ghi
  đè. `sync-gbrain` hiện dính lỗi ở **cả hai** bản.

### 13.4 Không mượn

Song ngữ EN/ZH có hash gate · per-file 100% coverage · Cordis. Quá nặng cho một người.

### 13.5 Chỗ plan này đã đi trước — đừng "cải tiến" ngược

Repo đó **không có một con số nào**: zero eval, zero benchmark, `BENCHMARK.md` dài 231 byte.
Toàn kiến trúc và kỷ luật văn bản, không có bằng chứng nó làm agent tốt hơn.

Bốn thứ ở đây mạnh hơn, và không được đánh đổi lấy thứ gì trong §13.2–13.3:

- Tiêu chí giết viết trước, lúc còn khách quan (§0)
- Precision có nêu mẫu số, và ghi rõ cách đọc kia bị loại vì sao (§8/P8)
- Từ chối cập nhật `71,4%` bằng suy diễn vì hai phép đo khác mẫu số (§8/P8)
- Nói thẳng cái gì không đi theo repo, thay vì để người sau tự vấp (§11c)

**Lấy kỷ luật văn bản của họ. Không lấy thói quen không đo.**

### 13.6 Một điều về chính mục 11b/11c/12

Chúng đang tích lũy lịch sử phiên bản của bản thân — `Bản 1 bị 5 blocker`, `cập nhật 13/08`,
`~~Cài lại codex?~~ ĐÃ TRẢ LỜI 13/08`, `ĐÃ ĐÓNG NỐT 14/08`. Vẫn dùng được, nhưng doc đang trôi
từ **decision record** sang **nhật ký của chính nó** — đúng thứ luật `implemented` ở §13.3 cấm.

Chưa cần đụng. Khi có thêm vài lớp "cập nhật ngày X" nữa thì tách, và luật supersession cho
cách tách mà không mất rationale: chuyển mọi lý do, phương án, hệ quả, bằng chứng đã ship sang
chủ sở hữu mới rồi mới xoá bản cũ; sửa mọi link trỏ vào. Giữ cả hai và nối chéo nếu chỉ thay
thế một phần.

---

## 14. `/explain-diff` — cổng đặt lên người, không đặt lên code

Nguồn: Geoffrey Litt, [_Understanding is the new bottleneck_](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck)
(02/07/2026), lưu trong `personal/tech-digest/saved.md` mục 5. Skill gốc:
[gist `geoffreylitt/a29df1b5f9865506e8952488eac3d524`](https://gist.github.com/geoffreylitt/a29df1b5f9865506e8952488eac3d524),
hai biến thể xuất HTML hoặc Notion.

### 14.1 Vì sao nó chạm đúng BLOCKER 1

Luận điểm của Litt: khi viết code đã rẻ, nút thắt chuyển sang **hiểu** code agent vừa đẻ ra.
Không phải để verify — agent tự kiểm khá tốt — mà để **còn tham gia được vào vòng lặp**. Không
hiểu thì tích **cognitive debt**, và tới lúc cần dẫn dắt dự án thì không dẫn được.

Plan này đã đặt tên đúng nửa vấn đề từ 12/08. BLOCKER 1 (§11): *`human_touches` bị chính cuộc
di cư nó canh gác làm hỏng — đo độ suy giảm chú ý rồi gọi đó là chất lượng oracle.* Cách vá:
mẫu mù 1/5 + `review_depth` bắt buộc (§3.2).

**Nhưng `review_depth: "full-diff"` là một lời tự khai.** Người đọc lướt full diff, không thấy
gì, ghi `human_touches: 0` — và dòng đó đọc thành *"cổng tốt"* trong khi nó có thể là *"tôi
không thực sự đọc"*. Hai trạng thái khác hẳn nhau, cùng một dòng log. Litt gọi đúng tên:

> fool yourself into thinking you did the reading when you really didn't retain or understand

Và luật vừa mượn ở §13.3 nói thẳng điều kiện để không bị lừa: **verify the world, not the
self-report.** `review_depth` hiện là self-report. Quiz là the world.

### 14.2 Skill làm gì

Bốn phần, xếp theo thứ tự sư phạm — nền trước, trực giác giữa, chi tiết sau:

| # | Phần | Nội dung |
|---|---|---|
| 1 | **Background** | hệ thống đang có, phần liên quan tới thay đổi — dạy nền TRƯỚC khi nói thay đổi |
| 2 | **Intuition** | mục tiêu + khái niệm cốt lõi bằng toy data và hình, **trước khi hiện code** |
| 3 | **Code** | *literate diff*: đi qua thay đổi theo thứ tự có nghĩa, prose bao quanh, snippet nhúng |
| 4 | **Quiz** | 5 câu trắc nghiệm mức trung bình, **random thứ tự đáp án độc lập từng câu**, distractor dài tương đương và hợp lý |

Xuất một file HTML self-contained (CSS + JS inline), `/tmp/YYYY-MM-DD-explanation-<slug>.html`.
Litt in ra giấy đọc ngoài quán — *"AI turns an interactive activity into a static paper report
I can focus on deeply."* Biến thể cộng đồng chuyển quiz sang chat: hỏi **từng câu một**, tự
luận, chấm theo nội dung — khó đoán mò hơn trắc nghiệm.

Đối lập mà nó nhắm tới: *"a typical diff is a pile of files edited in alphabetical order with
no explanation."*

**Quiz là cái van, không phải phần trang trí:**

> A quiz is a speed regulator. Working with AI, it's easy for the loop to run faster than the
> speed of human understanding.

Luật cá nhân của Litt: *"I won't send code to others until I can pass the quiz."* Và ông vẫn
đọc diff — *"I still read the code diff but I always read this first."* Đây là thứ đọc **trước**
diff, không phải thứ thay diff.

### 14.3 Nối vào đâu

| Chỗ nối | Đổi gì |
|---|---|
| **§3.2 mẫu mù** | Task trúng xổ số chạy `/explain-diff` **trước** khi đọc diff, rồi làm quiz. `review_depth` thêm giá trị thứ ba: `full-diff+quiz` |
| **§3.3 gate log** | Thêm `quiz_score` (`n/5`, rỗng khi không chạy). Không có điểm thì `review_depth: "full-diff"` vẫn chỉ là tự khai như cũ |
| **`gate_family`** | Family thứ ba: **`human`**. Mọi cổng hiện tại — `deterministic`, `llm` — đo **output của agent**. Cái này đo **hiểu biết của người vận hành**. Khác chủ thể, cùng kỷ luật |
| **§8 / P8** | Xem §14.4 |
| **§0 tiêu chí giết** | Xem §14.4 |

**Ba ràng buộc thiết kế, chốt trước khi xây:**

1. **Không chạy mọi task.** Chỉ lô mẫu mù (1/5) và lane vừa tắt review theo P8. Một lượt
   `/explain-diff` là một lệnh gọi model sinh ra trang HTML dài — tốn thật, và §6.5 đã có trần
   chi phí, codex đã làm `costKnown: false`. Chạy mọi task là tự bơm nhiễu vào đúng chỗ đang
   thiếu mẫu.
2. **Quiz không chặn agent, nó chặn người.** Agent cứ chạy tiếp. Cái bị chặn là `git push` /
   merge — đúng lằn ranh §1 đã vạch: việc không đảo ngược được thì cần anh gật. Nay "gật" có
   thêm một điều kiện đo được.
3. **Agent sinh đề, người trả lời.** Agent chấm được vì đề nó sinh có đáp án, nhưng **người phải
   là bên trả lời** — agent tự làm quiz của chính nó rồi ghi `pass` thì cả cơ chế thành vô
   nghĩa, y hệt luật ensemble §7.3 cấm một model tự xác nhận mình.

### 14.4 P8 đang thiếu một điều kiện

Điều kiện mở lane hiện tại (§8/P8): ≥15 task mẫu mù `human_touches = 0` · `precision ≥ 90%` ·
`deterministic` chiếm ≥20% `caught`.

**Cả ba đều đo máy.** Không cái nào chặn được viễn cảnh này: máy chạy đúng hết, ba số đều xanh,
và người vận hành **không còn hiểu hệ thống mình đang chịu trách nhiệm**. Tới lần đầu có sự cố
nằm ngoài vùng phủ của cổng, người không đỡ được — mà đó chính là lúc cần người.

Tiêu chí giết ở §0 cũng vậy: thời gian bỏ ra, `human_touches` trong lô mẫu mù, số lần phải sửa
tay sau khi agent báo xong. Ba điều kiện đều đọc XANH trong viễn cảnh trên.

**Đề xuất: điều kiện thứ tư, đo trên lô mẫu mù, và nó là điều kiện có thể ĐÓNG lane lại** — y
như luật hiện hành *"tắt rồi mà lô mẫu mù có `human_touches > 0` → bật lại ngay, không thương
lượng"*.

**Chưa đặt ngưỡng.** Không có phân bố thì mọi con số đều là bịa — đúng luật §8/P8 đã áp cho
`71,4%`. Phải chạy tay vài lượt lấy phân bố trước, xem §14.5.

### 14.5 Trạng thái bằng chứng — nói thẳng

Bài của Litt là **n = 1, không có số**. Trải nghiệm cá nhân, không benchmark, không đối chứng.
Bài **không** nói chi phí một lượt, **không** nói mất bao lâu, **không** nói khi nào không nên
dùng. Cái duy nhất cụ thể là cấu trúc 4 phần và luật cá nhân "chưa pass quiz thì chưa gửi code".

Ghi đúng như vậy, cùng cách CLAUDE.md ghi về codex-as-builder: **một cái cược vào việc chia vai
là đúng, không phải một kết luận từ dữ liệu.**

**Đo trước khi ràng buộc.** Chạy tay trên 3-5 task mẫu mù và ghi lại:

- một lượt tốn bao nhiêu (token, USD nếu đo được) và mất bao lâu để đọc + làm quiz
- điểm quiz phân bố thế nào khi anh **thật sự** đã đọc diff
- có lần nào bắt được chỗ anh tưởng đã hiểu mà không hiểu không — **đây mới là con số đáng
  giá**, không phải điểm trung bình

Chưa có ba thứ đó thì `/explain-diff` là công cụ đọc, chưa phải cổng. Đừng nối vào P8 sớm.

### 14.6 Ba thứ khác trong bài, chưa lấy

- **Micro-worlds** — debugger và command center tương tác để hiểu bằng tay (tinh thần Papert).
  Gần với hướng `gstack browser` + inspector đã có, nhưng là việc riêng.
- **Shared spaces** — không gian chung cho cả nhóm dựng mental model chung. Chưa hợp: harness
  này đang là một người.
- **In ra giấy đọc offline** — rẻ, thử được ngay, không cần xây gì.
