# How Compaction Works in Pi — Earendil Engineering (DỊCH SÁT tiếng Việt)

> Nguồn: https://earendil.com/posts/compaction-in-pi/ (đăng 13/8/2026)
> Tóm tắt: [tom-tat.md](tom-tat.md)
> Chế độ: DỊCH SÁT — bài giải thích cơ chế: số liệu, tên lệnh, chuỗi prompt nguyên văn và 8 sơ đồ ASCII chính là nội dung, lệch một chỗ là hiểu sai compaction chạy thế nào.
> Xưng hô: bạn
> Pass 2 (editor mù nguồn): 3 vòng · điểm vòng cuối: nhịp câu 8 · từ ngữ 8 · xưng hô 10 · mạch đoạn 9 · thuật ngữ 9
> Pass 3 (soát nghĩa): 0 finding · đã sửa 0 · còn lại: không còn

---

Ngồi code đủ lâu với một coding agent như Pi, Claude Code hay Codex thì kiểu gì cũng có lúc bạn kích hoạt compaction. Bài này nói compaction chạy thế nào, và lúc nào Pi cần compact.

## Hội thoại với LLM

Large language model (LLM) có context window hữu hạn. Context window là phần model "nhìn" được trong lúc sinh câu trả lời. LLM chạy trên kiến trúc transformer. Kiến trúc này giới hạn lượng input model xử lý được. Trong một session với coding agent, input gồm hết message và tool call trước đó, càng làm càng phình ra. Vượt quá context window là LLM từ chối request.

Lúc bạn làm việc trực tiếp với coding agent như Pi, agent gửi request tới LLM rồi nhận response về. Mỗi request gồm system prompt, mấy file nạp sẵn như `AGENTS.md`, tool definitions và lịch sử hội thoại.

Coding agent gửi request đầu tiên lên LLM. Request này chứa đúng khối context ban đầu đó, kèm user message đầu tiên.

```
request 1:
[system][tools][user]
```

Một turn bắt đầu từ đó. Trước hết LLM có thể trả về một assistant message chứa tool call. Chương trình agent chạy đám tool call đó, rồi gửi lên LLM một request mới chứa cả cuộc hội thoại, lần này có thêm tool result. Lại nhận về một assistant message nữa. Turn kết thúc khi assistant sinh xong output.

```
after request 1:
[system][tools][user][assistant: tool call][tool result][assistant]
                     <------------------->     ^        <--------->
                     returned by LLM           |        returned by LLM
                                               |
                                     produced by the agent
```

Bạn làm tiếp, gửi thêm message nữa.

```
request 2:
[system][tools][user][assistant: tool call][tool result][assistant][user]
                                                                     ^
                                                               new user message
```

Mỗi turn lại làm cuộc hội thoại dài thêm. Đến một lúc, lịch sử vượt quá context limit. Request kế tiếp trả về lỗi kiểu `Request exceeds the maximum size`.

```
[system][tools][user][assistant][....][tool result][user]
                                                      ^
                                             exceeds context window
```

## Xử lý khi context tràn

Cứ để nguyên cuộc hội thoại đang có thì không đi tiếp được nữa. Đến đây, bạn có hai lựa chọn.

1. Mở một cuộc hội thoại mới, rỗng, không mang theo đống context đã tích. Cách này vứt luôn lịch sử, cả quyết định trước đó lẫn phần việc còn dang dở. Vẫn có thể là nước đi hay: context càng lớn thì LLM trả ra càng kém.

2. Muốn giữ cuộc hội thoại này chạy tiếp thì rút context của nó lại thành một bản nhỏ hơn. Compaction làm đúng việc đó.

## Compaction

Trên lý thuyết, có nhiều cách cài compaction. Ví dụ: viết một hàm deterministic, giữ lại một phần nội dung hội thoại rồi vứt phần còn lại. Nhưng thực tế thì bản cài compaction dùng một request LLM để tóm tắt lịch sử hội thoại.

Compaction thay một phần lịch sử bằng bản nén lại, chừa chỗ cho message và tool call mới.

```
[system][tools][compaction result][user]
                                    ^
                               new message
```

## Pi cài thế nào

Giờ xem kỹ hơn: riêng Pi cài compaction thế nào.

Hội thoại dài quá thì Pi dùng compaction để tóm tắt phần cũ, đồng thời giữ nguyên phần việc gần đây. Compaction tự chạy khi context limit tiến sát tổng kích thước context window. Bạn cũng gọi tay được bằng lệnh `/compact`.

Pi kiểm tra auto-compaction sau khi một turn kết thúc. Trước đó, mỗi request nối thêm vào prompt đang có và dùng lại được cached prefix. Gặp lỗi context overflow thì Pi cũng compact giữa turn được.

Lúc compact, Pi giữ nguyên một số message gần nhất.

```
before compaction:
[system + tools][older turns][recent retained messages]
```

Số message giữ lại không cố định, vì Pi dùng một token budget chỉnh được. Mặc định hiện tại là 20 nghìn token, tính ra khoảng 5 đến 20 turn. Pi gom hết message nằm trước điểm cắt đó, serialize lại, rồi đem tóm tắt.

## Compaction prompt của Pi

Lý tưởng thì một bản tóm tắt tốt cho coding agent đọc lên giống bản bàn giao giữa hai ca trực. Compaction prompt của Pi nhắm vào một chuyện: trong context đang có, rất nhiều thứ không còn liên quan nữa. Chỉ nên giữ lại phần nào còn là context quan trọng với request LLM kế tiếp.

Thế nên request Pi gửi cho compaction khác hẳn request hội thoại thường.

1. System prompt trong request compaction standalone là một prompt riêng. Thay vì bảo LLM `you are an expert coding assistant`, Pi nói `you are a context summarization assistant.`

2. User message trong request compaction cũng khác. Nó yêu cầu `a structured summary of this conversation branch for context when returning later.` Prompt chỉ rõ mấy mục cần có: goal, progress và key decisions.

3. Đây là request standalone, không đụng tới lịch sử hội thoại đang có, nên dùng được model LLM khác mà không phát sinh chi phí thừa.

Pi nối kết quả compaction vào session dưới dạng compaction entry, thế là session chạy tiếp được. Chạy xong request compaction là context đã nén lại.

```
after compaction:
[system][tools][summary][recent turns][new user message]
```

Giờ context hội thoại còn chỗ cho rất nhiều message nữa.

Pi lưu bản tóm tắt compaction trong session dưới dạng plain text. Nhờ vậy context đã nén vẫn đọc được và mang đi được: bạn đổi model trong Pi rồi vẫn dùng tiếp được bản tóm tắt đó.

## Compaction và prompt caching

Bên cung cấp LLM dùng prompt caching: request lặp lại trong cùng một cuộc hội thoại thì rẻ đi. Trong một session code đang chạy, bạn trả ít tiền hơn cho phần context do model sinh ra từ trước. Kiểu cache này đòi hỏi prefix khớp chính xác, nên compact một session là làm vỡ prompt cache.

```
cached before compaction:
[system][tools][older history][recent retained turns]
<-------------------- cached prefix -------------------->

first request after compaction:
[system][tools][summary][recent retained turns][new user message]
<-- reusable -->^
                |
        first changed token
                |
                +-- everything after this point must be recomputed
```

Đám turn giữ lại vẫn chứa đúng token cũ, nhưng giờ chúng nằm sau một prefix khác, nên cached state cũ không dùng lại được.

Request mới sau compaction thì lại hưởng được prompt caching như cũ.

## Thử nghiệm

Pi mở rộng được, nắn theo ý bạn được, nên thay compaction của nó bằng bản tự viết cũng chẳng sao. Muốn thử cơ chế compaction khác thì bảo Pi tạo một extension kèm compaction prompt riêng.
