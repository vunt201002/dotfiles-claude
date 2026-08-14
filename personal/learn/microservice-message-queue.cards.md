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
  neo: buổi 14/08 — dây đèn mắc nối tiếp 6 bóng: cần 6 bóng sống để sáng, cần 1 bóng cháy để tối
  level: 2
  streak: 1
  taught: 2026-08-13
  last_tested: 2026-08-14
  next_review: 2026-08-17
  note: Mất 3 lần mới qua, và chỉ qua khi bỏ hẳn phần trăm. Lần 1 (13/08) "chưa hiểu cốt lõi". Lần 2 (14/08) rút nhầm thẻ — trả lời bằng latency + lãng phí công (Saga). Lần 3 qua sạch sau khi đổi sang dây đèn nối tiếp và bắt ĐẾM hai con số (6 để sáng, 1 để tối) thay vì suy luận. Câu user tự phát biểu, giữ nguyên vì nó là chỗ chốt: "Vấn đề không nằm ở số lượng. Mà là chúng đang phụ thuộc vào nhau." Bài học phương pháp: khái niệm xác suất mà giảng bằng phần trăm thì trượt, giảng bằng đếm vật thể thì qua.

---

## Buổi 2 (tiếp, 14/08) — Đường tới hạn

- id: duong-toi-han
  concept: Thước chia việc đồng bộ / bất đồng bộ KHÔNG phải "cái nào quan trọng hơn", mà là "khi màn hình báo thành công thì ta vừa hứa điều gì". Cái CHÍNH LÀ lời hứa đó thì bắt buộc đồng bộ; mọi thứ chảy ra TỪ nó là hệ quả và chờ được. Vùng xám (trừ tiền, trừ kho) là quyết định nghiệp vụ đổi độ tin cậy lấy độ chặt dữ liệu, không phải luật kiến trúc.
  neo: buổi 14/08 — đặt hàng: ghi đơn vào DB là bản thân request (không ghi thì chữ "Đặt hàng thành công" là nói dối); mail/điểm/analytics là hệ quả; `authorize` đồng bộ còn `capture` bất đồng bộ là bằng chứng vùng xám có thật
  level: 2
  streak: 1
  taught: 2026-08-14
  last_tested: 2026-08-14
  next_review: 2026-08-17
  note: Lần đầu user xếp "ghi đơn vào DB" vào nhóm trễ được NHIỀU NHẤT, ngang analytics — sai nặng nhất có thể. Chữa bằng một câu duy nhất: "màn hình đã hiện thành công, việc ghi đơn để sau, ngay giây đó server chết — đơn hàng ở đâu?". User tự thấy ngay. Hỏi lại chỗ vùng xám ở lần ôn sau: user có còn phát biểu "trừ tiền/trừ kho là bản thân request" như một sự thật thay vì một lựa chọn không.

- id: cat-phep-nhan
  concept: Cách duy nhất giảm phép nhân availability mà không bỏ service nào là đẩy service ra khỏi ĐƯỜNG TỚI HẠN của request. Số service không đổi; số service mà request phải chờ mới đổi. Aggregator đặt TRÊN đường tới hạn thì làm mọi thứ tệ đi (thêm một thứ phải còn sống); đặt SAU khi đã trả lời khách thì cắt được thật.
  neo: buổi 14/08 — 6 thành phần 99.4% (259 phút chết/tháng) xuống 2 thành phần 99.8% (86 phút), chỉ bằng cách đẩy mail/điểm/analytics/kho ra sau. Không thêm dòng logic nào, không thêm server nào. Aggregator gọi 5 service lúc khách đang chờ = 7 thành phần = 99.3%, tệ hơn lúc chưa có nó.
  level: 2
  streak: 1
  taught: 2026-08-14
  last_tested: 2026-08-14
  next_review: 2026-08-17
  note: User tự tính đúng cả 99.3% (bẫy aggregator) lẫn 99.8%/86 phút (phần thưởng). Nhưng khi giải thích VÌ SAO 99.3% tệ hơn thì lại nói "vì trễ thêm" — gắn latency vào lần thứ ba. Con số đúng, lý do sai. Lần ôn sau hỏi thẳng lý do, đừng hỏi con số.

---

## Từ bản sim 10/08 (Buổi 3+4 xem trước, chưa dạy kỹ)

- id: unacked
  concept: Message đã giao cho consumer nhưng chưa được ack thì VẪN nằm trong queue ở trạng thái unacked, chưa rời đi. Consumer chết lúc đó thì broker phát hiện mất kết nối và requeue message cho consumer khác.
  neo: sim 10/08 — chặng unacked, nhánh "consumer chết"
  level: 0
  streak: 0
  taught: 2026-08-10
  last_tested: 2026-08-13
  next_review: 2026-08-15
  note: TRƯỢT sạch 13/08 ("chưa nhớ lắm"). Hỏi lại 14/08, user không trả lời — tôi chủ động bỏ qua, KHÔNG kiểm nguội nữa vì khái niệm này chưa từng được dạy tử tế, mới lướt qua bản sim. Bằng chứng phương pháp: xem sim mà không bị bắt dự đoán trước mỗi chặng thì không dính lại gì. Buổi 3 dạy lại đàng hoàng, và lần này phải hỏi dự đoán TRƯỚC mỗi chặng.
