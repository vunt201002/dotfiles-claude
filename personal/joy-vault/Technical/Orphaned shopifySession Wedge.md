---
type: gotcha
product: wishlist
created: 2026-07-03
updated: 2026-07-03
tags: [joy, wishlist]
---
# Orphaned shopifySession Wedge

**Cạm bẫy:** Shop doc (`shops/*`) bị xoá khỏi Firestore nhưng session doc (`shopifySession/offline_<domain>`) vẫn còn với access token active → admin app treo infinite loading VĨNH VIỄN, reload vô ích, và mọi API vẫn trả HTTP 200 (vỏ lỗi) nên rất khó lần. Dính thực tế: wishlist-3 dev store vunt-3, 2026-07-03.

**Vì sao:** `@avada/core` verifyToken middleware: có session + `checkIfActiveAccessToken=true` → BỎ QUA nhánh token-exchange/re-install → `getShopByShopifyDomain` trả null → `ctx.state.user` không được set (code không có nhánh else) → controller crash `TypeError: reading 'shopID'` → errorHandler nuốt lỗi trả 200. Vòng tự khoá: session còn sống thì core không bao giờ tự sửa.

**Cách đúng:**
- Fix: **xoá session doc mồ côi** (`shopifySession/offline_<shop-domain>`) → request sau `checkIfHasSession` tạo session rỗng → verifyToken buộc chạy token-exchange + `handleAfterInstall` → tự tạo lại shop doc, webhooks, plan.
- Debug lesson: **HTTP 200 ≠ thành công** — `firebase-debug.log` ghi cả `console.error` trong function (dòng `[info] > ...`); grep quanh `>>> [apiv2][query]` là thấy stacktrace thật đằng sau response "200".
- Kèm theo vụ này: thiếu `packages/functions/serviceAccount.development.json` (copy từ wishlist-2, cùng project wishlist-staging-1).

Liên quan: [[Expiring Access Token Enforcement (@avada-core)]]
