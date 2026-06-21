---
type: moc
tags: [joy, moc]
---
# 🐞 Technical / Bugs

> Bug ĐÃ/ĐANG điều tra (triệu chứng thật). Khác với "potential-bug" ở [[🐛 Watchlist]].

## Bugs
```dataview
TABLE WITHOUT ID file.link AS Bug, product AS "App", status AS "TT", severity AS "Mức", updated AS "Cập nhật"
WHERE file.folder = this.file.folder AND file.name != "_MOC"
SORT status ASC, updated DESC
```
