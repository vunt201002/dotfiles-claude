---
type: potential-bug
product: wishlist
severity: high
status: open
created: 2026-06-22
updated: 2026-06-22
tags: [joy, wishlist, potential-bug]
---
# Wishlist count deflation - reattribute no remove-guard

Sau khi guest merge wishlist vào customer, app chạy ĐỒNG THỜI 2 cơ chế attribution (chủ động giữ cả 2 — feature khác phụ thuộc bản UPDATE vật lý):
- read-time: marker row `merge_customer` + CTE `guest_map` COALESCE lúc đọc.
- write-time: `reattributeGuestActivities` UPDATE các dòng activities sang customer.

## Triệu chứng / vì sao đáng ngại
`reattributeGuestActivities` (packages/functions/src/services/bigquery/customerService.js ~L413) chạy:
`UPDATE activities SET shopifyCustomerId=@customerId WHERE guestId=@guestId AND shopifyCustomerId IS NULL`
— KHÔNG filter event, KHÔNG có remove-guard. Nên re-point MỌI dòng của guest sang customer, kể cả dòng `remove` cũ. Dòng `remove` cũ lọt vào bucket customer rồi trừ nhầm vào `add` hợp lệ → read query (`valid_wishlist`: totalAdd-totalRemove>0) bị deflate → admin Customers page hiện `totalWishlist` THẤP hơn thực tế. Tự đúng lại chỉ khi customer add lại variant đó.

## Nơi liên quan
- `customerService.js` ~L413 `reattributeGuestActivities` (đường đang chạy, KHÔNG guard).
- `customerService.js` ~L376 `updateWishlistActivityCustomerForGuest` — sibling CÓ guard (`NOT EXISTS ... remove createdAt muộn hơn` + `event='add'`) nhưng là DEAD CODE, grep không ai gọi.
- Trigger: `mergeController.js` publish `AFTER_MERGE_WISHLIST` → `backgroundHandler.js` L274.

## Cần kiểm tra / hướng xử lý
- Thêm remove-guard (NOT EXISTS remove muộn hơn) vào `reattributeGuestActivities`, HOẶC chỉ re-point dòng `event='add'`.
- Reviewed (Opus, 2026-06-22), DEFER chưa fix. Đã ở master qua MR !54 / commit 99f87c5. Resolve merge bản thân SẠCH — điểm yếu có sẵn của cơ chế cũ, không phải lỗi merge.
- Marker `merge_customer` được loại đúng khỏi mọi COUNT (filter event IN 'add','remove').

Liên quan: [[Guest Wishlist]]
