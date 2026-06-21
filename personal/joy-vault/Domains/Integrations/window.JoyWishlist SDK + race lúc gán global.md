---
type: how-it-works
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# window.JoyWishlist SDK + race lúc gán global

`window.JoyWishlist = sdk` gán **SAU** khi `orchestrator.initialize()` chạy xong, nhưng `sdk.ready` resolve **bên trong** initialize → ready resolve TRƯỚC khi global tồn tại.

⇒ Integrator PHẢI `waitForJoyWishlist()` (poll có timeout) rồi mới `await sdk.ready`. `if(!window.JoyWishlist) return` một phát = rớt integration khi load chậm (bẫy tích hợp #1).
- SDK `version` ('1.0.0') ≠ package.json version. Đừng so version bằng string `<`.
- `getWishlist()` trả ID thô (không enrich), `handle`/`addedAt` có thể `undefined` (item cũ sync từ metafield). ID luôn là string.
- Cross-app: listen event `joy-loyalty:wishlist-add/-remove`; API liên thông `GET /integrate/joy-loyalty/wishlists` auth JWT HS256.
File: `packages/web-components/src/index.js`, `src/sdk/core.js`. (nguồn: joy-sdk-public-contract*)

Liên quan: [[Technical]]
