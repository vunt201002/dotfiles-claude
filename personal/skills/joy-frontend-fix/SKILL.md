---
name: joy-frontend-fix
description: (Đã tách) Quy trình frontend chung chuyển sang /my-frontend-fix (mọi web project); đồ Joy widget v4 (__joyDebug, layer matrix, stores) ở /joy-widget-v4-fix. Dùng hai skill đó.
type: workflow
---

# joy-frontend-fix → đã tách làm 2

Skill này tách ra cho **generic + triệt để hơn**:

- **Quy trình verify frontend chung** (Joy, Wishlist, vlxd, mọi web project) → **`/my-frontend-fix`**
- **Joy widget v4 power-tools** (`__joyDebug`, layer matrix 4 tầng, stores, css-var map) → **`/joy-widget-v4-fix`**
- **Chứng minh root cause** (mọi stack) → **`/my-bug-hunter`**

**Bug frontend Joy:** gọi `/my-frontend-fix` — nó tự trỏ sang `/joy-widget-v4-fix` cho `__joyDebug`.

Không có gì mất, chỉ dời chỗ. Các reference cũ (`references/shadow-dom.md`,
`css-variable-map.md`) vẫn nằm trong `joy-widget-v4-fix/references/`.
