---
type: potential-bug
product: wishlist
severity: high
status: open
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# BigQuery SQL ghép chuỗi (injection)

~14 chỗ interpolate `shopId/customerId/guestId/variantId` thẳng vào câu SQL (vd `SET shopifyCustomerId = '${customerId}'`). `guestId` do client kiểm soát → **injection thật** vào BigQuery (exfil/destroy chéo shop).

Tự mâu thuẫn: read path (`getListCustomer`) lại dùng `@params` đúng. Fix: parameterize hết bằng named params.
File: `services/bigQueryService.js`. (nguồn: docs/bfs-master-fix-plan.md)
