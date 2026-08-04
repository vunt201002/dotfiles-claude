---
topic: Microservice + Message Queue
mode: teach
status: in-progress
started: 2026-08-02
last_session: 2026-08-02
next_start: "Chữa 3 câu hỏi kiểm tra Buổi 1 (scale không đều / vì sao DB riêng / kinh nghiệm queue) rồi vào Buổi 2: sync communication (REST/gRPC, API Gateway, service discovery) + lab dựng 2 service Node + docker-compose trong D:\\Project\\arcitecture\\microservice\\first-learn"
---
## Đã học / nắm được
- (Buổi 1 mới dạy xong lý thuyết, chưa xác nhận qua câu hỏi kiểm tra)

## Đang kẹt / chưa rõ
- (chưa có)

## Lộ trình
- [~] Buổi 1: Monolith vs Microservices — định nghĩa, trade-offs, distributed tax, khi nào KHÔNG dùng (đang dở: chờ trả lời 3 câu kiểm tra)
- [ ] Buổi 2: Sync communication — REST/gRPC giữa services, API Gateway, service discovery + Lab: dựng order-service + product-service (Node, docker-compose)
- [ ] Buổi 3: Async communication — vì sao cần Message Queue, RabbitMQ concepts (exchange, queue, binding, routing key) + Lab: bắn event order.created
- [ ] Buổi 4: Messaging reliability — ack, redelivery, dead letter queue, idempotent consumer + Lab
- [ ] Buổi 5: Kafka & event streaming — log-based vs broker-based, partition, consumer group, offset; khi nào chọn Kafka vs RabbitMQ
- [ ] Buổi 6: Data trong microservices — database-per-service, Saga (choreography vs orchestration), Outbox pattern, CQRS, eventual consistency + Lab: outbox
- [ ] Buổi 7: Resilience & Observability — timeout, retry, circuit breaker, distributed tracing, health check, centralized logging
- [ ] Buổi 8: Capstone — tự thiết kế mini e-commerce microservices hoàn chỉnh trên giấy (system design interview style)

## Ghi chú buổi 2026-08-02
- Bắt đầu topic. User muốn học microservice + message queue, có project sandbox mới: D:\Project\arcitecture\microservice\first-learn (đang trống).
- Thống nhất hướng: lý thuyết + build dần mini e-commerce bằng Node.js + Docker (chọn Node vì user làm JS hằng ngày, tập trung học kiến trúc thay vì ngôn ngữ mới).
- Đã dạy Buổi 1: monolith vs microservices, cái giá của distributed system (network, data consistency, operational complexity), monolith-first, vị trí của MQ trong bức tranh.
- Giao 3 câu kiểm tra: (1) scale không đều giữa module, (2) vì sao database-per-service quan trọng, (3) đã từng đụng RabbitMQ/Kafka/Redis queue/webhook chưa (để calibrate level). Chưa có câu trả lời.
