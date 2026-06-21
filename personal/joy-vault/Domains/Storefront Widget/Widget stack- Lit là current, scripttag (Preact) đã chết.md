---
type: how-it-works
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Widget stack: Lit là current, scripttag (Preact) đã chết

- `packages/web-components` (Lit 3 + Vite → `static/web-components/joy-wishlist.js`) = cái **production chạy**.
- `packages/scripttag` (Preact) vẫn build trong CI nhưng **KHÔNG load ở đâu** → legacy/tham khảo. Vài thứ hay (per-theme selector map, JS position math, ResizeObserver) chỉ có ở đây, CHƯA port sang Lit.

Inject qua **Theme App Extension**: `avada-embed.liquid` → serialize vào `window.AVADA_WISHLIST` + load bundle CDN. `WishlistOrchestrator` (`index.js`) tạo `<joy-wishlist-*>` imperatively. **First paint zero-API** (data nhúng sẵn vào window, set 1 lần lúc load, không reactive).

⇒ Khi suy luận hành vi storefront: chỉ đọc `packages/web-components`. (nguồn: bfs-master-fix-plan.md, web-components-migration.md)

Liên quan: [[Technical]]
