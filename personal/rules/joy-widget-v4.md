---
paths:
  - "**/packages/web-components/**"
  - "**/packages/scripttag/**"
  - "**/packages/assets/src/components/PreviewV4/**"
  - "**/packages/assets/src/locales/*.json"
---

# Joy widget v4 — 4 layer, đọc trước khi sửa

Bug ở đây thường **spans 2-3 layer**. Sửa đúng layer được chỉ vào rồi commit là
công thức của round-2-fail (tester mở lại bug).

| Layer | Đường dẫn | Ngôn ngữ |
|---|---|---|
| 1. Admin React | `packages/assets/src/components/PreviewV4/` | React + Polaris |
| 2. Web Components | `packages/web-components/src/components/` | Lit (TS) |
| 3. Scripttag | `packages/scripttag/src/v4-adapters/` | Vanilla JS |
| 4. V3 fallback | `packages/scripttag/src/v3/` | Vanilla JS |

**Trước khi đoán root cause, chạy `__joyDebug` trên storefront** (có sẵn ở window khi
widget mounted): `tree()` · `inspect()` · `brandingPipeline()` · `find()` · `events()`.
Tiết kiệm ~30 phút đọc code mò.

**Ba cái sai đắt nhất ở vùng này:**
- **Admin preview ≠ storefront.** Chưa verify storefront thật thì chưa "done".
- **`web-components/dist/` là build output** — sửa `src/`, đừng sửa dist.
- **Translation nằm ở HAI nơi**: `assets/src/locales/<lang>.json` và
  `web-components/src/i18n/`. Sửa một bên là bug im lặng.

Playbook đầy đủ (layer matrix, bảng bug→file, verify checklist): **`/joy-widget-v4-fix`**.
