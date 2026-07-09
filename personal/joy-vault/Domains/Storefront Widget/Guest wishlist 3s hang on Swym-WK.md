---
type: potential-bug
product: wishlist
severity: high
status: open
created: 2026-06-24
updated: 2026-06-24
tags: [joy, wishlist]
---
# Guest wishlist 3s hang on Swym/WK

## Triệu chứng / vì sao đáng ngại
Khi **guest wishlist feature go-live** (bật cờ `GUEST_WISHLIST_ENABLED` trong
`packages/scripttag/v4-adapters/helpers/wishlistFeatureFlags.js`), guest (khách chưa đăng nhập)
trên shop dùng **Swym** hoặc **Wishlist King** sẽ thấy wishlist tab quay loading **đúng 3 giây**
rồi mới hiện items — mỗi lần mở widget VÀ mỗi lần bấm heart (vì `handleFavoriteToggle` gọi lại
`loadWishlistItems` ở cuối).

Đã **prove runtime** (Playwright eval trên `demo.swish.app`, shop WK guest):
`waitForWishlistInit` mất `elapsed_ms: 3002`, `hasJoyWishlist: false`.

## Root cause
`loadWishlistItems` (trong `wishlistHandler.js`, chỉ tồn tại trên branch
`feature/widget-v4-guest-wishlist`) gate bằng điều kiện SAI: `if (!customer.id) await waitForWishlistInit()`
— tức "là guest" thì luôn đợi SDK. Nhưng `waitForWishlistInit` chỉ biết SDK của **Joy/Avada Wishlist**:
nó chờ `window.JoyWishlist?._initialized` hoặc event `joy-wishlist:initialized`. Swym/WK là app thứ ba,
KHÔNG tạo `window.JoyWishlist`, KHÔNG bắn event đó → rơi vào nhánh `setTimeout(..., 3000)`.

Đây là **semantic merge defect**: feature guest đúng riêng lẻ (với Avada), nhưng giả định ngầm
"guest ⟹ Joy SDK" vỡ khi gặp provider Swym/WK từ branch `integration/wishlist-apps`.

## Hiện trạng (tại sao chưa nổ)
Đã chặn tạm bằng `GUEST_WISHLIST_ENABLED = false` → `isGuestEnabled()` của Swym/WK luôn trả `false`
→ đường guest không kích hoạt → không treo. An toàn vì guest wishlist feature CHƯA live.

## Cần kiểm tra / hướng xử lý (khi go-live, bật cờ)
Sửa điều kiện gate trong `waitForWishlistInit` / `loadWishlistItems`: chỉ `await waitForWishlistInit()`
khi SDK Joy thực sự có mặt — VD `if (!customer.id && window.JoyWishlist) await waitForWishlistInit()`,
hoặc gate theo `provider.id === 'avada-wishlist'`. Swym/WK guest fetch ngay (0ms), vì chúng tự quản
guest session riêng (Swym session cookie, WK `x-appmate-sid`), không cần Joy guest UUID.

**Lưu ý branch:** code này nằm ở `feature/widget-v4-guest-wishlist`, KHÔNG có trên
`integration/wishlist-apps`. Phải sửa trên branch guest hoặc tại điểm merge — đừng quên khi bật cờ.

Per-app guest detection đã verify SDK thật và giữ sẵn sau cờ:
- Swym: `_swat.retailerSettings.Wishlist.Enabled !== false` (guest-first, không có cờ login-gate).
- WK: `WishlistKing.settings.general.wishlistAccessMode === 'UNRESTRICTED'` (verified live = UNRESTRICTED).

Liên quan: [[Storefront Widget]] [[Integrations]]
