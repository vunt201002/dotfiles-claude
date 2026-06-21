---
type: moc
tags: [learn, moc]
---
# 🧠 Topics

> Kiến thức học tập theo mảng. Mỗi mảng là 1 folder có `_MOC` + `raw/`.

```dataview
TABLE WITHOUT ID file.link AS Topic
WHERE startswith(file.folder, "Topics/") AND file.name = "_MOC" AND file.folder != "Topics"
SORT file.folder ASC
```
