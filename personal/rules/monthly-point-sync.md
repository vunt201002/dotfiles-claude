---
paths:
  - "**/monthly-point-sync/*.gs"
  - "**/monthly-point-sync/*.cjs"
  - "**/monthly-point-sync/*.md"
---

# monthly-point-sync — Apps Script, không phải Node app

`Code.gs` chạy trong Apps Script gắn với Google Sheet "Monthly point", **không chạy được
ở đây**. Claude không với tới sheet: deploy là Garry dán tay qua Extensions → Apps Script.
Secret duy nhất là Script Property `NOTION_TOKEN` — đừng đưa vào code.

**Cách duy nhất để verify: `node logic-test.cjs`** (nạp `Code.gs` THẬT vào `node:vm`
sandbox với Apps Script services mock). Phải xanh toàn bộ trước khi báo xong. Đuôi `.cjs`
là cố ý — `package.json` của repo là `"type": "module"`. Stop-hook của repo này tự chạy
test đó khi diff đụng thư mục này.

**Luật nghiệp vụ dễ phá khi sửa `syncNow`** (đã khoá từ 2026-06, đừng "dọn" đi):
- Row MỚI chỉ vào tab tháng hiện tại. Tab tháng cũ vẫn UPDATE được, nhưng cột
  `Have` và `Note` (H) **không bao giờ bị ghi đè**.
- Dedup theo Notion page id trên MỌI tab trước khi add.
- Trùng tên nhưng KHÁC id → vẫn add, kèm cảnh báo vào cột H. Cố ý không fuzzy match.
- Month pin: absence = calendar month. **Đừng lưu trạng thái bình thường thành giá trị** —
  quên gỡ pin chỉ hỏng tối đa 1 tháng nhờ stale guard.
