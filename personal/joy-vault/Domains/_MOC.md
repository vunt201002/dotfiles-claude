---
type: moc
tags: [joy, moc]
---
# 🗂 Domains

> Kiến thức theo từng mảng nghiệp vụ. Mỗi domain là 1 folder có `_MOC` + `raw/`.

## Danh sách domain
```dataview
TABLE WITHOUT ID file.link AS Domain
WHERE startswith(file.folder, "Domains/") AND file.name = "_MOC" AND file.folder != "Domains"
SORT file.folder ASC
```

## 🐛 Tất cả "cần để ý" trong Domains
```dataview
TABLE WITHOUT ID file.link AS Note, product AS "App", file.folder AS "Domain", severity AS "Mức", status AS "TT"
WHERE startswith(file.folder, "Domains/") AND type = "potential-bug" AND status != "resolved"
SORT choice(severity = "high", 0, choice(severity = "medium", 1, 2)) ASC
```
