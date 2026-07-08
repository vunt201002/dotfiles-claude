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
- **Ghim tháng (ACTIVE_MONTH):** KPI thường chốt sổ trễ vài ngày — đầu tháng 7 task
  vẫn tính cho tháng 6, và mốc chốt không cố định nên không auto được, phải manual.
  Menu "⏪ Vẫn tính cho tháng trước" ghim tháng đích cho dòng MỚI (Script Property
  `ACTIVE_MONTH`); chốt sổ xong bấm "✅ Chốt: sang tháng lịch" (xoá ghim — vắng ghim
  = tháng lịch, mặc định an toàn). Guard chống quên: ghim chỉ có hiệu lực khi nó là
  tháng lịch hiện tại hoặc tháng liền trước, cũ hơn → stale, tự bỏ qua (thiệt hại
  tối đa 1 tháng). Nhắc passive: tên menu mang tháng đang tính + toast khi mở sheet
  lúc đang ghim. Ghim chỉ đổi tab đích khi ADD — update/Have/Note không đổi hành vi.

## Quy tắc thêm / cập nhật (hard rules)
1. **Không thêm task mới vào tháng cũ.** "Tháng cũ" = mọi tab khác tháng đang tính.
   Dòng mới chỉ được tạo ở tab **tháng đang tính** (tháng lịch, hoặc tháng liền
   trước khi đang ghim `ACTIVE_MONTH`). Tab tháng cũ đã chốt.
2. **Tháng cũ vẫn được update theo Notion.** Task nằm ở tab cũ mà Notion đổi
   Status / Point / Role → cập nhật tại chỗ ở tab cũ đó (vd Testing → Done).
   Checkbox **Have** và cột **Note** anh chỉnh tay không bao giờ bị đè.
3. **Trước khi thêm, verify chưa từng add ở bất kỳ tháng nào.** Khớp theo Notion
   page id trên **tất cả** tab tháng. Đã có (cùng id) → update, **không** add lại.
4. **Reviewer = Dev** về luật: chỉ được add khi status ≥ Ready to Test **và** chưa
   tồn tại ở tháng nào trước đó. Trước Ready to Test → không add.
5. **Nghi trùng (cùng tên, khác id)** → **vẫn add** vào tháng hiện tại, nhưng ghi
   cảnh báo vào cột **Note (H)**: `⚠ Nghi trùng "<tên>" ở tab MM/YYYY`. Anh tự
   check, nếu đúng trùng thì **xoá tay**. Ngoại lệ ưu tiên manual (rất ít case).

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

## Dashboard pin + board "đang xử lý"
- **Dashboard luôn ở đầu:** `ensureMonthSheet_` gọi `pinDashboardFirst_` sau khi
  tạo tab tháng mới, đưa tab `Dashboard` (đã có sẵn, tên cấu hình ở `DASHBOARD`)
  về index 0. Menu **📌 Ghim Dashboard lên đầu** làm lại thủ công khi cần. Không
  có tab Dashboard → no-op, không lỗi.
- **Board tổng hợp task đang xử lý (tab "Đang xử lý"):** Code.gs tự ghi trực
  tiếp, không phải formula. `syncInProgress_` được gọi **1 LẦN cho MỌI task**
  Dev/Reviewer ngay đầu vòng lặp `syncNow` — độc lập hoàn toàn với luồng
  COUNTED/tab tháng bên dưới (pid match / baseline / add-mới / waiting). Nếu
  status ∈ `IN_PROGRESS_STATUSES` (`Reviewing`, `To review`, `Test Production`,
  `Testing`, `Doing`) thì upsert dòng (theo pid, index riêng
  `buildInProgressIndex_`); nếu không còn thuộc nhóm đó → xoá dòng (`deleteRow`).
  5 cột A-E (Task/Status/Point/Role/Card), không có Have/Note. Quét MỌI tab tháng
  (không chỉ tháng hiện tại), tự tạo tab nếu chưa có (`ensureInProgressSheet_`).
  Hoàn toàn tự động — không cần Garry sửa gì khi có tab tháng mới hay task đổi
  status. Tách biệt khỏi RULE 1-5 và `_STATE`: tên tab không khớp `isMonthTab_`
  nên `buildIndex_` không quét vào, không ảnh hưởng dedup-theo-pageId của luồng
  chính.
  - **"Doing" nằm ngoài `COUNTED`** (task chưa từng đạt Ready to Test) nhưng vì
    `syncInProgress_` không phụ thuộc `isCounted_`, task đang Doing vẫn lên được
    tab này ngay từ lần sync đầu tiên — kể cả task đó chưa từng và có thể
    KHÔNG BAO GIỜ xuất hiện ở bất kỳ tab tháng nào (Doing không tính KPI).
  - **Sort theo priority:** sau khi mọi upsert/xoá trong lần sync xong,
    `sortInProgressSheet_` sắp lại TOÀN BỘ tab theo đúng thứ tự
    `IN_PROGRESS_STATUSES` (index trong mảng = rank). Đọc lại bằng
    `getFormulas()` cho cột Card để không mất công thức `HYPERLINK` khi viết
    lại thứ tự mới. Status lạ (không có trong mảng, hiếm — vd Notion đổi tên
    status) bị đẩy xuống cuối, không crash. Chạy lại mỗi lần sync (10 phút/lần)
    nên thứ tự có thể đổi nếu có task đổi status — đánh đổi lấy sự đơn giản/đáng
    tin cậy so với tự tính vị trí chèn/dịch chuyển từng dòng.
- **Style tab "Đang xử lý":** `styleInProgressSheet_` chạy đúng 1 lần trong
  `ensureInProgressSheet_` lúc tab được tạo — copy format header (font/màu nền)
  từ `_TEMPLATE`, copy conditional format rule của cột Status (`getColumn() === 2`)
  VÀ cột Role (`getColumn() === 4`) sang đúng cột tương ứng (B/D) của tab mới —
  cùng vị trí cột ở cả 2 sheet nên copy thẳng, chỉ đổi vùng áp dụng. Rule khác
  (vd Have ở cột E của `_TEMPLATE`) không mang sang. Set bold header + freeze row
  1, ẩn cột F (pid), set wrap text cho cột Task (A2:A1000) để tên task dài xuống
  dòng thay vì bị cắt — khớp tab tháng. Các lần `syncNow` sau chỉ `setValues`,
  không style lại — không ghi đè chỉnh sửa tay của Garry sau khi tab đã tồn tại.

## Mở / rủi ro
- Role lịch sử để trống (schema DB cũ khác nhau) — chấp nhận, backfill thủ công nếu cần.
- Nếu Vũ đổi sang project DB mới → thêm DB ID vào tab Config.
- Polling lệch tháng chỉ khi transition rơi đúng đêm giao tháng (hiếm) → webhook khắc phục.
