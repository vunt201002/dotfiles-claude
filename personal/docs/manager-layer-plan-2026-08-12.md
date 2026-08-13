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
- **Daemon nhẹ** `manager daemon` + **CLI**: `manager run|status|stop|stopall|report|cost`
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

### 6.3 Concurrency và tài nguyên khan hiếm

| Tài nguyên | Cap | Cơ chế |
|---|---|---|
| Agent toàn cục | `min(8, cores-2)` | semaphore sẵn có |
| Agent chính / project | **1** | khoá theo `project` |
| Chrome thật (`/my-chrome`, DevTools MCP) | **1 token toàn cục** | FIFO, `holds: ["browser-token"]` |
| Playwright headless | không giới hạn | không tranh Chrome |

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

#### Kết quả đo lần đầu — 19 fixture từ lỗi THẬT (12/08)

Fixture lấy từ git history của repo này, `design-eye §D1` (pattern 21/22, cột "Gặp" = 1), và
chuỗi T-124 → T-148 trong `DEBT.md` của eivno. **19/19 verify đỏ trên `buggy`, xanh trên
`fixed`** — không fixture nào là mô tả suông.

| Cổng | family | detect | coverage | FP rate |
|---|---|---:|---:|---:|
| `guard` | deterministic | **0%** | 11% | **50%** (4/8) |
| `lint` | deterministic | 0% | 32% | 0% |
| `tsc` | deterministic | 0% | 42% | 0% |
| `red-test` | deterministic | 90% | 100% | 0% |
| `spec-check` | llm | — | — | **CHƯA ĐO** (thiếu API key) |
| `reviewer` | llm | — | — | **CHƯA ĐO** |

**Bốn điều đọc ra được, theo thứ tự quan trọng:**

1. **`guard` sai cả HAI chiều.** Chặn 4/6 lệnh vô hại (gồm đúng ca `echo "...đừng dùng
   rm -rf ~"` mà benchmark ghi lại ngày 08/08), và bắt **0/2** fixture thật sự phá hoại —
   `git clean -fdx` đi thẳng qua denylist, `git add -A` trong đường deploy cũng vậy. Cái thứ
   hai đặc biệt đáng nói: `git add -A` bị CẤM rõ trong `CLAUDE.md` mà cổng không thấy.
   *Caveat của chính phép đo: probe set dựng để ép precision, không phải traffic quan sát được.*
2. **`tsc` và `lint` bắt 0 — đúng như kỳ vọng, và đó mới là điểm.** Đây là những bug đã
   **lọt qua** chúng. Giá trị của `tsc` nằm ở cột **ratchet**: hai fixture mà bản vá thật siết
   kiểu (`twin-mapper-drift` T-124, `ignored-input-field` T-81) giờ làm `tsc` đỏ ở call site cũ.
   Đó là việc của tsc ở đây — **chặn tái phát, không phải phát hiện**.
3. **2/19 fixture không cổng nào bắt được**: `scope-drift-extra-endpoint` và
   `cross-surface-token-drift` — đúng lớp lỗi mà `spec-check` nhận là của mình. Nghĩa là con số
   `~60-70%` **chịu lực**: spec-check không bắt thì **không gì bắt**.
4. **`red-test` 90% KHÔNG phải detection rate.** Mọi fixture đều là bug rốt cuộc đã được tìm ra
   và viết lại, nên đây là **cận trên của B5 khi đã có ticket**. Hai ca trượt là hai lớp không
   ticket nào mô tả. Runner in caveat này ngay cạnh số để không ai trích trần.

**Một bug tìm thấy trong chính dụng cụ đo.** Lần chạy đầu báo *"tsc caught 0/8"* — **sai**:
tsc in path tương đối, matcher so path tuyệt đối, nên mọi lỗi biên dịch bị quy về không ai.
Chỉ lộ ra vì có người bơm một lỗi đã biết vào để thử phần quy trách nhiệm. Giờ mỗi lần chạy có
**canary**: một file hỏng sẵn phải bị gắn cờ *và* truy được về đúng path; canary im ⟹ cổng bị
đánh `error`, **không bao giờ đánh "0 catches"**. Cùng lớp lỗi với fixture
`silent-skip-without-env` — và nó sống trong chính cái máy đo. Đây là lý do §3.2 có lấy mẫu mù
và §7.3b có luật "kênh độc lập": **một phép đo im lặng sai trông y hệt một phép đo đạt.**

**Lưu ý khi đọc P8:** tỉ lệ "deterministic ≥ 20%" hiện đọc ra 100% — **chỉ vì cổng LLM chưa
được đo**. Nó sẽ tụt khi đo. Nguồn đúng cho tỉ lệ này lúc chạy thật là gate log (P1), không
phải file này.

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

### Bốn việc CHỜ QUYẾT ĐỊNH của vunt

1. **Danh sách lệnh cấm của guard (`DENY_CMD`).** Sai cả hai chiều: FP **28,6%** trên việc
   thật / **50%** trên probe set, và bắt **0/2** lệnh phá hoại thật (`git clean -fdx`,
   `git add -A`). Đề nghị chia hai bậc — chặn cứng thứ không bao giờ chính đáng, **hỏi rồi
   mới chạy** thứ tuỳ ngữ cảnh. **Thứ tự bắt buộc: giảm ồn TRƯỚC, thêm bảo vệ SAU** — thêm
   pattern vào một cổng đang ồn thì cổng bị bỏ qua và bảo vệ mới chết theo.
2. **Khe Bash + chuỗi leo thang.** Guard chỉ chặn theo `file_path`; ghi file qua lệnh shell
   không bị phân tích. Nối với việc manager tự đọc lệnh test từ `~/.gstack/manager/projects.json`
   (nằm ngoài mọi scope) thành chuỗi: agent ghi qua Bash → manager chạy lệnh được cắm vào, với
   quyền manager. Lọc hiện có chỉ chặn binary agent + dev/watch/deploy; `curl … | sh` đi qua.
   **Đề nghị (rẻ, cắt đúng chuỗi): manager không chạy lệnh nào từ file đó khi vunt chưa duyệt.**
3. **Token Telegram** (chỉ vunt làm được: `@BotFather` → `/newbot`, xem
   `personal/manager/telegram/README.md`) **+ một vòng chạy thật** để chốt tên tool MCP cho
   làn judge.
4. **`/sync-skills` dùng `ln -s` trần** — trên Windows tạo bản sao đông cứng thay vì liên kết.
   Skill mới sync bằng code hiện tại sẽ **im lặng không cập nhật khi sửa**. Đúng lớp lỗi giết
   `fix-bug-loop` 2 tuần. Sửa: dùng `MSYS=winsymlinks:nativestrict` + verify sau khi tạo.

**Thứ tự đề nghị:** 4 (15 phút, không rủi ro, đang âm thầm phá mọi skill thêm mới) → 2 (cắt
chuỗi, không đụng chỗ rủi ro) → 1 (cần vunt chốt hai bậc) → 3 (cần thao tác tay + tốn tiền model).

### Ba giới hạn đã biết, ghi rõ chứ không giấu

- **Làn `B8-judge` HIỆN KHÔNG CHẠY ĐƯỢC.** `allowedTools` là
  `['Read','Glob','Grep','Bash','Edit','Write','TodoWrite']` — **không một tool browser nào**.
  Manager trao `browser-token` cho một agent không có gì để lái Chrome. Cần một vòng chạy thật
  để chốt tên allowlist; agent xây phần này **từ chối đoán** một dòng trong danh sách quyền.
- **`red-test` luôn bị hạ xuống `llm`.** Manager không phân biệt được test đỏ viết TRƯỚC fix
  với test viết sau. Đóng được thì phải lưu output lần chạy đỏ rồi đối chiếu — đúng phần P6.
- **Hook row không mang task id.** Manager khớp theo cửa sổ thời gian + project, nên một session
  vunt tự mở trên cùng repo sẽ có dòng bị tính cho task.

## 12. Câu hỏi còn mở

- Agent chính: spawn theo task hay session thường trú? **Đề xuất: spawn theo task**, state ở
  file — rẻ hơn, không phình context, hợp nguyên tắc manager mỏng.
- Trần chi phí bootstrap cụ thể: bao nhiêu USD/task và USD/ngày trước khi có p90?
- "Chế độ tập lái" giữa P6 và P8: tắt review nhưng manager vẫn gửi diff để anh liếc, không
  bắt buộc trả lời — có đáng làm như bước đệm không?
- Grok/X search nối vào manager (brainstorm) hay agent chính (research lúc size)?
- Cài lại codex? Luật ensemble §7.3 yếu hẳn khi cả ba cổng LLM đều là Claude.
