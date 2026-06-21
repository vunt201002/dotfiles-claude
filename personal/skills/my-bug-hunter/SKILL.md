---
name: my-bug-hunter
description: Evidence-first bug investigation workflow, generic across stacks. Localize the bug by following evidence (grep the symptom, trace backward, bisect with logs, diff vs a working case, git blame) instead of guessing files; prove the root cause with runtime observation and try to refute it before any fix; lock it with a red test. Iron Law - no fix without a PROVEN root cause. Use for cross-layer bugs, round-2-fail (a fix that bounced back from QC), compound bugs, or anything that is not an obvious 1-line change. Skip for typos/labels/colors.
type: workflow
---

# My Bug Hunter

> **Iron Law: NO FIX WITHOUT A *PROVEN* ROOT CAUSE.**
> Proven = anh **quan sát được bằng chứng runtime**, không phải đọc code rồi suy ra.

## When to invoke

- Bug đã fix nhưng tester report fail lại (round-2-fail)
- Bug cross-layer / cross-surface
- Bug compound (1 bullet chứa nhiều sub-bug)
- Bug không phải 1-line fix rõ ràng

**Skip skill này** cho bug hiển nhiên: typo, label, color, copy, translation. Fix thẳng.

---

## ⛔ Mù thì KHAI, đừng đoán (luật trên hết)

Nếu **không quan sát được runtime** — không có browser tool, không chạy được app/emulator, không đọc được state/log — thì **DỪNG và khai báo**:

> *"Tôi không quan sát được [X] vì thiếu [tool Y]. Tôi KHÔNG kết luận root cause từ đọc code suông."*

**TUYỆT ĐỐI không** sản xuất một root cause "nghe hợp lý" từ đọc code tĩnh khi đang mù — đó là cách đẻ ra giả thuyết sai, tốn cả một vòng fix vô ích. Output đáng tin = **root cause đã chứng minh** HOẶC **"đây là cái tôi quan sát được + đây là chỗ tôi bị chặn + cần tool gì"** — KHÔNG bao giờ là phỏng đoán tự tin.

**Đồ quan sát (theo Project Adapter của app):**
- UI / storefront / admin → **Playwright MCP** (`mcp__playwright__*`: navigate · snapshot · screenshot · evaluate). Chưa wire → khai + yêu cầu wire, **đừng bắt người dùng tự chụp tay.**
- Backend / handler → chạy **emulator** (Bash) + đọc log + firestore UI.
- Data / record → query state thật.

---

## Phase 1 — Investigate: khoanh vùng + reproduce

KHÔNG fix gì ở phase này. Mục tiêu: tới đúng điểm sai, có repro.

**1. Reproduce trước.** Tái hiện bug ở môi trường thật (đúng surface bug xuất hiện).
Không reproduce được = chưa đủ hiểu bug để fix.

**2. Localize bằng BẰNG CHỨNG, không bằng đoán file.** Mỗi kỹ thuật thu nhỏ vùng tìm
bằng một tín hiệu thật — chọn cái hợp bug:

| # | Kỹ thuật | Khi nào dùng |
|---|---|---|
| 1 | **Neo vào chuỗi cụ thể** — grep nguyên văn error message / text sai / label / field / mã lỗi → dẫn thẳng tới dòng sinh ra nó | Có chuỗi/thông báo nhìn thấy được |
| 2 | **Trace ngược từ symptom** — từ chỗ bug hiện ra, grep tên biến/prop/hàm, "find references", lần lên nguồn | Biết giá trị/element sai, chưa biết nguồn |
| 3 | **Bisect bằng log** — đặt log/breakpoint ở GIỮA đường nghi ngờ; đúng → nửa sau, sai → nửa trước; chia đôi mỗi bước | Đường dài, nhiều bước trung gian |
| 4 | **Diff với case đang chạy đúng** (chi tiết ở Phase 2) | Có component/flow tương tự work |
| 5 | **git blame / bisect** — pin commit làm hỏng | Regression ("trước chạy được") |
| 6 | **Theo data flow của stack** — props/state, hoặc request→handler→service→repo, hoặc tab Network | Bug về dữ liệu / state |

**3. Output:** điểm sai + **bằng chứng**, KHÔNG phải phỏng đoán.
- ❌ "Tôi nghĩ bug vì X ở Y:Z" (đọc code suy ra)
- ✅ "Reproduce được; quan sát [log/inspect/Network] cho thấy tại Y:Z, biến/state = A — đây là điểm sai"
- Mới suy từ đọc code, chưa quan sát → đánh dấu **[CHƯA CHỨNG MINH]**, bắt buộc qua
  Phase 3 lấy bằng chứng trước khi fix.

---

## Phase 2 — Pattern Analysis: so với cái đang đúng

1. Tìm 1 case tương tự đang work (component khác, page khác, route khác)
2. Diff 2 case → tìm khác biệt
3. Khác biệt = candidate root cause (vẫn phải chứng minh ở Phase 3)

---

## Phase 3 — Hypothesize & PROVE

Scientific method: 1 hypothesis, 1 variable.

**1. Viết hypothesis ra:** "X gây Y vì Z"

**2. Thử REFUTE trước (falsify, đừng confirm):**
- Còn nguyên nhân nào khác cho cùng symptom này?
- Đây là **NGUỒN** hay **TRIỆU CHỨNG**? Nếu fix ở đây, thứ gì ở thượng nguồn vẫn sai?
- Nếu X đúng thì [state/giá trị] phải thế này — kiểm tra THẬT xem có đúng không.

**3. PROVE bằng runtime evidence (bắt buộc):**
- Add log/debugger → reproduce → đọc giá trị THẬT, đối chiếu expected
- git blame để bổ trợ (khi nào logic đổi)
- ⚠️ "Đọc code xác nhận logic" **KHÔNG** tính là prove — đó là confirmation bias.
  Đọc code chỉ để TẠO giả thuyết.

**4. Hypothesis sai → quay lại Phase 1.** KHÔNG đoán bừa cái khác.

> Ra được "rule": nói được *"tại Y:Z, biến = A nhưng phải = B, vì Z"* kèm bằng chứng
> quan sát. Chưa nói được = chưa ra rule, đào tiếp.

---

## Phase 3.5 — Red test (khoá bug lại)

1. Viết 1 test (hoặc repro script/Playwright) **tái hiện bug → phải ĐỎ**
2. Không viết được test đỏ = chưa thật nắm bug → quay lại Phase 1
3. Fix (Phase 4) tới khi test **XANH**. "Fixed" = đỏ→xanh, không phải "nhìn có vẻ ổn"

*(Bug thuần visual khó test tự động → dùng screenshot baseline làm mốc đỏ thay cho test,
nhưng vẫn phải có mốc đỏ trước khi fix.)*

---

## Phase 4 — Implementation

1. Fix **tối thiểu** — 1-3 dòng nếu có thể. Fix tại **NGUỒN**, không vá từng chỗ triệu chứng.
2. KHÔNG refactor, KHÔNG cleanup adjacent code, KHÔNG abstraction mới
3. Verify test Phase 3.5 xanh **+** verify ở môi trường thật
4. **Blast radius** — cùng root cause này còn rò ở đâu? Fix + check hết trong một lượt (checklist dưới)
5. Commit message = câu "rule" ở Phase 3

---

## Blast-radius checklist (bug có thể spans nhiều nơi)

Từ root cause, liệt kê MỌI nơi nó biểu hiện rồi verify từng cái trước khi commit:

- [ ] Mọi surface/layer dùng chung nguồn này (UI / state / data / backend / cache)
- [ ] Mọi variant (mobile + desktop, light + dark, các loại view)
- [ ] Translation / config nếu có thêm key
- [ ] Cache — có cần invalidate?

> Fix 1 nơi rồi commit = round-2-fail. Cùng 1 root cause thường hiện ở nhiều mặt.

---

## Red flags — DỪNG, nghĩ lại

- **3 lần fix fail liên tiếp** = vấn đề kiến trúc, không phải implementation. Revert hết, đổi approach.
- **Fix dài hơn 30 dòng** = đang fix sai chỗ (vá triệu chứng, không trúng nguồn).
- **Không viết được commit message 1 câu mô tả root cause** = chưa hiểu bug, đừng commit.
- **Test/screenshot xanh nhưng không chỉ được giá trị runtime nào đổi** = có thể đang
  hardcode / `!important` / đè lên triệu chứng. Chưa trúng nguồn.

---

## Commit message rule

❌ "fix tier icon"
✅ "getTierIcon nhận key 'gold' nhưng presets định nghĩa 'Gold' (capital) → đổi key về lowercase"

Format: `[điểm sai] — [root cause] — [fix]`. Không viết được câu này → quay lại Phase 1.

---

## Anti-patterns

- ❌ "Claude fix giúp" → search → fix tiếp → 50% work, sai nguồn
- ❌ Đoán file rồi đọc, thay vì **localize bằng bằng chứng** (Phase 1.2)
- ❌ "Verify" = đọc lại code (confirmation bias). Verify = **quan sát runtime**.
- ❌ Fix layer được chỉ vào, bỏ blast radius
- ❌ Fix 1 variant, không enumerate matrix
- ❌ "Fixed" = "code applied". Sai. "Fixed" = test đỏ→xanh + tester confirm.

---

## Inspired by

- ChrisWiles/claude-code-showcase systematic-debugging skill
- nobelk/claude-tools fix-bug (test-driven variant)
- Personal notes: bug-fix-workflow-notes.md
