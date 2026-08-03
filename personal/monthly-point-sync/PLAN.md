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

## Dashboard pin
- **Dashboard luôn ở đầu:** `ensureMonthSheet_` gọi `pinDashboardFirst_` sau khi
  tạo tab tháng mới, đưa tab `Dashboard` (đã có sẵn, tên cấu hình ở `DASHBOARD`)
  về index 0. Menu **📌 Ghim Dashboard lên đầu** làm lại thủ công khi cần. Không
  có tab Dashboard → no-op, không lỗi.

## Màu status (theo Notion) — tự động, không nút
- **Không có nút tô màu.** `syncNow` gọi `syncStatusColors_` ở cuối mỗi lượt (trigger
  10 phút, "Sync now", `backfillCounted` đều đi qua đây) → task chuyển sang status nào
  là màu đúng ngay, không cần thao tác tay. `colorStatusesFromNotion` vẫn còn để chạy
  tay từ Apps Script editor khi cần soi/ép tô lại, nhưng **không** gắn menu.
- **Tô màu không được kéo sập sync.** Lời gọi nằm trong `try/catch` và đặt SAU
  `writeState_`: màu là việc trang trí, cộng point mới là việc chính. Lỗi Sheets/quota
  lúc dựng rule chỉ ghi log, `syncNow` vẫn trả kết quả và trigger không báo fail.
- Dựng conditional formatting cho cột Status (B) của mọi tab tháng **và** `_TEMPLATE`.
  Tô template vì `ensureMonthSheet_` tạo tab tháng mới bằng `copyTo` — copy mang theo
  formatting nên tháng sau tự có màu. `applyCachedStatusRules_` là guard cho ca
  `_TEMPLATE` chưa kịp có rule: tab mới tạo được tô ngay từ cache.
- **Cộng thêm, không thay thế.** `applyStatusRules_` chia rule hiện có thành `theirs`
  (giữ) và rule do chính code tạo (dựng lại). Rule của anh giữ nguyên thứ tự và đứng
  **đầu** danh sách — Sheets xét từ trên xuống, rule khớp đầu tiên thắng, nên đó chính
  là bảo đảm màu của anh không bị đè. Chỉ status **không** nằm trong `covered` (đọc từ
  `getCriteriaValues()` của rule `TEXT_EQUAL_TO` cột B) mới được thêm rule màu Notion.
  Nhận diện "rule của code" = cột B + `TEXT_EQUAL_TO` + cặp nền/chữ trùng khít một dòng
  `NOTION_CHIP` (so qua `getBackgroundObject()/getFontColorObject()`, chuẩn hoá
  `#aarrggbb` → `rrggbb`). Sai số luôn rơi về phía vô hại: đoán nhầm rule của anh thành
  rule của code → dựng lại y nguyên màu; không đọc ra được rule của anh phủ status nào
  (công thức / `TEXT_CONTAINS`) → cùng lắm thêm một rule thừa đứng SAU nó, màu hiển thị
  không đổi.
- **Nới range rule cũ.** Rule `TEXT_EQUAL_TO` cột B của anh mà không chạm
  `getMaxRows()` (vd `B2:B100`) được thay bằng `rule.copy().setRanges([B2:B]).build()`
  — cùng vị trí, cùng màu, cùng criteria, chỉ dài ra. Đây gần như chắc chắn là nguyên
  nhân gốc của "dòng mới không màu": dòng rơi ra ngoài range. Không đổi màu nào, nên
  không vi phạm "màu cũ giữ nguyên".
- Range rule mới luôn là `B2:B` **không chặn đuôi** — đó là thứ làm "dòng thêm sau này
  tự đúng màu" thành thật.
- **Màu lấy sống từ Notion**, không hardcode: `GET /v1/data_sources/<id>` →
  `properties.Status.status.options[].color`, gộp mọi board trong `WATCH_SOURCES`
  (trùng tên khác màu → board đầu thắng, chỉ log). Lý do: tên status hai board vốn
  đã lệch nhau (xem `COUNTED`) và còn đổi theo thời gian — bảng màu chép cứng sẽ rot
  y hệt. 10 tên màu Notion map sang chip màu light-mode ở `NOTION_CHIP`; tên màu lạ
  → fallback `default`.
- **Cache để không đốt quota:** Script Property `STATUS_COLOR_CACHE` = `{map, ts}`.
  `needStatusRefresh_` chỉ cho fetch lại khi cache thiếu / gặp status chưa có trong
  map (lấy từ chính các page vừa sync, không quét lại sheet) / cache quá 24h (bắt ca
  đổi màu mà không đổi tên). Map mới **deep-equal** map cũ → không gọi
  `setConditionalFormatRules` lần nào.
- **Không blanket-replace:** `setConditionalFormatRules()` ghi đè cả tab, nên hàm ghi
  lại đúng `theirs.concat(appended)` — mọi rule ở cột khác giữ nguyên (kể cả màu Role
  ở cột D), rule của code được dựng lại nên chạy lại không nhân đôi.
- **Partial failure phải abort:** `notionStatusOptions_` trả `null` khi HTTP ≠ 200 (khác
  `[]` = board không có option). Chỉ cần **một** board lỗi là `statusColors_().failed`
  → bỏ qua cả lượt, không đụng rule. Nếu không phân biệt, map gộp sẽ thiếu status của
  board lỗi, dựng rule theo nó sẽ **xoá màu** của board đọc được và báo nhầm mấy status
  đó là "Notion không còn" (bảo anh đi sửa tên đúng thành sai).
- Đồng thời là bước **check**: mỗi lần đọc lại bảng màu, quét Status thực tế trong các
  tab tháng và ghi đích danh status VẪN không màu (không có rule sẵn của anh trên chính
  tab đó, cũng không có trong map Notion) vào `Logger.log` (trigger không có UI). Đường
  chạy tay thì alert; `alert_` tự rơi xuống log khi không có UI. Mỗi lượt ghi rule còn
  log một dòng tổng kết giữ / nới / thêm để kiểm chứng màu cũ không bị đụng.

## Mở / rủi ro
- Role lịch sử để trống (schema DB cũ khác nhau) — chấp nhận, backfill thủ công nếu cần.
- Nếu Vũ đổi sang project DB mới → thêm DB ID vào tab Config.
- Polling lệch tháng chỉ khi transition rơi đúng đêm giao tháng (hiếm) → webhook khắc phục.
