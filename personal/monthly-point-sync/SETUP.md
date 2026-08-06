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

## Script Properties (Project Settings)
| Property | Ai ghi | Nghĩa |
|---|---|---|
| `NOTION_TOKEN` | anh, 1 lần | Bí mật duy nhất. Không nằm trong code. |
| `ACTIVE_MONTH` | menu ⏪ / ✅ | Ghim tháng đích cho dòng MỚI. **Vắng = tháng lịch.** |
| `CLOSED_THROUGH` | menu ✅ | Chốt sổ tới hết tháng này; tab ≤ nó không nhận task mới. **Vắng = chưa chốt tháng nào.** |
| `STATUS_COLOR_CACHE` | script | Cache bảng màu status, để khỏi gọi Notion mỗi 10 phút. |
| `ROW_FORMAT_VERSION` | script | Phiên bản format dòng đã đặt (wrap cột tên + checkbox Have + ẩn cột G). Xoá đi = đặt lại ở lượt sync sau. |
| `SCRIPT_NOTE_ACK` | script | Nhớ dòng nào đã được ghi note 🤖 rồi, để note không mọc lại sau khi anh xoá. |
> Ba cái dưới do menu tự lo, không cần sửa tay. Vắng mặt luôn là trạng thái bình thường
> và an toàn — xoá đi là quay về mặc định chứ không hỏng gì.

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
- **Task anh đã xoá tay thì quét bù KHÔNG kéo về lại.** Script nhớ (trong sheet ẩn
  `_STATE`) pid nào đã từng có dòng trong sheet; pid đó mà giờ không còn dòng nào nữa
  nghĩa là anh đã xoá — quét bù bỏ qua và **nêu đích danh tên task** trong hộp thoại kết
  quả, không bao giờ im lặng. Task sync bắt hụt (chưa từng có dòng) vẫn được cứu như thường.
- **Đừng gõ tay vào sheet ẩn `_STATE`** — nó là bộ nhớ của script, không phải chỗ để sửa.
  Ẩn chứ không khoá nên anh mở ra xem thoải mái, nhưng **cột C là dấu "pid này từng có
  dòng"**: gõ số `1` vào một dòng ở đó là task tương ứng bị coi như anh đã xoá tay, và quét
  bù **không bao giờ** kéo nó về nữa. Script chỉ nhận đúng số `1` là dấu (gõ nhầm chữ khác
  thì nó bỏ qua, không bị hiểu thành lệnh xoá), nhưng cứ để `_STATE` yên là chắc nhất — mọi
  thứ trong đó script tự ghi tự đọc, không có việc gì cần anh sửa tay. Muốn xoá task thì
  dùng đúng hai cách ở mục "Xoá task bằng tay" bên dưới.

## Đầu tháng mà vẫn tính cho tháng trước (ghim tháng)
- KPI thường chốt sổ trễ vài ngày: sang đầu tháng 7 nhưng task vẫn tính cho tháng 6.
  Mốc chốt không cố định nên không auto — anh tự bấm:
- **⏪ Vẫn tính cho tháng trước (06/2026)**: từ lúc bấm, task MỚI được ghi vào tab
  tháng trước thay vì tháng lịch. Label tự điền đúng tháng, không phải gõ gì.
- Chốt sổ xong: **✅ Chốt: sang tháng lịch (07/2026)** — gỡ ghim, về bình thường, **và
  khoá luôn tháng 6**: từ đó tab tháng 6 (và mọi tab cũ hơn) **không nhận task mới nữa**.
- **An toàn khi quên gỡ:** ghim cũ hơn tháng liền trước tự bị bỏ qua (quay về tháng
  lịch, lệch tối đa 1 tháng). Đang ghim thì mỗi lần mở sheet có toast nhắc, và tên
  menu luôn hiện tháng đang tính (`🔄 Point Sync — tháng 06/2026`).
- Ghim chỉ đổi tab cho dòng MỚI (kể cả quét bù). Update dòng cũ / Have / Note giữ
  nguyên hành vi. Ghim lưu ở Script Property `ACTIVE_MONTH` — chỉ thao tác qua menu,
  không cần sửa tay.

## Chốt sổ tháng — tháng cũ không nhận task mới nữa
- Trước đây quên bấm "✅ Chốt" thì ghim tháng 6 còn hiệu lực hết tháng 7, task mới cứ
  chảy vào tab tháng cũ. Giờ **nút ✅ làm luôn việc chốt**: một khi đã sang tháng mới
  thì tháng cũ đóng, không phải nhớ thêm nút nào.
- Mốc chốt lưu ở Script Property `CLOSED_THROUGH` (một tháng `MM/YYYY`) — **mọi tab
  tháng ≤ mốc** đều đã chốt. Chưa bấm bao giờ = chưa chốt tháng nào, mọi thứ y như cũ.
- Mốc **chỉ tăng, không bao giờ giảm** — bấm lại nút ✅ không mở lại tháng đã chốt.
- **Tháng đã chốt vẫn được cập nhật đầy đủ:** Status / tên task / Point / Role vẫn sync
  từ Notion như thường, vẫn được ghi note, vẫn được dọn dòng trùng. Chốt chặn đúng **một**
  việc: **thêm dòng mới**. `Have` và `Note` anh tự gõ vẫn không bao giờ bị đè, y như trước.
- Task đáng lẽ vào tháng đã chốt sẽ **không bị nuốt im lặng**: nó được đếm, ghi vào
  Execution log, và hiện ngay trong alert của "quét bù".
- **Lỡ chốt sớm?** Bấm **⏪ Vẫn tính cho tháng trước** — nếu tháng đó đã chốt, script
  hỏi lại "Tháng MM/YYYY đã chốt sổ. Mở lại để tính tiếp?". Chọn Có là mở lại đúng tháng
  đó rồi ghim luôn; chọn Không thì không đổi gì.
- Tên menu luôn mang dấu mốc chốt (`🔄 Point Sync — tháng 08/2026 (đã chốt ≤ 07/2026)`).

## Xoá task bằng tay — script không hồi sinh

> **ĐỔI TỪ 2026-08-06 (vòng 2) — đọc kỹ chỗ này, thao tác cũ của anh giờ đã đủ.**
> Trước đây phải xoá cho bằng hết A..F **và** cả ô Note (H) thì script mới hiểu là anh xoá.
> Quét mấy cột nhìn thấy (A..D) rồi Delete là **chưa đủ**: ô tick `Have` và link Card còn
> sót nên dòng vẫn bị coi là còn sống, và cứ 10 phút script lại ghi lại tên/Status/Point/
> Role từ Notion. Đúng ca 2 task Reviewer ở `07/2026` mọc lại trong khi anh đã gõ tay chúng
> sang `08/2026` — KPI hai tháng cùng đếm.

**Cách xoá bây giờ — chọn một trong hai, cái nào cũng đúng:**

1. **Bôi đen dòng rồi bấm Delete.** Chỉ cần **A, B, C, D** (Tên / Status / Point / Role)
   trống là script hiểu ngay: task này anh đã xoá. Ô tick `Have`, link Card, ghi chú ở
   cột Note còn hay không **không quan trọng nữa**. Cột **G (page id) được ẩn** — không phải
   đụng tới, id nằm nguyên trong đó chính là thứ ghim cho task không bị kéo về lại.
2. **Menu 🔄 Point Sync → 🗑 Xoá task khỏi tháng này.** Bôi đen dòng (các ô trong vùng
   A..H), bấm menu, xác nhận. Nó dọn A..F và H, giữ lại id ở G, **và ghi dấu "task này đã
   xoá" ngay lập tức** — nên kể cả sau này anh có dọn nốt ô G thì quét bù cũng không kéo
   task về. Xong nó báo lại đã xoá mấy dòng.
   - Không xoá cả dòng bao giờ (khối KPI ở cột I+ nằm **trên cùng những dòng đó**).
   - Nó từ chối và **không xoá gì** khi: tab không phải dạng `MM/YYYY`; vùng chọn tràn
     sang cột I+ (đừng bấm số dòng để chọn cả dòng — bôi đen `A5:H6` chẳng hạn); vùng chọn
     không có dòng nào mang page id ở G (dòng anh gõ tay — script không tự dọn dòng tay,
     anh cứ bấm Delete thẳng); hoặc script chưa chạy lượt sync nào.
   - Chọn lẫn dòng tay vào cũng không sao: nó chỉ xoá dòng có id và **nói rõ đã bỏ qua
     dòng nào**.
   - Nó dọn **cả ô Note (H)**, kể cả ghi chú anh tự gõ — hộp thoại xác nhận nói thẳng
     chuyện đó. Đây là chỗ duy nhất script đè lên chữ của anh ở cột Note.
   - Bấm nút này **trước lượt sync đầu tiên sau khi dán code mới** cũng không sao: nó ghi
     dấu nhưng chừa lại phần "đang nâng cấp `_STATE`" cho lượt sync thật, nên phép nhận
     dòng-tay-theo-tên ở gạch đầu dòng dưới vẫn chạy đủ.

- Dù xoá kiểu nào, script cũng **không bao giờ ghi lại** task đó: dòng còn id ở G thì
  thành "bia mộ" (nằm im giữ chỗ, không được cập nhật lại); xoá sạch cả G thì `_STATE` vẫn
  nhớ pid đó từng có dòng, nên quét bù cũng bỏ qua (và nêu tên trong hộp thoại để anh biết).
- **Lỡ tay thì gọi lại được, không mất gì.** Dòng bị đóng băng mà anh **gõ lại tên task vào
  cột A** là nó sống lại ngay lượt sync kế tiếp: Status / Point / Role / link Card về đầy
  đủ từ Notion, ô tick `Have` của anh không bị đụng. Không phải xoá ô G, không phải bấm gì.
- **Đóng băng KHÔNG ghi note lên sheet** (đổi 2026-08-06). Dòng bia mộ là dòng **trống** —
  một ghi chú nằm đó đọc ra thành "không có task mà vẫn có note", nên script để ô Note (H)
  hoàn toàn yên. Muốn biết dòng nào đang đóng băng thì xem hai chỗ đọc được bất cứ lúc nào:
  - hộp thoại **quét bù** liệt kê `❄ Đang đóng băng` kèm tab + số dòng + tên task;
  - **🩺 Chẩn đoán sheet** có dòng `Dòng đang đóng băng` cùng danh sách chi tiết theo từng tab.

  Execution log cũng ghi từng dòng bia mộ, nhưng log chỉ giữ vài ngày — hai hộp thoại trên
  mới là đường chính thức.
- **Còn sót note 🤖 "đang được coi là ĐÃ XOÁ" từ bản trước?** Bản cũ có ghi note đó vào ô H.
  Script **không tự dọn chữ đã ghi** (luật cột Note), nên vài dòng bia mộ trên sheet có thể
  còn note cũ nằm lại. Cứ **xoá tay ô H** đi cho sạch — không ảnh hưởng gì, việc nhận diện
  bia mộ không nhìn cột H bao giờ.
- **Đúng lượt đầu tiên sau khi dán code mới**, `_STATE` chưa có cột dấu nên script dựng lại
  dấu từ chính sheet. Riêng lượt đó nó còn nhận thêm theo **TÊN**: task trùng tên một dòng
  anh gõ tay ở tab tháng **mới hơn** tháng đang tính cũng bị coi là "đã từng có dòng" (đúng
  ca anh ghim về tháng trước rồi gõ tay lại vào tháng này). Đó là **suy đoán theo tên**, nên
  nó ghi thẳng tên task + dòng tay khớp vào Execution log, và dòng của nó trong hộp thoại
  quét bù nói rõ *"khớp theo tên, không phải page id"*. Thấy dòng đó mà anh biết mình chưa
  xoá gì: **dán page id của task vào ô G của chính dòng tay đó** — lượt sync kế tiếp
  nhận ra nó và cập nhật Status/Point/Role + vá link như một dòng bình thường. (Xoá dòng
  tay đi thì **không** gỡ được: dấu "từng có dòng" là vĩnh viễn, đúng như luật xoá tay.)
- Dấu "pid này từng có dòng" **không rơi vì lỗi vặt**: Notion trả lỗi một lượt, anh bỏ
  assign một hôm, page chuyển board — dấu vẫn còn, quét bù vẫn không hồi sinh. Lượt sync
  nào đọc Notion không đầy đủ sẽ nói thẳng trong Execution log và trong hộp thoại quét bù.
- Chuyển task sang tháng khác bằng tay (xoá ở tab cũ + gõ lại ở tab mới) là an toàn —
  dòng anh gõ tay **không bao giờ** bị script tự xoá, kể cả khi nó trùng tên với dòng ở
  tab khác. Script nhận ra dòng của chính nó bằng **cặp** ô Card (F) + page id (G) —
  nó ghi cả hai cùng một lúc lúc sinh dòng. Dòng gõ tay thiếu một trong hai nên vẫn
  được bảo vệ **kể cả sau khi anh dán id vào G**.
- Lưu ý: dòng gõ tay không có id nên Status/Point **không tự cập nhật** theo Notion nữa.
  Muốn nó sống theo Notion thì dán page id của task vào ô cột G của dòng đó — lượt
  sync kế tiếp sẽ cập nhật Status/Point/Role và vá luôn link Card cho dòng đó.
  - Dán id vào một dòng **trống trơn** cũng được: script sẽ điền cả dòng cho anh. Trừ
    **hai** ca:
    - pid đó trước đây script đã từng đặt dòng rồi anh xoá đi — lúc ấy ô id lẻ loi là
      "bia mộ", script giữ nguyên chứ không hồi sinh. Muốn kéo lại thì xoá ô G đó đi rồi
      bấm quét bù.
    - task đó còn một **dòng gõ tay ở tab tháng CŨ HƠN**. Luật 8 giữ dòng tháng cũ làm bản
      chính, mà dòng tay thì không bao giờ bị tự dọn — nên **không có gì bị dọn**, và ô G
      của dòng cũ chỉ được vá id khi có thứ gì đó bị dọn. Kết quả từng lượt:
      - **Lượt đầu:** dòng ở tab tháng cũ được cập nhật một lần (tên/Status/Point/Role +
        vá link Card). Dòng trống của anh **vẫn trống**, chỉ nhận một note `🤖 Trùng với …`
        và giữ nguyên id anh vừa dán.
      - **Từ lượt sau:** dòng trống mang id lẻ loi đó bị xếp là **bia mộ**, nên task ngừng
        được cập nhật ở cả hai chỗ. Không có gì bị xoá hay bị đè — chỉ là nó đứng yên, và
        🩺 Chẩn đoán sheet nêu nó ra trong danh sách `Dòng đang đóng băng`.
      Muốn task sống theo Notion: dán id vào ô G của **chính dòng ở tab tháng cũ** (đúng
      cách ở gạch đầu dòng trên), hoặc xoá dòng ở tab tháng cũ trước rồi mới dán id vào
      dòng mới. Đừng để một dòng trống A..D chỉ có mỗi ô G.
  - Nếu task đó **đã có dòng ở một tab tháng CŨ HƠN**, dán id xong script sẽ coi dòng
    tháng cũ là bản chính (luật 8: giữ tháng cũ nhất) và ghi một note 🤖 vào dòng mới của
    anh thay vì cập nhật nó. Dòng của anh không bị xoá, nhưng muốn task "chuyển hẳn"
    sang tháng mới thì **xoá dòng ở tab tháng cũ trước**, rồi mới dán id.

## Ghi chú tay ở cột Note (H)

- Cứ **gõ thẳng vào ô H**. Script **không bao giờ** đè lên ô đã có chữ — cả 4 chỗ nó ghi
  Note đều kiểm ô trống trước.
- **Ngoại lệ duy nhất: nút 🗑 Xoá task khỏi tháng này.** Nút đó dọn ô H **kể cả chữ anh tự
  gõ** — hộp thoại xác nhận nói thẳng chuyện đó và anh phải bấm Yes. Mọi đường còn lại (xoá
  tay bằng phím Delete, script dọn dòng trùng theo luật 8) đều giữ nguyên chữ của anh.
- Cột Note được để kiểu **chữ ghi chú**: wrap (không tràn sang khối KPI ở cột I+), chữ
  **nghiêng, xám, nhỏ hơn một cỡ** — ghi chú lùi ra sau chứ không tranh chỗ với task.
  Cột đang hẹp thì script nới ra ~280px; anh đã tự kéo rộng hơn thì nó không đụng.
- Note của script luôn mở đầu bằng **🤖**. Đó là dấu nhận diện duy nhất, nên **mọi icon
  khác thuộc về anh**: `📝`, `ℹ️`, `✅`… gõ thoải mái, không bao giờ bị nhận vơ.
  (Mac: `Ctrl + Cmd + Space` mở bảng emoji.)
- **Đừng viết thêm vào sau một note 🤖 có sẵn.** Ô đó vẫn bị tính là của script, nên nếu
  dòng ấy sau này bị dọn vì trùng thì chữ anh thêm mất theo. Muốn giữ thì xoá dấu 🤖 đi
  rồi viết lại từ đầu.
- Ô H **đã có chữ của anh thì script thôi ghi cảnh báo vào đó** — cảnh báo trùng của dòng
  ấy chỉ còn trong Execution log, mà log chỉ giữ vài ngày.
- **Xoá một note 🤖 đi = anh đã đọc và thấy ổn.** Script ghi note trùng cho mỗi dòng đúng
  **một lần**; xoá rồi thì nó không mọc lại nữa (dù tình huống trùng vẫn còn). Sự kiện
  thì vẫn được đếm và ghi Execution log mỗi lượt, nên không có gì bị giấu.
  Dấu "đã ghi rồi" này gắn theo **ô** (`tháng!dòng`), và Google chỉ cho script giữ ~9KB
  cho nó. Nên script tự dọn dấu của những dòng đã **trống trơn cả A..H** hoặc nằm ở tab
  không còn tồn tại — chúng không bao giờ được ghi note lại nữa nên giữ cũng vô ích.
  Hệ quả anh có thể thấy: xoá **cả dòng** (chứ không phải mỗi ô H) rồi sau này có task
  mới rơi vào đúng dòng đó thì nó được ghi note như một dòng mới. Xoá **mỗi ô H** thì dấu
  vẫn còn nguyên — note đã đọc không mọc lại. Kể cả lúc dấu ghi hỏng (đầy chỗ, quota),
  lượt sync vẫn chạy xong bình thường: point vẫn được cộng, `_STATE` vẫn được ghi.
- Note nằm trong vùng A..H nên **một dòng chỉ có Note vẫn được tính là dòng đã dùng** —
  task mới sẽ không rơi vào đó.
- **Note ở H KHÔNG còn giữ một dòng "sống" nữa** (đổi 2026-08-06 vòng 2). Trước đây ô H có
  chữ của anh thì dòng đó vẫn được coi là còn dùng và vẫn bị sync đè lên. Giờ chỉ **A..D**
  quyết định: A..D trống + còn id ở G = anh đã xoá, dù H có viết gì. Đúng là để anh xoá
  dòng rồi ghi lại lý do ("đã chuyển sang tháng 8") mà không bị script cãi mỗi 10 phút.
  Chữ anh gõ ở H vẫn **không bao giờ bị đè** — chỗ đó không đổi.

## 🩺 Chẩn đoán sheet
- Menu **🔄 Point Sync → 🩺 Chẩn đoán sheet** — **chỉ đọc**, không sửa gì trong sheet.
  Tóm tắt hiện ra trong hộp thoại, chi tiết từng tab / từng dòng nằm ở Execution log
  (Extensions → Apps Script → Executions).
- Nó trả lời mấy câu chỉ nhìn sheet thật mới biết:
  - Tab nào **không đúng dạng `MM/YYYY`** (bị đổi tên, `7/2026`, thừa khoảng trắng).
    Tab như vậy **vô hình** với sync: task trong đó bị coi là chưa có nên bị add lại ở
    tháng mới, lại còn không được tô màu. Đổi tên đúng dạng là hết.
  - Dòng nào **trống cột A mà vẫn còn data** ở B..H (dòng anh sửa tay — thủ phạm cũ của
    vụ bị ghi đè).
  - Dòng nào **thiếu page id ở cột G** (không khớp được theo id → dễ bị add lại).
  - **Page id / tên task trùng** giữa các tab.
  - Rule màu status nào còn ở **đời cũ**.
  - **Quét bù sẽ thêm bao nhiêu dòng** nếu bấm bây giờ — đo từ `_STATE`: task đã counted
    mà chưa có dòng nào trong sheet. Đây là bán kính nổ, xem trước rồi hãy bấm.
- Chạy một lần rồi gửi lại nội dung log là đủ để soi.

## Cách hoạt động
- Quét các data source trong `WATCH_SOURCES`, lấy task anh là **Developer** hoặc **Reviewer**.
- Task **chưa có trong sheet** mà đã đạt **Ready to Test** trở đi → ghi vào tab **tháng
  đang tính** — tháng lịch, hoặc tháng đã ghim qua menu (xem mục ghim tháng ở trên)
  (Point = `Size card`, Role = Dev/Reviewer, Status live, Card link, Have = chưa tick).
- Task **đã có** (khớp theo Notion page id, ở **bất kỳ** tab tháng nào) → cập nhật
  Status/Point/Role/tên ngay tại tab đó, kể cả tab tháng cũ; **giữ nguyên** Have và Note.
- **Không bao giờ** thêm dòng mới vào tab tháng cũ — dòng mới chỉ vào tháng hiện tại.
- **Task đã chuyển về tháng cũ thì không bị kéo lại.** Trước khi thêm, script quét mọi
  tab tháng: task đã có ở tab **cũ hơn** tháng đang tính là thôi, không add. Nếu dòng cũ
  đó **trống cột G** (anh gõ tay / cắt-dán thiếu cột nên không có id để khớp), script
  khớp theo **tên** và **vá luôn page id vào ô G trống** — lần sau khớp bằng id, hết
  cảnh mỗi lượt sync lại mọc thêm một dòng. Ô G đã có id thì **không bao giờ** bị ghi đè.
  Khớp theo tên là **suy đoán**, nên mỗi lần vá script để lại dấu `🤖 Tự gán Notion id
  theo tên task` ở cột **Note (H)** — hai task khác nhau mà trùng tên thì anh nhìn
  sheet là thấy, xoá dấu đi là xong. Note anh tự gõ thì không bị đè.
  Việc vá này chạy ở **mọi lượt sync**, kể cả trigger 10 phút — không phải đợi bấm "quét
  bù". Nó không phụ thuộc vào việc task có đang vượt mốc hay không, nên dòng thiếu id tự
  lành ở lượt sync kế tiếp thay vì nằm chờ người nhớ ra.
  **Trừ task anh đã xoá tay.** Nếu pid đó đang là "bia mộ" (dòng cũ trống A..D, còn ô G) thì script
  **không** vá id theo tên nữa: vá xong dòng anh gõ tay sẽ mang id của task đã xoá, và lượt
  sync kế tiếp ghi đè Tên/Status/Point/Role lên chính dòng đó. Dòng tay nằm im đúng như anh
  gõ; muốn nó sống theo Notion thì tự dán page id vào ô G của nó.
- **Một task nằm ở 2 tab tháng: trùng rõ thì tự dọn, trùng mờ thì ghi chú.** Khớp bằng id
  chỉ tìm ra task đang ở đâu, không biết nó có bản sao chỗ khác. Nếu bản sao ở tab kia lại
  giữ id thì script bám vào đó mãi và dòng còn lại thành mồ côi. Giờ mỗi lượt sync còn so
  theo **tên**, rồi phân loại theo **page id**:
  - Bên kia **trống id hoặc trùng id** → cùng một task. Giữ dòng ở **tab tháng cũ nhất**,
    **dọn** bản sao ở tháng mới hơn **có id** (dòng script sinh ra luôn có id), vá id vào
    dòng giữ lại. Bản sao **trống cột G** là dòng anh gõ tay — **không bao giờ tự dọn**,
    chỉ ghi `🤖 Trùng với …` vào Note (H) để anh tự quyết.
  - Bên kia có **id khác hẳn** → hai task Notion khác nhau trùng tên. **Không dọn**, chỉ ghi
    `🤖 Nghi trùng TÊN (page id khác)` vào cột **Note (H)** để anh tự quyết.

  Dọn ở đây là **xoá nội dung A..H**, không xoá cả dòng — khối KPI nằm ở cột I+ trên cùng
  những dòng đó, xoá dòng là mất luôn công thức. Note anh **tự gõ** trên dòng bị dọn vẫn
  được giữ nguyên; chỉ note do script ghi mới bị dọn theo. Lỡ dọn nhầm thì File → Version
  history khôi phục được.
- **Dòng mới rơi vào dòng trống đầu tiên**, lấp lỗ do luật 8 dọn bản sao để lại thay vì
  rơi xuống đáy. Vẫn không bao giờ ghi đè lên dòng còn nội dung — ghi vào ô trống thì
  không mất gì. Dòng cuối tính theo cả vùng A..H,
  nên dòng anh sửa tay (trống tên nhưng còn Status/Point/Note) **không bị ghi đè** nữa.
  Block KPI ở cột I trở đi không tính, nên dòng mới cũng không bị đẩy xuống chỗ trống.
- **Reviewer xử như Dev**: chỉ add khi status ≥ Ready to Test và chưa có ở tháng nào trước.
  So status **không phân biệt hoa thường** — lệch một chữ cái (`Waiting to Launch` vs
  `Waiting to launch`) từng đủ để task đi thẳng vào status đó không bao giờ được tính.
- **Tên task dài tự xuống dòng** ở cột A thay vì bị cắt cụt, và **checkbox cột Have phủ hết
  cột** — dòng thêm về sau hay dòng anh cắt-dán tay đều có ô tick như nhau, không còn cảnh
  dòng có dòng không. **Chữ căn giữa theo chiều dọc** cho cả A..H và **căn giữa ngang** cho
  Status→Card: tên task wrap thành 2-3 dòng làm dòng cao lên, ô một dòng bên cạnh mặc định
  dính đáy nên nhìn lệch. Cột tên và cột Note giữ căn trái — chữ dài mà căn giữa thì khó đọc.
  Tất cả đặt một lần cho cả cột, gắn số phiên bản `ROW_FORMAT_VERSION`.
- **Cột G (page id) được ẩn.** Nó là sổ sách của script, không phải chỗ anh đọc. Có một đời
  bản trước bỏ ẩn nó, vì hồi đó tín hiệu xoá đòi trống hết A..F nên ô id khuất là cái bẫy
  im lặng; từ khi tín hiệu thu về **A..D** thì quét mấy cột nhìn thấy rồi Delete đã là thao
  tác đúng, nên không cần bày ô id ra nữa. Đây là việc **một lần** theo `ROW_FORMAT_VERSION`:
  anh tự bỏ ẩn lại thì script không ẩn đè mỗi 10 phút.
- **Dòng mất link Card được vá lại.** Đường update xưa nay chỉ ghi Status/Tên/Point/Role nên
  dòng nào mất link (cắt-dán thiếu cột) là mất vĩnh viễn. Giờ ô Card **đang trống** thì được
  điền lại từ Notion; link anh tự sửa thì không bao giờ bị đè.
- **Nghi trùng** (cùng tên, khác id — vd task từ board cũ): vẫn add, nhưng ghi cảnh báo
  `🤖 Nghi trùng "<tên>" ở tab MM/YYYY` vào cột **Note (H)**. Anh check rồi xoá tay nếu trùng thật.
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

## Màu status — tự động, không có nút nào phải bấm
- **Anh không phải làm gì.** Mỗi lần sync (kể cả nhịp tự động 10 phút) code tự kiểm
  tra và chỉnh màu status. Task chuyển sang status nào là ô đó có màu đúng của status
  đó, kể cả status mới toanh vừa thêm bên Notion.
- **Màu đọc sống từ Notion** (schema Status của các board trong `WATCH_SOURCES`),
  không có bảng màu chép cứng trong code — nên màu trong sheet luôn khớp Notion.
- **Chữ status in đậm.** Chữ của chip Notion là màu nhạt trên nền nhạt, để nét thường
  thì đọc bị mờ trong Sheets. Rule do code sinh luôn bật bold; rule đã sinh từ trước
  cũng được nâng lên đậm ở lượt sync kế tiếp, không cần anh chỉnh tay.
- **Mọi tab dùng chung một bảng màu.** Trước đây script cố đoán "rule này của anh hay
  của code" và giữ lại rule nó không nhận ra — mà anh thì có tô màu bao giờ đâu, nên
  cái nó giữ lại chính là rule do bản script **đời cũ** sinh ra. Rule cũ chiếm chỗ status
  đó nên tab ấy không bao giờ nhận được màu mới, trong khi tab vừa tạo lại nhận màu hiện
  tại → mỗi sheet một màu. Giờ script **dựng lại** mọi rule màu status nó đọc được, nên
  tab cũ tab mới hội tụ về đúng một bảng màu. Lần dán code mới, lượt sync kế tiếp tự
  quét lại toàn bộ tab một lần.
- **Cái gì không dựng lại được thì không đụng vào.** Rule dùng công thức / "chứa chữ",
  và rule tô cho status mà Notion không còn — script giữ nguyên và vẫn xếp **lên đầu**
  (Sheets xét từ trên xuống, rule khớp đầu tiên thắng). Xoá mấy rule đó đi là mất màu
  của những dòng cũ mà không có gì thay thế.
- **Rule cũ bị chặn đuôi tự hết.** Rule `B2:B100` làm dòng thứ 101 trở đi trắng màu; vì
  rule luôn được dựng lại với range `B2:B` không chặn đuôi nên chuyện đó không còn đường
  tái diễn.
- Tô bằng **conditional formatting** trên cột **Status (B)**. Rule mới thêm cũng luôn
  dùng `B2:B` → dòng thêm sau này tự có màu.
- **Dropdown cột Status cũng lớn theo Notion.** Danh sách data validation được dựng lại
  từ đúng bảng status đó, nên status mới (`QA/UAT`, `Waiting to launch`…) không còn bị
  Sheets gắn cờ đỏ "invalid" oan. Dropdown để **cảnh báo chứ không chặn** — chặn cứng thì
  một status vừa đổi tên bên Notion sẽ khoá luôn lượt ghi của script, hỏng nặng hơn cờ đỏ.
- Áp cho **mọi tab tháng** và cả `_TEMPLATE`. Tô `_TEMPLATE` là để tab tháng mới
  (nhân bản từ nó) sinh ra đã có màu.
- **Không đè format tay của anh:** màu Role ở cột D và mọi rule cột khác giữ nguyên
  tuyệt đối. Chạy bao nhiêu lần cũng không nhân đôi rule.
- **Không tốn quota:** bảng màu được cache ở Script Property `STATUS_COLOR_CACHE`.
  Chỉ đọc lại Notion khi cache chưa có / gặp status lạ / cache quá 24h (bắt ca đổi
  màu bên Notion mà không đổi tên) / rule trong sheet còn ở format đời cũ. Bảng màu
  không đổi và format không đổi thì **không** ghi lại rule.
- **Tô lỗi giữa chừng thì lượt sau vá tiếp.** Cache chỉ được ghi *sau khi* tô xong. Nếu
  Sheets nghẽn quota ở tab thứ ba, cache vẫn giữ bảng màu cũ nên lượt sync sau làm lại,
  chứ không bỏ mấy tab lỡ dở kẹt màu sai vĩnh viễn.
- Hai board đặt **cùng tên status khác màu** → lấy màu board đầu trong `WATCH_SOURCES`
  (ghi log, không hỏi).
- **Notion lỗi thì không đụng gì:** chỉ cần **một** board đọc lỗi (429/500/token sai)
  là bỏ qua cả lượt và giữ nguyên rule đang có. Không bao giờ xoá màu của board đọc
  được, cũng không báo nhầm status của nó là "Notion không còn".
- **Quét ô cũ:** mỗi lần đọc lại bảng màu, code so status thực tế trong các tab tháng
  với (rule sẵn có của anh + bảng màu Notion) và **ghi đích danh vào Execution log**
  status nào vẫn không màu — tức là anh chưa tô mà Notion cũng không còn (đổi tên /
  xoá bên Notion). Sửa tên cho khớp Notion là hết.
- Mỗi lần ghi rule, log có một dòng tổng kết: **giữ nguyên bao nhiêu rule sẵn có, nới
  range bao nhiêu, thêm mới bao nhiêu** — mở Execution log là kiểm chứng được màu cũ
  không bị đụng.
- Cần soi hoặc ép tô lại ngay: mở Apps Script, chọn hàm **`colorStatusesFromNotion`**
  → **Run**. Cố tình không gắn menu vì màu đã tự đúng rồi.

## Giới hạn đã biết
- Tháng gán theo **lúc sync phát hiện** task đạt Ready to Test (chính xác tới mức tháng;
  chỉ lệch nếu transition rơi đúng đêm giao tháng — hiếm). Cần chính xác tuyệt đối thì
  nâng cấp webhook sau (cùng logic).
- Nếu task đã vượt Ready to Test *trước khi* bật sync và chưa có trong sheet, nó sẽ được
  gán vào tháng hiện tại (không phải tháng thực tế nó đạt Ready to Test).
