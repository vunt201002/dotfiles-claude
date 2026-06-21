---
type: potential-bug
product: wishlist
severity: medium
status: open
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Duplicate customer khi add nhanh — fix bằng Firestore claim

Customer mới bấm 'add' nhiều lần nhanh → N row trùng trong BigQuery `customers` (read-check-INSERT không atomic; BigQuery không có unique constraint, streaming buffer không thấy row mới nên MERGE/WHERE NOT EXISTS vô dụng).

Fix: dùng **Firestore làm cổng atomic** trước BigQuery — `claimCustomerCreation` claim doc `${shopId}_${shopifyCustomerId}` trong transaction, đúng 1 caller thắng & INSERT; `releaseCustomerCreation` khi INSERT fail để Pub/Sub retry tạo lại.
File: `repositories/customerSyncClaimRepository.js`, `handlers/pubsub/backgroundHandler.js`. (nguồn: docs/features/duplicate-customer-race-fix.md)
