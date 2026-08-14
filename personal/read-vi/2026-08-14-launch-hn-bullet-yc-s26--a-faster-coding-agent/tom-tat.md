# Launch HN: Bullet (YC S26) – A Faster Coding Agent — tóm tắt (trang chủ Bullet)

> Nguồn: https://www.codewithbullet.com (không rõ ngày đăng)
> Bản dịch đầy đủ: [dich.md](dich.md)
> Loại: **tóm tắt + giải thích, do Claude viết** — KHÔNG phải lời tác giả, không phải bản dịch.
>   Chỗ nào cần nguyên văn thì đọc bản dịch, đừng trích file này.
> Viết: 2026-08-14

Một lưu ý về tỉ lệ, vì nó quyết định cách đọc bài này. Trang gốc chỉ chừng 460 từ, toàn
khẩu hiệu và nút download. Phần comment trên Hacker News dài gấp sáu lần. Nội dung thật
nằm ở phần comment, và bản tóm tắt này chia thời lượng theo đúng tỉ lệ đó.

## Trang bán cái gì

Bullet là coding agent, và toàn bộ lời chào hàng gói trong một chữ: nhanh. Trang mở bằng
`FAST, BY DESIGN.` cùng một nhãn `95.8% ON SWE-BENCH VERIFIED`. Private beta, miễn phí,
bản macOS và Linux, version `1.3.32`, Y Combinator rót vốn.

Mục 01 nêu vấn đề, và nêu khá sắc: bên họ đốt hàng giờ ngồi chờ agent chạy, **không phải
vì model kém**, mà vì bộ máy dựng quanh model nặng hơn mức cần. Đây là câu định vị quan
trọng nhất trang. Nó tách bài toán "model thông minh tới đâu" ra khỏi bài toán "cái vỏ bọc
quanh model tốn bao nhiêu thời gian", rồi tuyên bố chỉ đánh vào cái thứ hai.

## Ba protocol, và cơ chế thật sự đằng sau

Mục 02 là phần kỹ thuật duy nhất của trang. Khuôn vẫn là model → tools → results; thứ họ
đổi là vòng lặp quanh khuôn đó.

1. **Route / Escalate.** Việc dễ đẩy sang model nhanh, chỉ leo thang khi việc đòi. Trang
   vẽ ba nấc `FAST` / `DEEP` / `REASON`. Cơ chế: chi phí và độ trễ của một task phần lớn
   do model nào nhận task quyết định, nên chọn model là đòn bẩy rẻ nhất.
2. **Search / Acquire.** Search có định hướng cộng đọc file, thay vì embedding cả repo.
   Hình minh hoạ cho thấy chỉ `08%` repo bị đụng tới. Cơ chế: đọc ít thì context nhỏ,
   context nhỏ thì mỗi lượt gọi model rẻ và nhanh hơn.
3. **Parallel execution.** Tool call độc lập chạy cùng lúc, còn call trùng và loop kẹt bị
   chặn sớm. Đồng hồ trong hình dừng ở `00:02.31` cho ba thao tác đồng thời. Cơ chế: thời
   gian một task là tổng các lượt chờ tool, nên gộp chúng lại cắt được phần lớn thời gian
   chết.

Ba mục còn lại của trang mỏng: một video demo `02:14`, một bản CLI cài bằng
`npm install -g @trybullet/cli` (macOS và Linux, `Node 18+`, không cần key để bắt đầu),
và lời người sáng lập kể họ dựng Bullet vì ngày nào cũng dùng Claude Code và phát bực.

## Phần comment: chỗ có nội dung thật

73 comment, 25 nhánh gốc. Đáng chú ý ngay từ con số: 28 trong 73 comment là của chính hai
người sáng lập (`alsima` 23, `adi1` 5), tức gần bốn phần mười thread là lời người bán hàng.

### Đòn nặng nhất: con số 95.8% chứng minh được gì

Đây là phần đáng đọc nhất, và **cũng là chỗ có lời giải thích hay nhất bài**. Đúng một
người, `seizethecheese`, đẩy qua năm comment liên tiếp.

Lập luận không phải "các anh gian lận" mà là "bảng đã bão hoà nên con số không phân biệt
được gì". Chỗ hay nằm ở cách anh ta chứng minh: thay vì than trừu tượng, anh ta dựng một
thí nghiệm tưởng tượng ai cũng kiểm được. Trên một bảng đã bão hoà, chỉ cần viết một router
**chọn model ngẫu nhiên** là đã công bố được "điểm cao hơn với chi phí thấp hơn", vì mọi
model đều đã sát trần điểm nên router thừa hưởng giá rẻ mà gần như không mất điểm. Đẩy tiếp
sang trục tốc độ: chọn ngẫu nhiên giữa Fable và Gemini 3.7 Flash đã nhanh hơn chừng 50% mà
điểm còn tốt hơn (Flash 0.1 phút, Fable 0.8 phút); cứ luôn luôn chọn Flash thì công bố được
mức giảm 87.5% thời gian. Anh ta lấy số thật từ GPQA Diamond để neo: Fable 92.6% với $0.22
mỗi task, trong khi vài model khác điểm cao hơn mà chỉ $0.01.

Sức nặng của đòn này là ở chỗ nó biến một lời chê thành một cấu trúc kiểm chứng được. Ai
cũng dựng lại được cái router ngẫu nhiên đó và tự xem con số nói lên gì.

Phía Bullet không bác lập luận, mà nhượng bộ dần. `adi1` nhận 95.8% trên một benchmark đã
chín không phải bằng chứng chính, và cho biết đang chạy Terminal-Bench, CursorBench,
SlopCodeBench. `alsima` nhận benchmark chạy **không kèm router**, router chỉ có trong bản
chạy thật, và bài đăng sẽ được diễn đạt lại cho rõ. Đó là nhượng bộ rõ nhất toàn thread.

### Câu hỏi không ai trả lời

`yetanotherjosh` hỏi thẳng: cái gì trong harness này khác về **cơ chế** tới mức một prompt
hay một skill ở harness khác không tái tạo nổi. Anh ta soi từng gạch đầu dòng, và điểm số 3
là điểm kỹ thuật nhất cả thread: harness hiện có vốn đã không đọc lại file chưa đổi; phần
đã nằm trong context window là cached token nên gần như không thêm latency; mà **bỏ context
ra khỏi lịch sử thì làm hỏng KV cache**, tức "giữ context sạch" có thể tốn hơn phần nó tiết
kiệm. Không người sáng lập nào trả lời comment này. Người duy nhất đáp là `andai`, kể rằng
tái tạo được một phần lợi ích của harness tự dựng ngay trong Claude bằng MCP cộng startup
hook, nhưng vướng phải đánh nhau với system prompt của Claude.

### Harness có phải là một sản phẩm bán được

Ba tài khoản kể chuyện tự dựng harness riêng và chuộng đồ tự dựng hơn. `lowbloodsugar` hỏi
thẳng harness có kiếm ra tiền không, vì dựng nó không khó tới vậy, đưa lên GitHub thì người
ta chỉ cần chĩa AI vào là clone được. Câu đáp hay nhất nhánh này gọn một dòng, của
`japborst`: người ta không muốn dựng harness, người ta muốn xong việc, "Dropbox thì cũng chỉ
là rsync". Một mệnh đề, và nó trả lời trọn cả nhánh.

### Mấy nhánh còn lại, ngắn gọn

- **Cerebras.** Hai người ở hai nhánh khác nhau cùng nói inference nhanh lên thì tốc độ
  harness thành chuyện nhỏ. `alsima` đáp lại bằng phân biệt đáng cân nhắc nhất trong phần
  đối đáp: inference nhanh chỉ rút ngắn khâu **sinh chữ**, còn test, build, search vẫn
  chiếm phần lớn thời gian ở nhiều task thật.
- **YC.** Ba tài khoản chê chuyện rót vốn, hai tài khoản giải thích đó là cách seed vận
  hành. Không ai đổi ý ai.
- **Đăng ký và devtools.** Nhánh mở đầu, bốn tài khoản, không ai bênh. Có người chỉ cách bỏ
  qua màn hình đăng ký và cảnh báo tuỳ chọn chia sẻ chat bật sẵn mặc định; phản xạ đầu tiên
  của `alsima` là chặn phím mở devtools, và đúng câu đó châm ngòi ba lời chế.
- **Trang landing.** Chia đôi thật sự: hai chê (10px, animation), hai khen.
- **"Không thêm giá trị gì".** `esafak` chê ở tầng định vị chứ không phải chi tiết: hai thứ
  Bullet đem khoe thì OpenCode đã có cả. Routing thì OpenCode có sẵn subagent định nghĩa
  trước; search thì đã có MCP theo AST và theo embedding. Đây là góc chê khác hẳn hai góc
  trên, vì nó không cãi con số hay cơ chế, nó cãi chuyện có cần một sản phẩm mới hay không.
- **Hai báo cáo dùng thật.** Cả thread khen khá nhiều nhưng gần hết là một dòng. Chỉ hai
  người kể trải nghiệm đủ chi tiết: `lucasdimarco` đã chuyển sang dùng Bullet là chính và
  khen hai người sáng lập cập nhật đều theo phản hồi; `mattm` thấy có vẻ nhanh hơn **nhưng
  nói rõ chưa bấm giờ so với Claude**. Câu rào đó làm lời khen của `mattm` đáng tin hơn cả
  mấy lời khen chắc nịch còn lại.
- **Lỗ hổng sản phẩm.** Agent tự ghi tên nó làm author trong commit và tắt không được, đủ để
  mất một user. Nút Download đẩy file `.dmg` 200MB về điện thoại Android. Chưa có MCP, chưa
  có ACP.

## Rút lại

Trang bán tốc độ → thread không cãi tốc độ, thread cãi **bằng chứng** cho tốc độ → và chỗ
yếu nhất lộ ra không phải sản phẩm, mà con số dùng để chứng minh sản phẩm.

1. **Con số benchmark chỉ có nghĩa khi bảng chưa bão hoà.** 95.8% trên SWE-bench Verified
   không phân biệt được harness tốt với router chọn bừa. Chính hai người sáng lập cũng nhận
   như vậy, và đang chuyển sang bảng khó hơn.
2. **Đọc kỹ hệ nào được đo.** Benchmark chạy không kèm router, còn router lại là thứ có
   trong bản người dùng chạy. Đo một hệ, bán một hệ khác.
3. **Câu hỏi "khác gì về cơ chế" vẫn treo.** Phần lớn thứ Bullet khoe nghe như thứ đạt được
   bằng prompt hoặc skill ở harness khác, và người đặt câu hỏi đó không được trả lời.
4. **Đối thủ thật của một harness không phải harness khác, mà là inference rẻ và nhanh.**
   Phân biệt của `alsima` giữa thời gian sinh chữ và thời gian chạy tool là lý lẽ đáng giá
   nhất họ đưa ra, và cũng là thứ quyết định harness còn chỗ đứng bao lâu.
