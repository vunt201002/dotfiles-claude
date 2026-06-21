---
type: potential-bug
product: wishlist
severity: high
status: open
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Thiếu GDPR webhooks + handler nuốt lỗi

BFS blocker + lỗ hổng xoá dữ liệu thật:
- Chưa đăng ký `customers/redact`, `customers/data_request`, `shop/redact`, `app/uninstalled` (chỉ có orders/create, customers/delete, bulk_operations/finish).
- `customers/delete` controller & `backgroundHandler` trả **200/ack ngay trong catch** → Shopify không retry → PII còn lại; message Pub/Sub bị mất.

Lưu ý: GDPR `customers/redact` lồng customer ở `body.customer.id/.email` (KHÁC `customers/delete` top-level `id`) — đừng dùng lại parser.

File: `services/shopifyService.js` (createWebhooks), `const/webhooks.js`, `handlers/pubsub/backgroundHandler.js`.

Liên quan: [[Technical]]
