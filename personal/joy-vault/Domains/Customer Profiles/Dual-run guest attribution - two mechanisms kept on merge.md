---
type: decision
product: wishlist
created: 2026-06-22
updated: 2026-06-22
tags: [joy, wishlist]
---
# Dual-run guest attribution - two mechanisms kept on merge

## Bối cảnh
Khi merge nhánh feat/build-for-shopify-v2 (BFS) vào master (MR !54 / commit 99f87c5), hai nhánh có HAI kiến trúc khác nhau để gắn (attribute) hoạt động wishlist của guest sang customer sau khi guest đăng nhập & merge:
- **Read-time (mới, của BFS branch — commit 5856077):** lúc merge INSERT 1 marker row `merge_customer` (event=ACTIVITY_MERGE_CUSTOMER_EVENT, guestId+shopifyCustomerId, không variantId). Lúc ĐỌC thì query trong `customerService.queryCustomerRows` dùng CTE `guest_map` + COALESCE(a.shopifyCustomerId, m.shopifyCustomerId) để gộp activity của guest vào customer. Không sửa dữ liệu cũ, rẻ về BigQuery (không DML), giữ lịch sử guest.
- **Write-time (cũ, của master — f427f2e):** lúc merge publish `AFTER_MERGE_WISHLIST` → backgroundHandler → `reattributeGuestActivities` chạy UPDATE activities SET shopifyCustomerId WHERE guestId AND shopifyCustomerId IS NULL. Ghi đè vật lý các dòng cũ, query đọc đơn giản, nhưng tốn DML mỗi merge và mất dấu guest.

## Quyết định
Giữ CẢ HAI cơ chế chạy song song (không bỏ bên nào) khi resolve merge. Cụ thể: mergeController vừa INSERT marker + publish AFTER_ACTION_WISHLIST (read-time path), VỪA publish AFTER_MERGE_WISHLIST (write-time path). Metafield chỉ publish 1 lần (bỏ bản trùng của master).

## Lý do
- Cơ chế mới (read-time) là hướng đi của BFS branch, nhưng các FEATURE KHÁC vẫn đang phụ thuộc vào việc activities được UPDATE vật lý sang customer → không thể bỏ write-time ngay.
- Bỏ write-time sẽ làm dead code `AFTER_MERGE_WISHLIST` case trong backgroundHandler + build-break (reattributeGuestActivities bị import/gọi).

## Nợ kỹ thuật (cần dọn sau)
- Đây là TRÙNG LẶP có chủ đích — lý tưởng là hội tụ về MỘT cơ chế (ưu tiên read-time guest_map) khi đã gỡ được các phụ thuộc vào bản UPDATE vật lý.
- Chạy song song chính là ROOT của 2 bug đã ghi: đếm thiếu wishlist (reattribute không có remove-guard) [[Wishlist count deflation - reattribute no remove-guard]], và count nhảy khi multi-merge (ANY_VALUE) [[guest_map ANY_VALUE non-determinism on multi-merge]].
- Reviewed (Opus, 2026-06-22). Resolve merge bản thân SẠCH; đây là tech-debt thiết kế, không phải lỗi merge.

Liên quan: [[Guest Wishlist]]
