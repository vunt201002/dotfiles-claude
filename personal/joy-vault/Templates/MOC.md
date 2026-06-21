---
type: moc
tags: [joy, moc]
---
# {{title}}

> Mô tả khu vực.

## 📒 Notes
```dataview
TABLE WITHOUT ID file.link AS Note, type, status, updated
WHERE file.folder = this.file.folder AND file.name != "_MOC" AND type != "raw"
SORT type ASC, file.name ASC
```
