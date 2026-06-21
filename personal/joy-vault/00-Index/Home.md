---
type: moc
tags: [joy, index]
---
# 🏠 Joy Knowledge Base

Ghi chú kiến thức 2 app **Loyalty** + **Wishlist**. Mỗi insight = 1 note trong đúng folder
domain/khu vực, gắn `product:` (wishlist | loyalty | shared). `_MOC` & Watchlist tự gom.

## 🧭 Khu vực
- [[Domains/_MOC|🗂 Domains]] · [[Confusion/_MOC|❓ Confusion]] · [[Facing/_MOC|👁 Facing]] · [[Handoffs/_MOC|🤝 Handoffs]]
- [[Initiatives/_MOC|🚀 Initiatives]] · [[Insights/_MOC|💡 Insights]] · [[Tasks/_MOC|✅ Tasks]] · [[Technical/_MOC|🔧 Technical]] · [[Technical/Bugs/_MOC|🐞 Bugs]]
- [[🐛 Watchlist]] — bug tiềm tàng cần để ý

## 📊 Theo app
```dataview
TABLE WITHOUT ID rows.product AS "App", length(rows) AS "Số note"
WHERE type != "moc" AND type != "raw"
GROUP BY product
SORT length(rows) DESC
```

## 🆕 Note gần đây
```dataview
TABLE WITHOUT ID file.link AS Note, product AS "App", file.folder AS "Khu vực", type AS "Loại", created AS "Ngày"
WHERE type != "moc" AND type != "raw"
SORT created DESC
LIMIT 15
```

## 📚 Theo khu vực
```dataview
TABLE WITHOUT ID rows.file.folder AS "Khu vực", length(rows) AS "Số note"
WHERE type != "moc" AND type != "raw"
GROUP BY file.folder
SORT length(rows) DESC
```
