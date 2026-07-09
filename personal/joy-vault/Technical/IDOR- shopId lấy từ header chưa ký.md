---
type: potential-bug
product: wishlist
severity: high
status: open
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist, potential-bug]
---
# IDOR: shopId lấy từ header chưa ký

`clientApiMiddleware` verify App Proxy HMAC, **nhưng** shopId đọc thẳng từ header `X-Shopify-Shop-Id` — KHÔNG nằm trong params được HMAC ký (HMAC chỉ chứng minh `shop` domain + `logged_in_customer_id`).

→ Attacker có HMAC hợp lệ của shop mình + gửi shopId của shop khác = đọc/ghi **chéo tenant**.

Fix: lấy shopId từ domain đã verify HMAC (`ctx.state.shopId`), coi header là advisory. Áp cho cả `publicTokenMiddleware`.
File: `helpers/utils/getContext.js`, `middleware/clientApiMiddleware.js`. (BFS blocker — nguồn: docs/build-for-shopify-readiness.md)

Liên quan: [[Customer Profiles]]
