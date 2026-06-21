---
type: moc
tags: [joy, index]
---
# 🐛 Watchlist — Bug tiềm tàng & điều cần để ý

Tự gom mọi note `type: potential-bug` chưa `resolved` toàn vault, sắp theo mức độ.

```dataview
TABLE WITHOUT ID file.link AS Note, product AS "App", file.folder AS "Khu vực", severity AS "Mức", status AS "TT", created AS "Ngày"
WHERE type = "potential-bug" AND status != "resolved"
SORT choice(severity = "high", 0, choice(severity = "medium", 1, 2)) ASC, created DESC
```

## ✅ Đã xử lý
```dataview
TABLE WITHOUT ID file.link AS Note, product AS "App", file.folder AS "Khu vực", created AS "Ngày"
WHERE type = "potential-bug" AND status = "resolved"
SORT created DESC
```
