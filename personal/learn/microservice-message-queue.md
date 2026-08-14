---
topic: Microservice + Message Queue
mode: teach
status: in-progress
started: 2026-08-02
last_session: 2026-08-14
next_start: "USER YÊU CẦU RÕ: mở buổi sau bằng ĐÚNG hai câu này, user đã hẹn sẽ trả lời rồi mới học tiếp. (1) 'Aggregator muốn retry, nhưng trong lúc chờ email-service sống lại — có thể hai phút, có thể hai tiếng — nó GIỮ cái việc chưa làm xong đó ở đâu?' (2) 'Nếu chính aggregator chết trong lúc đang ôm mấy việc chưa làm xong đó thì sao?' — Đáp án user đang tự đi tới là: cần một chỗ GIỮ VIỆC BỀN, tách khỏi cả bên gửi lẫn bên nhận. Đó chính là message broker/queue. ĐỪNG nói trước, user đang tự dựng lại nó từ đầu và chỉ còn một bước. Khi user chốt được, đó là cửa vào Buổi 3 — và lúc đó dạy `unacked` cho tử tế (thẻ này trượt 2 lần, chưa từng được dạy đàng hoàng, mới lướt qua sim). SAU Buổi 3 phải quay lại trả nợ Buổi 2: REST vs gRPC, API Gateway, service discovery + LAB — chưa đụng tới dòng nào. TRƯỚC KHI VÀO LAB phải hỏi: sandbox ghi là D:\\Project\\arcitecture\\microservice\\first-learn (Windows) nhưng máy đang dùng là macOS — user học ở máy khác hay cần chọn chỗ mới? Đã hỏi 13/08 VÀ 14/08, vẫn chưa được trả lời."
---
## Bối cảnh
- User làm frontend/fullstack JS hằng ngày, hướng senior/system design. Học kiến trúc chứ không học ngôn ngữ mới → chọn Node.js + Docker cho mọi lab.
- **Vốn thật đã có:** webhook (làm Shopify app, dùng nhiều), rate limit 429 của Shopify (gặp thường xuyên khi xử lý số lượng lớn order/product/customer), Firebase (nên mọi thứ liên quan tới tải đều do cloud lo).
- **Vốn thật CHƯA có:** chưa từng tự vận hành broker nào. Không RabbitMQ, không Kafka, không Redis queue. → Buổi 3-5 phải đi chậm ở phần vận hành, nhưng được phép dùng webhook làm mỏ neo để bắc sang khái niệm async.

## Đã học / nắm được
Đo thật ngày 13/08, không phải tự khai. Chi tiết từng thẻ ở `microservice-message-queue.cards.md`.

- **Buổi 1 — xong, đã kiểm.** Monolith chỉ scale được cả khối (level 2). Database-per-service là chuyện coupling chứ không phải chuyện tải (level 2, phải giảng lại mới qua).
- **Buổi 2 — xong phần "vì sao gọi qua mạng khác hẳn gọi hàm", cả 5/5.** Kết cục thứ ba / partial failure (level 2). Ranh giới mạng ép API phải thô (level 2, user tự suy ra endpoint batch). Availability nhân chứ không cộng (level 2, qua ở lần thứ ba).
- **Buổi 2 (tiếp, 14/08) — đường tới hạn.** Thước chia đồng bộ/bất đồng bộ: cái request LÀ gì vs hệ quả chảy ra từ nó (level 2). Cắt phép nhân bằng cách đẩy hệ quả ra khỏi đường tới hạn (level 2). Cả hai đều mới, đều qua cổng ngay trong buổi.

## Đang kẹt / chưa rõ
### Của user
- **`unacked` trượt 2 lần** (13/08 "chưa nhớ lắm", 14/08 không trả lời). Chưa từng được dạy tử tế — mới lướt qua bản sim 10/08. Không kiểm nguội nữa, để Buổi 3 dạy đàng hoàng.

### Của tôi — cần tra thêm
- **Message requeue nằm ở đầu hay cuối queue?** Doc consumer-ack chỉ nói "automatically requeued", không nói vị trí. Sim cố ý KHÔNG vẽ vị trí. Cần tra thêm trước Buổi 4.
- **Broker mất bao lâu để phát hiện consumer chết?** Doc chỉ nói "it takes a period of time to detect an unavailable client" — không có con số. Sim hiện tức thì, thực tế không phải vậy. Ảnh hưởng trực tiếp tới thiết kế timeout/retry ở Buổi 7.
- **`delivery-limit` của quorum queue đếm thế nào?** Biết nó là 1 trong 4 trigger dead-letter, nhưng cách đếm nằm ở trang quorum-queues chưa tra. Để tới Buổi 5 (Kafka vs RabbitMQ) hoặc khi động vào quorum queue.

### Về cách user suy nghĩ — theo dõi tiếp
Hai lần trong buổi 13/08, user quy vấn đề về **triệu chứng vận hành** (chậm, nghẽn, lỗi gì, sửa sao) thay vì về **tính đúng đắn của dữ liệu / hợp đồng giữa các bên**:
1. Database-per-service → quy về "tải khác nhau, chung bottleneck" thay vì coupling.
2. Partial failure → quy về "không biết tại sao fail" (chuyện debug) thay vì "không biết đã chạy chưa" (chuyện dữ liệu đúng/sai).

3. Availability nhân → lần đầu trả lời bằng latency ("càng nhiều service càng lâu") + lãng phí công khi fail ở chặng cuối (đó là Saga, Buổi 6).
4. Aggregator làm 99.4% tụt xuống 99.3% → giải thích "vì trễ thêm". Con số đúng, lý do sai; lý do thật là thêm một thứ nữa phải còn sống.

Bản năng này đến từ làm app, và nó sẽ dắt lệch nhiều lần nữa trong môn này (Saga, outbox, eventual consistency đều nằm đúng vùng đó). Đã nói thẳng với user ngày 13/08 để tự bắt. Mỗi lần tái phát thì chỉ tên nó ra, đừng giảng lại từ đầu.

**Tiến bộ ngày 14/08:** lần thứ 5 (xếp nhầm "ghi đơn vào DB" vào nhóm trễ được nhiều nhất), user **tự bắt được** trước khi tôi chỉ: *"Anh lại mắc một lỗi cũ, ta cần phải chú trọng sự toàn vẹn của dữ liệu."* Đây là lần đầu tiên khả năng tự giám sát chạy. Tiếp tục chỉ tên, đừng giảng lại.

### Về cách dạy user này — đã kiểm chứng
- **Khái niệm xác suất: giảng bằng phần trăm thì trượt, bắt ĐẾM VẬT THỂ thì qua.** `availability-nhan` trượt 2 lần khi trình bày bằng %, qua ngay khi đổi sang dây đèn nối tiếp và hỏi "cần mấy bóng sống để sáng / mấy bóng cháy để tối". Dùng lại chiêu này cho mọi khái niệm xác suất về sau.
- **Bắt tự tính thì hiệu quả hơn giảng.** Mọi lần user tính lấy con số (50-100ms, 99.4%, 99.3%, 99.8%/86 phút) đều qua cổng gọn. Mọi lần tôi giảng trước rồi hỏi lại đều phải giảng ít nhất hai lượt.
- **Cảnh báo "Ồ anh hiểu rồi".** Câu này xuất hiện đúng trước một câu trả lời sai (14/08). Nghe thấy nó thì kiểm kỹ hơn, đừng đi tiếp.

## Lộ trình
- [x] Buổi 1: Monolith vs Microservices — định nghĩa, trade-offs, distributed tax, khi nào KHÔNG dùng ✅ đã kiểm 13/08, cả 2 thẻ level 2
- [~] Buổi 2: Sync communication — **xong phần "vì sao gọi qua mạng khác hẳn gọi hàm"** (partial failure, latency/API thô, availability nhân) **+ đường tới hạn** (thước chia đồng bộ/bất đồng bộ, cắt phép nhân). **NỢ, chưa đụng dòng nào:** REST vs gRPC, API Gateway, service discovery + Lab dựng order-service + product-service (Node, docker-compose)
- [~] Buổi 3: Async communication — **phần "vì sao cần Message Queue" đã bắt đầu sớm ngày 14/08** và user đang tự dựng lại broker từ đầu, còn đúng một bước (chỗ giữ việc bền). **Còn lại:** RabbitMQ concepts (exchange, queue, binding, routing key), dạy tử tế `unacked` + Lab: bắn event order.created
- [ ] Buổi 4: Messaging reliability — ack, redelivery, dead letter queue, idempotent consumer + Lab
- [ ] Buổi 5: Kafka & event streaming — log-based vs broker-based, partition, consumer group, offset; khi nào chọn Kafka vs RabbitMQ
- [ ] Buổi 6: Data trong microservices — database-per-service, Saga (choreography vs orchestration), Outbox pattern, CQRS, eventual consistency + Lab: outbox
- [ ] Buổi 7: Resilience & Observability — timeout, retry, circuit breaker, distributed tracing, health check, centralized logging
- [ ] Buổi 8: Capstone — tự thiết kế mini e-commerce microservices hoàn chỉnh trên giấy (system design interview style)

## Simulation (SIM)
- https://claude.ai/code/artifact/4aa71e24-47ab-4fb8-806a-a578258d7f2d — 2026-08-10 · phủ Buổi 3+4 (xem trước)
- Chặng dựng được: publish → exchange (topic, khớp binding `order.*`) → ready trong queue → **unacked** (còn trong queue) → 5 nhánh rẽ: ack / consumer chết / nack requeue=true / nack requeue=false / hết TTL → dead letter + `x-death.reason`
- Chặng KHÔNG dựng được: vị trí message sau requeue · độ trễ phát hiện consumer chết · cách đếm `delivery-limit` (cả 3 đã ghi ở "Đang kẹt / chưa rõ", và hiện thẳng trong sim chứ không giấu)
- Nguồn đã tra 10/08: [Consumer Acknowledgements](https://www.rabbitmq.com/docs/confirms) · [Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx) · [AMQP 0-9-1 Concepts](https://www.rabbitmq.com/tutorials/amqp-concepts)

## Ghi chú buổi 2026-08-14
Buổi mạnh nhất từ đầu topic. Bốn thẻ động tới, ba thẻ lên level 2, không thẻ nào trượt lúc đóng buổi.

**Mở buổi bằng một khúc lạc mạch.** User dán lại câu trả lời cũ của chính mình (99.8% / 99.4% / "chưa hiểu cốt lõi") và tưởng ta đang ở đó. Tôi bày lại bảng chấm ba câu rồi chỉ ra chỗ thật sự đang treo. Ghi lại vì có thể lặp: sau một buổi bị ngắt giữa chừng, user quay lại từ chỗ họ nhớ chứ không phải chỗ ta dừng — luôn dựng lại bảng chấm trước khi đi tiếp.

**`availability-nhan` — mất 3 lần mới qua, và bài học nằm ở CÁCH giảng.**
- Lần 2 user rút nhầm thẻ hoàn toàn: trả lời bằng latency và bằng chuyện lãng phí công khi fail ở chặng cuối. Cả hai đều đúng, đều là bài khác (một cái đã học, một cái là Saga ở Buổi 6). Tôi gọi tên "anh vừa rút nhầm thẻ" thay vì giảng lại lý thuyết.
- Lần 3 bỏ SẠCH phần trăm, đổi sang dây đèn mắc nối tiếp sáu bóng, và chỉ bắt **đếm**: cần mấy bóng sống để sáng (6), cần mấy bóng cháy để tối (1). Qua ngay lập tức.
- Chốt bằng câu user tự phát biểu, đáng giữ nguyên văn: *"Vấn đề không nằm ở số lượng. Mà là chúng đang phụ thuộc vào nhau."* Chính câu đó mở được cửa sang phần sau, nên tôi dùng lại lời của user để đặt câu hỏi tiếp.

**Dạy mới: đường tới hạn (critical path).**
- Vào bài bằng cách bắt user chia 6 việc của một đơn hàng thành hai nhóm: phải xong ngay vs chờ được.
- User xếp đúng mail / điểm thưởng / analytics ra ngoài, nhưng xếp **ghi đơn vào DB** vào nhóm trễ được nhiều nhất — sai nặng nhất có thể. Chữa bằng đúng một câu: *"màn hình đã hiện Đặt hàng thành công, việc ghi đơn để sau, ngay giây đó server chết — đơn hàng ở đâu?"* User thấy ngay, và tự nhận ra đây là lỗi cũ tái phát.
- Đưa thước thay cho cảm giác: không phải "cái nào quan trọng hơn", mà là "khi màn hình báo thành công thì ta vừa hứa gì". Ghi đơn CHÍNH LÀ lời hứa; phần còn lại là hệ quả chảy ra từ nó.
- Nói rõ vùng xám (trừ tiền, trừ kho) là **quyết định nghiệp vụ**, không phải luật, và chứng minh bằng `authorize` / `capture` — cùng một việc trừ tiền, một nửa trên đường tới hạn một nửa ngoài. User trước đó phát biểu "cả hai đều là bản thân request" như một sự thật; đã siết lại thành một lựa chọn.

**Câu trả lời hay nhất của user từ đầu topic:** khi được hỏi cái giá của việc đẩy trừ kho ra sau, user dựng lại đúng ca oversell từ đầu, không cần mớm — kho còn 1 món, chưa trừ, khách thứ hai đặt, cả hai thấy "thành công", tiền đã trừ, hàng không có để giao. Tự nối được với bài timeout/retry hôm trước. Đây là transfer thật sang ca chưa từng gặp.

**Phần thưởng cuối:** user tự tính 99.4% → 99.8%, 259 phút → 86 phút chết mỗi tháng, chỉ bằng cách đẩy 4 việc ra khỏi đường tới hạn. Không thêm dòng logic nào, không thêm server nào.

**Bẫy aggregator — user đi vào rồi tự ra.** Lần 1 user đề xuất aggregator gọi 5 service **lúc khách đang chờ**; tự tính ra 99.3% và tự thấy tệ hơn lúc chưa có nó. Lần 2 user đề xuất lại aggregator nhưng đặt **sau khi đã trả lời khách** — lần này đúng, và tôi nói rõ đây là bước tiến chứ không phải lặp lỗi cũ.

**Dừng đúng chỗ đẹp.** Buổi kết thúc khi user vừa nhận ra mail sẽ mất nếu `email-service` chết, đề xuất retry, và thành thật nói *"làm sao để biết thì anh chưa hình dung ra"*. Hai câu tôi đặt ra và user hẹn trả lời buổi sau nằm ở `next_start`. User đang cách message queue đúng một bước và đang tự dựng lại nó — tuyệt đối không nói trước.

**User tự tóm tắt:** chưa — buổi dừng theo yêu cầu, user hẹn tiếp tục sau. Xin lại 3 dòng ở đầu buổi kế nếu user còn muốn.

## Ghi chú buổi 2026-08-13
Buổi đầu tiên có REVIEW thật. Dựng luôn `.cards.md` và `.glossary.md` cho topic (trước đó chỉ có file này).

**Chữa nốt 3 câu treo từ 02/08 + 1 câu từ sim:**
- Scale không đều → đúng ngay, không cần chữa.
- Database-per-service → sai chỗ cốt lõi, quy về tải. Chữa bằng khung "schema thành public API ngầm không ai ký" + ca tách cột `price` cho giá B2B. User tự nói ra "phải sửa cả code order rồi mới deploy được" — tự tìm ra coupling, qua cổng.
- Calibrate level → webhook có, Firebase có, broker chưa từng. Ghi vào Bối cảnh.
- Unacked (từ sim) → trượt sạch.

**Phát hiện về phương pháp:** xem sim mà không bị bắt dự đoán trước mỗi chặng thì KHÔNG dính lại gì. Sim 10/08 công phu nhưng user chỉ ngồi xem, và 3 ngày sau không nhớ nổi khái niệm trung tâm của nó. Lần tới dùng sim thì phải hỏi dự đoán TRƯỚC khi mở mỗi chặng, không thì đừng dùng.

**Dạy Buổi 2, phần "vì sao gọi qua mạng khác hẳn gọi hàm":**
- Vào bài bằng cái hố do chính đáp án của user mở ra: tách DB rồi thì order-service lấy giá ở đâu?
- Bắt đoán trước khi giảng: user nêu được rate limit (429) và auth. Thiếu 3: partial failure, latency, availability.
- **Partial failure** — dạy qua tương phản với 429 ("lỗi rõ ràng vẫn là tin tốt"). Ca inventory-service trừ kho rồi timeout. Chốt bằng câu chọn (A) biết nguyên nhân vs (B) biết đã chạy chưa — user chọn B và giải thích đúng vì sao A vô dụng. Qua cổng.
- **Latency** — không giảng, bắt tự tính. 50 dòng × 1-2ms = 50-100ms vs ~50µs. User tính đúng cả ba câu và tự mô tả ra endpoint batch. Qua cổng gọn nhất buổi.
- **Availability nhân** — bắt tự tính, user ra đúng 99.8% và 99.4%, nhưng không rút được ý nghĩa, còn hỏi ngược "câu này chưa liên quan lắm nhỉ". Giảng lại theo đường đổi ra phút (43 phút → 259 phút/tháng) + khung "cả 6 service đều khoẻ, không ai viết sai dòng nào, mà hệ thống yếu đi 6 lần — kiến trúc làm hỏng chứ không phải service nào". **Chưa kiểm lại, buổi dừng ngay tại đây.**

**Câu đang treo (hỏi lại đầu buổi sau):**
1. Vì sao cả 6 service đều khoẻ mà hệ thống lại yếu đi?
2. Vẫn cần đủ 6 service, không bỏ bớt được — còn đường nào thoát khỏi phép nhân? (Đáp án là async/MQ. ĐỪNG nói ra, để user đoán — nó là cầu nối tự nhiên nhất mở sang Buổi 3, và Buổi 3 mở bằng chính câu trả lời của user thì tốt hơn nhiều so với tôi tuyên bố.)

**Chưa làm:** phần cơ chế của Buổi 2 (REST vs gRPC, API Gateway, service discovery) và toàn bộ LAB. Buổi 2 vẫn chưa đóng.

**Câu hỏi hành chính chưa được trả lời:** path sandbox trong note là `D:\Project\arcitecture\microservice\first-learn` (Windows) nhưng session đang chạy trên macOS. Phải làm rõ trước khi vào lab.

**User tự tóm tắt:** chưa — buổi dừng đột ngột theo yêu cầu, chưa kịp xin 3 dòng tổng kết.

## Ghi chú buổi 2026-08-10
- Buổi SIM đầu tiên (mode `sim` mới thêm vào /learn hôm nay). Chủ đề qua Gate 1 vì message-qua-queue đúng dạng "vật thể đi qua các chặng, đổi trạng thái nhìn thấy được".
- Gate 2 chạy đủ: tra 3 trang doc chính thức TRƯỚC khi viết dòng code nào. Không dùng bước "model tự kiểm knowledge base" của bài gốc.
- Trọng tâm sim là trạng thái **unacked** — message đã giao cho consumer nhưng CHƯA rời queue. Đây là chỗ prose giấu được câu hỏi "consumer chết thì message ở đâu".
- CHƯA kiểm tra hiểu bài: user mới xem sim, chưa được hỏi dự đoán. 3 câu kiểm tra Buổi 1 vẫn còn treo từ 02/08.

## Ghi chú buổi 2026-08-02
- Bắt đầu topic. User muốn học microservice + message queue, có project sandbox mới: D:\Project\arcitecture\microservice\first-learn (đang trống).
- Thống nhất hướng: lý thuyết + build dần mini e-commerce bằng Node.js + Docker (chọn Node vì user làm JS hằng ngày, tập trung học kiến trúc thay vì ngôn ngữ mới).
- Đã dạy Buổi 1: monolith vs microservices, cái giá của distributed system (network, data consistency, operational complexity), monolith-first, vị trí của MQ trong bức tranh.
- Giao 3 câu kiểm tra: (1) scale không đều giữa module, (2) vì sao database-per-service quan trọng, (3) đã từng đụng RabbitMQ/Kafka/Redis queue/webhook chưa (để calibrate level). Chưa có câu trả lời.
