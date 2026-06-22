---
type: potential-bug
product: wishlist
severity: high
status: open
created: 2026-06-22
updated: 2026-06-22
tags: [joy, wishlist, potential-bug]
---
# Wishlist menu item identified by title only

## Triệu chứng / vì sao đáng ngại
Trên branch `fix/wishlist-menu-page-auto-inject`, hàm `buildWishlistMenuItems` (`packages/functions/src/helpers/graphql/menuHelpers.js`) nhận diện wishlist menu item **CHỈ bằng title**:
```js
const others = toMenuItemInput(existingItems).filter(
  item => item.title !== WISHLIST_MENU_ITEM_TITLE  // 'My wishlist'
);
```
Hai latent bug:
1. **Merchant đổi tên** item trong menu → lần enable lại, filter theo title cũ bị trượt → **ADD DUPLICATE** (2 link wishlist trong menu).
2. **Merchant có item trùng tên** 'My wishlist' (tự tạo, trỏ chỗ khác) → khi disable bị **XOÁ NHẦM** item của merchant.

## Nơi liên quan
- `packages/functions/src/helpers/graphql/menuHelpers.js` → `buildWishlistMenuItems`
- Gọi từ `themeService.js` → `addOrRemoveWishlistNavigation` (enable/disable menu page access).
- Const: `WISHLIST_MENU_ITEM_TITLE='My wishlist'`, `WISHLIST_PAGE_URL='/pages/joy-wishlist'` (`const/wishlistManagement.js`).

## Cần kiểm tra / hướng xử lý (đã code thử + rollback theo yêu cầu user — tạm hoãn)
Thêm helper `isWishlistMenuItem(item, wishlistPageGid)` nhận diện bền dần:
1. `resourceId === page GID` — mạnh nhất, sống sót đổi tên.
2. URL path chuẩn hoá === `/pages/joy-wishlist` (bỏ host/query/hash/trailing-slash, lowercase → khớp cả absolute url, có query, khác hoa-thường).
3. Title fallback **CHỈ khi item không có url** (cho legacy item cũ); nếu item có url trỏ chỗ khác → là của merchant, không đụng.

Đã viết 34 unit test xanh (`menuHelpers.test.js` + `menuNavigationResult.test.js` cho `needsReauth`) — chạy jest TỪ thư mục `packages/functions` (`.babelrc` có module-resolver cho alias `@functions`; chạy từ root sẽ fail resolve alias).

Phụ: package `assets` KHÔNG có test harness nào (0 test file, không jest config/jsdom) → `buildReauthUrl` chưa test được trừ khi dựng infra test cho assets.

Tất cả đã rollback, branch về nguyên trạng (title-based). Hoãn vì user muốn tạm chưa sửa chỗ này.


---
_Cập nhật 2026-06-22_

## Cập nhật (cùng phiên): branch đã xoá inline comment
Theo yêu cầu, đã xoá toàn bộ INLINE comment (`//` và CSS `/* */` giải thích "why") mà branch `fix/wishlist-menu-page-auto-inject` thêm — GIỮ lại JSDoc block. 6 file, 15 dòng comment bị xoá, KHÔNG đụng code/logic. Build (web-components + functions babel) vẫn pass; không phát sinh lint error mới (wishlist-icon.js vốn đã 170 lint issue pre-existing, không liên quan).

Hệ quả cần nhớ: phần "tại sao" của vài chỗ giờ chỉ còn trong note này, không còn trong code:
- `index.js` header icon selectors: `'cart-drawer-component'` đặt TRƯỚC `.header__icon--cart` là chủ đích cho theme **Horizon** (cart-drawer-component là con trực tiếp của header-actions; chèn trước nó để wishlist icon nằm cạnh cart). Các selector sau là Dawn-family.
- `themeService.getMenuItems`: việc đọc `getHeaderBlock` (preferredHandle) là best-effort, bọc try/catch — store mới có thể thiếu header block, KHÔNG được abort, fallback về Main menu qua selectTargetMenu.
- `designController.updateOne`: chỉ trả `menuNavigation` trong response khi merchant bật menu page; settings save vẫn success bất kể menu-inject lỗi (FR-3).
- `Design.handleChangeData`: reset `menuNavigationResult` khi user sửa data (kết quả menu-inject cũ không còn đúng, đánh giá lại ở lần save sau).

Latent bug title-matching + hướng fix isWishlistMenuItem (resourceId → url chuẩn hoá → title fallback khi không url) vẫn nguyên — CHƯA fix, đã rollback. Toàn bộ vẫn ở branch, chưa commit.
