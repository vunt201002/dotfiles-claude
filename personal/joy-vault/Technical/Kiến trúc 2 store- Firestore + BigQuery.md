---
type: how-it-works
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Kiến trúc 2 store: Firestore + BigQuery

Wishlist chạy 2 store song song:
- **Firestore** giữ *state wishlist sống* (collection `wishlists`, 1 doc / shop+customer).
- **BigQuery** giữ *event log append-only* (`activities`, `customers`) dùng cho mọi analytics/aggregate.

Mỗi add/remove ghi cả hai. → Số liệu khách & analytics đọc **BigQuery**, không phải Firestore; 2 nguồn phải tự đồng bộ (merge/webhook logic phải giữ khớp).

File: `repositories/wishlistRepository.js`, `services/bigQueryService.js`, `services/bigquery/customerService.js`.

Liên quan: [[Analytics]]
