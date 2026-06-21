# Cài đặt sync Notion → Sheet (Apps Script)

Chạy 1 lần. Sau đó cứ thao tác task trên Notion, sheet tự cập nhật mỗi 10 phút.

## 1. Mở trình soạn Apps Script
- Mở Google Sheet **Monthly point**.
- Menu **Extensions → Apps Script** (Tiện ích mở rộng → Apps Script).

## 2. Dán code
- Xóa hết nội dung file `Code.gs` mặc định.
- Dán toàn bộ nội dung file `Code.gs` (trong thư mục này) vào.
- Bấm 💾 **Save**.

## 3. Khai báo token (chỗ bí mật duy nhất)
- Trong Apps Script, vào **Project Settings** (bánh răng bên trái).
- Kéo xuống **Script Properties → Add script property**:
  - Property: `NOTION_TOKEN`
  - Value: token của "Joy Internal integration" (bắt đầu bằng `ntn_`)
- **Save**.
> Token chỉ nằm ở đây, không nằm trong code → không lộ khi chia sẻ code.

## 4. Cấp quyền + chạy thử
- Quay lại tab code, chọn hàm **`syncNow`** trên thanh trên → bấm **Run**.
- Lần đầu Google hỏi quyền → **Review permissions → chọn tài khoản → Advanced → Go to project (unsafe) → Allow**.
  (An toàn: chỉ là script của chính anh, không phải bên thứ 3.)
- Xem **Execution log**: dòng `Sync done. added=… updated=… skipped=…`.

## 5. Bật tự động 10 phút
- Chọn hàm **`installTrigger`** → **Run**. Xong.
- Hoặc dùng menu trong Sheet: reload sheet → menu **🔄 Point Sync → Install 10-min auto-sync**.
- Menu **🔄 Point Sync → Sync now** để chạy tay bất cứ lúc nào.

## Cách hoạt động
- Quét các DB trong `WATCH_DBS`, lấy task anh là **Developer** hoặc **Reviewer**.
- Task **chưa có trong sheet** mà đã đạt **Ready to Test** trở đi → ghi vào tab **tháng hiện tại**
  (Point = `Size card`, Role = Dev/Reviewer, Status live, Card link, Have = chưa tick).
- Task **đã có** → cập nhật Status/Point/Role/tên; **giữ nguyên** Have và mọi chỉnh tay.
- Tab tháng mới được nhân bản từ sheet ẩn `_TEMPLATE` (giữ nguyên format/KPI).

## Đổi cấu hình (đầu file Code.gs)
- `WATCH_DBS`: thêm DB id khi anh chuyển project khác.
- `COUNTED`: danh sách status được tính (mặc định từ "Ready to Test" trở đi).
- `POINT_FIELD`: hiện là `Size card`.
- Đơn giá tiền (45.000) nằm ở công thức trong `_TEMPLATE` (ô J5), không ở code.

## Giới hạn đã biết
- Tháng gán theo **lúc sync phát hiện** task đạt Ready to Test (chính xác tới mức tháng;
  chỉ lệch nếu transition rơi đúng đêm giao tháng — hiếm). Cần chính xác tuyệt đối thì
  nâng cấp webhook sau (cùng logic).
- Nếu task đã vượt Ready to Test *trước khi* bật sync và chưa có trong sheet, nó sẽ được
  gán vào tháng hiện tại (không phải tháng thực tế nó đạt Ready to Test).
