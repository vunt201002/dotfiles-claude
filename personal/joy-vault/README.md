# Joy Knowledge Base (Obsidian vault)

Lấy ý tưởng từ vault của team, cộng thêm **Dataview** để các `_MOC` và Watchlist **tự gom** note.
Mở thư mục này như một **vault** trong Obsidian.

## Cài 1 lần
1. Obsidian → **Open folder as vault** → chọn thư mục `joy-vault`.
2. Community plugins → cài & bật **Dataview** (bắt buộc — không có thì các bảng tự gom hiện dạng code).
3. Core plugins → bật **Templates** → **Template folder location** = `Templates`. Gán hotkey "Insert template".

## Cấu trúc
- `00-Index/` — [[Home]] (bản đồ) + [[🐛 Watchlist]] (bug tiềm tàng).
- `Domains/<Domain>/` — mỗi domain 1 folder: `_MOC` (tự liệt kê note) + `raw/` (ghi nhanh) + note nguyên tử.
- `Confusion/ Facing/ Handoffs/ Initiatives/ Insights/ Tasks/` — các ngăn ghi chú khác.
- `Technical/` — kỹ thuật xuyên suốt (lifecycle, data contract, endpoint...) + `Bugs/` (bug đang điều tra).
- `Templates/` — note / potential-bug / gotcha / decision / bug / raw / MOC.

## Loại note (`type` trong frontmatter)
- `how-it-works` — cơ chế, cách hoạt động (mặc định của template `note`).
- `gotcha` — cạm bẫy/điều dễ quên.
- `potential-bug` — rủi ro tiềm tàng cần để ý → tự lên [[🐛 Watchlist]] (dùng `severity`, `status`).
- `decision` — quyết định + lý do.
- `bug` — bug đang điều tra (ở `Technical/Bugs`).
- `confusion` — câu hỏi mở.
- `raw` — ghi nhanh chưa xử lý (đặt trong `raw/`).

## Dùng hằng ngày
1. Có gì cần nhớ → tạo note **trong đúng folder domain/khu vực**, Insert template phù hợp, đặt tên theo khái niệm.
2. Xong — `_MOC` của folder đó và (nếu là potential-bug) [[🐛 Watchlist]] tự cập nhật.
3. Bí thời gian thì quăng vào `raw/` rồi xử lý sau.

## Thêm domain/khu vực mới
Tạo folder mới + 1 file `_MOC.md`, Insert template `MOC`. Dataview trong MOC dùng `this.file.folder` nên tự chạy.

## Quy ước
- `status` (bug): open | watching | resolved (potential-bug) · investigating | fixed (bug).
- `severity`: low | medium | high.
- Liên kết chéo bằng `[[...]]` để Obsidian vẽ graph.
