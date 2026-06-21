---
type: moc
tags: [joy, moc]
---
# Referral

> Giới thiệu bạn, TapAffiliate, chống gian lận.

## 📒 Notes
```dataview
TABLE WITHOUT ID file.link AS Note, product AS "App", type AS "Loại", status AS "TT", updated AS "Cập nhật"
WHERE file.folder = this.file.folder AND file.name != "_MOC" AND type != "raw"
SORT product ASC, type ASC, file.name ASC
```

## 🐛 Cần để ý ở khu vực này
```dataview
TABLE WITHOUT ID file.link AS Note, product AS "App", severity AS "Mức", status AS "TT"
WHERE file.folder = this.file.folder AND type = "potential-bug" AND status != "resolved"
SORT choice(severity = "high", 0, choice(severity = "medium", 1, 2)) ASC
```

## 🗃 raw (ghi nhanh, chưa xử lý)
```dataview
LIST
WHERE file.folder = this.file.folder + "/raw"
```
