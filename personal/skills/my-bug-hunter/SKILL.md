---
name: my-bug-hunter
description: Hypothesis-first bug fixing workflow. Adapted from ChrisWiles systematic-debugging. Use when fixing bugs that may span multiple layers, when previous fix attempts failed (round-2-fail), or when the bug isn't an obvious 1-line fix. Iron Law - no fixes without root cause investigation.
type: workflow
---

# My Bug Hunter

> Iron Law: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.

## When to invoke

- Bug đã fix nhưng tester report fail lại (round-2-fail)
- Bug cross-layer (admin + storefront, frontend + backend)
- Bug compound (1 bullet chứa nhiều sub-bug)
- Bug không phải 1-line fix rõ ràng

**Skip skill này** cho bug đơn giản: typo, label, color, copy, translation. Fix thẳng.

## 4-phase framework

### Phase 1 — Root Cause Investigation

Trace ngược từ symptom đến nguyên nhân gốc. KHÔNG fix gì ở phase này.

1. Reproduce bug ở môi trường thật (storefront/admin/staging — không phải local)
2. Liệt kê các layer có thể liên quan
3. Đọc code 2-3 file đoán liên quan, KHÔNG search rộng
4. Output: 1 câu mô tả "Tôi nghĩ bug này vì X ở file Y dòng Z"

### Phase 2 — Pattern Analysis

So sánh code lỗi với code working tương tự.

1. Tìm 1 case tương tự đang work (component khác, page khác)
2. Diff 2 case → tìm khác biệt
3. Khác biệt = candidate root cause

### Phase 3 — Hypothesis & Verification

Scientific method: 1 hypothesis, 1 variable.

1. Viết hypothesis ra: "X gây Y vì Z"
2. Verify bằng 1 trong 3 cách:
   - Đọc code xác nhận logic
   - Add log/debugger, reproduce, đọc log
   - Tìm git blame xem khi nào logic thay đổi
3. Nếu hypothesis sai → quay lại Phase 1, KHÔNG đoán bừa cái khác

### Phase 4 — Implementation

1. Fix tối thiểu — 1-3 dòng nếu có thể
2. KHÔNG refactor, KHÔNG cleanup adjacent code, KHÔNG abstraction mới
3. Verify fix ở môi trường thật
4. Regression check 2-3 page liên quan
5. Commit message = câu hypothesis ở Phase 3

## Red flags — DỪNG và suy nghĩ lại

- **3 lần fix fail liên tiếp** = vấn đề kiến trúc, không phải implementation. Revert tất cả, đổi approach.
- **Fix dài hơn 30 dòng** = đang fix sai chỗ
- **Không viết được commit message 1 câu mô tả root cause** = chưa hiểu bug, đừng commit

## Commit message rule

❌ "fix tier icon"
✅ "tier icon Gold dùng key 'gold' nhưng presets.ts định nghĩa 'Gold' (capital) — đổi key thành lowercase trong getTierIcon"

Nếu không viết được câu thứ 2 → quay lại Phase 1.

## Cross-layer checklist (khi bug có thể spans nhiều layer)

Trước khi commit, verify mỗi layer:

- [ ] Admin (React) — đã fix?
- [ ] Storefront (web component / scripttag) — đã fix?
- [ ] Backend (handler/service/repository) — đã fix?
- [ ] Translation files — đã update nếu có label mới?
- [ ] Cache — có cần invalidate?

## Anti-patterns

- ❌ "Claude fix giúp" → Claude search → fix tiếp → 50% work
- ❌ Fix layer được chỉ vào, không trace cross-layer
- ❌ Fix 1 variant, không enumerate matrix (mobile + desktop, light + dark...)
- ❌ "Fixed" = "code change applied" — sai. "Fixed" = "tester confirm bug đã hết"

## Inspired by

- ChrisWiles/claude-code-showcase systematic-debugging skill
- nobelk/claude-tools fix-bug (test-driven variant)
- Personal notes: bug-fix-workflow-notes.md
