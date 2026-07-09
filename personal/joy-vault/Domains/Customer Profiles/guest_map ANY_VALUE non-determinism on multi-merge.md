---
type: potential-bug
product: wishlist
severity: low
status: open
created: 2026-06-22
updated: 2026-06-22
tags: [joy, wishlist, potential-bug]
---
# guest_map ANY_VALUE non-determinism on multi-merge

## Triệu chứng / vì sao đáng ngại
CTE `guest_map` dùng `ANY_VALUE(shopifyCustomerId) ... GROUP BY guestId` để map guest đã merge sang customer. Nếu MỘT guest từng merge vào HAI customer khác nhau (vd máy/browser dùng chung: customer A login → merge guest G vào A; sau đó customer B login cùng browser, G chưa rotate → merge G vào B) → có 2 marker row, 2 shopifyCustomerId. `ANY_VALUE` chọn 1 cái TÙY Ý, không ổn định giữa các lần query → `totalWishlist` của A nhảy qua lại giữa A và B mỗi lần load trang Customers.

## Nơi liên quan (CẢ 2 bản phải sync)
- `packages/functions/src/services/bigquery/customerService.js:300` (guest_map trong queryCustomerRows)
- `packages/functions/src/services/bigquery/activitiesService.js:23` (bản mirror — comment ngay trên đã ghi "must mirror customerService — keep in sync")

## Cần kiểm tra / hướng xử lý
- Thay `ANY_VALUE` bằng deterministic last-merge-wins:
  `ROW_NUMBER() OVER (PARTITION BY guestId ORDER BY createdAt DESC)` rồi lấy rn=1.
- Sửa ĐỒNG THỜI cả 2 bản (nếu chỉ sửa 1 sẽ lệch).
- Blast radius nhỏ: cần case shared-device double-merge (hiếm), và bị cơ chế UPDATE cũ che bớt (sau khi reattribute physical re-point thì read không còn phụ thuộc guest_map cho dòng đó).
- Reviewed (Opus, 2026-06-22), DEFER chưa fix. Đã ở master. Liên quan bug đếm thiếu: [[Wishlist count deflation - reattribute no remove-guard]].

Liên quan: [[Guest Wishlist]]
