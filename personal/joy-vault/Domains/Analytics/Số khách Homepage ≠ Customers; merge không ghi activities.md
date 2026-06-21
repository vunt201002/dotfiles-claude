---
type: gotcha
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Số khách Homepage ≠ Customers; merge không ghi activities

Hai con số lệch vì 2 định nghĩa:
- Homepage `getAllProductInWishlist`: `WHERE totalAdd > 0` (đếm cả sau khi remove, cả guest).
- Customers `getListCustomer`: `(totalAdd - totalRemove) > 0` (net, loại guest).

Thêm: merge KHÔNG ghi BigQuery `activities`; guest activity có `shopifyCustomerId = NULL` còn count join `ON shopifyCustomerId` → 'items added' = **0** sau merge.
Fix: INSERT 1 row `event='merge_customer'` (map guestId↔customerId) rồi count LEFT JOIN `guest_map` + `COALESCE`; nhớ `GROUP BY guestId` (ANY_VALUE) tránh đếm đôi, và loại `merge_customer` khỏi count item. (nguồn: docs/features/ly-uat-*)
