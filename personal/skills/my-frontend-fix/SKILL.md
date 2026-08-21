---
name: my-frontend-fix
description: Generic frontend verification workflow, any web stack. Frontend bugs need visual + runtime verification - the agent can read code but cannot see the rendered UI or live state. Open the rendered surface and diagnose runtime BEFORE coding, fix at the root (not a visual band-aid), verify with a fix to re-render to compare loop, then check regressions + blast radius. Defers root-cause proof to my-bug-hunter; for project power-tools (e.g. Joy __joyDebug / widget v4 layers) points to the project adapter. Carries the design-eye layer (references/design-eye.md) — visual read before diagnose, mandatory viewport matrix, design-verify gate (mechanical + taste, scored 0-10) before close, accumulating UI pattern library. Use for any UI/frontend bug fix. Skip for typos/copy/color one-liners.
type: workflow
---

# Frontend Fix (generic)

> **Core problem:** Bug frontend cần thấy bằng MẮT + đọc STATE lúc chạy. Đọc code không thấy
> được UI render ra sao hay state thật → fix 3-4 vòng hoặc trượt.

> **Phân vai:** `/my-bug-hunter` = chứng minh *vì sao* (root cause, mọi stack). Skill này =
> *thấy & verify* phần frontend. **Đừng đoán root cause ở đây** — mang bằng chứng từ
> `/my-bug-hunter` sang.

> **Con mắt + gu:** `references/design-eye.md` — nạp khi fix UI. §A visual read (trước bước 3),
> §B design-verify (trong bước 4), §D pattern library (ĐỌC trước khi diagnose, GHI sau khi fix).
> Nguyên tắc: symptom hết = điều kiện CẦN; qua design-verify = điều kiện ĐỦ.

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

### Visual read (design-eye §A):
- Hệ đang dùng: [spacing/align/type/token] · Lệch chuẩn: [gì, số đo] · Bug là: [property lẻ | HỆ sai]

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
- **Viewport matrix bắt buộc:** bug mobile → chụp **390px TRƯỚC**, rồi 768 + desktop; bug
  desktop → desktop + check nhanh 390. Chụp **CẢ CỤM xung quanh**, không chỉ element lỗi
  (visual read §A cần context). Verify cuối (bước 4) phải đủ lại đúng matrix này.
- URL/lệnh chạy: theo adapter project (Joy: Vite `5173` / admin embed / storefront thật).
- Browser: gọi **/my-chrome để route theo surface**. Storefront/theme editor/
  standalone Admin dùng `claude-in-chrome` trên **Chrome thật đang mở**.
  Với đúng các surface này, **check group trước mỗi lần test:** `tabs_context_mcp` → **CÓ group thì DÙNG**
  (`navigate` tab sẵn có; `tabs_create_mcp` chỉ khi cần thêm tab — vẫn vào group đó);
  **CHƯA có thì tạo đúng 1 lần** rồi tái dùng suốt session (session mới luôn phải tạo —
  giới hạn extension #69542). **Xong việc → `tabs_close_mcp` đóng tab đã mở** (group
  tự biến mất). **Không đụng tab ngoài group**. Login Admin/store có sẵn chỉ giải
  quyết login, không giúp `find`/`read_page` xuyên cross-origin iframe.
- **Embedded Admin app:** route thẳng `/browse`: `$B goto <url>` →
  `$B frame 'iframe[name="app-iframe"]'` → `$B snapshot -i` → act bằng `@ref` → `$B frame main`.
  Selector này đã đo trên live Shopify; full `browse --cdp` path **chưa verify end-to-end**.
- **HARD STOP:** sau 2 lần không reach cùng control, dừng + báo user; không retry lần
  3, không thử tool thứ ba, không coordinate-click xuyên iframe. Nếu UI không drive
  được, verify staging Firestore/storefront và report rõ embedded UI chưa verify.

## 3. Diagnose runtime TRƯỚC khi code (diagnose-first, fix-second)

**3.0 — Pattern + visual read trước (design-eye §D1 + §A):** mở bảng pattern §D1 — symptom khớp
dòng nào thì kiểm giả thuyết đó ĐẦU TIÊN. Làm visual read trên cụm đã chụp ở bước 2, điền output
vào checklist (`Hệ đang dùng / Lệch chuẩn / Bug là property lẻ hay HỆ sai`). Rồi mới diagnose tiếp:

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
   - RỒI  → 3b. Design-verify (design-eye §B): tầng CƠ HỌC (DOM, deterministic) → tầng
     TASTE (rubric), chấm 0-10 năm dimension (spacing·align·hierarchy·states·mobile).
     Mọi dimension ≥8 → bước 4. Dimension <8 DO CHÍNH fix này → chỉnh, quay lại 1.
     Finding [Medium]/[Nitpick] ngoài scope → ghi "polish lân cận", KHÔNG tự sửa.
4. Regression: screenshot 2-3 trang liên quan (đủ viewport matrix của bước 2) + check console error
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
### Design-verify: cơ học [n/n pass] · taste 0-10: spacing _ · align _ · hierarchy _ · states _ · mobile _
### Pattern: [ghi mới / tăng đếm dòng §D1] · Polish lân cận (KHÔNG tự sửa — đổ về checklist C): [...]
### Anh verify: [ ] [trang + thứ cần nhìn trên app thật]
```

## Pitfalls

- Sửa code khi chưa mở surface → bước 2 luôn trước bước 4
- Nói "done" khi chưa Read screenshot → cấm
- Screenshot xanh nhưng không chỉ được giá trị runtime nào đổi → đang băng-dán
- Over-scope: đổi 20 file cho fix 3 file → checklist chặn scope
- Fix ổn lúc lẻ, vỡ trong context → screenshot trang liên quan
- Mò giá trị khi fix trượt → re-diagnose, đừng thử bừa
- Fix đúng property nhưng lệch HỆ (spacing scale/alignment/token) → symptom hết CHƯA phải xong; design-verify bắt
- Nhận xét visual không số đo/element cụ thể ("nhìn hơi lệch") → cấm; grounded: element + số + screenshot

## Combine

- **Con mắt + gu**: `references/design-eye.md` (rubric §B, surface adapter Polaris/theme §C, pattern library §D)
- **Trước**: `/my-bug-hunter` (chứng minh root cause, viết red test)
- **Joy widget v4**: `/joy-widget-v4-fix` (adapter: `__joyDebug`, layer matrix, stores)
- **Verify hành vi / test thật**: `/qa`, `/verify`
