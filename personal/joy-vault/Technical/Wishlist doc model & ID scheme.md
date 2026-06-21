---
type: how-it-works
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Wishlist doc model & ID scheme

`wishlists/{shopId}_{customerId}` — `customerId` là string mờ: chứa **Shopify customer id (số)** HOẶC **guest UUID v4** interchangeably (nên guest 'just works', merge chỉ là copy doc).

Doc: `{shopId, customerId, items[], createdAt, updatedAt, expireAt?}`; item: `{productId, variantId, handle, addedAt, price?}`.
- Guest doc có **TTL 90 ngày** (`expireAt`), refresh mỗi add/remove + mỗi lần truy cập share token.
- Customer doc **không hết hạn**.

File: `repositories/wishlistRepository.js`.

Liên quan: [[Customer Profiles]]
