---
name: my-frontend-fix
description: Generic frontend verification workflow, any web stack. Frontend bugs need visual + runtime verification - the agent can read code but cannot see the rendered UI or live state. Open the rendered surface and diagnose runtime BEFORE coding, fix at the root (not a visual band-aid), verify with a fix to re-render to compare loop, then check regressions + blast radius. Defers root-cause proof to my-bug-hunter; for project power-tools (e.g. Joy __joyDebug / widget v4 layers) points to the project adapter. Use for any UI/frontend bug fix. Skip for typos/copy/color one-liners.
type: workflow
---

# Frontend Fix (generic)

> **Core problem:** Bug frontend cần thấy bằng MẮT + đọc STATE lúc chạy. Đọc code không thấy
> được UI render ra sao hay state thật → fix 3-4 vòng hoặc trượt.

> **Phân vai:** `/my-bug-hunter` = chứng minh *vì sao* (root cause, mọi stack). Skill này =
> *thấy & verify* phần frontend. **Đừng đoán root cause ở đây** — mang bằng chứng từ
> `/my-bug-hunter` sang.

## 0. Project adapter (đọc 1 lần / project)

Skill này generic. Chi tiết theo project (URL dev, lệnh chạy server, công cụ inspect runtime)
đọc từ `CLAUDE.md` của project; thiếu thì **hỏi rồi ghi vào CLAUDE.md** — đừng hardcode.

| Project | Adapter / power-tools |
|---|---|
| **Joy** (widget v4, shadow DOM) | `/joy-widget-v4-fix` + `__joyDebug` + `~/.claude/skills/joy-widget-v4-fix/references/shadow-dom.md` |
| Khác (Wishlist, vlxd, tienvu-bt...) | DevTools console · Playwright `eval`/`getComputedStyle` · framework devtools (React/Vue) · Network tab |

## 1. Fix checklist (BẮT BUỘC — confirm trước khi code)

```
## Fix: [bug]
## Surface: [trang/màn nào]

### Root cause (từ /my-bug-hunter — phải có bằng chứng runtime):
- [file:line] → [giá trị quan sát được: cái gì sai, vì sao]

### Changes:
- [ ] [file] → [đổi gì] → [kết quả render mong đợi]

### KHÔNG được đổi:
- [ ] [component/trang] → [giữ nguyên]

### Verify on:
- [ ] [trang + thứ cần nhìn] + blast radius (mọi surface cùng nguồn)
```

Chưa confirm → chưa code. Root cause chưa có bằng chứng → quay lại `/my-bug-hunter`.

## 2. Mở surface render TRƯỚC khi code (không bỏ qua)

Chạy app ở trạng thái lỗi, chụp **baseline** (đây cũng là *mốc đỏ* của red test).
- URL/lệnh chạy: theo adapter project (Joy: Vite `5173` / admin embed / storefront thật).
- Browser: mặc định **/chrome** (claude-in-chrome) trên **Chrome thật đang mở** — dùng
  **1 group tab "Claude" cố định**: `tabs_context` → **navigate tab sẵn có trong group**
  (không `tabs_create` khi group đã có tab — tạo tab mới dễ đẻ thêm group "Claude" nữa;
  nhiều URL → điều hướng tuần tự cùng tab). **Không đụng tab ngoài group**. Login
  Admin/store có sẵn → khỏi cookie-import.
- Fallback headless (khi /chrome không khả dụng): `browse`/Playwright: `goto` → `screenshot` → Read ảnh.

## 3. Diagnose runtime TRƯỚC khi code (diagnose-first, fix-second)

Đừng đoán fix từ code tĩnh — quan sát state thật:

| Triệu chứng | Quan sát (generic) | Joy power-tool |
|---|---|---|
| Element ẩn / sai màu | computed styles (`getComputedStyle`/DevTools), truy var nào thắng | `__joyDebug.brandingPipeline()` · `innerStyles()` |
| Text/data sai | tìm element → đọc props/state (framework devtools / `eval`) | `__joyDebug.find()` · `props()` |
| Data không tới | Network tab + log tại adapter; actual vs expected | `__joyDebug.diff()` |
| Layout vỡ | computed flex/grid/box | `__joyDebug.innerStyles()` |
| Không biết bắt đầu đâu | DOM/component tree → drill in | `__joyDebug.tree()` → `inspect()` |

→ Cập nhật root cause trong checklist bằng cái **quan sát được**. Rồi mới sang bước 4.

## 4. Fix → re-render → verify loop (mỗi bug tới khi xác nhận)

```
1. Đổi code (theo checklist)
2. Re-render: screenshot trang bug → Read ảnh
3. So baseline — bug hết chưa?
   - CHƯA → re-diagnose (bước 3), chỉnh, lặp lại. ĐỪNG mò giá trị bừa.
   - RỒI  → bước 4 (regression)
4. Regression: screenshot 2-3 trang liên quan + check console error
5. Có regression/error? → chỉnh, quay lại 1. Không → Report.
```

**Chống băng-dán (đây là phần "triệt để"):** screenshot đúng = *triệu chứng* hết, CHƯA chắc
*nguồn* đúng. Trước khi đóng, xác nhận **giá trị runtime đổi đúng theo root cause** (var/prop/state
thật) — KHÔNG phải vừa hardcode / `!important` / đè cho nhìn đúng.

**Blast radius:** cùng root cause còn hiện ở đâu? (Joy: dùng layer matrix của `/joy-widget-v4-fix`;
mobile/desktop, variant, theme, cache). Fix hết một lượt — đừng commit 1 chỗ.

## 5. Report (kèm bằng chứng)

```
## Fix Complete
### Changed: [file:line] → [gì]
### Root cause proven: [giá trị runtime quan sát được]
### Verified: [x] trang — screenshot · [x] liên quan — no regression · [x] blast radius
### Anh verify: [ ] [trang + thứ cần nhìn trên app thật]
```

## Pitfalls

- Sửa code khi chưa mở surface → bước 2 luôn trước bước 4
- Nói "done" khi chưa Read screenshot → cấm
- Screenshot xanh nhưng không chỉ được giá trị runtime nào đổi → đang băng-dán
- Over-scope: đổi 20 file cho fix 3 file → checklist chặn scope
- Fix ổn lúc lẻ, vỡ trong context → screenshot trang liên quan
- Mò giá trị khi fix trượt → re-diagnose, đừng thử bừa

## Combine

- **Trước**: `/my-bug-hunter` (chứng minh root cause, viết red test)
- **Joy widget v4**: `/joy-widget-v4-fix` (adapter: `__joyDebug`, layer matrix, stores)
- **Verify hành vi / test thật**: `/qa`, `/verify`
