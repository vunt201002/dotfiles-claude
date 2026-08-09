# Azure SRE Agent — Context Engineering (tóm tắt có trích dẫn)

> Nguồn: [Context Engineering for Reliable AI Agents: Lessons from Building Azure SRE Agent](https://techcommunity.microsoft.com/blog/appsonazureblog/context-engineering-lessons-from-building-azure-sre-agent/4481200)
> — Microsoft techcommunity, đồng tác giả visagarwal. Đọc và tóm 09/08/2026.
>
> **Đây là tóm tắt có trích dẫn, KHÔNG phải bản dịch đầy đủ.** Muốn dịch trọn bài đúng chuẩn → `/read-vi`.
>
> **Cảnh báo số liệu:** hai con số hay bị trích chung — *35.000 incident tự động xử lý* và
> *time-to-mitigation của App Service từ 40,5 giờ xuống 3 phút* — **KHÔNG nằm trong bài này**.
> Chúng đến từ thông báo GA riêng. Bài này là bài kỹ thuật, bộ số hoàn toàn khác.

Câu mở đầu tóm gọn cả bài:

> "Chúng tôi bắt đầu với 100+ tool và 50+ agent chuyên biệt. Kết thúc với 5 tool lõi và một
> nhúm generalist. Agent trở nên **đáng tin hơn**, không phải kém đi."

Và câu định khung:

> "Chúng tôi mất rất lâu chạy theo nâng cấp model, mài prompt, tranh luận chiến lược điều
> phối. Lợi ích thấy rõ trên eval offline, nhưng **không chuyển hoá thành độ tin cậy trong
> production**."

---

## Vấn đề 1 — Bùng nổ tool

Bắt đầu ở chỗ ai cũng bắt đầu: tool hẹp + prompt kể lể. Không tin model trong prod nên siết
lại. Mỗi hành động một tool, mỗi tool một bộ guardrail.

Azure có hàng trăm dịch vụ. **Trong 2 tuần: 100+ tool và một prompt đọc như cẩm nang chính sách.**

> "User gặp edge case? Thêm tool. Tool bị dùng sai? Thêm guardrail. Guardrail quá chặt? Thêm
> ngoại lệ. **Backlog phình nhanh hơn tốc độ đóng.**"

Agent không tổng quát hoá được — giỏi đúng kịch bản đã mã hoá, giòn ở mọi chỗ khác.

> "Chúng tôi không xây được một agent — chúng tôi xây một **workflow có gắn LLM lên trên**."

**Insight #1: Không tin model biết suy luận thì sẽ xây workflow giòn, chứ không phải agent.**

### Cách xử lý: tool RỘNG thay vì NHIỀU tool

Đổi câu hỏi: thay vì 100 tool hẹp, cho model **hai tool rộng** — `az` và `kubectl` như tool
hạng nhất. Không phải "tool" theo nghĩa thường mà là cả hệ sinh thái dòng lệnh; dưới mắt model
chỉ là hai mục.

| | |
|---|---|
| **Nén context** | Ba tool thay vì hàng trăm |
| **Mở rộng năng lực** | Chạm toàn bộ bề mặt `az`/`kubectl`, không chỉ phần đã bọc |
| **Suy luận tốt hơn** | LLM **đã biết** các CLI này từ dữ liệu huấn luyện. Bọc sau abstraction riêng là **đánh nhau với prior của model** |

CLI còn tự mô tả (`--help`, subcommand nhất quán) và trả lỗi giàu tín hiệu → vòng lặp chặt
*chạy → đọc → sửa*.

**Insight #2: Đừng đánh nhau với kiến thức sẵn có của model — dựa vào nó.**

---

## Vấn đề 2 — Multi-agent sụp khi scale

Thấy tool tổng quát hiệu quả, họ làm hệ multi-agent đầy đủ với handoff, mô phỏng cách đội
người tổ chức: mỗi sub-agent một persona, sở hữu một dịch vụ Azure, bàn giao khi điều tra
vượt ranh giới. Lý thuyết đẹp — orchestrator chỉ biết sub-agent, mỗi agent chỉ nạp tool của
mình, context gọn.

**Chạy tốt ở quy mô nhỏ. Lên 50+ sub-agent thì vỡ.**

Phân bố **lưỡng cực**: handoff trúng thì mọi thứ trúng, trượt thì agent lạc hẳn.

> "Bài toán cần **hơn bốn lần handoff gần như luôn thất bại.**"

Bốn kiểu hỏng:

1. **Không khám phá được** — mỗi sub-agent chỉ biết những sub-agent gọi trực tiếp được. User
   hỏi câu hợp lý, nhận "tôi không biết giúp thế nào" — không phải thiếu năng lực, mà năng
   lực đó nằm cách ba chặng.
2. **System prompt mong manh** — một sub-agent chỉnh kém bơm chỉ thị mâu thuẫn vào **cả chuỗi
   suy luận**. Context orchestrator nhiễm output lẫn lộn. Một agent tồi kéo sập cả phiên — mà
   họ có hơn 50 cái.
3. **Vòng lặp vô hạn** — agent đá việc qua lại: *"anh làm đi / không, anh làm đi"*. Nhìn từ
   user thì đứng yên; bên dưới đốt token và latency. Hop limit + loop detection có giúp nhưng
   phá luôn kiến trúc sạch ban đầu.
4. **Tầm nhìn đường hầm** — chuyên gia người có vùng chồng lấn (kỹ sư K8s biết đủ network để
   nghi ngờ lỗi route). Chính chỗ chồng lấn làm handoff của người thông minh. Agent ranh giới
   cứng → hoặc đầu hàng sớm, hoặc bám triệu chứng trong địa hạt mình trong khi root cause nằm
   chỗ khác.

**Insight #3: Multi-agent khó scale — điều phối mới là việc thật.**

Họ tự chẩn đoán rất sắc:

> "Với tool hẹp, chúng tôi ràng buộc **model được LÀM gì** — trả giá bằng lỗ hổng phạm vi. Với
> agent chia theo địa hạt, chúng tôi ràng buộc **nó được KHÁM PHÁ gì** — trả giá bằng chi phí
> điều phối. **Cùng một kiểu sửa quá tay, chỉ khác tầng.**"

### Cách xử lý: gộp chuyên gia thành generalist

Gộp hàng chục chuyên gia thành một nhúm generalist — **chỉ làm được vì trước đó đã có tool
tổng quát**. Đồng thời chuyển tri thức địa hạt từ system prompt **vào file để agent đọc khi
cần** (về sau thành cơ chế agent skills, lấy cảm hứng từ Anthropic).

**Insight #4: Đầu tư ngân sách context vào NĂNG LỰC, không phải vào RÀNG BUỘC.**

### Ví dụ thật: agent tự debug hạ tầng của chính nó

Deployment Azure OpenAI của chính họ hỏng. **Không có workflow định sẵn nào**, agent tự: đọc
log deployment → phát hiện lỗi quota → truy vấn giới hạn subscription → tìm đúng hạng mục
support request → mở ticket. Sáng hôm sau có email duyệt tăng quota.

Kiến trúc cũ **không thể** làm được: không có sub-agent Cognitive Services, không có tool tạo
support request. Họ chưa từng lường trước kịch bản này — và với generalist + tool rộng thì
không cần lường trước.

---

## Vấn đề 3 — Đổ metrics thô vào context

Cách ngây thơ: đổ toàn bộ metrics vào context rồi bảo model tìm bất thường.

> "Chúng tôi lấy dữ liệu **tất định, có cấu trúc** và đẩy nó qua một hệ **xác suất**. Chúng tôi
> bắt LLM làm việc mà **một dòng Pandas** làm được."

Trả giá bằng token, latency, độ chính xác (model không thích metric giá trị 0). Nguy hiểm nhất
là **nó hơi chạy được** — với cửa sổ ngắn, truy vấn đơn giản. Đủ thành công để **che mất việc
cách tiếp cận sai từ gốc**. Kinh điển *"chạy ngon lúc demo, chết ở prod"*.

**Cách xử lý:** cho model **viết code**. Không gửi 50K token metrics vào context — gửi metrics
cho code interpreter, model viết phân tích pandas/numpy, chạy nó, **chỉ trả về kết quả**.

Phân tích metrics vốn là **nguồn lỗi tool lớn nhất**. Sau thay đổi: **không còn lỗi nào**, và
vì hết thuế token nên **nới khoảng thời gian phân tích lên gấp một bậc độ lớn**.

**Insight #5: LLM là nhạc trưởng, không phải máy tính.** Dùng nó để quyết định *chạy phép tính
nào*, rồi để code thật thực hiện.

---

## Vấn đề 4 — Tool trả về payload khổng lồ

Ví dụ thật: bảng log Control Plane của App Service có **~3.000 cột** do bug telemetry. Một
truy vấn kiểu `SELECT *` — **một dòng log đơn lẻ nở thành hơn 200.000 token**. Context bay
sạch, model nghẹn, user nhận lỗi.

**Cách xử lý: chặn ở tầng session.** Tool có thể trả payload lớn thì **không bao giờ đi thẳng
vào context** — nó ghi thành "file" trong sandbox, nơi dữ liệu được soi (*"có những cột nào?"*),
lọc, phân tích bằng code, và tóm tắt **trước khi** bất cứ thứ gì vào context.

Model không bao giờ thấy 200K token thô; nó thấy một tham chiếu session và bộ tool để tương
tác. Một vụ nổ context vô hạn thành **một cuộc thăm dò có biên**.

**Insight #7: Coi output tool lớn là NGUỒN DỮ LIỆU, không phải context.**

---

## Hai kỹ thuật kèm theo

- **Todo planner** — biểu diễn kế hoạch thành checklist tường minh **nằm NGOÀI context**, để
  model cập nhật nó thay vì suy lại workflow mỗi lượt.
- **Compaction** — liên tục co lịch sử thành tóm tắt + trạng thái có cấu trúc, giữ context là
  *working set nhỏ* thay vì cuốn nhật ký phình mãi.

**Insight #6: Đưa kế hoạch ra ngoài và nén lịch sử sẽ "kéo giãn" cửa sổ context dùng được.**

---

## Sắp tới — Tool call chaining

```
Hiện tại:  Model → Tool A → Model → Tool B → Model → Tool C → Model → Response
Sắp tới:   Model → [Script: Tool A → Tool B → Tool C → Output] → Model → Response
```

Model viết script nhỏ nối các tool, platform chạy và trả kết quả gộp. **Ba vòng thành một.
Chi phí context giảm 60-70%.**

Điều tinh tế hơn nó mở ra: **workflow tất định bên trong hệ xác suất**. Model quyết định *cái
gì phải xảy ra*; script bảo đảm *xảy ra thế nào*.

---

## Bài học tổng

> "Sáu tháng trước, chúng tôi tưởng mình đang xây một SRE agent. Thực ra chúng tôi đang xây
> **một hệ context engineering tình cờ làm SRE**."

Ẩn dụ Karpathy: context window là **RAM** của agent, context engineering là **quản lý bộ nhớ**
— nạp gì, nén gì, đẩy ra ngoài cái gì, tính bên ngoài cái gì.

> "Khi anh lấp đầy nó, chất lượng model thường tụt **phi tuyến** — 'lost in the middle', 'không
> tuân thủ chỉ thị', suy giảm long-context — và **xuất hiện từ rất lâu trước khi chạm giới hạn
> quảng cáo**. Thêm token không chỉ tốn latency; nó **âm thầm bào mòn độ chính xác**."

---

## Liên hệ với harness của mình

Xem thêm [[harness-benchmark-2026-08-09.md]].

**Đang ở đúng giai đoạn của họ.** 29 skill cá nhân + ~40 skill gstack, description nạp mọi
session. Đường đi của Microsoft là *gộp lại*, và họ nói rõ chỉ gộp được **sau khi** đã có tool
tổng quát. Lập luận độc lập cho việc chạy `/checkup`.

**Vách 4-handoff là con số nên nhớ.** Cặp builder + judge chỉ 2 chặng — an toàn. Nhưng nó nói
rằng đừng mở rộng thành chuỗi nhiều vai; giá trị nằm ở *tính độc lập của judge*, không phải ở
số lượng agent.

**Insight #4 hơi nghịch với thiết kế hiện tại.** Họ đi từ "ràng buộc" sang "năng lực" và **đáng
tin hơn**. Harness mình đang nặng về ràng buộc — guard, cổng, iron law re-inject mỗi session.
Không phải bỏ; các cổng bằng chứng giải quyết vấn đề khác (chất lượng phán đoán — đúng chỗ
*"Cheap Code, Costly Judgment"* gọi là nút thắt thật). Nhưng đáng hỏi: chỗ nào là ràng buộc
*cần*, chỗ nào chỉ là "chưa tin model" đã đóng băng thành cấu trúc?

**Todo planner ngoài context** — đã có sẵn, chính là `/todo` và `/my-worklog`. Trùng với thứ
Microsoft rút ra sau sáu tháng.

---

## Chưa đọc

Bài thứ hai cùng series, đúng chủ đề harness, chưa bóc:
[Harness Engineering for Azure SRE Agent: Building the Agent Self-Improvement Loop](https://techcommunity.microsoft.com/blog/appsonazureblog/the-agent-that-investigates-itself/4500073)
— agent tự điều tra lỗi của chính nó.

*Ghi chú kỹ thuật: trang techcommunity render bằng JavaScript nên WebFetch chỉ lấy được tiêu
đề. Phải `curl` lấy HTML thô rồi bóc trường `"body"` trong JSON nhúng mới ra toàn văn.*
