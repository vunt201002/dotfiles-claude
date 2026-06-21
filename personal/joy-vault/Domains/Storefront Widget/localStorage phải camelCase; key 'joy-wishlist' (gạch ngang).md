---
type: gotcha
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# localStorage phải camelCase; key 'joy-wishlist' (gạch ngang)

Hard contract:
- localStorage + SDK state dùng **camelCase** (`productId`, `variantId`, `addedAt`).
- **Chỉ** body `POST /merge` dùng snake_case (convert tại đúng 1 boundary).

Ghi snake_case vào localStorage → đọc lại sau refresh ra `undefined` → list trống, **không báo lỗi**. Key là `joy-wishlist` (gạch ngang), KHÔNG phải underscore.
Dedup: runtime theo `variantId`; lúc merge theo `(productId, variantId)` giữ `addedAt` cũ hơn.
File: `packages/web-components/src/sdk/core.js`. (nguồn: guest-wishlist-*)
