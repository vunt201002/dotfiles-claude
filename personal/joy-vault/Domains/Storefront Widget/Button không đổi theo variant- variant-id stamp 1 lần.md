---
type: gotcha
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Button không đổi theo variant: variant-id stamp 1 lần

Root cause: `variant-id` của button product page stamp 1 lần lúc render từ `selected_or_first_available_variant`, **không cập nhật** khi đổi swatch → heart sai trạng thái, remove/add nhầm default variant. Backend luôn đúng (lưu đúng cái nhận được).

Fix: `_watchVariantChanges(btn, form)` (`index.js`) cập nhật attribute; cover 4 pattern theme: Dawn radio `data-variant-id`, `select[name=id]`, custom event `variant:changed`, theme push-URL (monkeypatch `history.pushState` → synthetic `popstate`).
Bẫy Lit: thiếu `variant-id` bị coerce thành **0** (không null) → check đúng là `if (this.variantId)`. Collection card cố ý theo product (handle), không phải bug. (nguồn: variant-wishlist-*)
