---
topic: Microservice + Message Queue
mode: teach
status: in-progress
started: 2026-08-02
last_session: 2026-08-13
next_start: "Buổi 2 đang dở, dừng GIỮA một câu hỏi. Mở buổi bằng REVIEW 2 thẻ trượt: `availability-nhan` (hỏi trước tiên — đúng câu đang treo: vì sao cả 6 service đều đạt 99.9% mà hệ thống lại yếu đi?) và `unacked`. Rồi hỏi câu số 2 đang treo: 'anh vẫn cần đủ 6 service, còn đường nào thoát khỏi phép nhân?' — đáp án là async/message queue, và đó chính là cầu nối mở thẳng sang Buổi 3, ĐỪNG tự nói ra, để user đoán. Sau đó mới dạy nốt phần cơ chế của Buổi 2 chưa đụng tới: REST vs gRPC, API Gateway, service discovery + LAB dựng 2 service Node + docker-compose. TRƯỚC KHI VÀO LAB phải hỏi: project sandbox ghi là D:\\Project\\arcitecture\\microservice\\first-learn (đường dẫn Windows) nhưng máy đang dùng là macOS — user học ở máy khác hay cần chọn chỗ mới? Câu này đã hỏi ngày 13/08, chưa được trả lời."
---
## Bối cảnh
- User làm frontend/fullstack JS hằng ngày, hướng senior/system design. Học kiến trúc chứ không học ngôn ngữ mới → chọn Node.js + Docker cho mọi lab.
- **Vốn thật đã có:** webhook (làm Shopify app, dùng nhiều), rate limit 429 của Shopify (gặp thường xuyên khi xử lý số lượng lớn order/product/customer), Firebase (nên mọi thứ liên quan tới tải đều do cloud lo).
- **Vốn thật CHƯA có:** chưa từng tự vận hành broker nào. Không RabbitMQ, không Kafka, không Redis queue. → Buổi 3-5 phải đi chậm ở phần vận hành, nhưng được phép dùng webhook làm mỏ neo để bắc sang khái niệm async.

## Đã học / nắm được
Đo thật ngày 13/08, không phải tự khai. Chi tiết từng thẻ ở `microservice-message-queue.cards.md`.

- **Buổi 1 — xong, đã kiểm.** Monolith chỉ scale được cả khối (level 2). Database-per-service là chuyện coupling chứ không phải chuyện tải (level 2, phải giảng lại mới qua).
- **Buổi 2 — được 3/5 kiểu hỏng của sync call.** Kết cục thứ ba / partial failure (level 2). Ranh giới mạng ép API phải thô (level 2, user tự suy ra endpoint batch). Availability nhân chứ không cộng (level 1, TRƯỢT).

## Đang kẹt / chưa rõ
### Của user
- **`availability-nhan` chưa qua cổng.** Tính đúng cả hai con số nhưng không rút được ý nghĩa. Đã giảng lại theo đường đổi phần trăm ra phút, chưa kiểm lại. Thẻ này là bản lề mở sang Buổi 3 — không qua thì Buổi 3 mất lý do tồn tại.
- **`unacked` trượt sạch** ("chưa nhớ lắm"), dù đã xem sim hôm 10/08.

### Của tôi — cần tra thêm
- **Message requeue nằm ở đầu hay cuối queue?** Doc consumer-ack chỉ nói "automatically requeued", không nói vị trí. Sim cố ý KHÔNG vẽ vị trí. Cần tra thêm trước Buổi 4.
- **Broker mất bao lâu để phát hiện consumer chết?** Doc chỉ nói "it takes a period of time to detect an unavailable client" — không có con số. Sim hiện tức thì, thực tế không phải vậy. Ảnh hưởng trực tiếp tới thiết kế timeout/retry ở Buổi 7.
- **`delivery-limit` của quorum queue đếm thế nào?** Biết nó là 1 trong 4 trigger dead-letter, nhưng cách đếm nằm ở trang quorum-queues chưa tra. Để tới Buổi 5 (Kafka vs RabbitMQ) hoặc khi động vào quorum queue.

### Về cách user suy nghĩ — theo dõi tiếp
Hai lần trong buổi 13/08, user quy vấn đề về **triệu chứng vận hành** (chậm, nghẽn, lỗi gì, sửa sao) thay vì về **tính đúng đắn của dữ liệu / hợp đồng giữa các bên**:
1. Database-per-service → quy về "tải khác nhau, chung bottleneck" thay vì coupling.
2. Partial failure → quy về "không biết tại sao fail" (chuyện debug) thay vì "không biết đã chạy chưa" (chuyện dữ liệu đúng/sai).

Bản năng này đến từ làm app, và nó sẽ dắt lệch nhiều lần nữa trong môn này (Saga, outbox, eventual consistency đều nằm đúng vùng đó). Đã nói thẳng với user ngày 13/08 để tự bắt. Mỗi lần tái phát thì chỉ tên nó ra, đừng giảng lại từ đầu.

## Lộ trình
- [x] Buổi 1: Monolith vs Microservices — định nghĩa, trade-offs, distributed tax, khi nào KHÔNG dùng ✅ đã kiểm 13/08, cả 2 thẻ level 2
- [~] Buổi 2: Sync communication — **đã xong phần "vì sao gọi qua mạng khác hẳn gọi hàm"** (3 kiểu hỏng: partial failure, latency/API thô, availability nhân). **Còn lại:** REST vs gRPC, API Gateway, service discovery + Lab dựng order-service + product-service (Node, docker-compose)
- [ ] Buổi 3: Async communication — vì sao cần Message Queue, RabbitMQ concepts (exchange, queue, binding, routing key) + Lab: bắn event order.created
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
