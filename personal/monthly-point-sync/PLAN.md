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
| TaskPageID (G) | id trang Notion — khoá khớp dòng, không trùng tên. **Hiện, không còn ẩn** |

**Ai sở hữu cột nào** (chốt 2026-08-06 vòng 2 — nền của luật xoá):
- **Script sở hữu A..D** (Tên / Status / Point / Role): bốn cột duy nhất đường update ghi
  vào, và là tín hiệu duy nhất để đọc ra "anh đã xoá task này".
- **Anh sở hữu E (`Have`) và H (`Note`)**: script không bao giờ đè, và cũng không đọc
  chúng để đoán dòng còn sống hay không.
- **F (`Card`) do script ghi nhưng anh xoá được** — ô trống thì được vá lại, link anh sửa
  thì không bị đè.
- **G giữ page id**, là cái ghim chống add lại; nó phải HIỆN để anh nhìn thấy mình đang
  để lại cái gì khi xoá dòng.

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
- **Chốt sổ (CLOSED_THROUGH):** Script Property giữ MỘT tháng `MM/YYYY` — mọi tab tháng
  ≤ mốc đó đã chốt, **không nhận dòng MỚI** nữa. Vắng mốc = chưa chốt tháng nào (cùng
  nguyên tắc với `ACTIVE_MONTH`: không lưu trạng thái bình thường thành giá trị). Nút
  "✅ Chốt: sang tháng lịch" vừa gỡ ghim vừa nâng mốc lên tháng liền trước — **chỉ nâng,
  không bao giờ hạ**, nên bấm lại không mở lại tháng đã chốt. Không có nút thứ hai: sang
  tháng mới thì tháng cũ đóng, đó là một hành động chứ không phải hai.
  Ghim trỏ vào tháng đã chốt bị **bỏ qua** (log + toast) → task mới về tháng lịch; đây
  chính là ca "đã sang tháng 8 mà task vẫn rơi vào tab tháng 7". Mở lại: bấm "⏪ Vẫn tính
  cho tháng trước" khi tháng đó đã chốt sẽ **hỏi xác nhận** (Yes → hạ mốc đúng một bậc
  rồi ghim; No / không có UI → không làm gì). So tháng bằng số thứ tự `year*12+month`,
  không so chuỗi (`12/2025` > `01/2026`) và không đi qua `Date` (timezone).

## Quy tắc thêm / cập nhật (hard rules)
1. **Không thêm task mới vào tháng cũ.** "Tháng cũ" = mọi tab khác tháng đang tính.
   Dòng mới chỉ được tạo ở tab **tháng đang tính** (tháng lịch, hoặc tháng liền
   trước khi đang ghim `ACTIVE_MONTH`). Tab tháng cũ đã chốt.
2. **Tháng cũ vẫn được update theo Notion.** Task nằm ở tab cũ mà Notion đổi
   Status / Point / Role → cập nhật tại chỗ ở tab cũ đó (vd Testing → Done).
   Checkbox **Have** và cột **Note** anh chỉnh tay không bao giờ bị đè.
   **Ngoại lệ BIA MỘ (ca thật 2026-08-06):** dòng **trống hết A..D** mà cột G còn id
   = anh đã xoá task này. Update **bỏ qua hẳn** dòng đó — không ghi
   lại tên/status/point/role, không vá link Card, không làm keeper của rule 8. Nó chỉ
   nằm đó ghim pid trong `byPid` để task không bị add lại chỗ khác. Đếm vào
   `tombstones` + log. Trước đây đường update "hồi sinh" đúng dòng anh vừa xoá — mọi
   guard đều được tôn trọng mà kết quả vẫn ngược ý anh. Xem thêm rule 10.
   Ba điểm tinh của phép thử bia mộ, mỗi điểm là một lỗ đã bịt:
   - **Chỉ đọc A..D. E, F và H đều KHÔNG được xét** (mở rộng 2026-08-06 vòng 2, sau khi
     bản đầu vẫn hồi sinh 2 task Reviewer ở `07/2026`). Phép thử cũ đòi trống cả A..F lẫn
     H; thao tác thật của anh là quét mấy cột **nhìn thấy được** A..D rồi bấm Delete, nên
     ô tick `Have` và link Card sống sót và dòng **không bao giờ** thành bia mộ — đường
     update ghi lại sạch sẽ Tên/Status/Point/Role, task hiện ở cả tháng cũ lẫn dòng anh gõ
     tay ở tháng mới, KPI hai tháng đếm đôi. Ranh giới đo được của bản cũ: sống sót một ô
     bất kỳ trong A/B/C/D, **E=TRUE**, **F có link**, hoặc **H có chữ anh gõ** là dòng
     được hồi sinh; chỉ `E=false` và note 🤖 của script mới tính là trống.
     Tín hiệu bây giờ đọc đúng **chữ của chính script** (A..D) và không đọc gì khác.
   - **Cột H cũng bị bỏ qua, kể cả note anh gõ tay** (đổi ý so với bản trước, cố ý). H là
     cột của ANH: gõ "đã chuyển sang tháng 8" vào đó là **lời giải thích việc xoá**, không
     phải bằng chứng dòng còn dùng — giữ nó làm chốt chặn thì đúng thao tác tự nhiên nhất
     lại là thao tác bị script chống lại mỗi 10 phút. Luật **không** đổi ở chỗ quan trọng
     nhất: chữ anh gõ ở H **không bao giờ bị đè**.
   - **Bia mộ chỉ là bia mộ khi pid đó có `stamped` trong `_STATE`.** Hình dạng "A..D trống
     mà G còn id" là bề ngoài; cái làm nên bia mộ là dấu script TỪNG đặt dòng ở đó. Pid chưa
     từng stamp mà xuất hiện ở G một dòng trống chỉ có thể là anh vừa dán id vào để buộc
     task — coi là bia mộ thì task vừa bị ghim pid vừa không có dòng ở đâu, rơi khỏi KPI
     trong im lặng. Ca đó script **điền cả dòng** cho anh.
   - **Dòng SỐNG luôn thắng bia mộ trong `byPid`.** `ensureMonthSheet_` đưa tab tháng mới
     về index 0 nên tab CŨ được duyệt SAU CÙNG; kiểu "ghi sau thắng" để bia mộ tháng cũ
     chiếm chỗ dòng sống tháng mới mang cùng pid và đóng băng nó vĩnh viễn (đúng ca
     copy nguyên dòng gồm cột G sang tháng mới rồi xoá ô hiện của tháng cũ). Dòng sống
     là thông tin; bia mộ là sự VẮNG MẶT của thông tin.
   **Bia mộ tắt đường hồi sinh VÀ đường vá id theo tên, nhưng không tắt rule 8.**
   - **Rule 8 (soi bản sao ở tab khác) vẫn chạy đủ** cho pid đó — bia mộ chỉ nói "dòng NÀY
     anh đã xoá", nó không nói gì về các BẢN SAO cùng task ở tab khác. `return` sớm từng
     tắt cả nó: hai bản sao ở hai tháng cùng sống sót làm KPI đếm đôi trong im lặng. Bia mộ
     vẫn **không được làm keeper**, nên seed của rule 8 ở nhánh này là dòng tháng cũ nhất
     mang đúng tên. Trong nhánh bia mộ rule 8 **không bao giờ dọn được dòng nào** (dòng dọn
     được phải có CẢ Card lẫn id, mà có id thì nó là dòng SỐNG và thắng bia mộ trong `byPid`
     — hết bia mộ), nên nó cũng không vá id vào keeper: chỉ ghi note + đếm.
   - **Rule 7 (vá id theo TÊN vào dòng tay ở tab cũ hơn) thì KHÔNG chạy.** Vá theo tên là
     suy đoán — chính rule 7 tự cảnh báo tên chung đụng nhau. Vá cho một pid đã là bia mộ
     thì dòng tay ở tab cũ mang id của task anh vừa xoá: lượt sau nó khớp bằng id, hết là
     bia mộ, rơi vào đường update và bị ghi đè Tên/Status/Point/Role + vá link — mất Point
     và Role anh gõ tay, và task đã xoá sống lại trong KPI tháng đó. `CLOSED_THROUGH` không
     đỡ được vì chốt sổ chỉ chặn ADD. Lý do cũ ("`return` sớm làm dòng thiếu id mồ côi vĩnh
     viễn") không áp cho pid đã là bia mộ: bia mộ + `stamped` đã chặn re-add rồi, nên phép
     vá không mua thêm gì. Dòng tay nằm im đúng như anh gõ; muốn nó sống theo Notion thì
     tự dán id vào ô G (dòng sống thắng bia mộ, lượt sau update đúng dòng đó).
3. **Trước khi thêm, verify chưa từng add ở bất kỳ tháng nào.** Khớp theo Notion
   page id trên **tất cả** tab tháng. Đã có (cùng id) → update, **không** add lại.
4. **Reviewer = Dev** về luật: chỉ được add khi status ≥ Ready to Test **và** chưa
   tồn tại ở tháng nào trước đó. Trước Ready to Test → không add. So tên status trong
   `COUNTED` **không phân biệt hoa thường**: hai board tự đổi tên theo thời gian, lệch
   đúng một chữ cái là task hỏng im lặng (không được tính, không ai thấy tới lúc soát KPI).
5. **Nghi trùng (cùng tên, khác id)** → **vẫn add** vào tháng hiện tại, nhưng ghi
   cảnh báo vào cột **Note (H)**: `🤖 Nghi trùng "<tên>" ở tab MM/YYYY`. Anh tự
   check, nếu đúng trùng thì **xoá tay**. Ngoại lệ ưu tiên manual (rất ít case).
6. **Tháng đã chốt sổ không nhận dòng mới.** Tab tháng ≤ `CLOSED_THROUGH` bị chặn ADD
   ngay tại chỗ — không ghi dòng, và **không tạo tab** tháng đó từ `_TEMPLATE`. Update
   thì vẫn chạy đủ (Status/Tên/Point/Role), `Have` + `Note` vẫn bất khả xâm phạm. Mọi
   ca bị chặn đều được đếm, log và hiện trong alert của "quét bù" — không chặn im lặng.
7. **Task đã có ở tab tháng CŨ HƠN thì không kéo lại về tháng đang tính.** Khớp theo
   page id là chính (rule 3). Thêm: khớp theo **tên** khi dòng cũ **trống cột G** — đó
   là dòng anh gõ tay / cắt-dán thiếu cột, không có id nên không khớp id được và cứ bị
   add lại mỗi lượt. Khớp kiểu này thì **vá luôn page id vào ô G trống** để lần sau khớp
   bằng id. **Không bao giờ ghi đè G đã có.** Tên trùng mà G có id KHÁC vẫn add (rule 5)
   — chặn theo tên vô điều kiện sẽ nuốt mất task mới trùng tên ("Fix bug", "Review PR").
   Vá theo tên là suy đoán chứ không phải khớp chắc, nên nó phải **để lại dấu**: ghi
   `🤖 Tự gán Notion id theo tên task` vào `Note` (H) **khi H đang trống**. Không
   có dấu này, hai task trùng tên bị buộc nhầm vào nhau sẽ im lặng mãi — Execution log
   chỉ giữ vài ngày. Note anh tự gõ vẫn không bao giờ bị đè.
   So tên **quy ký tự đánh máy đẹp về dạng thẳng trước**: nháy cong `“ ” ‘ ’` và gạch dài
   `– —` của Notion vs nháy thẳng gõ tay trong Sheets. Không quy về một mối thì hai chuỗi
   nhìn y hệt nhau vẫn trượt nhau, và task lại bị kéo sang tháng mới.
   **Không vá cho pid đã là BIA MỘ** (xem rule 2): vá xong dòng tay mang id của task đã
   xoá và lượt sync kế tiếp ghi đè lên chính dòng đó. Chỉ có đúng MỘT chỗ gọi phép vá này,
   nằm ở đường add bình thường bên dưới.
   **Khối này đứng NGOÀI cổng "có vừa vượt mốc không" của rule 4 — đừng dồn nó vào trong.**
   Vá id là sửa dữ liệu, không phải quyết định đóng dấu point, nên nó không được phụ thuộc
   vào việc task có đang vượt mốc. Nằm trong cổng thì task đã counted từ trước (`prev[pid]`
   đã counted) không bao giờ đi vào được, nên dòng thiếu id ở tháng cũ nằm hỏng vĩnh viễn:
   lượt sync 10 phút không tự lành, phải có người nhớ bấm "quét bù". Ca thật 2026-08-05.
8. **Khớp id xong vẫn phải soi theo TÊN xem task có nằm ở tab tháng khác nữa không.**
   Khớp id chỉ trả lời "task này đang ở đâu", không trả lời "nó có ở chỗ khác nữa không".
   Một dòng trùng ở tab tháng khác mà lại **giữ page id** thì mọi lượt sync sau đều bám
   vào nó, `return` ngay tại đó, và dòng bên kia không bao giờ được với tới — mồ côi vĩnh
   viễn, im lặng, không ai thấy. Ca thật 2026-08-05: 4 task nằm ở cả `07/2026` lẫn
   `08/2026`, id ở bên tháng 8, nên luật 7 không bao giờ chạm được dòng tháng 7.
   Phân biệt hai ca bằng **PAGE ID**, không bằng độ giống của tên — `normTitle_` vốn đã
   là so khít, không có bậc "nghe tương tự" nào (fuzzy match bị loại từ rule 5, cố ý):
   - **id bên kia TRỐNG hoặc TRÙNG KHÍT** → cùng một task chiếm hai chỗ, trùng rõ ràng.
     **Giữ dòng ở tab tháng CŨ NHẤT** (đúng tinh thần rule 7), **dọn** các bản sao ở
     tháng mới hơn **do script sinh ra**, vá id vào dòng giữ lại. Đếm vào `dupCleared`.
     **Bản sao anh gõ tay thì KHÔNG BAO GIỜ tự dọn** (ca thật 2026-08-06: anh xoá task
     khỏi 07/2026 rồi gõ tay lại vào 08/2026, luật này từng dọn mất dòng tay đó): chỉ ghi
     `🤖 Trùng với …` vào Note khi H trống, đếm vào `dupHandKept`.
     **Phân biệt dòng-của-script bằng CẶP ô Card (F) + page id (G)**, không bằng mỗi G.
     Script ghi cả hai trong cùng một `setValues` lúc sinh dòng, nên thiếu MỘT trong hai
     là dòng người thật đặt ở đó. Soi mỗi G thì đúng lúc `SETUP.md` bảo anh tự dán page id
     vào G để dòng tay sống theo Notion, làm đúng theo tài liệu là mất luôn lớp bảo vệ và
     bị dọn mất dòng vừa gõ. Hệ quả đã biết và chấp nhận: dòng script sinh mà bị cắt-dán
     rơi mất ô Card sẽ không được tự dọn nữa — nó chỉ bị ghi note, và đó là hướng sai
     an toàn (bất biến (i) đứng trên việc dọn gọn).
     Ca sáng lập 2026-08-05 vẫn ra đúng kết cục cũ: bản gốc tay ở July (trống G) làm
     keeper, các bản sao CÓ id ở August vẫn bị dọn — có test regression khoá lại.
   - **id bên kia KHÁC HẲN** → hai page Notion khác nhau vô tình trùng tên (ca thật:
     "Fix translation … Loyalty Hub" tồn tại 2 lần, 2 id). **Không bao giờ tự dọn**, chỉ
     ghi `🤖 Nghi trùng TÊN (page id khác)` vào Note. Đếm vào `dupFlagged`.

   **Tháng đã chốt sổ VẪN được dọn bản sao** (Garry, 2026-08-05 — đã cân nhắc rồi chốt).
   Chốt sổ cấm đúng MỘT việc: **thêm dòng mới**. Update 4 cột, ghi note, dọn dòng trùng
   đều được. Hệ quả đã biết và đã chấp nhận: hai bản sao ở hai tháng đều đã chốt thì
   dòng ở tháng mới hơn bị dọn và KPI hai tháng đó đổi theo. Mọi lần dọn đều vào
   `dupCleared` + log nên không im lặng. **Đừng thêm lại guard "tháng chốt thì miễn dọn".**

   **Dọn = xoá nội dung A..H, KHÔNG `deleteRow`.** Khối KPI sống ở cột I+ **trên cùng
   những dòng đó** (`Tổng số task` / `Point Dev` / `Tổng point` ở I2:J5), nên `deleteRow`
   sẽ nuốt luôn công thức KPI. Dòng trống ở giữa vô hại — `nextFreeRow_` và `buildIndex_`
   đều bỏ qua. Ô `Note` (H) chỉ được dọn khi nội dung do chính script ghi (nhận theo tiền
   tố); chữ anh tự gõ thì **giữ nguyên**, kể cả trên dòng vừa bị dọn — luật "Note không
   bao giờ bị đè" không có ngoại lệ, một ghi chú lạc còn hơn mất chữ của anh.
9. **Dòng mới rơi vào dòng TRỐNG ĐẦU TIÊN (trống hoàn toàn A..H), tính từ dòng 2.** "Dòng cuối" tính theo dấu
   chân **A..H**, không phải mỗi cột A: dòng anh sửa tay có thể trống tên mà B..H còn
   nguyên, chỉ soi cột A thì lượt add sau ghi đè lên chính dòng đó (mất data). Cột I trở
   đi (KPI/summary) **không** tính — nó kéo dài xuống dưới vùng task và sẽ đẩy dòng add
   ra giữa khoảng trắng. Checkbox chưa tick trả `false`, coi như trống (cột Have thường
   kẻ sẵn checkbox cả trăm dòng). Trước khi ghi còn kiểm lại dòng đích trống A..H.
10. **Xoá tay = ý định (ca thật 2026-08-06).** Anh xoá 2 task Reviewer khỏi `07/2026`
    (đã chốt) rồi gõ tay lại vào `08/2026` — sync hồi sinh chúng ở July (đường update
    khi G sót, hoặc quét bù trước lúc chốt khi G sạch) rồi rule 8 dọn luôn dòng tay
    tháng 8. Không guard nào bị vi phạm; chính các luật khoá đảo ngược thao tác chủ
    đích của anh. Gói an toàn — ba bất biến, theo thứ tự ưu tiên: (i) dòng tay (trống
    G) không bao giờ bị script tự xoá; (ii) task anh đã xoá không bao giờ được script
    hồi sinh; (iii) tháng chốt không nhận dòng mới (giữ nguyên). Ba chốt chặn:
    - **Bia mộ** (rule 2): dòng trống A..D mà còn id ở G vẫn vào `byPid` (ghim pid, chống
      re-add) nhưng update / heal link / vai keeper rule 8 đều bỏ qua. Đếm `tombstones`.
    - **Đóng băng phải NHÌN THẤY được và MỞ RA được** (2026-08-06 vòng 2). Tín hiệu xoá
      rộng ra thì rủi ro mới là: anh xoá A..D để gõ lại, một lượt sync chen vào giữa, và
      dòng đứng hình mà không có gì trên sheet nói vì sao.
      - **Mở ra được:** gõ nội dung trở lại A..D là dòng SỐNG lại ngay và update từ Notion
        chạy tiếp — không cần thao tác gì thêm, không cần xoá ô G. Đây là thứ làm cho cả
        thiết kế này an toàn; có test khoá riêng (`P2 (mở ra được)`) và đã probe runtime.
      - **KHÔNG ghi note lên dòng bia mộ** (đảo lại 2026-08-06, sau khi Garry nhìn sheet
        thật). Đời trước ghi vào H một note 🤖 giải thích việc đóng băng. Luật của anh:
        note của script thuộc về dòng **còn task**, mà bia mộ theo định nghĩa là dòng trống
        — note nằm đó đọc ra thành "không có task mà vẫn có ghi chú", gây rối chứ không
        giúp. Ba note còn lại đều nằm trên dòng còn task nên giữ nguyên: `🤖 Trùng với …`,
        `🤖 Nghi trùng TÊN …`, `🤖 Tự gán Notion id theo tên task …`.
        Bỏ note kéo theo: `TOMB_NOTE`, tham số `kind` của `noteOnce_` và nhánh `!tomb` trong
        `pruneNoteAck_` đều đã gỡ — chúng chỉ tồn tại để dấu ack của note bia mộ hết hạn khi
        dòng sống lại. Dấu ack của note trùng (khoá `MM/YYYY!dòng`, sống theo
        `rowHasContent_`) **không đụng tới** và vẫn được nhóm test `F8` khoá.
      - **Nhìn thấy được = hai hộp thoại, và giờ chỉ còn hai hộp thoại đó.** Trên sheet
        không còn vết nào của việc đóng băng, mà Execution log chỉ giữ vài ngày. Alert
        **quét bù** nêu số dòng đang đóng băng kèm `MM/YYYY dòng N — tên task`, và
        **🩺 Chẩn đoán sheet** liệt kê chúng theo từng tab + một dòng tổng. Cả hai đọc được
        bất cứ lúc nào. Vì đây là đường DUY NHẤT, cả hai đều có test khoá riêng (`R2`, và
        `R1` khoá ca đóng băng LẦN HAI sau khi dòng đã được gọi về).
        Chẩn đoán đọc `_STATE` TRƯỚC vòng quét tab để phân biệt bia mộ thật với dòng anh
        vừa dán id vào (pid chưa có dấu → script sắp điền cả dòng, không phải đóng băng).
        `_STATE` còn format cũ thì hình dạng là đủ: lượt sync tới dựng dấu từ chính sheet,
        mà dòng hình bia mộ nào cũng mang pid ở G.
        Và chỉ đếm ở **tab tháng**: `scanMonthRows_` không index tab khác, nên dòng hình bia
        mộ trong một tab như `Ghi chú` không hề bị script từ chối cập nhật — cả tab đó vô
        hình với sync, và dòng riêng của tab trong báo cáo đã nói đúng điều đó. Đếm nó vào
        "Dòng đang đóng băng" là bịa ra một con số trong chính công cụ sinh ra để dẹp hoang
        mang; đổi tên tab về `MM/YYYY` xong chạy lại là nó hiện ra đúng.
    - **Nút 🗑 Xoá task khỏi tháng này** (menu): dọn vùng chọn về đúng hình dạng đã xoá —
      **xoá A..F và H, GIỮ id ở G** — rồi **đóng dấu `stamped` ngay** cho các pid đó, nên
      quét bù sau này không kéo về kể cả khi anh dọn nốt ô G. Hỏi xác nhận trước, báo lại
      số dòng đã xoá. **Không bao giờ `deleteRow`** (khối KPI ở cột I+ nằm trên cùng những
      dòng đó — có test grep tĩnh khoá lại). Bốn guard, mỗi cái một test: tab không đúng
      `MM/YYYY`; vùng chọn tràn sang cột I+ (đúng hình "bấm số dòng chọn cả dòng"); vùng
      chọn không có page id nào ở G (dòng tay — **không tự dọn**, chỉ báo); và `_STATE`
      chưa có dòng nào (script chưa chạy sync lần nào — ghi dấu lúc đó sẽ cướp mất tư cách
      `firstRun` của lượt sync đầu và kéo mọi task counted về tháng đang tính một lượt).
      Lượt ghi state của nút này **dựng lại dấu từ sheet khi `_STATE` còn format cũ**, y
      hệt `syncNow`, và **GỘP** vào dấu đã có chứ không thay (bấm nút hai lần trước lượt
      sync đầu là có thật): một đường phụ không bao giờ được làm hẹp ký ức xoá tay của pid
      khác. Lượt ghi đó **chừa lại ô header `stamped`** cho một lượt sync thật. Nâng header
      ở đây thì lượt sync ĐẦU TIÊN sau khi dán code mới hết tư cách "đang migrate", và phép
      suy dấu theo TÊN (dòng tay ở tab tháng mới hơn) không bao giờ nổ — bấm nút xoá trước
      khi sync lượt nào là mất luôn nó. Dấu vẫn ghi vào cột C và `getState_` vẫn đọc cột C
      kể cả khi header còn cũ (`_STATE` đời cũ có đúng 2 cột nên C rỗng, không đụng gì).
      **Nhưng đọc theo SENTINEL, không phải theo truthy** (`isStampMark_`: đúng số `1`, hoặc
      chuỗi `'1'` khi ô đang ở định dạng text — đúng thứ `writeState_` ghi ra). `_STATE` ẩn
      chứ không khoá: một chữ gõ nhầm vào cột C mà tính là dấu thì pid đó chết vĩnh viễn ở
      cổng add, và lượt ghi state kế tiếp đóng số `1` vào đúng ô đó (dấu không bao giờ được
      hẹp lại) nên nhầm lẫn KHÔNG BAO GIỜ tự sửa — trên nhịp 10 phút nó nhiễm im lặng, tới
      lượt quét bù mới lòi ra dưới dạng "anh đã xoá tay", tố oan task anh chưa từng đụng.
      Ba đường đọc cột C dùng CHUNG `isStampMark_`: `getState_` và hai chỗ `diagnoseSheet`
      đọc `_STATE` bằng tay — chẩn đoán lệch luật với `getState_` là in ra con số mô tả một
      lượt quét bù khác với lượt sẽ chạy thật.
      **Ngoại lệ duy nhất của "Note không bao giờ bị đè":** nút này dọn ô H **kể cả chữ anh
      tự gõ**. Có nêu thẳng trong hộp thoại xác nhận và phải bấm Yes. Đường xoá tay bằng
      phím Delete và `clearTaskRow_` (luật 8) vẫn giữ nguyên chữ của anh.
      Tên hàm `deleteTasksFromMonth` **không có gạch dưới cuối** — `addItem` không gọi được
      hàm private.
    - **Cột G ẩn** (`applyRowFormat_`, đánh version `ROW_FMT`): G là sổ sách của script,
      không phải chỗ anh đọc. Một đời bản trước bỏ ẩn nó vì tín hiệu xoá khi đó đòi trống
      A..F, nên ô id khuất là bẫy im lặng; **cùng vòng đó tín hiệu thu về A..D**, và thế là
      lý do bỏ ẩn hết hiệu lực — quét mấy cột nhìn thấy rồi Delete đã là thao tác đúng.
      Đặt **một lần** theo số phiên bản như wrap cột A — anh tự bỏ ẩn lại thì script không
      cãi mỗi 10 phút.
      **Chỉ đổi `showColumns` → `hideColumns` là chưa đủ:** sheet thật đã bị bỏ ẩn ở đời
      trước và `ROW_FORMAT_VERSION` đã nằm sẵn trong Script Property, nên phải **nâng
      `ROW_FMT` (5 → 6)** thì pass mới chạy lại và ẩn G một lần. Có test khoá đúng ca đó
      (`P4: sheet đã có ROW_FORMAT_VERSION đời trước`) vì quên nâng version thì không test
      nào khác đỏ.
    - **Dấu đã-từng-add:** `_STATE` thêm cột `stamped` (A=pid, B=status như cũ) — bật
      khi pid có dòng trong sheet: script add, khớp id (kể cả bia mộ), hoặc được vá id
      theo rule 7; đã bật thì giữ suốt vòng đời state. Cổng add gặp pid có stamp mà
      không còn dòng nào trên MỌI tab → **không re-add** (cả quét bù lẫn nhịp thường),
      đếm `skippedDeleted` và **nêu đích danh tên task** trong alert quét bù — xoá
      không bao giờ im lặng. Pid chưa từng thấy mà counted và thiếu dòng → quét bù vẫn
      cứu như xưa (đúng việc của nó: vớt task sync bắt hụt).
      **Migration (`_STATE` thiếu cột `stamped` — format cũ 2 cột, hoặc tab vừa bị xoá):
      dấu được dựng lại từ chính SHEET, KHÔNG suy từ status.** Mọi pid đang có dòng ở
      một tab tháng (kể cả bia mộ) coi như đã-từng-add; pid không còn dấu vết nào thì
      không có dấu. Bản trước suy "counted = đã từng add" và gán nhãn "anh đã xoá" cho
      **cả đống task chưa từng có dòng** — task bị `CLOSED_THROUGH` chặn, task nhịp 10
      phút bắt hụt, task nằm trong tab không khớp `MM/YYYY` (`buildIndex_` không thấy,
      đó là lý do `diagnoseSheet` tồn tại) — rồi ghi cái nhãn đó lại vĩnh viễn ngay lượt
      sync đầu tiên: quét bù không bao giờ cứu được chúng nữa. Đọc từ sheet thì sai lầm
      **tự sửa được**: task thật sự đã xoá mà không còn dấu vết có thể quay lại đúng MỘT
      lần ở lượt quét bù đầu, và chính lượt đó đóng stamp thật lại — xoá lần sau là chết
      hẳn. Đổi một hỏng nhỏ tự sửa lấy một hỏng không đảo ngược được.
      Ngoại lệ ở đúng lượt dựng lại: dòng anh **gõ tay** không có id nên không vào diện
      trên, chỉ còn TÊN để nhận ra — task đã có dòng tay mang đúng tên cũng coi như
      đã-từng-add, không thì lượt migration đầu tiên add thêm một bản sao nữa nằm cạnh
      dòng tay (đúng ca 2026-08-06). Chỉ áp khi state đời cũ THẬT SỰ tồn tại.
      **Và chỉ soi dòng tay ở tab tháng MỚI HƠN tháng đang tính.** Gom cả dòng tay ở mọi
      tab (bản trước) là task Notion mới toanh trùng tên bất kỳ dòng trống-G nào — sheet
      thật có ~325 dòng như thế — bị đóng dấu "đã xoá" **vĩnh viễn** ngay lượt trigger im
      lặng đầu tiên sau khi dán code, rồi chết ở cổng add mãi mãi, và quét bù còn báo với
      anh là anh đã xoá nó. Hẹp đúng tới "tab mới hơn" vì hai vùng còn lại đã có luật lo:
      dòng tay ở tab **cũ hơn** đi qua rule 7 (vá id + đếm `blockedOld`, chặn trước cổng
      add), dòng tay ở **đúng tab đang tính** đi qua rule 5 (vẫn add, kèm cờ `🤖 Nghi trùng`
      ngay cạnh nó — anh nhìn thấy và tự xử). Còn lại đúng hình ca 2026-08-06: ghim về 07,
      gõ tay lại vào 08 — thêm dòng lúc này là ghi vào tab anh vừa dọn.
      Suy đoán này **nêu đích danh task + dòng tay khớp vào log ngay lúc nổ** (nó vĩnh
      viễn, mà Execution log chỉ giữ vài ngày), và dòng của nó trong alert quét bù nói rõ
      "khớp theo tên, không phải page id" — alert không bao giờ được kể với anh là anh đã
      xoá một thứ anh chưa từng xoá. Suy đoán này **vẫn được ghi vĩnh viễn vào `_STATE`**
      như mọi dấu khác, cố ý: không ghi thì task chưa tới mốc lúc migration sẽ được quét bù
      add vào tab đã ghim ở lượt sau — đúng ca hồi sinh mà bất biến (ii) cấm. Sai thì gỡ
      bằng cửa thoát có sẵn: **dán page id vào ô G của chính dòng tay** (khớp id thắng cổng
      add). Xoá dòng tay đi thì không gỡ được, đúng như luật "stamp là vĩnh viễn".
      **Stamp là VĨNH VIỄN, không sống theo vòng đời status.** Task rời query Notion một
      lượt (fetch 502/429, anh bỏ assign, page đổi board) **không** được làm rơi dấu. Câu
      cũ "rule 7 đỡ được" là sai: rule 7 chỉ vá id vào một dòng CÓ SẴN ở tab cũ hơn, mà ca
      này không còn dòng nào cả. `writeState_` vì thế ghi ra HỢP của map và stamped (pid
      có dấu mà lượt này không thấy vẫn giữ dòng, status để trống), và ghi ĐÈ lên chỗ cũ
      chứ không `clearContents` trước — giữa clear và ghi lại có một cửa sổ mà một lần ném
      để `_STATE` trắng trơn, mất sạch ký ức xoá tay.
      **Đọc thiếu không bao giờ được làm hẹp trạng thái đã lưu.** `notionQuery_` trả
      `{pages, ok}`; `ok:false` (HTTP ≠ 200) trước đây trông y hệt "board không có task
      nào". Lượt nào đọc thiếu thì status cũ được giữ nguyên, và cờ `fetchFailed` hiện
      trong log lẫn alert quét bù — hỏng thì phải nhìn thấy.
    - **Luật tay của rule 8** (`dupHandKept`) — xem rule 8.
    **Giới hạn đã chấp nhận:** bia mộ ở July + dòng tay cùng task ở August (tháng đang
    tính) → bia mộ ghim pid (không re-add), dòng tay bất khả xâm phạm, và update từ
    Notion **không tới được cả hai** (dòng tay không có id; title-heal của rule 7 chỉ
    vá tab CŨ HƠN, August là tháng hiện tại). Muốn dòng tay sống theo Notion thì tự
    dán page id vào ô G của nó — **cửa thoát này bây giờ chạy thật**: dòng sống thắng
    bia mộ trong `byPid` nên lượt sync kế tiếp cập nhật đúng dòng tay đó và vá luôn link
    Card, và cặp Card+id giữ cho nó không bị rule 8 dọn. Nếu task đã có dòng ở tab tháng
    CŨ HƠN thì dán id xong rule 8 vẫn giữ dòng tháng cũ làm bản chính và chỉ ghi note lên
    dòng mới — muốn chuyển hẳn sang tháng mới thì xoá dòng ở tab cũ trước rồi mới dán id.
    **Note của script bỏ qua được.** Note trùng của rule 8 ghi cho mỗi dòng đúng MỘT lần
    (nhớ ở Script Property `SCRIPT_NOTE_ACK`, khoá theo `MM/YYYY!dòng`); anh xoá ô H đi
    = đã đọc và thấy ổn, nó không mọc lại nữa. Trước đây note ghi lại mỗi khi H trống nên
    cứ 10 phút một lần, vĩnh viễn, đúng trên những dòng tay mà luật này sinh ra để bảo vệ
    — note đọc rồi mà cứ mọc lại thì anh sẽ ngừng đọc mọi note của script. Sự kiện vẫn
    vào `dupHandKept` / `dupFlagged` + log mỗi lượt, nên bỏ qua note không phải bỏ qua
    sự kiện. Đánh đổi: sau khi anh xoá note, tình huống trùng đổi (keeper dời sang tháng
    khác) cũng không được ghi lại — dấu ack khoá theo DÒNG, không theo nội dung.
    **`SCRIPT_NOTE_ACK` có TRẦN và phải được dọn.** Script Property của Apps Script chặn ở
    **9216 byte**; mỗi dấu tốn ~15.8 byte nên tới khoảng **581 dòng đã ack** là `setProperty`
    ném `Argument too large`. Cú ném đó nằm trên đường `noteOnce_` → rule 8 → `syncNow`,
    **trước `writeState_`**, nên nó giết cả lượt sync mà không ghi được state — và vì store
    không bao giờ nhỏ lại thì mọi nhịp 10 phút sau đó cũng chết y hệt, vĩnh viễn. Hai lớp:
    - **Bọc `try/catch` quanh lượt ghi dấu.** Dấu ack là thứ trang trí, không được kéo sập
      lượt cộng point — cùng lý do `syncRowFormat_` / `syncStatusColors_` được bọc. Ghi hỏng
      thì note vẫn nằm trên sheet, chỉ là lượt sau có thể ghi lại (ô H lúc đó đã có chữ nên
      thực tế vẫn không mọc thêm).
    - **Dọn dấu chết mỗi lượt** (`pruneNoteAck_`, chạy ngay sau khi quét sheet): dấu chỉ chết
      khi dòng đó **không bao giờ ghi note lại được** — tab không còn, hoặc dòng đã trống hết
      A..H (mọi đường gọi `noteOnce_` đều qua `titleRows`, cần dòng còn TÊN). **Cố tình KHÔNG
      dọn theo "ô H hết note"**: anh xoá note = đã đọc, dọn dấu theo đó là note mọc lại sau
      10 phút — đúng thứ `SCRIPT_NOTE_ACK` sinh ra để chặn. Hệ quả phụ có lợi: dòng bị rule 8
      dọn rồi được lượt add sau tái sử dụng thì cũng được ghi note lại như dòng mới.
      Chỉ còn **một** luật sống cho dấu (`rowHasContent_`), không còn nhánh theo LOẠI: nhánh
      `!tomb` cũ chỉ tồn tại để dấu của note bia mộ hết hạn khi dòng sống lại, mà note đó đã
      bỏ. Hai đường khoá khác nhau nên tách được sạch — probe bằng mutation: gỡ luật
      `rowHasContent_` thì hai test `F8` đỏ ngay (note trùng mọc lại mỗi 10 phút).

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
- **Dựng lại, không đoán rule của ai.** Anh không tự tô màu status bao giờ ("để script
  lo hết") — nên mọi rule `TEXT_EQUAL_TO` ở cột B đều là sản phẩm của chính script này,
  chỉ khác đời. `applyStatusRules_` **bỏ và dựng lại** mọi rule đọc được phủ một status
  Notion đang có, rồi ghi lại theo bảng màu hiện tại. Đây là thứ làm **mọi tab hội tụ**:
  giữ rule đời cũ (thiếu màu chữ, palette đã đổi, range chặn đuôi) tức là để nó chiếm
  chỗ status đó, màu hiện tại không bao giờ được thêm vào tab ấy, trong khi tab mới tạo
  lại nhận màu hiện tại → mỗi sheet một màu (đúng triệu chứng 2026-08).
  **Chỉ dựng lại thứ dựng lại được.** Hai loại rule không đụng tới vì xoá đi là mất luôn
  không tái tạo nổi: rule không đọc ra status (công thức / `TEXT_CONTAINS`) và rule phủ
  status mà Notion không còn (xoá thì mấy dòng cũ mất màu chứ không được màu mới).
  Chúng giữ nguyên thứ tự và vẫn đứng **đầu** — Sheets xét từ trên xuống, rule khớp đầu
  tiên thắng. `isOwnStatusRule_` (cột B + `TEXT_EQUAL_TO` + cặp nền/chữ trùng khít một
  dòng `NOTION_CHIP`, chuẩn hoá `#aarrggbb` → `rrggbb`) giờ chỉ còn phục vụ **chẩn đoán**:
  rule trượt phép thử đó chính là rule đời cũ cần soi.
- **Bold + format version.** Rule code sinh bật `setBold(true)`: chữ chip Notion là màu
  nhạt trên nền nhạt, để nét thường thì trong Sheets đọc bị mờ. Bold cố tình **không**
  nằm trong phép nhận diện "rule của code" — có vậy rule sinh từ bản chưa-bold mới được
  nhận ra để dựng lại. Vì cache chặn ghi rule khi bảng màu không đổi, format rule được
  đánh version ở `STATUS_FMT` và lưu kèm cache; đổi cách vẽ rule thì bump số này, lượt
  sync kế tiếp tự dựng lại toàn bộ.
- **Rule cũ chặn đuôi tự hết.** Rule `B2:B100` làm dòng thứ 101 trở đi không màu; vì
  rule đọc được luôn bị dựng lại nên nó ra đời với range `B2:B` **không chặn đuôi** —
  không còn đường nào để một rule chặn đuôi sống sót qua lượt sync.
- **Màu lấy sống từ Notion**, không hardcode: `GET /v1/data_sources/<id>` →
  `properties.Status.status.options[].color`, gộp mọi board trong `WATCH_SOURCES`
  (trùng tên khác màu → board đầu thắng, chỉ log). Lý do: tên status hai board vốn
  đã lệch nhau (xem `COUNTED`) và còn đổi theo thời gian — bảng màu chép cứng sẽ rot
  y hệt. 10 tên màu Notion map sang chip màu light-mode ở `NOTION_CHIP`; tên màu lạ
  → fallback `default`.
- **Cache để không đốt quota:** Script Property `STATUS_COLOR_CACHE` = `{map, ts, fmt}`.
  `needStatusRefresh_` chỉ cho fetch lại khi cache thiếu / gặp status chưa có trong
  map (lấy từ chính các page vừa sync, không quét lại sheet) / cache quá 24h (bắt ca
  đổi màu mà không đổi tên). Map mới **deep-equal** map cũ → không gọi
  `setConditionalFormatRules` lần nào.
- **Cache chỉ được ghi SAU khi áp xong.** Ghi trước thì một lần `applyToTabs_` ném giữa
  chừng (quota, sheet bị protect) sẽ để cache nói dối là "đã áp": lượt sau thấy bảng màu
  không đổi nên bỏ qua, mấy tab lỡ dở **kẹt màu sai vĩnh viễn**. Ca "bảng màu y cũ, không
  phải áp gì" vẫn trẻ hoá `ts` để khỏi fetch Notion mỗi 10 phút.
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

## Chẩn đoán (🩺 Chẩn đoán sheet)
- Menu **🔄 Point Sync → 🩺 Chẩn đoán sheet** (`diagnoseSheet`) — **chỉ đọc**, không
  sửa một ô nào, không đụng rule, không tạo tab. Tóm tắt vào alert, chi tiết vào
  Execution log.
- Có để trả lời bằng **dữ kiện** mấy câu chỉ sheet thật mới biết: tab nào không khớp
  `MM/YYYY` (tab đổi tên / `7/2026` / thừa khoảng trắng là **vô hình** với `buildIndex_`,
  `formatTargets_`, `orphanStatuses_` — một mình nó giải thích được cả "task bị add lại"
  lẫn "màu lệch"), dòng nào trống cột A, dòng nào thiếu page id, page id/tên nào trùng
  giữa các tab, và rule màu status nào là đời cũ.
- Mỗi tab in: dòng data, dòng cuối theo **cột A** vs theo **A..H** vs cả sheet (kể cả
  KPI cột I+), danh sách dòng trống cột A, danh sách dòng thiếu id, **danh sách dòng đang
  đóng băng**, và phân loại rule màu (đúng bảng màu hiện tại / đời cũ / không đọc được).
- **Dòng đang đóng băng** có cả một dòng tổng trong alert. Bia mộ không mang note nào nên
  việc đóng băng vô hình trên sheet; đây là một trong hai chỗ đọc lại được bất cứ lúc nào
  (chỗ kia là alert quét bù). `_STATE` đọc TRƯỚC vòng quét tab (không gọi `getState_` — hàm đó tạo tab khi thiếu)
  để tách bia mộ thật khỏi dòng vừa được dán id vào, và đọc cột C bằng cùng `isStampMark_`
  với `getState_`. Chỉ đếm dòng ở **tab tháng**: tab không khớp `MM/YYYY` vô hình với sync
  nên ở đó không có gì bị đóng băng — dòng riêng của tab đã nói tab đó vô hình rồi.
- **Tab lạ cũng được quét**, không chỉ điểm mặt: task nằm trong tab lạ chính là thứ
  giải thích vì sao nó bị add lại ở tháng mới, nên id/tên của nó phải vào bảng trùng.

## Mở / rủi ro
- Role lịch sử để trống (schema DB cũ khác nhau) — chấp nhận, backfill thủ công nếu cần.
- Nếu Vũ đổi sang project DB mới → thêm DB ID vào tab Config.
- Polling lệch tháng chỉ khi transition rơi đúng đêm giao tháng (hiếm) → webhook khắc phục.
