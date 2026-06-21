---
type: moc
tags: [learn, moc]
---
# CS Fundamentals

> OS, networking, concurrency, compilers, memory.

## 📒 Notes
```dataview
TABLE WITHOUT ID file.link AS Note, type AS "Loại", status AS "TT", updated AS "Cập nhật"
WHERE file.folder = this.file.folder AND file.name != "_MOC" AND type != "raw"
SORT type ASC, file.name ASC
```

## ❓ Câu hỏi mở ở mảng này
```dataview
TABLE WITHOUT ID file.link AS Note, created AS "Ngày"
WHERE file.folder = this.file.folder AND type = "question" AND status != "answered"
SORT created DESC
```

## 🗃 raw (ghi nhanh, chưa xử lý)
```dataview
LIST
WHERE file.folder = this.file.folder + "/raw"
```
