# Steps of AI Adoption (thread 5 tweet) — Boris Cherny (DỊCH SÁT tiếng Việt)

> Nguồn: https://x.com/bcherny/status/2077929390806073807 (đăng 2026-07-17)
> Tóm tắt: [tom-tat.md](tom-tat.md)
> Chế độ: DỊCH SÁT — thread chỉ tên từng chế độ và từng giao diện phải bật, gọi sai một cái là người đọc bật nhầm thứ.
> Xưng hô: bạn (tác giả tự xưng `tôi`)
> Pass 2 (editor mù nguồn): 3 vòng · điểm vòng cuối: nhịp câu 8 · từ ngữ 8 · xưng hô 10 · mạch đoạn 8 · thuật ngữ 10
> Pass 3 (soát nghĩa): 2 finding · đã sửa 2 · còn lại: không còn

**[1/5]**

Ngày nào tôi cũng nói chuyện với engineer ở công ty khác, và nghe đúng một chuyện: một người đang 10x output nhờ Claude, trong khi những người còn lại trong tổ chức chưa theo kịp.

Nhìn team đưa AI vào việc, tôi thấy đi thấy lại đúng 4 bước.

Tôi vẽ hết ra ở đây: Steps of AI Adoption https://t.co/kQnRAUMKpP

**[2/5]**

Đi qua mấy bước này thì không có một con đường đúng duy nhất. Team nào công ty nào cũng khác nhau. Nhưng ở mỗi bước, chỉ đổ token vào thì không đủ để đi tiếp. Muốn lên bước sau, bạn phải tìm ra và phá cho được mấy bottleneck kế tiếp, rồi dựng lên mấy guardrails kế tiếp.

**[3/5]**

Cụ thể là phải cho Claude tự kiểm được việc nó làm từ đầu tới cuối. Tức là bật auto mode cho permissions, cho code review và security review chạy tự động mặc định. Rồi dùng mấy giao diện quản được nhiều agent cùng lúc (Agent view trong CLI, Desktop app, app iOS và Android, Tag).

Level cao hơn nghĩa là /loop, /batch, dynamic workflows và worktree isolation cho subagent. Không phải chuyện một tính năng đơn lẻ, mà là dùng đúng tính năng với đúng guardrails. Nhờ vậy Claude tự động hoá được nguyên cả mảng việc, còn team bạn thì vẫn tin được kết quả nó trả ra.

**[4/5]**

Team chịu dùng rồi thì theo dõi bằng cách nào? Usage thì cũng đáng nhìn (trên dashboard chẳng hạn), nhưng nó đo hoạt động chứ không đo cái thu về. Câu hỏi tốt hơn: việc này mà không có Claude thì bạn có bỏ công engineer ra làm không? Nếu có thì bỏ bao nhiêu công, làm tay thì tốn bao nhiêu giờ eng? Đó mới là cái bạn thu về.

**[5/5]**

Cái được lớn hơn là lúc việc sửa và bảo trì chạy ngầm ở dưới, còn team thì tập trung dựng cái mới. Lúc đó bạn bắt đầu làm được mấy thứ trước đây còn chưa với tới.

Anthropic đang ở bước 3 và đẩy lên 4. Riêng tôi thì vừa chạm level 4.

Không biết mọi người tới đâu rồi nhỉ. Team bạn đang ở bước nào?
