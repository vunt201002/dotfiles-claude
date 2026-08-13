# VI conventions — thuật ngữ + cấu trúc cấm (file TÍCH LŨY)

> **Vai:** `/read-vi` nạp file này ở **pass 1 (draft)** và **pass 2 (editor mù nguồn)**.
> §A quyết định từ nào giữ tiếng Anh, §B là danh sách cấu trúc dính-syntax-nguồn kèm bản
> viết lại, §C là cổng chấm tự nhiên. §D nói file này lớn lên bằng cách nào.

> **Vì sao file này tồn tại:** lỗi dịch không nằm ở từ vựng — thuật ngữ giữ tiếng Anh là
> xong. Lỗi nằm ở **cú pháp**: model vừa nhìn bản tiếng Anh vừa viết tiếng Việt thì thay
> từ nhưng giữ nguyên khung câu Anh. Bảo "viết tự nhiên hơn" không chữa được, vì bản gốc
> vẫn nằm trước mặt. File này là phần chữa **kiến thức**; pass 2 mù nguồn là phần chữa
> **cơ chế**. Thiếu một trong hai thì lỗi quay lại.

> **Luật grounded:** mỗi dòng trong §B phải là một cấu trúc mà dev Việt đọc lên là thấy
> gợn, kèm **bản viết lại cụ thể**. "Câu nghe hơi Tây" mà không chỉ được cấu trúc nào =
> không được thêm vào bảng.

---

## Nghi thức bắt buộc (30 giây, mỗi lần chạy)

1. **ĐỌC trước** — mở §A + §B TRƯỚC khi viết câu tiếng Việt đầu tiên (pass 1), và TRƯỚC
   khi sửa (pass 2).
2. **GHI sau** — chạy xong một bài: cấu trúc nào editor hoặc user bắt được mà §B chưa có
   → append ngay, kèm bản viết lại. Thuật ngữ nào phải quyết định mà §A chưa có → append.
   Đây là bước có số thứ tự trong SKILL.md, không phải lời hứa.

Giá trị của file là **câu xấu hôm nay không quay lại tuần sau**. Một dòng không được ghi
là một lần phải nghĩ lại từ đầu.

---

## §A. Thuật ngữ

### §A1. Giữ nguyên tiếng Anh — MẶC ĐỊNH cho mọi thuật ngữ kỹ thuật

Đây là lựa chọn đã chốt của user, và khớp với `/learn` ("Vietnamese explanations; keep
terms, code, concept names in English"). Không cần xin phép từng từ.

Giữ nguyên: tên công nghệ · tên sản phẩm · tên hàm/biến/file · tên khái niệm kỹ thuật.

Ví dụ (danh sách minh hoạ, không phải danh sách đóng): `cache` · `deploy` · `build` ·
`commit` · `merge` · `branch` · `API` · `endpoint` · `request` · `response` · `latency` ·
`throughput` · `race condition` · `deadlock` · `hook` · `state` · `props` · `component` ·
`render` · `bundle` · `tree-shaking` · `migration` · `index` · `query` · `transaction` ·
`token` · `prompt` · `context window` · `embedding` · `fine-tune` · `container` · `pod` ·
`cluster` · `retry` · `backoff` · `rate limit` · `webhook` · `payload` · `schema` ·
`refactor` · `benchmark` · `profiling` · `garbage collection` · `thread` · `worker`.

Bổ sung (chốt khi dịch bài release note của OpenAI): `slider` · `guardrails` · `system card` ·
`reasoning` · `roleplay` · `fact` (trong "sai fact") — đều giữ tiếng Anh. Thuật ngữ chuyên
ngành ngoài IT cũng vậy khi nó là tên gọi cố định: `marine layer` · `rip current`.

Bổ sung (chốt khi dịch bài về cách học bằng LLM): `hallucination` · `low-poly` ·
`simulation` · `animation` · `knowledge base` · `plan mode` · `PoC` · `dashboard` ·
`challenge` · `puzzle` · `fab` · `quartz` — đều giữ tiếng Anh.

**Tên một control trên UI:** danh từ chỉ loại viết tiếng Việt, tên riêng giữ tiếng Anh —
`nút Think`, `slider`, `tab Settings`. Đừng dịch tên control (`nút Nghĩ` là sai).

Code, tên định danh, tên lệnh, tên flag: **giữ nguyên byte**. Không dịch, không "dọn dẹp",
không đổi quote, không sửa chính tả trong code.

### §A2. Có bản tiếng Việt đã chấp nhận

Dùng bản tiếng Việt khi dev Việt thật sự nói như vậy, không phải khi từ điển cho phép.

| English | Tiếng Việt dùng được | Ghi chú |
|---|---|---|
| performance | hiệu năng | cả hai đều ổn; `performance` cũng được |
| security | bảo mật | |
| vulnerability | lỗ hổng | |
| version | phiên bản | trong câu văn; số version giữ nguyên (`v1.4.2`) |
| library | thư viện | khi nói khái niệm; nói về một package cụ thể thì `lib`/`package` |
| open source | mã nguồn mở | |
| memory leak | rò rỉ bộ nhớ | `memory leak` cũng rất phổ biến |
| edge case | trường hợp biên | `edge case` phổ biến hơn |
| trade-off | đánh đổi | |
| bottleneck | nút thắt | |
| overhead | chi phí thêm | tuỳ ngữ cảnh; `overhead` giữ nguyên cũng ổn |
| deprecated | đã bỏ / sắp bỏ | đừng dịch thành "không dùng nữa" nếu vẫn chạy được |
| flow (mạch chạy của một simulation/animation) | luồng chạy | `luồng` trần thì đụng nghĩa `thread` — thêm `chạy` là hết mơ hồ. `flow` của data/stream vẫn giữ tiếng Anh |

### §A3. CẤM dịch kiểu này

Các bản dịch dưới đây đúng từ điển nhưng sai trong ngữ cảnh dev — hoặc đè lên một nghĩa
khác đã có sẵn trong tiếng Việt kỹ thuật.

| English | CẤM dịch thành | Vì sao |
|---|---|---|
| framework | khung sườn / khuôn khổ | không ai nói vậy |
| commit | cam kết | `cam kết` là nghĩa đời thường, đọc lệch hẳn |
| build | xây dựng | `xây dựng` nghe như dự án xây nhà |
| release | phát hành | ổn cho phim/sách, lệch cho CI/CD |
| prompt | lời nhắc | |
| token | thẻ / mã thông báo | |
| cache | bộ nhớ đệm | đúng nghĩa nhưng không ai nói khi code |
| embedding | nhúng | **đụng nghĩa**: `nhúng` = embed một widget vào trang, khác hẳn |
| stream | dòng chảy | |
| hook | móc | |
| agent | tác nhân | |
| race condition | điều kiện đua | |
| garbage collection | thu gom rác | |
| handler | xử lý viên / bộ xử lý | |
| state (React) | trạng thái | `trạng thái` chỉ dùng cho nghĩa đời thường ("trạng thái hệ thống") |
| context (LLM) | ngữ cảnh | `ngữ cảnh` ok cho nghĩa đời thường, không cho `context window` |
| thread (OS) | sợi | `luồng` tạm được, nhưng `thread` rõ hơn; `thread` trên forum = "chủ đề" |

*(append tại đây khi gặp bản dịch sai mới)*

---

## §B. Cấu trúc cấm — bảng translationese

Đọc cột 3 để hiểu **vì sao nó dính**: mỗi dòng là một khung câu tiếng Anh in dấu lên
tiếng Việt. Biết khung nguồn thì bắt được cả họ hàng của nó, không chỉ đúng chuỗi ký tự.

### §B1. Bảng chính

| # | Dính syntax nguồn | Tự nhiên | Khung tiếng Anh gây ra nó |
|---|---|---|---|
| 1 | Việc sử dụng cache giúp cải thiện hiệu năng | Cache giúp chạy nhanh hơn | gerund làm chủ ngữ: *Using cache improves performance* |
| 2 | Điều này cho phép chúng ta có thể… | Nhờ vậy mình… | *This allows us to…* (+ `có thể` thừa, đã có `cho phép`) |
| 3 | được thực hiện bởi hệ thống | hệ thống làm | bị động + *by*: *is performed by the system* |
| 4 | Nó cung cấp cho bạn khả năng… · cho <ai> khả năng <làm gì> | Bạn có thể… · để <ai> <làm gì> được | *It provides you with the ability to…* · *gives X the ability to* |
| 5 | có thể được sử dụng để | dùng để | *can be used to* |
| 6 | một cách hiệu quả | hiệu quả | *-ly*: tiếng Việt tính từ đã làm được việc của trạng từ |
| 7 | trong trường hợp mà | khi | *in the case that / in cases where* |
| 8 | Nó là điều quan trọng rằng… | Quan trọng là… | dummy subject: *It is important that…* |
| 9 | Đáng chú ý rằng, cần lưu ý rằng | Đáng chú ý: … (hoặc bỏ hẳn) | *It is worth noting that…* |
| 10 | Tôi nghĩ **rằng** nó nhanh hơn | Tôi nghĩ nó nhanh hơn | *that*-clause bắt buộc trong tiếng Anh, tuỳ chọn trong tiếng Việt |
| 11 | Các developers cần phải hiểu **những** khái niệm này | Dev cần hiểu mấy khái niệm này | số nhiều `-s` dịch máy móc thành `các`/`những` |
| 12 | hiệu năng **của** việc render **của** component | component render nhanh chậm ra sao | chuỗi *of*: tối đa **một** `của` mỗi mệnh đề |
| 13 | Cách này **sẽ** làm nó nhanh hơn | Cách này nhanh hơn | *will* dịch thành `sẽ` ở mọi câu; `sẽ` chỉ dành cho tương lai thật |
| 14 | Request **đang được** xử lý bởi worker | Worker đang xử lý request | *is being + p.p.*: chồng cả tiến hành lẫn bị động |
| 15 | **Tuy nhiên,** … **Do đó,** … **Bên cạnh đó,** … (mỗi câu một cái) · **Vậy:** mở câu chốt | nhưng / nên / còn — nằm giữa câu · **Tóm lại:** | discourse marker dịch 1:1; tiếng Việt bỏ bớt phần lớn. *So: …* thành `Vậy:` cũng là dòng này |
| 16 | Hãy cùng nhau xem xét ví dụ sau | Thử ví dụ này | *Let's take a look at…* |
| 17 | Các bước thực hiện **như sau**: | Các bước: | *as follows:* — dấu hai chấm đã đủ |
| 18 | một trong những kỹ thuật quan trọng nhất · nằm trong nhóm … nhất | kỹ thuật quan trọng nhất nhì (hoặc bỏ) | *one of the most…* · *is one of the top…* |
| 19 | **Nếu** cache miss **thì** hệ thống **sẽ** phải query lại DB | Cache miss thì phải query lại DB | *If X, then Y will Z* dịch đủ ba mảnh |
| 20 | tại thời điểm này | lúc này (hoặc bỏ) | *at this point in time* |
| 21 | **về mặt** hiệu năng | về hiệu năng | *in terms of* |
| 22 | một kỹ thuật **được gọi là** memoization | kỹ thuật memoization | *a technique called X* — tiếng Việt đặt tên bằng đồng vị ngữ |
| 23 | **sự** gia tăng **của** latency | latency tăng | danh từ hoá `sự +` từ *the increase in* |
| 24 | **thực hiện việc** kiểm tra input | kiểm tra input | *perform the validation of* |
| 25 | **tiến hành** cài đặt package | cài package | *proceed to install* — `tiến hành` là tiền tố rỗng |
| 26 | Bạn **có thể muốn** cân nhắc… | Nên cân nhắc… / Có thể… | *You might want to consider…* |
| 27 | **Trong bài viết này, chúng ta sẽ** tìm hiểu về… | (bỏ hẳn câu, vào thẳng nội dung) | *In this article, we will explore…* |
| 28 | **vô cùng** nhanh, **cực kỳ** hiệu quả | nhanh, hiệu quả | *extremely / incredibly* — văn kỹ thuật Việt phẳng hơn |
| 29 | **Có thể nói rằng** đây là… | Đây là… | hedge nhập khẩu |
| 30 | **đảm bảo rằng** input hợp lệ | để input không lọt rác | *ensure that* |
| 31 | Đây là hàm **mà** trả về giá trị **mà** đã được cache | Hàm này trả về giá trị đã cache | chuỗi *that/which* — dấu hiệu số 1 của câu dài kiểu Anh |
| 32 | Chúng ta thấy rằng… (khi tác giả nói về nhóm của họ) | Bên mình thấy… | *we* dịch mù thành `chúng ta`; tiếng Việt phân biệt `chúng tôi` (không gồm người đọc) / `chúng ta` (có gồm) / `mình` |
| 33 | Kỹ Thuật Tối Ưu Hiệu Năng Ứng Dụng (tiêu đề) | Tối ưu hiệu năng: mấy cách | Title Case + chồng danh từ kiểu tiêu đề Anh |
| 34 | **Đầu tiên,** … **Thứ hai,** … **Cuối cùng,** … (nhưng không có list nào) | bỏ, trừ khi thật sự đang liệt kê | *First… Second… Finally…* rải đều mọi đoạn |
| 35 | Đoạn văn dài — 40 từ, ba mệnh đề phụ — nối bằng dấu gạch ngang `—` | tách câu, dùng dấu phẩy / hai chấm / ngoặc đơn | tiếng Việt không dùng em-dash như tiếng Anh (khớp `design-eye §E1 #3`) |
| 36 | **tính** khả dụng của hệ thống rất cao | hệ thống ít khi chết | `tính + adj` từ danh từ trừu tượng Anh; giữ khi nó **là** thuật ngữ (`tính nhất quán` = consistency) |
| 37 | Ngày 3rd tháng July, 2026 | 3/7/2026 | format ngày giữ nguyên kiểu Anh |
| 38 | Server gửi một Request tới Endpoint | server gửi request tới endpoint | viết hoa danh từ chung giữa câu, dính từ tiêu đề/nhấn mạnh tiếng Anh |
| 39 | **Đây là những gì** cần chờ đợi: · **Đây là những thứ** nên tính trước: | Dự kiến thế này: · Mấy thứ nên tính trước: | *Here's what to expect / Here's what to plan for* — dummy `Đây là` + mệnh đề quan hệ `những gì`; tiếng Việt vào thẳng, hai chấm đã đủ |
| 40 | Càng gần biển, gió càng rõ hơn **ở** Mission | … càng rõ hơn **so với** Mission | *more noticeable than at X* — bỏ mất `so với` làm câu vỡ nghĩa thành "rõ tại Mission" |
| 41 | phục vụ hết **dải** đó · phủ hết **phổ** nhu cầu | lo được hết ngần ấy việc · đủ kiểu | *serve that whole range/spectrum* — `dải`/`phổ` cho phạm vi trừu tượng là dịch mặt chữ |
| 42 | cảm giác phải **là** model đang nghĩ lâu hơn | cảm giác phải **giống như** model đang nghĩ lâu hơn | *it should feel like X* — tiếng Việt cần `giống như` / `như thể`, `là` nghe hụt |
| 43 | **Chỉ có một thứ** đáng lưu ý là X | Thứ đáng lưu ý **duy nhất** là X | *The one thing to watch out for is X* |
| 44 | … rối loạn ăn uống. **Thêm** hàng hoá giới hạn tuổi, hoạt động nguy hiểm. | gộp thẳng vào vế liệt kê của câu trước | *Plus X, Y, Z.* — tiếng Anh cho phép câu cụt kiểu này, tiếng Việt thì không |
| 45 | Gió **thiên về** làm bạn chậm lại **hơn là** làm ướt | Gió làm bạn chậm lại **nhiều hơn là** làm ướt | *tends to X rather than Y* / *is more likely to X than Y* — `thiên về` là calque cứng |
| 46 | **Một** đánh giá nội bộ chạy trên… | Đánh giá nội bộ chạy trên… | mạo từ *a/an* dịch thành `một` thừa (họ hàng #11, nhưng #11 là số nhiều `-s`) |
| 47 | Mình **đã** làm hẳn một cái · Bài **đã** nói ở trên | Mình làm hẳn một cái · Bài nói ở trên | thì quá khứ tiếng Anh dịch thành `đã` ở mọi động từ; tiếng Việt chỉ cần `đã` khi có mốc thời gian thật sự tương phản. Chiều quá khứ của #13 (*will* → `sẽ`) |
| 48 | **Thứ nhận về là** một animation đẹp · **Cái bạn có được là**… | Làm xong là có animation đẹp | *What you get is X* / *The result was X* — chủ ngữ danh từ rỗng `Thứ/Cái + V + là` đẩy lên đầu; tiếng Việt trả chủ ngữ về người/vật thật, hoặc bỏ hẳn chủ ngữ. Họ hàng #39 |
| 49 | *(bài đã chốt xưng hô `mình`)* **Mình** nhận về animation chính xác 100% · **Mình** nhìn theo xe goòng và thấy nó đổi dạng | Làm xong là có animation… · Nhìn theo xe goòng **là thấy được** nó đổi dạng | *you get X* / *you can watch X and see it change* — `you` phiếm chỉ bị hút vào xưng hô đã chốt, biến lời hứa chung thành **báo cáo cá nhân của tác giả** và nuốt luôn sắc thái *can*. Chữa bằng câu không chủ ngữ + gắn khả năng vào động từ (`thấy được`, `là thấy`), tuyệt đối không lôi `bạn` vào. Mặt trái của §B2(b): xưng hô **đúng** nhưng dùng **sai vai** |
| 50 | phân tích mấy bottleneck mới của AI, mấy thứ có thể làm chậm việc dựng data center, mình nhận ra… | …mấy bottleneck mới của AI, **tức** mấy thứ có thể làm chậm việc dựng data center. Rồi mình nhận ra… | appositive kẹp giữa chủ ngữ và vị ngữ; tiếng Việt không đọc trôi qua hai dấu phẩy rồi mới tới động từ. Tách câu, hoặc chèn `tức` |
| 51 | Design sát hơn. · Kết quả tốt hơn. *(đứng một mình)* | **Nhìn** sát thực tế hơn. · **Chạy ra** kết quả tốt hơn. | *The design is much closer.* — câu danh từ + tính từ; tiếng Anh có `is` đỡ, tiếng Việt cần một động từ thật (`nhìn`, `trông`, `chạy`, `đọc`) mới thành câu |
| 52 | **Bắt trả lời** câu hỏi về bước trước thì kiến thức bám lâu hơn | **Tự trả lời** câu hỏi về bước trước thì kiến thức bám lâu hơn | *Trying to answer questions about a previous step helps you retain it* — gerund tiếng Anh cho phép trống chủ thể; tiếng Việt phải gọi tên ai làm. **Bẫy:** gọi tên SAI người còn tệ hơn để trống — điền `người chơi` vào chỗ gốc nói chính người đọc là sai attribution, không phải sửa văn phong |

### §B2. Hai lỗi cấu trúc (không phải chuỗi ký tự — phải đọc mới thấy)

**a) Câu để nguyên độ dài tiếng Anh.** Tiếng Anh xếp chồng mệnh đề quan hệ rất thoải mái;
tiếng Việt thì không — cùng nội dung đó phải **tách thành nhiều câu**. Dấu hiệu: một câu
có ≥2 mệnh đề phụ, hoặc ≥2 chữ `mà`, hoặc dài hơn ~35 từ. Cách chữa: tìm chỗ mạch ý ngắt
tự nhiên và chấm câu ở đó; đừng chỉ thay `mà` bằng dấu phẩy.

**b) Xưng hô trôi.** Mở bài bằng `bạn`, giữa bài trượt sang `chúng ta`, cuối bài thành
`mình`. Chọn **một** và giữ suốt bài. Mặc định: `mình` cho bài viết lại (giọng kể), `bạn`
cho bài hướng dẫn (có bước làm). Chọn xong thì trong bài **không được xuất hiện** hai họ
kia. Đây là lỗi dễ bắt nhất và cũng dễ sót nhất, vì mỗi đoạn đọc riêng đều ổn.

### §B3. Negative list — điều CẤM khi sửa

- KHÔNG sửa câu tiếng Việt bằng cách nhìn lại bản tiếng Anh "cho chắc" — đó chính là chỗ
  cú pháp nguồn chui vào. Pass 2 mù nguồn tồn tại là vì lý do này.
- KHÔNG giữ một cấu trúc ở §B1 chỉ vì "câu gốc nó viết thế". Câu gốc viết thế là chuyện
  của câu gốc.
- KHÔNG dịch thuật ngữ đã có ở §A1 sang tiếng Việt "cho thuần Việt".
- KHÔNG đổi số, tên riêng, tên hàm, version khi đang sửa văn phong — đó là việc của pass 3
  bắt lỗi, không phải việc của editor thêm lỗi.
- KHÔNG rút gọn bài ở chế độ `DỊCH SÁT`. Rút gọn chỉ hợp lệ ở `VIẾT LẠI`.
- **KHÔNG đổi MỨC ĐỘ của một claim khi đang sửa văn phong.** Viết lại cho thuận tay rất dễ
  kéo `nhiều mảng chưa biết` → `gần như mù tịt`, `hơi khó chịu` → `khó đọc`, `chi tiết có
  thể thiếu` → `chi tiết có thiếu`, `chính xác hơn` → `sát hơn hẳn`. Bốn cái đó đến từ
  **đúng một vòng editor**, và cả bốn đều lọt qua vì nghe hay hơn. Bạn mù nguồn nên không
  có cách nào kiểm được độ mạnh của câu gốc — vậy thì giữ nguyên độ mạnh của câu bạn nhận
  được. Đổi nhịp, đổi trật tự, đổi từ: được. Đổi liều: không.
- **KHÔNG bỏ khung giả định (`Giả sử…`, `Nếu…`) như thể nó là hedge nhập khẩu.** `Có thể
  nói rằng` (#29) là hedge rỗng, bỏ được. `Giả sử X` là **nội dung**: bỏ đi thì "nếu anh
  thấy X" biến thành khẳng định "X". Phân biệt: hedge rỗng nói về thái độ người viết, khung
  giả định nói về điều kiện của sự việc.
- **KHÔNG thu hẹp (hay nới rộng) PHẠM VI của một claim khi đang sửa văn phong.** Đây là
  trục thứ hai, song song với trục liều ở trên. Sửa cho gọn tay rất dễ kéo `một bước đã đi
  qua` → `bước vừa đi qua`, `mấy thứ` → `thứ`, `một trong các X` → `X`: câu ngắn hơn, đọc
  mượt hơn, và **hẹp hơn bản gốc**. Dấu hiệu grep được: `vừa` · `ngay` · `chính` chèn vào
  trước một danh từ vốn phiếm chỉ. Cùng họ với việc chèn `chắc` / `có lẽ` vào một câu
  khẳng định — đều là editor mù nguồn tự chỉnh cho êm tai một thứ nó không có cách nào
  kiểm được.

*(append tại đây khi có điều cấm mới)*

---

## §C. Cổng tự nhiên — chấm bản tiếng Việt

Theo đúng hình dạng của `design-eye §B`: tầng cơ học chạy trước (rẻ, deterministic), tầng
taste chạy sau.

### §C1. Tầng cơ học — grep được, không cần "gu"

Chạy trên đúng file tiếng Việt cuối cùng. Mỗi mục phải **0 hit**, hoặc từng hit còn lại
phải được gọi tên và giải thích vì sao giữ.

- [ ] Không chuỗi nào ở §B1 còn sót (grep từng cụm)
- [ ] `của` ≤ 1 lần mỗi mệnh đề
- [ ] `rằng` gần bằng 0 (chỉ giữ khi bỏ đi thì câu mơ hồ)
- [ ] Không có `được … bởi`
- [ ] Không có `một cách <tính từ>`
- [ ] Xưng hô: chỉ một họ trong `bạn` / `mình` / `chúng ta` / `chúng tôi` xuất hiện
- [ ] Không có em-dash `—` trong phần văn xuôi
- [ ] Không câu nào > ~35 từ; không câu nào có ≥2 chữ `mà`
- [ ] Code / tên định danh / số / version giữ nguyên byte so với bản gốc

### §C2. Tầng taste — 5 dimension, 0-10

| Dimension | Đo cái gì |
|---|---|
| `nhịp câu` | độ dài + số mệnh đề; câu có ngắt đúng chỗ người Việt cần thở không |
| `từ ngữ` | có cấu trúc §B1 nào sót không; có danh-từ-hoá thừa không |
| `xưng hô` | một họ duy nhất, giữ suốt bài |
| `mạch đoạn` | connector có bị dịch 1:1 không; đoạn ngắt theo ý tiếng Việt hay theo bản gốc |
| `thuật ngữ` | §A1 giữ tiếng Anh; §A2 dùng đúng chỗ; §A3 không dính bản dịch cấm |

**Ngưỡng đóng: mọi dimension ≥9.** Lấy đúng ngưỡng của việc *improve/build/redesign* trong
`personal/global-CLAUDE.md`, vì dịch/viết lại là làm ra văn bản mới, không phải fix bug —
không có áp lực minimal-fix nào để phải chấp nhận 8.

**Ai chấm:** editor của vòng sau chấm bản của vòng trước. Không ai tự chấm bản của chính
mình. Chi tiết vòng lặp ở SKILL.md.

---

## §D. File này lớn lên bằng cách nào

Ba nguồn, đều là **append**, không bao giờ viết đè:

1. **Editor pass 2 bắt được** một cấu trúc chưa có trong §B1 → dòng mới, kèm bản viết lại
   và (nếu đoán được) khung tiếng Anh gây ra nó.
2. **User bảo "câu này đọc gợn"** → dòng mới, lấy đúng câu user chê làm cột 1.
3. **Một thuật ngữ phải quyết định** giữa Anh và Việt, mà §A chưa có → thêm vào §A1, §A2
   hoặc §A3 tuỳ kết quả.

Ghi ngay trong cùng phiên, không để dành. Trùng thì gộp, đừng thêm dòng gần-giống.
Không xoá dòng cũ chỉ vì bảng dài — bảng dài là tài sản; đào lại một câu xấu đã từng chữa
tốn hơn nhiều so với việc đọc thêm vài dòng.
