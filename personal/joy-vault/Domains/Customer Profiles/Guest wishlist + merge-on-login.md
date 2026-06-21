---
type: how-it-works
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Guest wishlist + merge-on-login

Guest ghi **localStorage tức thì (canonical)** + mirror backend fire-and-forget (cross-device + analytics).
Login → `POST /clientApi/merge` (1 Firestore transaction): dedup `(productId,variantId)`, `addedAt` cũ hơn thắng, ghi customer doc + xoá guest doc cùng lúc.

- Identity lấy từ HMAC `logged_in_customer_id`; body `customer_id` **bị bỏ qua** (chống spoof).
- `added_at` client bị clamp `[now-90d, now+5min]` (vì tiebreaker 'cũ hơn thắng', tránh fake 1970).
- Merge dùng items **từ client** → item guest lưu ở browser khác (chỉ có trên Firestore) sẽ KHÔNG được merge, orphan tới khi TTL.
File: `controllers/clientApi/mergeController.js`. (nguồn: guest-wishlist-implementation-plan.md)

Liên quan: [[Storefront Widget]]
