# Monthly Point — Notion → Google Sheets sync

## Mục tiêu
Anh chỉ thao tác task trên Notion công ty. Google Sheet "Monthly point" tự cập nhật
để theo dõi số task / point / KPI, không phải nhập tay 2 chỗ.

## Nguồn & đích
- **Nguồn (read-only):** Notion công ty, integration "Joy Internal integration".
  - DB hiện tại của Vũ: `25ab0da4-49f1-8080-b2af-ddd26d6b8b05` (Joy Wishlist Product Tasks)
  - Lịch sử ở `37e9a9f0…` (Joy Loyalty Development), `cea9ddae…` — schema khác nhau.
  - Danh sách DB watch được **cấu hình** (tab Config), đổi project chỉ thêm 1 dòng.
- **Đích:** Google Sheet `Monthly point` (`1qcGnw9…`), service account `cladue-sheet@…` quyền Editor.
- User Vũ trên Notion: `168cd13f-884c-4138-bcec-bbc6ed47ea34`.

## Mapping cột (mỗi tháng = 1 tab "MM/YYYY")
| Cột | Nguồn |
|---|---|
| Task | `Task name` |
| Status | `Status` (live, badge màu) |
| Point | `Size card` (number) |
| Role | Vũ ∈ `Developer` → Dev; ∈ `Reviewer` → Reviewer (Dev ưu tiên nếu cả hai) |
| Have | checkbox — anh tự tick "đã report" |
| Card | link task (hiện "Notion ↗") |
| _(ẩn)_ TaskPageID | id trang Notion — khóa khớp dòng, không trùng tên |

## Quy tắc THÁNG (tab nào)
Tháng = tháng của **ngày task chuyển sang "Ready to Test"** (lúc point được tính).
- Notion **không lưu** ngày này, API không cho xem lịch sử status → phải **bắt lúc xảy ra**.
- Polling mỗi ~10 phút: thấy task vừa đạt "Ready to Test" (hoặc xa hơn) mà **chưa có
  trong sheet** → đóng dấu ngày hiện tại → ghi vào tab tháng đó. Chính xác tới mức tháng.
- Đã đóng dấu = **cố định tab** (point tính 1 lần). Status sau đó vẫn cập nhật live.

## KPI mỗi tab (công thức sống)
- Tổng point task = SUM(Point)
- **KPI (point nhận)** = SUMIF(Role,"Dev",Point) + 0.2 × SUMIF(Role,"Reviewer",Point)
- Point đã tính (Have) = SUMIF(Have=TRUE, Point)
- Đếm theo từng Status

## Hai phần triển khai
### Phần 1 — Backfill lịch sử (chạy 1 lần, qua API)
- Đổ 325 dòng từ Monthly Point Notion cũ vào các tab tháng, format đã duyệt
  (badge Status, dropdown Role, checkbox Have, Card rút gọn, wrap Task).
- Giữ nguyên cách gom tháng thủ công cũ. Role để trống (backfill được sau).
- 02/2025 trùng → tab giữa 03/2026 và 01/2026 sửa thành 02/2026.

### Phần 2 — Sync tự động (Apps Script + timer 10')
- Code gắn trong Sheet (Extensions → Apps Script), chạy trên server Google, không cần PC.
- Token + user id + DB list lưu ở Script Properties (không hardcode trong code).
- Mỗi lần chạy: query các DB watch cho task Vũ là Dev/Reviewer & status ≥ Ready to Test;
  upsert theo TaskPageID; task mới → đóng dấu tháng; task cũ → cập nhật Status/Point;
  **không đè** Have và Role anh chỉnh tay.
- Webhook realtime: nâng cấp sau nếu anh có quyền chỉnh integration (cùng logic).

## Mở / rủi ro
- Role lịch sử để trống (schema DB cũ khác nhau) — chấp nhận, backfill thủ công nếu cần.
- Nếu Vũ đổi sang project DB mới → thêm DB ID vào tab Config.
- Polling lệch tháng chỉ khi transition rơi đúng đêm giao tháng (hiếm) → webhook khắc phục.
