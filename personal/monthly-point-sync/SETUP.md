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
- Xem **Execution log**: dòng `Sync done. added=… updated=… baseline=… waiting=…`.

## 5. Bật tự động 10 phút
- Chọn hàm **`installTrigger`** → **Run**. Xong.
- Hoặc dùng menu trong Sheet: reload sheet → menu **🔄 Point Sync → Install 10-min auto-sync**.
- Menu **🔄 Point Sync → Sync now** để chạy tay bất cứ lúc nào.

## Quét bù task bị sót
- Sync tự động chỉ ghi task khi **bắt được lúc nó chuyển** sang Ready to Test trở đi.
  Task đi quá nhanh giữa 2 nhịp 10 phút, hoặc task không-cần-test kéo **thẳng** sang
  To Review/Reviewing (bỏ qua Ready to Test), đôi khi không được bắt → bị sót.
- Khi thấy thiếu: menu **🔄 Point Sync → Kéo task counted còn thiếu (quét bù)**.
  Nó quét mọi task đang ở status counted mà **chưa có** trong sheet và kéo về **tháng
  đang tính** (tháng lịch, hoặc tháng đã ghim — xem mục ghim tháng bên dưới). Chống
  trùng theo id/tên nên bấm nhiều lần vẫn an toàn (task đã có chỉ được cập nhật,
  không ghi lại).
- Sau khi quét, nếu task thực tế đạt mốc ở tháng khác, **kéo dòng sang tab đúng** —
  nút này gán theo tháng đang tính lúc bấm, không phải tháng task thật sự chuyển trạng thái.

## Đầu tháng mà vẫn tính cho tháng trước (ghim tháng)
- KPI thường chốt sổ trễ vài ngày: sang đầu tháng 7 nhưng task vẫn tính cho tháng 6.
  Mốc chốt không cố định nên không auto — anh tự bấm:
- **⏪ Vẫn tính cho tháng trước (06/2026)**: từ lúc bấm, task MỚI được ghi vào tab
  tháng trước thay vì tháng lịch. Label tự điền đúng tháng, không phải gõ gì.
- Chốt sổ xong: **✅ Chốt: sang tháng lịch (07/2026)** — gỡ ghim, về bình thường.
- **An toàn khi quên gỡ:** ghim cũ hơn tháng liền trước tự bị bỏ qua (quay về tháng
  lịch, lệch tối đa 1 tháng). Đang ghim thì mỗi lần mở sheet có toast nhắc, và tên
  menu luôn hiện tháng đang tính (`🔄 Point Sync — tháng 06/2026`).
- Ghim chỉ đổi tab cho dòng MỚI (kể cả quét bù). Update dòng cũ / Have / Note giữ
  nguyên hành vi. Ghim lưu ở Script Property `ACTIVE_MONTH` — chỉ thao tác qua menu,
  không cần sửa tay.

## Cách hoạt động
- Quét các data source trong `WATCH_SOURCES`, lấy task anh là **Developer** hoặc **Reviewer**.
- Task **chưa có trong sheet** mà đã đạt **Ready to Test** trở đi → ghi vào tab **tháng
  đang tính** — tháng lịch, hoặc tháng đã ghim qua menu (xem mục ghim tháng ở trên)
  (Point = `Size card`, Role = Dev/Reviewer, Status live, Card link, Have = chưa tick).
- Task **đã có** (khớp theo Notion page id, ở **bất kỳ** tab tháng nào) → cập nhật
  Status/Point/Role/tên ngay tại tab đó, kể cả tab tháng cũ; **giữ nguyên** Have và Note.
- **Không bao giờ** thêm dòng mới vào tab tháng cũ — dòng mới chỉ vào tháng hiện tại.
- **Reviewer xử như Dev**: chỉ add khi status ≥ Ready to Test và chưa có ở tháng nào trước.
- **Nghi trùng** (cùng tên, khác id — vd task từ board cũ): vẫn add, nhưng ghi cảnh báo
  `⚠ Nghi trùng "<tên>" ở tab MM/YYYY` vào cột **Note (H)**. Anh check rồi xoá tay nếu trùng thật.
- Tab tháng mới được nhân bản từ sheet ẩn `_TEMPLATE` (giữ nguyên format/KPI). Cột H
  (Note) để trống trong template, code chỉ ghi khi có nghi trùng; summary/KPI ở cột I trở đi.

## Đổi cấu hình (đầu file Code.gs)
- `WATCH_SOURCES`: thêm data source id khi anh chuyển project khác.
- `COUNTED`: danh sách status được tính (mặc định từ "Ready to Test" trở đi).
- `POINT_FIELD`: hiện là `Size card`.
- Đơn giá tiền (45.000) nằm ở công thức trong `_TEMPLATE` (ô J5), không ở code.

## Ghim tab Dashboard lên đầu
- Tab **Dashboard** (đã có sẵn trong sheet) tự động được đưa về vị trí đầu tiên mỗi
  khi có tab tháng mới được tạo (Code.gs làm việc này trong `ensureMonthSheet_`).
- Nếu thứ tự bị lệch vì lý do khác (vd anh tự kéo thả tab), dùng menu **🔄 Point
  Sync → 📌 Ghim Dashboard lên đầu** để đưa nó về đầu bất cứ lúc nào.
- Nếu tab Dashboard bị đổi tên hoặc xoá, code không lỗi — chỉ đơn giản bỏ qua bước
  ghim (menu sẽ báo "Không tìm thấy tab Dashboard").

## Board tổng hợp "task còn cần process" (tab "Đang xử lý")
Tab **Đang xử lý** tự động chứa mọi task đang ở status **Reviewing, To review,
Test Production, Testing, Doing** — gom từ TẤT CẢ tab tháng (cả tháng hiện tại
lẫn tháng cũ) VÀ cả task chưa từng đạt Ready to Test (Doing). Hoàn toàn tự động,
không formula, không thao tác tay:

- Tab này **tự được tạo** ở lần `syncNow` đầu tiên sau khi cập nhật code (nếu
  chưa có). Không cần tạo tay, không cần đặt tên — code luôn dùng đúng tên
  "Đang xử lý" (hằng số `IN_PROGRESS` đầu Code.gs).
- Mỗi lần `syncNow` chạy (auto mỗi 10 phút, hoặc bấm **Sync now** tay), với MỖI
  task: nếu status hiện tại thuộc 5 status theo dõi → dòng được **thêm mới** (nếu
  chưa có) hoặc **update tại chỗ** (nếu đã có). Nếu status KHÔNG còn thuộc nhóm
  đó nữa (vd chuyển sang Done, hoặc lùi về status khác) → dòng bị **xoá** khỏi
  tab này. Dữ liệu thật vẫn nguyên vẹn ở tab tháng gốc — tab Đang xử lý chỉ là
  1 mirror, xoá ở đây không mất gì.
- 5 cột: Task, Status, Point, Role, Card (không có Have/Note — đây là working
  view để theo dõi, không phải nơi chốt KPI; Have/Note vẫn sống ở tab tháng gốc).
- **Không cần làm gì khi có tab tháng mới** — code tự quét mọi tab tháng
  (`MM/YYYY`) mỗi lần sync, không giới hạn ở tháng hiện tại.
- Đơn giá thêm ~1 lần ghi/xoá dòng cho mỗi task đang trong nhóm theo dõi, mỗi
  lần sync — không đáng kể ở quy mô hiện tại.

**Thứ tự hiển thị (sort theo priority):** sau mỗi lần sync, toàn bộ tab được sắp
lại theo đúng thứ tự **Reviewing → To review → Test Production → Testing →
Doing**. Thứ tự này lấy trực tiếp từ mảng `IN_PROGRESS_STATUSES` — status đứng
trước trong mảng thì dòng đứng trước trong tab. Vì sort chạy lại mỗi 10 phút,
thứ tự hiển thị có thể đổi giữa các lần sync nếu có task đổi status (vd task
đang Testing chuyển sang Reviewing sẽ nhảy lên đầu ở lần sync kế tiếp) — đây là
đánh đổi chủ động để giữ logic đơn giản, thay vì tự tính vị trí chèn/dịch chuyển
từng dòng.

**Đổi thứ tự hoặc danh sách status theo dõi:** sửa mảng `IN_PROGRESS_STATUSES`
đầu Code.gs — vừa là danh sách lọc, vừa là thứ tự sort (index trong mảng =
priority hiển thị). Mặc định: `Reviewing`, `To review`, `Test Production`,
`Testing`, `Doing`. Lưu ý: `Reviewing`/`To review`/`Testing`/`Test Production`
là đúng tên Code.gs dùng trong `COUNTED`, nhưng **`Doing` KHÔNG có trong
`COUNTED`** — task ở status này chưa từng (và có thể sẽ không bao giờ) đạt Ready
to Test, nên nó chưa từng và sẽ không xuất hiện ở bất kỳ tab tháng nào (không
tính KPI/point). Tab Đang xử lý vẫn hiển thị được nó vì `syncInProgress_` chạy
độc lập, không phụ thuộc `isCounted_`/`COUNTED`.

**Hình thức (header + màu Status + màu Role + ẩn cột khoá nội bộ):** khi tab
Đang xử lý được tạo lần đầu, code tự đồng bộ giống tab tháng:
- Header (Task/Status/Point/Role/Card) copy format từ `_TEMPLATE` (font/màu nền)
  + set bold, freeze row 1.
- Conditional formatting tô màu theo Status VÀ theo Role (2 rule đang áp cho tab
  tháng ở `_TEMPLATE`) được copy nguyên sang đúng cột Status/Role của tab Đang
  xử lý — badge màu giống hệt tab tháng (Reviewing tím, Testing vàng, Dev xanh
  dương, Reviewer cam, v.v.), không cần set tay lại.
- Cột F (pid — khoá match nội bộ dùng để biết dòng nào ứng với task nào) bị ẩn
  tự động, giống cách tab tháng ẩn cột TaskPageID.
- Cột Task (A) được set wrap text sẵn cho cả vùng data (A2:A1000) — tên task dài
  xuống dòng thay vì bị cắt, giống hệt tab tháng. Set trước ở đây (lúc tạo tab)
  nên mỗi dòng mới thêm sau tự thừa hưởng, không cần style lại mỗi lần sync.
- **Chỉ chạy 1 LẦN lúc tạo tab.** Nếu sau đó anh tự chỉnh thêm màu/font trong
  Sheet, các lần sync tiếp theo không ghi đè lại (`syncNow` chỉ gọi `setValues`,
  không đụng style). Muốn style lại từ đầu: xoá hẳn tab "Đang xử lý", lần sync
  kế tiếp sẽ tự tạo + style lại từ `_TEMPLATE`.
- Nếu `_TEMPLATE` không tồn tại lúc tạo tab (hiếm, vd bị xoá nhầm): tab vẫn được
  tạo với style cơ bản (bold header, freeze, ẩn cột F) nhưng bỏ qua phần đồng bộ
  màu/font từ `_TEMPLATE` — không lỗi, không chặn sync.

## Giới hạn đã biết
- Tháng gán theo **lúc sync phát hiện** task đạt Ready to Test (chính xác tới mức tháng;
  chỉ lệch nếu transition rơi đúng đêm giao tháng — hiếm). Cần chính xác tuyệt đối thì
  nâng cấp webhook sau (cùng logic).
- Nếu task đã vượt Ready to Test *trước khi* bật sync và chưa có trong sheet, nó sẽ được
  gán vào tháng hiện tại (không phải tháng thực tế nó đạt Ready to Test).
