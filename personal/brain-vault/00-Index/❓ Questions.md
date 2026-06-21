---
type: moc
tags: [learn, index]
---
# ❓ Questions — câu hỏi mở

Tự gom mọi note `type: question` chưa `answered`. Trả lời xong đổi `status: answered` (hoặc chuyển thành concept).

```dataview
TABLE WITHOUT ID file.link AS Câu hỏi, file.folder AS "Mảng", created AS "Ngày"
WHERE type = "question" AND status != "answered"
SORT created DESC
```

## ✅ Đã trả lời
```dataview
TABLE WITHOUT ID file.link AS Note, file.folder AS "Mảng", updated AS "Ngày"
WHERE type = "question" AND status = "answered"
SORT updated DESC
```
