---
topic: Microservice + Message Queue
mode: teach
status: in-progress
started: 2026-08-02
last_session: 2026-08-10
next_start: "VẪN đang ở Buổi 2 — buổi 10/08 là SIM xem trước Buổi 3+4, KHÔNG phải đã học xong hai buổi đó. Chữa 3 câu hỏi kiểm tra Buổi 1 (scale không đều / vì sao DB riêng / kinh nghiệm queue) rồi vào Buổi 2: sync communication (REST/gRPC, API Gateway, service discovery) + lab dựng 2 service Node + docker-compose trong D:\\Project\\arcitecture\\microservice\\first-learn. Khi tới Buổi 3+4 thì mở lại sim ở link mục Simulation và bắt user dự đoán trước mỗi chặng."
---
## Đã học / nắm được
- (Buổi 1 mới dạy xong lý thuyết, chưa xác nhận qua câu hỏi kiểm tra)

## Đang kẹt / chưa rõ
- **Message requeue nằm ở đầu hay cuối queue?** Doc consumer-ack chỉ nói "automatically requeued", không nói vị trí. Sim cố ý KHÔNG vẽ vị trí. Cần tra thêm trước Buổi 4.
- **Broker mất bao lâu để phát hiện consumer chết?** Doc chỉ nói "it takes a period of time to detect an unavailable client" — không có con số. Sim hiện tức thì, thực tế không phải vậy. Ảnh hưởng trực tiếp tới thiết kế timeout/retry ở Buổi 7.
- **`delivery-limit` của quorum queue đếm thế nào?** Biết nó là 1 trong 4 trigger dead-letter, nhưng cách đếm nằm ở trang quorum-queues chưa tra. Để tới Buổi 5 (Kafka vs RabbitMQ) hoặc khi động vào quorum queue.

## Lộ trình
- [~] Buổi 1: Monolith vs Microservices — định nghĩa, trade-offs, distributed tax, khi nào KHÔNG dùng (đang dở: chờ trả lời 3 câu kiểm tra)
- [ ] Buổi 2: Sync communication — REST/gRPC giữa services, API Gateway, service discovery + Lab: dựng order-service + product-service (Node, docker-compose)
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
