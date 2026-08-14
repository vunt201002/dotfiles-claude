# Understanding is the new bottleneck — tóm tắt (Geoffrey Litt)

> Nguồn: https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck (đăng 2/7/2026)
> Bản dịch đầy đủ: [dich.md](dich.md)
> Loại: **tóm tắt + giải thích, do Claude viết** — KHÔNG phải lời tác giả, không phải bản dịch.
>   Chỗ nào cần nguyên văn thì đọc bản dịch, đừng trích file này.
> Viết: 2026-08-14

## Luận đề

Bản viết của một talk ở hội nghị AI Engineer, tháng 7/2026. Luận đề nằm ngay tiêu đề: agent viết
code càng lúc càng nhiều, nên thứ chặn lại không còn là tốc độ viết code mà là tốc độ con người
hiểu được đống code đó. Bài chia hai nhánh: **vì sao** phải hiểu, rồi **ba kỹ thuật** để hiểu cho
đỡ tốn sức là code explainer doc, quiz, micro-world.

## Hiểu để làm gì

Mục đáng đọc nhất bài, vì nó bác một câu trả lời mà chính phe "phải hiểu" hay đưa ra.

Câu trả lời quen thuộc: hiểu **để verify**. Chỗ hỏng là verify về bản chất chỉ là câu hỏi nhị
phân, qua hay không qua, mà agent thì ngày càng tự verify tốt hơn. Lý do đó tự teo đi theo đà
agent khôn lên.

Câu trả lời thay thế: hiểu **để tham gia**. Cơ chế: một dự án không phải một vòng lặp mà là rất
nhiều vòng nối nhau, ý cho vòng sau phải nảy ra từ đầu người, và muốn nghĩ ra ý đó thì trong đầu
phải sẵn một mớ khái niệm về hệ thống. Hiểu ít thì hậu quả không phải "review chậm hơn", mà là
**hết ý để đề xuất**. Đó là chỗ hai lý do không thay nhau được: verify thì agent làm hộ được,
tham gia thì không.

Litt nối chuyện này với cognitive debt (Margaret Storey và Simon Willison làm cho phổ biến):
giống tech debt, ngắn hạn không hiểu gì vẫn trót lọt, nhưng nợ cộng dồn rồi có ngày trả. Câu hỏi
kế là làm sao dựng cái hiểu đó khi vừa làm với AI vừa chạy nhanh, và ông rẽ sang giáo dục lấy ý.

## Kỹ thuật 1: lời giải thích

Agent làm xong một việc là dịp để có lời giải thích. Mặc định lời giải thích đó là code diff, mà
diff thô chỉ là một đống file xếp theo alphabet. Litt hỏi ngược: lời giải thích **tốt nhất** trông
ra sao? Câu trả lời là skill `/explain-diff`, xuất code explainer dạng HTML, markdown hoặc Notion
doc. Ba nguyên tắc bên trong là phần đáng lấy:

1. **Dạy phần nền trước.** Chưa nói tới chỗ đổi, giải thích chỗ đó vốn có gì đã.
2. **Trực giác trước, chi tiết sau.** Mục tiêu bằng lời thường, rồi khái niệm liên quan, rồi mới
   tới code. Interactive figure nằm ở tầng này.
3. **"Literate diff".** Đi qua từng thay đổi theo thứ tự có lý, giải thích bọc quanh, code chèn
   vào giữa, thay cho danh sách file theo alphabet.

Rồi tới một vấn đề thật: đọc thì mệt, rất dễ tự lừa là đã đọc trong khi chẳng nhớ gì. Chỗ này ông
mượn ý Andy Matuschak và Michael Nielsen về nhúng quiz spaced repetition vào bài luận, gắn **năm
câu hỏi** vào cuối mỗi explainer, kèm luật tự đặt: chưa qua được quiz thì chưa gửi code cho ai.

Ẩn dụ chốt mục này là chỗ hay nhất bài: **quiz là một cái phanh**. Vòng lặp làm với AI rất dễ chạy
nhanh hơn tốc độ người hiểu kịp, nên cần một cơ chế máy móc ghì lại. Nó không đo chất lượng code,
nó điều tốc.

## Kỹ thuật 2: micro-world

Lấy từ Seymour Papert và ý *sống trong Mathland*: muốn học toán thì sống trong Mathland, y như
muốn học tiếng Pháp thì sang Pháp sống. Áp vào code: dựng được những thế giới nhỏ để chui vào
nghịch rồi tự cảm ra hệ thống chạy thế nào, hay không?

Hai ví dụ. Một, viết Prolog interpreter mà không hình dung nổi bên trong, nên nhờ agent dựng một
debugger tua tới lui được theo thời gian, xem trên stack có gì, bước nào thì rule nào chạy. Hai,
chuyển website sang framework khác: Claude viết được script làm việc đó nhưng review thì bất lực
vì framework mới ông chưa quen, nên ông nhờ Claude dựng một "command center" có nút bấm để tự tay
chạy từng bước port, site cũ và site mới đặt cạnh nhau.

Điểm chung, và là chỗ dễ đọc lướt qua nhất mục: agent không debug hộ, agent **dựng công cụ để
người tự làm**. Làm hộ thì xong việc nhưng không đọng lại gì; tự đi qua từng bước thì cái hiểu lớn
lên dọc đường, chỉ nhanh hơn làm tay vì trải nghiệm đã bày sẵn.

## Kỹ thuật 3: không gian chung

Hai kỹ thuật trên đều là hiểu một mình; mục này chuyển sang team. Hai người cùng giữ một mental
model thì trao đổi rất nhanh, vì chung vốn từ và chung một hình ảnh trong đầu. Ví dụ là Notion,
nơi ông làm và có nói rõ chỗ thiên vị: chạy agent Claude và Cursor ngay trong Notion, plan kỹ
thuật agent viết ra mặc định nằm trên trang cộng tác nên comment và bàn được ngay. Mục này mỏng
hơn hai mục trước và nghiêng về sản phẩm, nhưng ý nền thì độc lập với công cụ.

## Mục tiêu luôn là augment

Phần kết mở ra ngoài chuyện code. Litt kéo về Alan Kay 50 năm trước, với tấm hình mấy đứa nhỏ nhìn
tưởng đang xem video trên máy tính bảng, thật ra đang chơi một game tương tác và sửa code ngay lúc
chơi để hiểu vật lý. Đây là chỗ đắt nhất phần kết: ý "máy tính là phương tiện để hiểu" không mới,
nó có từ thuở khai sinh ngành, chỉ là tới giờ AI mới làm việc dựng simulation đủ rẻ để ai cũng làm
được. Câu chốt: mục tiêu luôn là *augment*, không phải chỉ automate.

## Rút lại

Mạch chính: agent viết code rẻ đi → nút thắt dời sang chỗ người hiểu → hiểu để verify là lý do
đang teo dần vì agent tự verify ngày càng tốt → lý do còn đứng vững là hiểu để tham gia, vì ý cho
vòng lặp sau chỉ nảy ra từ người có đủ khái niệm trong đầu → nên đi mượn công cụ ngành giáo dục.

1. **Phân biệt verify và tham gia.** Đóng góp thật của bài. Đọc code chỉ để kiểm agent làm đúng
   chưa thì lý do đó sẽ hết hạn; lý do không hết hạn là cần hiểu để còn nghĩ ra việc tiếp theo.
2. **Explainer phải dạy phần nền trước, không phải kể lại diff.** Thứ tự đúng: bối cảnh → trực
   giác → code.
3. **Quiz là cơ chế điều tốc, không phải cơ chế đo chất lượng.** Luật "chưa qua quiz thì chưa gửi
   code" buộc tốc độ vòng lặp khớp tốc độ hiểu.
4. **Nhờ agent dựng công cụ để tự làm, thay vì nhờ agent làm hộ.** Cùng một agent, cùng một task,
   nhưng một đằng để lại cái hiểu, một đằng thì không.
