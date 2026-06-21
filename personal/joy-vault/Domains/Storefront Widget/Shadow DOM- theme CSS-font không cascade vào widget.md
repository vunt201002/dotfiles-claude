---
type: gotcha
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Shadow DOM: theme CSS/font không cascade vào widget

Mọi component Lit dùng **Shadow DOM** — kể cả button (trái với plan đề xuất Light DOM cho button).

→ Font/màu của theme **KHÔNG** vào được; chỉ theming qua biến `--joy-wl-*` và `font: inherit`. Thứ gì không wire thành custom property sẽ 'lệch theme'.
Hệ quả khác: admin preview **không dùng được `@media`** — phải dùng `:host([preview])` / `:host([mobile])`.

File: `packages/web-components/src/components/wishlist-button.js`, `wishlist-drawer.js`.
