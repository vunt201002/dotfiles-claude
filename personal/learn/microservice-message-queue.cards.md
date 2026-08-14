---
topic: Microservice + Message Queue
ladder: [3, 7, 14, 30, 90]
created: 2026-08-13
---

# Thẻ kiến thức — Microservice + Message Queue

Dựng ngày 13/08, sau buổi kiểm lại đầu tiên. Khác file thẻ SEO ở một điểm quan trọng:
**mọi mức ở đây đều là mức đo thật**, không phải mức mặc định. Buổi 13/08 đã hỏi lại
từng thẻ và chấm theo câu trả lời thực tế.

Quy tắc chấm: 0 quên · 1 lơ mơ · 2 tự giải thích lại được · 3 áp được vào ca chưa từng gặp.
Đạt (≥2) → `streak+1`, hẹn theo ladder. Trượt (≤1) → `streak=0`, hẹn lại buổi kế tiếp.

Level 3 chỉ được trao ở phase APPLY, trên ca hoàn toàn mới, cách buổi dạy một khoảng
thời gian. Giải thích trôi chảy ngay sau khi vừa được dạy thì vẫn chỉ là 2.

---

## Buổi 1 — Monolith vs Microservices

- id: monolith-scale-toan-khoi
  concept: Monolith deploy thành một khối nên chỉ scale được cả khối; không tách riêng phần đang nghẽn để tăng sức, phải trả tài nguyên cho cả phần đang nhàn.
  neo: buổi 13/08 — shop dịp sale, phần xem sản phẩm nghẽn còn thanh toán nhàn rỗi
  level: 2
  streak: 1
  taught: 2026-08-02
  last_tested: 2026-08-13
  next_review: 2026-08-16
  note: trả lời gọn và đúng ngay lần đầu, sau 11 ngày không ôn

- id: db-per-service-coupling
  concept: Lý do bắt mỗi service có DB riêng là coupling, không phải tải. Nhiều service đọc thẳng một bảng thì schema bảng đó thành public API ngầm không ai ký; service sở hữu mất quyền đổi bảng của chính mình, và hai service phải deploy thành cặp — chết đúng thứ duy nhất microservices mua được.
  neo: buổi 13/08 — product-service tách cột `price` ra bảng riêng để làm giá B2B, order-service đang query thẳng `products`
  level: 2
  streak: 1
  taught: 2026-08-02
  last_tested: 2026-08-13
  next_review: 2026-08-16
  note: TRƯỢT lần đầu — quy về "mỗi service tải khác nhau, chung DB thì chung bottleneck". Phải giảng lại rồi kiểm bằng ca tách cột `price` mới qua. Lần ôn tới hỏi thẳng "lý do KHÔNG phải là gì" để chắc phần chữa đã dính.

---

## Buổi 2 — Sync communication

- id: ket-cuc-thu-ba
  concept: Gọi hàm có 2 kết cục (trả về / ném lỗi), cả hai đều cho biết chắc chuyện gì đã xảy ra. HTTP call có 3 — thêm kết cục im lặng. Cái độc không phải là nó hỏng mà là nó nhập nhằng: request có thể đã chạy xong hoàn chỉnh, chỉ response chết trên đường về. "Đã chạy" và "chưa chạy" nhìn giống hệt nhau.
  neo: buổi 13/08 — order-service gọi inventory-service trừ kho 10 sản phẩm rồi timeout; retry thì hụt kho 20, không retry thì bán quá số lượng
  level: 2
  streak: 1
  taught: 2026-08-13
  last_tested: 2026-08-13
  next_review: 2026-08-16
  note: lần đầu đặt chỗ đau ở "không biết TẠI SAO fail" (chuyện debug). Chữa lại: chỗ đau là "không biết nó CÓ CHẠY hay không" (chuyện dữ liệu đúng/sai), vì quyết định phải ra ngay lúc timeout là retry hay không. Qua sạch ở câu chọn (A) nguyên nhân vs (B) đã chạy chưa — chọn B, giải thích đúng.

- id: api-tho-vi-mang
  concept: Trong monolith gọi hàm gần như miễn phí nên API thiết kế vụn thoải mái. Cắt ra thành service thì chính sự vụn vặt đó thành khoản chi lớn nhất — mỗi round trip ~1-2ms so với dưới 1 microsecond. API giữa các service phải thô: một lần gọi lấy nhiều thứ, gộp sẵn thứ người gọi cần.
  neo: buổi 13/08 — đơn 50 dòng, vòng lặp `GET /products/:id/price` mất 50-100ms; cùng vòng lặp đó trong monolith mất ~50 microsecond
  level: 2
  streak: 1
  taught: 2026-08-13
  last_tested: 2026-08-13
  next_review: 2026-08-16
  note: tính đúng cả ba câu và TỰ mô tả ra endpoint batch mà không cần mớm tên pattern

- id: availability-nhan
  concept: Độ sẵn sàng của một request nhân lên chứ không cộng. Mỗi service nằm trên đường đi của request đều kéo tụt độ sẵn sàng của mình. Không bao giờ ổn định hơn tích của mọi thứ phải hỏi mới trả lời được — kể cả khi mọi service đều đạt đúng cam kết của nó.
  neo: buổi 13/08 — 6 thành phần × 99.9% = 99.4%; đổi ra phút là 43 phút chết/tháng thành 259 phút, không ai viết sai dòng code nào
  level: 1
  streak: 0
  taught: 2026-08-13
  last_tested: 2026-08-13
  next_review: 2026-08-14
  note: TRƯỢT. Tính đúng cả 99.8% lẫn 99.4% nhưng không rút ra được ý nghĩa, còn hỏi ngược "câu này chưa liên quan lắm nhỉ". Đã giảng lại theo đường đổi phần trăm ra phút + khung "cả 6 service đều khoẻ mà hệ thống yếu đi". CHƯA kiểm lại — buổi tới hỏi trước tiên. Đây là bản lề mở sang Buổi 3, thẻ này không qua thì Buổi 3 mất lý do tồn tại.

---

## Từ bản sim 10/08 (Buổi 3+4 xem trước, chưa dạy kỹ)

- id: unacked
  concept: Message đã giao cho consumer nhưng chưa được ack thì VẪN nằm trong queue ở trạng thái unacked, chưa rời đi. Consumer chết lúc đó thì broker phát hiện mất kết nối và requeue message cho consumer khác.
  neo: sim 10/08 — chặng unacked, nhánh "consumer chết"
  level: 0
  streak: 0
  taught: 2026-08-10
  last_tested: 2026-08-13
  next_review: 2026-08-14
  note: TRƯỢT sạch, trả lời "chưa nhớ lắm". Bằng chứng phương pháp: xem sim mà không bị bắt dự đoán trước mỗi chặng thì không dính lại gì. Buổi 3 dạy lại tử tế, và lần này phải hỏi dự đoán TRƯỚC mỗi chặng.
