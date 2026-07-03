---
type: potential-bug
product: shared
severity: high
status: open
created: 2026-07-03
updated: 2026-07-03
tags: [joy, shared]
---
# Expiring Access Token Enforcement (@avada/core)

**Triệu chứng / vì sao đáng ngại:** Token exchange trong `@avada/core` (exchangeOfflineToken) trả về offline token **non-expiring** (`shpat_`). Shopify đã chặn loại này trên Admin API: app tạo sau **01/04/2026** bị chặn NGAY (đã dính thực tế trên dev app wishist-app-v3, 2026-07-03: mọi Admin call 403 `[API] Non-expiring access tokens are no longer accepted` → getShopifyInfo fail → không tạo được shop doc → admin infinite loading). **Từ 01/01/2027 chặn MỌI app public — Joy Wishlist production sẽ dính y hệt.**

**Nơi liên quan:** `@avada/core/build/services/shopifyAuthService.js` — `exchangeOfflineToken` (body request thiếu `expiring: 1`); session storage (`shopifySession`) chưa lưu `expires_at`/`refresh_token`; vòng `checkIfActiveAccessToken → re-exchange` trong verifyToken là cơ chế tự gia hạn tạm chấp nhận được cho dev, KHÔNG đủ cho prod (background jobs không có session token để re-exchange).

**Cần kiểm tra / hướng xử lý:**
- Fix TẠM đang chạy trên máy vunt: patch `expiring: 1` vào body exchange tại `node_modules/@avada/core/build/services/shopifyAuthService.js:322` (có `.bak-expiring`) — **mất khi reinstall node_modules**.
- Fix chính thức: đưa `expiring: 1` + refresh_token flow (grant_type=refresh_token, lưu expires_at/refresh_token_expires_at, refresh chủ động cho background jobs) vào `@avada/core` rồi bump version cho các app.
- Doc: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
- Nên tạo task trên board sớm — deadline cứng 01/01/2027.

Liên quan: [[Orphaned shopifySession Wedge]]
