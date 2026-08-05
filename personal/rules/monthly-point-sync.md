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

**Luật nghiệp vụ dễ phá khi sửa `syncNow`** (đã khoá từ 2026-06, bổ sung 2026-08; đừng "dọn" đi):
- Row MỚI chỉ vào tab tháng hiện tại. Tab tháng cũ vẫn UPDATE được, nhưng cột
  `Have` và `Note` (H) **không bao giờ bị ghi đè**.
- Dedup theo Notion page id trên MỌI tab trước khi add.
- Trùng tên nhưng KHÁC id → vẫn add, kèm cảnh báo vào cột H. Cố ý không fuzzy match.
- Month pin: absence = calendar month. **Đừng lưu trạng thái bình thường thành giá trị** —
  quên gỡ pin chỉ hỏng tối đa 1 tháng nhờ stale guard. `CLOSED_THROUGH` (chốt sổ) theo
  đúng nguyên tắc đó: vắng mặt = chưa chốt tháng nào, mốc chỉ NÂNG, hạ duy nhất qua
  đường ⏪ có người bấm Yes.
- Vùng "dòng đã dùng" là **A..H**, không phải mỗi cột A (dòng sửa tay trống tên mà B..H
  còn data từng bị add ghi đè — mất data). Cột I+ là KPI, **không** tính vào vùng này.
  Checkbox chưa tick trả `false` = trống.
- Khớp theo TÊN chỉ được dùng cho dòng ở tab CŨ HƠN mà **trống cột G**, và mỗi lần vá id
  phải để lại dấu ⚠ ở Note khi H trống. Đó là suy đoán, không phải khớp chắc — bỏ dấu đi
  là hai task trùng tên buộc nhầm nhau trong im lặng.
- Chốt sổ cấm **đúng một việc: thêm dòng mới**. Update 4 cột, ghi note, dọn dòng trùng đều
  được (Garry chốt 2026-08-05, đã cân nhắc hệ quả). Đừng thêm guard "tháng chốt miễn dọn".
- Hàm gắn **menu / trigger** phải để tên **không có gạch dưới cuối**: Apps Script coi
  `tênHàm_` là private và `addItem` gọi không ra ("Script function not found").
