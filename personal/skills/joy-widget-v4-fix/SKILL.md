---
name: joy-widget-v4-fix
description: Joy widget v4 specific bug-fix playbook. Use when fixing bugs in widget v4 — web components (Lit), scripttag widget, V3 fallback, or admin PreviewV4. Identifies which of 4 layers the bug lives in BEFORE fixing, prevents the round-2-fail pattern of "fix admin but storefront still broken." Combines with frontend-fix and my-bug-hunter skills.
type: workflow
---

# Joy Widget V4 Bug Fix Playbook

> **Pain point đang giải**: Round-2-fail. Bug "fix admin xong storefront vẫn lỗi" vì v4 có 4 layer, agent chỉ fix layer được chỉ vào.

## When to invoke

- Bug ở widget v4 (storefront, admin preview, hoặc cả hai)
- Bug "không hiển thị", "không sync", "preview khác store", "X không work"
- Bug tester report fail lại sau khi đã đánh dấu done

**Skip** cho bug đơn giản: typo, label, copy, color admin-only.

## 4 layer của widget v4 — phải hiểu TRƯỚC khi fix

| Layer | Đường dẫn | Ngôn ngữ | Khi nào dùng |
|---|---|---|---|
| **1. Admin React** | `packages/assets/src/components/PreviewV4/` | React + Polaris | Bug ở admin preview/editor |
| **2. Web Components** | `packages/web-components/src/components/` | Lit (TypeScript) | Bug ở storefront UI mới |
| **3. Scripttag** | `packages/scripttag/src/v4-adapters/` | Vanilla JS | Bug ở loader / mount điểm |
| **4. V3 Fallback** | `packages/scripttag/src/v3/` | Vanilla JS | Bug khi merchant chưa migrate v4 |

**Quan trọng**: 1 bug có thể spans 2-3 layer. Fix 1 layer → bug vẫn còn ở layer khác → round-2-fail.

## Step 1 — Identify layer matrix

Trước khi đụng code, trả lời 5 câu:

1. Bug xuất hiện ở **đâu**? (admin preview / store storefront / cả hai)
2. Bug xuất hiện trên **device** nào? (desktop / mobile / cả hai)
3. Bug xuất hiện ở **variant** nào? (popup / drawer / inline / icon-only)
4. Merchant **đã migrate v4** chưa? (có → layer 1+2+3, chưa → layer 4)
5. Bug có liên quan **data từ backend** không? (có → cần check API/handler)

→ Output: matrix các layer cần fix. Đừng fix 1 cái rồi commit.

## Step 2 — Bug type → first file lookup table

| Bug pattern | First file to check | Common anti-pattern |
|---|---|---|
| "Storefront không hiển thị widget" | `packages/scripttag/src/v4-adapters/loader.js` | Mount point không match selector merchant |
| "Admin preview khác storefront" | `packages/web-components/src/components/widget/joy-loyalty-widget.ts` `_getCustomStyles()` | Branding pipeline: admin → CSS var → component |
| "Click element không work" | `joy-loyalty-widget.ts` event delegation | `@click` catch hết, dùng `@joy-product-click` thay thế |
| "Heart icon mất ở inner page" | `joy-product-list.ts` props passing | Inner page không nhận đủ props từ outer |
| "Translation không update" | `assets/src/locales/<lang>.json` + `web-components/src/i18n/` | Update 1 file mà không update file kia |
| "Tier icon sai" | `web-components/src/presets.ts` | Key case-sensitive (`'Gold'` vs `'gold'`) |
| "Coupon không apply" | `web-components/src/components/redeem/` | Data path: `data.X` vs `data.subobject.X` |
| "Referral không hiện" | `scripttag/src/v4-adapters/referral.js` | Detect URL param: `?referralCode` lẫn `?hash` |

## Step 3 — Diagnose với `__joyDebug`

Window object có sẵn ở storefront khi widget mounted. Mở DevTools → Console:

```javascript
// Xem hierarchy components
__joyDebug.tree('joy-loyalty-widget')

// Inspect 1 component cụ thể (props + state + CSS vars)
__joyDebug.inspect('joy-redeem-detail')

// Trace branding pipeline: admin setting → CSS var
__joyDebug.brandingPipeline()

// Search shadow DOM theo text
__joyDebug.find('250 points')

// List tất cả custom events đang fire
__joyDebug.events()
```

→ Trước khi đoán root cause, **chạy `__joyDebug` trước**. Tiết kiệm 30 phút search code.

## Step 4 — Fix theo layer matrix

Cho mỗi layer trong matrix step 1, làm tuần tự:

### Layer 1 (Admin React)
1. Edit file ở `packages/assets/src/components/PreviewV4/`
2. Hot reload qua Vite dev server (cloudflare tunnel)
3. Verify trên `https://admin.shopify.com/.../widget-editor`

### Layer 2 (Web Components)
1. Edit file ở `packages/web-components/src/components/`
2. Vite dev server `cd packages/web-components && npm run dev`
3. Verify trên `http://localhost:5173`
4. **CŨNG verify trên storefront thật** (build khác biệt giữa dev và prod)

### Layer 3 (Scripttag)
1. Edit `packages/scripttag/src/v4-adapters/`
2. Build lại: `cd packages/scripttag && npm run build`
3. Verify trên storefront thật (không có dev mode)

### Layer 4 (V3 Fallback)
1. Edit `packages/scripttag/src/v3/`
2. Test merchant chưa migrate v4 — khó test, nhờ team

## Step 5 — Verify matrix

Trước khi commit, check **toàn bộ** matrix step 1:

- [ ] Admin preview — visual đúng?
- [ ] Storefront thật — visual đúng?
- [ ] Desktop — đúng?
- [ ] Mobile (Chrome DevTools responsive) — đúng?
- [ ] Variant khác (popup vs drawer) — không vỡ?
- [ ] Merchant chưa migrate v4 — không vỡ V3?

**Không bao giờ "done" mà chưa verify storefront thật.** Admin preview ≠ storefront.

## Step 6 — Commit message

Format: `fix(widget-v4): [layer] — [root cause] — [fix]`

✅ `fix(widget-v4): scripttag — @click catch heart icon clicks, use @joy-product-click`
✅ `fix(widget-v4): web-components — getTierIcon key case mismatch ('gold' vs 'Gold')`

❌ `fix tier icon`
❌ `update widget`

## Red flags

- **Fix 1 layer, không kiểm tra layer khác** → round-2-fail guaranteed
- **Edit web-components/dist/** → đó là build output, edit src/ thay
- **3 lần fail liên tiếp ở cùng 1 bug area** → revert hết, đổi approach
- **"Hot reload không hoạt động"** → có thể do scripttag chưa rebuild, không phải bug code

## Combine với skill khác

- **Trước fix**: `my-bug-hunter` (Phase 1-3 hypothesis) → skill này (Step 1-6 widget v4 specific)
- **Verify visual**: `frontend-fix` (Playwright screenshot loop)
- **Test thật**: `qa` skill từ gstack/aov-lab

## References

- `.claude/skills/frontend-fix/SKILL.md` — base 3-layer workflow
- `.claude/skills/playwright-cli/references/shadow-dom.md` — `__joyDebug` API
- `.claude/skills/web-components/references/css-variable-map.md` — CSS var pipeline
- `packages/web-components/src/components/widget/joy-loyalty-widget.ts` — main widget logic
- Personal notes: bug-fix-workflow-notes.md section 11
