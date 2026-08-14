# How Compaction Works in Pi — tóm tắt (Earendil Engineering)

> Nguồn: https://earendil.com/posts/compaction-in-pi/ (đăng 13/8/2026)
> Bản dịch đầy đủ: [dich.md](dich.md)
> Loại: **tóm tắt + giải thích, do Claude viết** — KHÔNG phải lời tác giả, không phải bản dịch.
>   Chỗ nào cần nguyên văn thì đọc bản dịch, đừng trích file này.
> Viết: 2026-08-14

---

## 1. Hội thoại với LLM

LLM có context window hữu hạn, do transformer giới hạn lượng input. Input của một session coding agent gồm system prompt, file nạp sẵn như `AGENTS.md`, tool definitions và lịch sử hội thoại. Mỗi turn lại nối thêm tool call và tool result vào đó.

Cơ chế đáng nhớ: lịch sử chỉ phình một chiều, không turn nào làm nó co lại. Vượt context window là request bị từ chối, với lỗi `Request exceeds the maximum size`.

## 2. Xử lý khi context tràn

Hai đường: mở hội thoại mới rỗng và vứt luôn lịch sử, hoặc rút context lại thành bản nhỏ hơn để đi tiếp, tức compaction.

Chỗ này tác giả không bán compaction như lựa chọn hiển nhiên. Đường vứt hết vẫn có thể hay, vì context càng lớn thì LLM trả ra càng kém.

## 3. Compaction

Lý thuyết thì nhiều cách, kể cả một hàm deterministic giữ một phần và vứt phần còn lại. Thực tế thì bản cài dùng một request LLM để tóm tắt, thay một phần lịch sử bằng bản nén.

## 4. Pi cài thế nào

Compaction tự chạy khi context limit tiến sát tổng kích thước context window; gọi tay được bằng `/compact`. Pi kiểm tra **sau khi một turn kết thúc**, chi tiết nhìn nhỏ nhưng chính là thứ giữ cho cached prefix còn dùng được suốt turn. Gặp context overflow thì compact giữa turn được.

Ngưỡng giữ lại là một token budget chỉnh được, mặc định 20 nghìn token, tính ra khoảng 5 đến 20 turn. Message trước điểm cắt bị gom lại, serialize, rồi đem tóm tắt.

## 5. Compaction prompt của Pi

Đây là đoạn giải thích hay nhất bài: một bản tóm tắt tốt đọc lên giống như **bản bàn giao giữa hai ca trực**. Không phải nén cho ngắn, mà là kể cho ca sau đủ thứ họ cần.

Request compaction khác request thường ở ba chỗ:

1. System prompt đổi vai, từ trợ lý code sang trợ lý tóm tắt context.
2. User message xin bản tóm tắt **có cấu trúc**, chỉ rõ mục `goal`, `progress`, `key decisions`.
3. Là request standalone, không dùng lịch sử đang có, nên chạy được trên model khác mà không phát sinh chi phí thừa.

Kết quả nối vào session dưới dạng compaction entry, lưu dạng plain text nên đổi model xong vẫn dùng tiếp được.

## 6. Compaction và prompt caching

Prompt caching đòi prefix khớp chính xác, nên compact là làm vỡ cache. Điểm tinh tế nhất bài: đám turn giữ lại vẫn chứa **đúng token cũ**, nhưng giờ chúng đứng sau một prefix khác, nên cached state cũ không dùng lại được. Từ token đầu tiên bị đổi trở đi, mọi thứ phải tính lại. Request mới sau đó lại hưởng caching như cũ.

## 7. Thử nghiệm

Pi mở rộng được và nắn được, nên thay compaction bằng bản tự viết cũng chẳng sao: bảo Pi tạo một extension kèm compaction prompt riêng.

## Rút lại

context window hữu hạn → lịch sử chỉ phình → tràn → chọn bỏ hết hoặc nén lại → Pi nén bằng một request LLM standalone, giữ phần gần đây theo token budget → trả giá bằng một lần vỡ prompt cache.

1. **Compaction là bàn giao, không phải nén dữ liệu.** Prompt hỏi goal, progress, key decisions, tức thứ ca sau cần để làm tiếp.
2. **Compact tốn hai lần:** một request LLM để tóm tắt, cộng một lần tính lại cache cho phần sau điểm đổi.
3. **Ngưỡng giữ lại đo bằng token, không phải số message:** mặc định 20 nghìn token, khoảng 5 đến 20 turn.
4. **Hai quyết định thiết kế đi cùng nhau:** request compaction đứng riêng nên chạy được trên model rẻ hơn, và summary là plain text nên đổi model vẫn xài tiếp được.
