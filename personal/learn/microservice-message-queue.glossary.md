---
topic: Microservice + Message Queue
created: 2026-08-13
---

# Từ điển Microservice + MQ — tra ngược

Bốn dòng cố định mỗi mục: **Là gì · Ví von · Trong hệ của anh · Nguồn**.

Dòng "Trong hệ của anh" là dòng quan trọng nhất. Thuật ngữ neo vào Shopify, Firebase,
hay project sandbox của chính anh thì nhớ được; định nghĩa trừu tượng thì không.

Link đã xác minh ngày 13/08. Mục nào ghi **(chưa dạy kỹ)** là thuật ngữ mới lướt qua
trong bản sim, chưa qua cổng hiểu bài — đừng coi là đã nắm.

---

## Kiến trúc

### Monolith
**Là gì:** cả ứng dụng là một khối code, build một lần, deploy một lần, chạy trong một process.
**Ví von:** một căn nhà một tầng không vách ngăn — muốn nới rộng chỗ bếp thì phải nới cả căn.
**Trong hệ của anh:** phần lớn app anh làm hằng ngày đều là dạng này, kể cả backend của Joy trước khi tách.
**Nguồn:** https://martinfowler.com/articles/microservices.html

### Microservices
**Là gì:** cắt ứng dụng thành nhiều service nhỏ chạy riêng process, deploy riêng, giao tiếp qua mạng.
**Ví von:** thay một căn nhà bằng một dãy ki-ốt — mỗi ki-ốt sửa riêng được, nhưng muốn nói chuyện với nhau thì phải bước ra đường.
**Trong hệ của anh:** project sandbox `first-learn` sẽ dựng theo hướng này — order-service, product-service, inventory-service tách rời.
**Nguồn:** https://microservices.io/patterns/microservices.html

### Monolith-first
**Là gì:** lời khuyên bắt đầu bằng monolith, chỉ cắt ra microservices khi nó đã lớn tới mức đau.
**Ví von:** đừng xây sẵn mười ki-ốt khi chưa biết mình bán gì.
**Trong hệ của anh:** lý do Buổi 1 bảo microservices không phải mặc định đúng — hầu hết ca thành công đều đi từ monolith bị vỡ ra, không phải dựng mới từ đầu.
**Nguồn:** https://martinfowler.com/bliki/MonolithFirst.html

### Coupling
**Là gì:** mức độ hai thứ phải đổi cùng nhau. Coupling cao nghĩa là động vào cái này thì buộc phải động cái kia.
**Ví von:** hai người bị còng chung tay — ai muốn đi đâu cũng phải rủ người kia.
**Trong hệ của anh:** ca `price` hôm 13/08 — product-service tách cột giá ra bảng riêng thì order-service gãy, hai service từ đó phải deploy thành cặp.
**Nguồn:** https://martinfowler.com/articles/microservice-trade-offs.html

---

## Dữ liệu

### Database-per-service
**Là gì:** mỗi service sở hữu riêng database của nó; service khác không được đọc/ghi thẳng, chỉ được hỏi qua API.
**Ví von:** mỗi ki-ốt có kho riêng khoá riêng; muốn lấy hàng của người ta thì gõ cửa hỏi, không tự thò tay vào.
**Trong hệ của anh:** đáp án anh tự tìm ra hôm 13/08 — product giữ `products` + `prices`, order giữ `orders`.
**Nguồn:** https://microservices.io/patterns/data/database-per-service.html

### Shared database
**Là gì:** nhiều service cùng đọc/ghi chung một database. Được xếp là anti-pattern trong microservices.
**Ví von:** cả dãy ki-ốt dùng chung một cái kho không khoá.
**Trong hệ của anh:** đúng cái bẫy hôm 13/08 — order-service query thẳng bảng `products` của product-service.
**Nguồn:** https://microservices.io/patterns/data/shared-database.html

### Schema
**Là gì:** cấu trúc của dữ liệu trong database — có bảng nào, cột nào, kiểu gì, ràng buộc gì.
**Ví von:** bản vẽ mặt bằng của cái kho.
**Trong hệ của anh:** khi order-service query thẳng `products`, cái schema đó lặng lẽ biến thành một public API mà không ai ký hợp đồng.
**Nguồn:** https://microservices.io/articles/glossary.html

---

## Gọi đồng bộ giữa các service

### Sync communication (giao tiếp đồng bộ)
**Là gì:** service A gọi service B rồi ĐỨNG CHỜ câu trả lời mới đi tiếp được.
**Ví von:** gọi điện thoại — phải có người nhấc máy thì cuộc nói chuyện mới diễn ra.
**Trong hệ của anh:** order-service gọi `GET /products/:id/price` rồi ngồi chờ, chưa có giá thì chưa tạo được đơn.
**Nguồn:** https://microservices.io/patterns/communication-style/rpi.html

### Round trip
**Là gì:** một vòng đi-về trọn vẹn của request: gửi đi, bên kia xử lý, response về tới nơi.
**Ví von:** một lượt gõ cửa, chờ người ta lục kho, rồi nhận hàng.
**Trong hệ của anh:** ~1-2ms mỗi vòng trong cùng datacenter. Đơn 50 dòng gọi từng cái là 50 vòng, thành 50-100ms; cùng vòng lặp đó trong monolith mất ~50 microsecond.
**Nguồn:** https://martinfowler.com/articles/distributed-objects-microservices.html

### Coarse-grained API (API thô)
**Là gì:** endpoint trả về nhiều thứ trong một lần gọi, gộp sẵn thứ người gọi cần — ngược với fine-grained (API vụn, mỗi lần một thứ).
**Ví von:** đi chợ một chuyến mua đủ 50 món, thay vì chạy đi chạy về 50 chuyến mỗi chuyến một món.
**Trong hệ của anh:** endpoint lấy giá của cả 50 product trong một call, đúng cái anh tự mô tả ra hôm 13/08.
**Nguồn:** https://martinfowler.com/articles/distributed-objects-microservices.html

### Partial failure — "kết cục thứ ba"
**Là gì:** trạng thái sau một lời gọi qua mạng khi không có hồi âm nào, và không thể biết bên kia đã chạy xong hay chưa chạy. ("Kết cục thứ ba" là cách gọi trong buổi học, không phải thuật ngữ chuẩn — tên chuẩn là partial failure.)
**Ví von:** gửi thư bảo đảm rồi mất liên lạc — không biết thư tới nơi mà biên nhận lạc, hay thư chưa từng tới.
**Trong hệ của anh:** order-service gọi inventory-service trừ kho rồi timeout. Retry thì có thể trừ hai lần, không retry thì có thể không trừ lần nào.
**Nguồn:** https://sre.google/sre-book/addressing-cascading-failures/

### Timeout
**Là gì:** ngưỡng thời gian chờ, quá ngưỡng thì bỏ cuộc và coi như thất bại — dù thực tế bên kia có thể vẫn đang chạy hoặc đã chạy xong.
**Ví von:** gõ cửa ba phút không ai ra thì bỏ đi, nhưng biết đâu người ta đang gói hàng.
**Trong hệ của anh:** đây là cái sinh ra partial failure. Timeout KHÔNG có nghĩa là "nó không chạy".
**Nguồn:** https://sre.google/sre-book/addressing-cascading-failures/

### Rate limit / 429
**Là gì:** giới hạn số request được phép trong một khoảng thời gian; vượt thì bị từ chối với mã lỗi 429 Too Many Requests.
**Ví von:** quầy chỉ nhận 10 khách một phút, khách thứ 11 bị mời ra xếp hàng lại.
**Trong hệ của anh:** lỗi anh gặp thường xuyên khi xử lý số lượng lớn order/product/customer qua API Shopify. Điểm quan trọng đã học: 429 là **tin tốt** so với timeout — anh biết chắc request đó không chạy.
**Nguồn:** https://microservices.io/articles/glossary.html

### Idempotency **(chưa dạy kỹ — Buổi 4)**
**Là gì:** tính chất của một thao tác mà chạy một lần hay nhiều lần đều ra cùng một kết quả.
**Ví von:** bấm nút tầng 5 trong thang máy mười lần vẫn chỉ lên tầng 5 một lần.
**Trong hệ của anh:** lối thoát khỏi partial failure. Không ai cho anh biết inventory-service đã trừ kho chưa, nên thay vì đi tìm câu trả lời đó, làm cho việc trừ kho chạy hai lần cũng vô hại.
**Nguồn:** https://microservices.io/patterns/communication-style/idempotent-consumer.html

---

## Độ tin cậy

### Availability (độ sẵn sàng)
**Là gì:** tỉ lệ thời gian hệ thống phục vụ được. Đo bằng phần trăm, nhưng phải đổi ra phút mới cảm được.
**Ví von:** 99.9% nghe như hoàn hảo; đổi ra là 43 phút chết mỗi tháng.
**Trong hệ của anh:** một tháng có 43.200 phút. 99.9% = 43 phút chết. 99.4% = 259 phút, hơn bốn tiếng rưỡi.
**Nguồn:** https://sre.google/sre-book/embracing-risk/

### Cascading failure (hỏng dây chuyền)
**Là gì:** một service hỏng kéo theo service phụ thuộc nó hỏng, lan tiếp thành đổ cả hệ.
**Ví von:** một mắt xích đứt thì cả sợi xích đứt, dù các mắt còn lại đều tốt.
**Trong hệ của anh:** 6 thành phần mỗi cái 99.9% xâu vào một đường request thành 99.4%. Không ai viết sai dòng code nào; kiến trúc làm hỏng, không phải service nào.
**Nguồn:** https://sre.google/sre-book/addressing-cascading-failures/

---

## RabbitMQ **(cả mục — chưa dạy kỹ, mới lướt qua bản sim 10/08)**

### Broker
**Là gì:** phần mềm trung gian nhận message từ bên gửi, giữ lại, rồi giao cho bên nhận.
**Ví von:** bưu cục — người gửi không cần biết người nhận có đang ở nhà không.
**Trong hệ của anh:** RabbitMQ sẽ đóng vai này giữa order-service và inventory-service ở Buổi 3.
**Nguồn:** https://www.rabbitmq.com/tutorials/amqp-concepts

### Exchange · Queue · Binding · Routing key
**Là gì:** message không vào thẳng queue. Nó vào exchange; exchange đối chiếu routing key của message với các binding để quyết định đẩy vào queue nào.
**Ví von:** exchange là bàn phân loại thư ở bưu cục, routing key là địa chỉ trên phong bì, binding là quy tắc "thư gửi phố X thì bỏ vào túi số 3", queue là cái túi.
**Trong hệ của anh:** trong sim, event `order.created` khớp binding `order.*` nên rơi vào queue của inventory.
**Nguồn:** https://www.rabbitmq.com/tutorials/amqp-concepts

### Unacked
**Là gì:** message đã giao cho consumer nhưng consumer chưa báo xử lý xong. Nó VẪN nằm trong queue, chưa rời đi.
**Ví von:** bưu tá đã đưa hàng nhưng chưa lấy được chữ ký — trên sổ, kiện hàng đó vẫn thuộc về bưu cục.
**Trong hệ của anh:** đây là chỗ trả lời câu "consumer chết thì message ở đâu". Trượt lần kiểm 13/08, học lại ở Buổi 3.
**Nguồn:** https://www.rabbitmq.com/docs/confirms

### Dead letter
**Là gì:** message không xử lý được sẽ bị đẩy sang một exchange riêng thay vì mất hẳn, kèm lý do trong `x-death.reason`.
**Ví von:** thư không phát được thì đưa về kho thư chết, có ghi lý do, không vứt đi.
**Trong hệ của anh:** một trong bốn nhánh rẽ ở cuối bản sim 10/08.
**Nguồn:** https://www.rabbitmq.com/docs/dlx
