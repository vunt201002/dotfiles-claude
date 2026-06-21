---
type: moc
tags: [learn, index]
---
# 🧠 Brain — Learning Knowledge Base

Ghi nhanh thứ mình học (tách khỏi công việc Joy). Mỗi insight = 1 note trong đúng mảng,
gắn `type` (concept / til / gotcha / question / snippet / resource). `_MOC` & các index tự gom.

## 🧭 Mảng
- [[Topics/_MOC|🧠 Topics]] · [[Inbox/_MOC|🗃 Inbox]]
- [[❓ Questions]] — câu hỏi mở cần trả lời

## 🆕 Note gần đây
```dataview
TABLE WITHOUT ID file.link AS Note, file.folder AS "Mảng", type AS "Loại", created AS "Ngày"
WHERE type != "moc" AND type != "raw"
SORT created DESC
LIMIT 15
```

## 📊 Theo mảng
```dataview
TABLE WITHOUT ID rows.file.folder AS "Mảng", length(rows) AS "Số note"
WHERE type != "moc" AND type != "raw"
GROUP BY file.folder
SORT length(rows) DESC
```

## 📊 Theo loại
```dataview
TABLE WITHOUT ID rows.type AS "Loại", length(rows) AS "Số note"
WHERE type != "moc" AND type != "raw"
GROUP BY type
SORT length(rows) DESC
```
