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
- Chốt sổ cấm **đúng một việc: thêm dòng mới**. Update 4 cột, ghi note, dọn dòng trùng
  (có id) đều được (Garry chốt 2026-08-05, đã cân nhắc hệ quả). Đừng thêm guard "tháng
  chốt miễn dọn".
- **Ai sở hữu cột nào (nền của luật xoá, chốt 2026-08-06 vòng 2).** Script sở hữu **A..D**
  (Tên/Status/Point/Role) — bốn cột duy nhất đường update ghi vào. User sở hữu **E (`Have`)**
  và **H (`Note`)**; **F (`Card`)** script ghi nhưng user xoá được; **G** giữ page id và
  **được ẩn lại**. Tín hiệu xoá chỉ được đọc từ cột của CHÍNH script.
- **Xoá tay = ý định (2026-08-06).** Script không hồi sinh task user đã xoá: dòng **trống
  hết A..D** mà cột G còn id = **bia mộ** (vẫn index vào `byPid` để ghim pid, nhưng
  update/heal/keeper luật 8 bỏ qua — đếm `tombstones`); `_STATE` có cột `stamped` — pid từng
  được add mà mất hết dòng thì cổng add bỏ qua kể cả quét bù (`skippedDeleted`, nêu tên
  trong alert). **Dòng tay không bao giờ bị script tự xoá** — luật 8 chỉ ghi note 🤖
  (`dupHandKept`).
- **Bia mộ: ba điểm tinh, đừng gỡ.** (a) **Chỉ đọc A..D; E, F và H đều KHÔNG được xét** —
  kể cả note user gõ tay ở H. Bản trước đòi trống cả A..F lẫn H, mà thao tác thật là quét
  mấy cột NHÌN THẤY (A..D) rồi Delete, nên `Have`=TRUE / link Card / ghi chú sống sót là
  dòng bị hồi sinh và KPI hai tháng đếm đôi (ca thật 07/2026 + 08/2026). H phải bỏ qua vì
  nó là cột của USER (gõ "đã chuyển sang tháng 8" là giải thích việc xoá, không phải bằng
  chứng dòng còn dùng). Chữ user gõ ở H vẫn **không bao giờ bị đè**. (b) Chỉ là bia mộ khi pid
  có `stamped`; pid chưa từng stamp mà có id ở dòng trống là user vừa DÁN id để buộc task →
  điền cả dòng. (c) Dòng SỐNG luôn thắng bia mộ trong `byPid` — tab tháng mới nằm ở index 0
  nên tab CŨ duyệt sau cùng, "ghi sau thắng" để bia mộ đóng băng dòng sống cùng pid vĩnh viễn.
- **Đóng băng phải NHÌN THẤY được + MỞ RA được** (điều kiện để tín hiệu rộng là an toàn).
  Gõ nội dung trở lại A..D là dòng SỐNG lại và update chạy tiếp — không cần xoá ô G, không
  cần bấm gì; có test riêng + đã probe runtime.
- **KHÔNG ghi note lên dòng bia mộ (đảo lại 2026-08-06, user chốt sau khi nhìn sheet thật).**
  Note của script chỉ thuộc về dòng CÒN TASK; bia mộ là dòng trống nên note ở đó đọc ra thành
  "không có task mà vẫn có ghi chú". Đã gỡ `TOMB_NOTE`, tham số `kind` của `noteOnce_` và
  nhánh `!tomb` trong `pruneNoteAck_` (chúng chỉ tồn tại để phục vụ note đó). Ba note còn lại
  **giữ nguyên** vì đều nằm trên dòng còn task: `🤖 Trùng với …`, `🤖 Nghi trùng TÊN …`,
  `🤖 Tự gán Notion id theo tên task …`. Đường ack của note trùng (khoá `MM/YYYY!dòng`, sống
  theo `rowHasContent_`) KHÔNG bị đụng — probe mutation: gỡ luật đó thì hai test `F8` đỏ.
  Note cũ đã ghi trên sheet thật thì script không tự dọn (luật "không tự dọn chữ đã ghi") —
  SETUP.md bảo user xoá tay, an toàn vì nhận diện bia mộ không bao giờ nhìn cột H.
- **Bia mộ vô hình trên sheet nên hai hộp thoại là đường DUY NHẤT.** Execution log chỉ giữ
  vài ngày. Alert **quét bù** nêu `tombstones` + `MM/YYYY dòng N — tên task`;
  **`diagnoseSheet`** liệt kê dòng đóng băng theo từng tab + một dòng tổng. `diagnoseTab_`
  nhận `stamped` đọc từ `_STATE` TRƯỚC vòng quét tab (không được gọi `getState_` — hàm đó
  tạo tab khi thiếu, mà chẩn đoán chỉ đọc); `_STATE` format cũ → `stamped = null` → hình
  dạng là đủ (lượt sync tới dựng dấu từ sheet, mà dòng hình bia mộ nào cũng có pid ở G).
  Đừng đếm theo hình dạng khi ĐÃ có dấu: dòng user vừa dán id vào là dòng script sắp điền,
  không phải đóng băng. Và **chỉ đếm ở tab tháng** (`isMonth` trong `diagnoseTab_`):
  `scanMonthRows_` không index tab khác nên dòng hình bia mộ ở `Ghi chú` không hề bị từ chối
  cập nhật — cả tab vô hình với sync, và dòng riêng của tab trong báo cáo đã nói đúng thế.
  Đếm nó là bịa số trong chính công cụ sinh ra để dẹp hoang mang.
- **Nút 🗑 "Xoá task khỏi tháng này"** (`deleteTasksFromMonth`, KHÔNG gạch dưới cuối): dọn
  A..F + H, **GIỮ id ở G**, và **đóng dấu `stamped` ngay** nên quét bù không kéo về kể cả
  khi user dọn nốt ô G. Hỏi xác nhận, báo số dòng đã xoá. **Không bao giờ `deleteRow`** (KPI
  ở cột I+ cùng dòng — có test grep tĩnh). Guard: tab không phải `MM/YYYY`; vùng chọn tràn
  sang cột I+; không có page id nào ở G (dòng tay → không tự dọn, chỉ báo); `_STATE` chưa có
  dòng nào (ghi dấu lúc đó cướp mất tư cách `firstRun`, làm lượt sync đầu kéo mọi task
  counted về tháng đang tính). Lượt ghi state của nút **dựng lại dấu từ sheet khi `_STATE`
  còn format cũ**, y hệt `syncNow`, và **GỘP** vào dấu đã có chứ không thay (bấm nút hai lần
  trước lượt sync đầu là có thật) — đường phụ không được làm hẹp ký ức xoá tay của pid khác.
  **Và lượt ghi đó CHỪA header `stamped` lại** (`writeState_(..., keepLegacyHeader)`): nâng
  header ở đây là lượt sync ĐẦU TIÊN hết tư cách "đang migrate" và phép suy dấu theo TÊN
  không bao giờ nổ — bấm nút xoá trước khi sync lượt nào là mất luôn nó. Bù lại `getState_`
  đọc cột C **kể cả khi header còn cũ** (`_STATE` đời cũ có đúng 2 cột nên C rỗng), và
  `syncNow` GỘP `stampsFromRows_` vào dấu đã đọc chứ không thay.
- **Dấu đọc theo SENTINEL, không theo truthy** (`isStampMark_`: đúng `1`, hoặc `'1'` khi ô
  ở định dạng text — đúng thứ `writeState_` ghi ra). `_STATE` ẩn chứ không khoá: một chữ gõ
  nhầm vào cột C mà tính là dấu thì pid đó chết vĩnh viễn ở cổng add, và lượt ghi state kế
  tiếp đóng số `1` vào đúng ô đó (dấu không bao giờ được hẹp lại) nên nhầm lẫn không tự sửa
  — nhịp 10 phút nhiễm im lặng, quét bù mới lòi ra dưới dạng "anh đã xoá tay", tố oan. Ba
  đường đọc cột C (`getState_` + hai chỗ `diagnoseSheet` đọc `_STATE` bằng tay) dùng CHUNG
  một hàm: chẩn đoán lệch luật với `getState_` là in ra con số mô tả một lượt quét bù khác
  với lượt sẽ chạy thật. `SETUP.md` nói thẳng với user: đừng gõ tay vào `_STATE`.
- **Nút 🗑 là NGOẠI LỆ DUY NHẤT của "Note không bao giờ bị đè":** nó dọn ô H kể cả chữ user
  gõ tay. Có nêu thẳng trong hộp thoại xác nhận + phải bấm Yes, nên không phải defect.
  `clearTaskRow_` (luật 8) và đường xoá tay bằng phím Delete vẫn giữ nguyên chữ user.
- **Cột G ẩn, một lần theo `ROW_FMT`** (đảo lại 2026-08-06). Một đời bản trước bỏ ẩn G vì
  tín hiệu xoá khi đó đòi trống A..F nên ô id khuất là bẫy im lặng; CÙNG vòng đó tín hiệu
  thu về A..D, nên lý do bỏ ẩn hết hiệu lực và user thấy cột id bày ra là xấu. `hideColumns`
  nằm trong `applyRowFormat_` (cùng pass với wrap cột A) nên chỉ chạy khi `ROW_FORMAT_VERSION`
  cũ — user tự bỏ ẩn lại thì script không cãi mỗi 10 phút. Đừng tách thành pass riêng chạy
  mỗi lượt. **Đổi `showColumns` → `hideColumns` mà quên nâng `ROW_FMT` là vô nghĩa:** sheet
  thật đã lưu version cũ nên cổng phiên bản chặn cả pass và G hiện vĩnh viễn trên đúng cái
  sheet cần sửa. Có test khoá riêng ca đó (`P4: sheet đã có ROW_FORMAT_VERSION đời trước`) —
  probe mutation: hạ `ROW_FMT` về 5 thì chỉ mình nó đỏ.
- **Bia mộ tắt đường hồi sinh VÀ đường vá id theo tên (luật 7), nhưng KHÔNG tắt luật 8**
  (`return` sớm từng tắt cả luật 8 → hai bản sao cùng sống làm KPI đếm đôi im lặng). Bia mộ
  vẫn không được làm keeper: seed luật 8 ở nhánh này là dòng tháng cũ nhất cùng tên, và ở
  nhánh này luật 8 không bao giờ dọn được gì (dòng dọn được phải có Card+id, mà có id thì
  nó là dòng SỐNG và thắng bia mộ) nên nó cũng không vá id vào keeper.
  **Đừng gọi lại `healOlderByTitle_` trong nhánh bia mộ.** Vá theo tên là suy đoán; vá cho
  một pid đã xoá là đưa id đó vào dòng tay ở tab cũ, lượt sau nó khớp id và bị đường update
  ghi đè Tên/Status/Point/Role — mất Point/Role user gõ tay và task đã xoá sống lại trong
  KPI. `CLOSED_THROUGH` không đỡ (chốt sổ chỉ chặn ADD). Chỉ còn ĐÚNG MỘT chỗ gọi nó, ở
  đường add bình thường, và vẫn phải nằm NGOÀI cổng "vừa vượt mốc".
  Giá đã trả (chấp nhận, không phải bug): dán id vào một dòng TRỐNG TRƠN ở tháng đang tính
  khi task còn dòng tay ở tab cũ hơn → từ lượt 2 dòng trống thành bia mộ và task đứng yên.
  Không mất dòng nào; cửa thoát là dán id vào chính dòng ở tab cũ.
- **Dòng-của-script nhận bằng CẶP ô Card (F) + page id (G)**, không bằng mỗi G. Tài liệu
  bảo user tự dán id vào G, nên "có id = của script" đã sai — làm đúng theo tài liệu mà
  bị luật 8 dọn mất dòng vừa gõ. Sai an toàn về phía KHÔNG dọn (bất biến (i) đứng trên).
- **`_STATE` thiếu cột `stamped` → dựng lại dấu từ SHEET, không suy từ status.** Suy từ
  status gán nhãn "đã xoá" cho mọi task chưa từng có dòng (bị `CLOSED_THROUGH` chặn, sync
  bắt hụt, nằm trong tab lạ) rồi ghi vĩnh viễn ngay lượt đầu — khoá chết đường quét bù.
  Đọc từ sheet thì sai lầm tự sửa (quay lại đúng 1 lần rồi stamp thật đóng lại). Đúng lượt
  dựng lại còn nhận thêm theo TÊN dòng tay (dòng tay không có id) — **nhưng chỉ dòng tay ở
  tab tháng MỚI HƠN tháng đang tính**. Gom mọi tab là task Notion mới toanh trùng tên bất kỳ
  dòng trống-G nào (sheet thật ~325 dòng) bị đóng dấu "đã xoá" VĨNH VIỄN ngay lượt trigger
  im lặng đầu tiên, chết ở cổng add mãi mãi, và alert quét bù tố oan user. Hai vùng kia đã
  có luật lo: tab CŨ HƠN → luật 7 (vá id, `blockedOld`, chặn trước cổng add); ĐÚNG tab đang
  tính → luật 5 (vẫn add + cờ 🤖 Nghi trùng ngay cạnh). Còn lại đúng hình ca 2026-08-06.
  Suy đoán này phải NÊU TÊN task + dòng tay khớp vào log ngay lúc nổ, và dòng của nó trong
  alert quét bù phải nói rõ "khớp theo tên, không phải page id".
- **Stamp là VĨNH VIỄN, không rơi theo status.** Fetch 502, user bỏ assign, page đổi board
  đều không được làm mất dấu ("rule 7 đỡ được" là sai — rule 7 cần một dòng CÓ SẴN).
  `notionQuery_` trả `{pages, ok}`; đọc thiếu thì giữ nguyên status cũ + phất cờ
  `fetchFailed`. `writeState_` ghi HỢP của map+stamped và ghi ĐÈ, **không `clearContents`**
  (cửa sổ đó từng để lại `_STATE` trắng = mất sạch ký ức xoá tay).
- **Note của script ghi cho mỗi dòng đúng MỘT lần** (`SCRIPT_NOTE_ACK`, khoá `MM/YYYY!dòng`).
  User xoá note = đã đọc; ghi lại mỗi 10 phút thì user sẽ ngừng đọc mọi note. Sự kiện vẫn
  đếm + log mỗi lượt.
- **`SCRIPT_NOTE_ACK` có trần 9216 byte (~581 dòng) và phải được dọn.** Store chỉ thêm không
  bớt thì `setProperty` ném `Argument too large` giữa lượt, TRƯỚC `writeState_`, không có
  try/catch nào trên đường `noteOnce_` → luật 8 → `syncNow` → mọi nhịp 10 phút chết vĩnh
  viễn vì store không bao giờ nhỏ lại. Hai lớp: **bọc try/catch** lượt ghi dấu (dấu ack là
  đồ trang trí, không được kéo sập lượt cộng point — cùng lý do `syncRowFormat_` /
  `syncStatusColors_` được bọc), và **`pruneNoteAck_` mỗi lượt**. Dấu chỉ chết khi dòng đó
  KHÔNG BAO GIỜ ghi note lại được: tab không còn, hoặc dòng trống hết A..H (mọi đường gọi
  `noteOnce_` đều qua `titleRows`, cần dòng còn TÊN). **Đừng dọn theo "ô H hết note"** —
  user xoá note = đã đọc, dọn theo đó là note mọc lại sau 10 phút, đúng thứ ack sinh ra để
  chặn. Chỉ còn MỘT luật sống (`rowHasContent_`), không còn nhánh theo LOẠI — nhánh `!tomb`
  đã gỡ cùng note bia mộ. Vẫn đừng đụng luật `rowHasContent_` này: probe mutation gỡ nó ra
  thì hai test `F8` đỏ (note trùng của luật 8 mọc lại mỗi 10 phút).
- Hàm gắn **menu / trigger** phải để tên **không có gạch dưới cuối**: Apps Script coi
  `tênHàm_` là private và `addItem` gọi không ra ("Script function not found").
