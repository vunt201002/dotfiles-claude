# Understanding is the new bottleneck — Geoffrey Litt (VIẾT LẠI tiếng Việt)

> Nguồn: https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck (đăng 2/7/2026)
> Tóm tắt: [tom-tat.md](tom-tat.md)
> Chế độ: VIẾT LẠI — bài luận, bản viết của một talk quan điểm; không có code, không có bước để gõ theo, nên dịch lệch một từ chỉ làm mất ý chứ người đọc không làm sai điều gì
> Xưng hô: mình
> Pass 2 (editor mù nguồn): 3 vòng · điểm vòng cuối: nhịp câu 9 · từ ngữ 9 · xưng hô 10 · mạch đoạn 8 · thuật ngữ 9
> Pass 3 (soát nghĩa): 8 finding · đã sửa 8 · còn lại: không còn

*Tháng 7/2026*

Viết lại từ một talk mình nói ở hội nghị AI Engineer, tháng 7/2026. Còn có bản đăng thành một chuỗi tweet nữa.

**Một ý chắc nhiều người không thích: mình vẫn nghĩ hiểu code agent viết ra là chuyện quan trọng.**

Talk này nói vì sao lại thế, kèm vài cách hiểu code cho đỡ tốn sức. Vào việc luôn.

Agent viết ngày càng nhiều code, ai cũng thấy theo không kịp.

Tin mừng là có nhiều đường để hiểu code. Đọc diff từng dòng không phải đường duy nhất.

Phần lớn talk xoay quanh mấy kỹ thuật mình thấy có ích khi muốn hiểu hệ thống agent đang dựng:

- Code explainer doc
- Quiz để tự kiểm xem mình hiểu tới đâu
- Micro-world để nghịch cho ra cách hệ thống chạy

Nhưng trước hết phải trả lời một câu cơ bản hơn.

## Hiểu để làm gì?

Chẳng phải giờ mình nên tự rút ra khỏi vòng lặp, để agent tự lặp lấy hay sao? Agent càng khôn thì người ngồi soi từng chi tiết càng bớt quan trọng chứ?

Mình nghĩ nhiều người trả lời câu này hơi lệch, kể cả người đứng về phe "phải hiểu".

Một câu trả lời: hiểu **để verify**. Xem agent làm có đúng không.

Đúng thì có nhiều nghĩa: khớp spec chưa, kiến trúc ổn chưa. Nhưng về căn bản vẫn là câu hỏi qua hay không qua.

Vấn đề là agent ngày càng verify được chính nó. Chuyện này tốt. Mình cũng thích agent đừng sai.

Nhưng vậy thì con người còn lại gì?

**Câu trả lời còn lại: hiểu để tham gia.**

Biết agent đang làm gì thì mới góp mặt thật sự vào phần sáng tạo. Vì sao lại đáng?

Có bao giờ chỉ một vòng lặp đâu. Một dự án là rất nhiều vòng với agent.

Nghĩ ra được ý tiếp theo để đẩy hệ thống đi tiếp, một phần là nhờ hiểu nó tới đâu.

Muốn nghĩ trôi chảy và sáng tạo về hướng đi tiếp thì trong đầu phải sẵn một mớ khái niệm. Thiếu cái đó, phần mình góp vào dự án hẹp lại thấy rõ.

Chỗ này dính chặt với ý [cognitive debt](https://margaretstorey.com/blog/2026/02/09/cognitive-debt/). Ý này phổ biến lên là nhờ Margaret Storey và Simon Willison.

Giống tech debt thôi: ngắn hạn thì không hiểu gì cũng trót lọt, nhưng rồi có ngày trả giá.

Được rồi, hiểu là quan trọng.

Nhưng **làm sao**? Làm sao dựng được cái hiểu đó khi vừa làm với AI vừa chạy nhanh?

Hoá ra đây không phải lần đầu có người nghĩ về chuyện truyền cái hiểu cho người khác. Mình nghĩ giáo dục là chỗ đáng học hỏi. Lấy mấy ý hay nhất ngành giáo dục từng nghĩ ra rồi áp vào bài toán này được không?

## Kỹ thuật 1: lời giải thích

Hôm nay mình chia sẻ ba kỹ thuật.

Đầu tiên: lời giải thích. Một lời giải thích tốt thì tốt ở chỗ nào?

Agent làm xong một việc là dịp tốt để giải thích, để lại một artifact.

Cách ngây thơ nhất là đọc code diff, đúng phần nguyên liệu vừa đổi.

Nhưng thử hỏi: **lời giải thích tốt nhất thì trông ra sao?** Cứ cho là có hẳn một team chăm chút chuyện giải thích cho mình, người hay AI cũng được. Cảm giác đó thế nào?

Mình có một câu trả lời: skill tên [/explain-diff](https://gist.github.com/geoffreylitt/a29df1b5f9865506e8952488eac3d524). Xài mỗi ngày, nhiều đồng nghiệp cũng thấy đáng.

Nó xuất ra code explainer có bố cục tử tế, dạng HTML, markdown hoặc Notion doc. Notion hợp để cả team cùng bàn trên mấy explainer đó. (Nói trước: mình làm ở Notion nên có thiên vị.)

Thử mở một cái ra xem, lấy ví dụ một thay đổi về góc nhìn trong game.

Nguyên tắc một: **dạy mình phần nền đã.**

Trước khi tới chỗ nào đổi, giúp mình hiểu chỗ đó vốn có gì. Ở đây là dạy về game engine.

Nguyên tắc hai: **trực giác trước, chi tiết sau.**

Chưa đụng dòng code nào, nó nêu mục tiêu trước: "làm khu vườn trông ba chiều bằng mấy mẹo vẽ 2D". Rồi mới tới mấy khái niệm liên quan, kiểu isometric projection là gì.

Cả đoạn đó dựng cho mình trực giác về phần cốt lõi. Nó kéo người đọc lên cùng một mặt bằng.

Interactive figure cũng dựng được trực giác.

Ở đây, kéo mấy hòn đá quanh vườn rồi nhìn toạ độ chạy theo là hiểu được góc nhìn isometric.

(Chỗ này xài một tính năng Notion vừa ra: nhúng HTML tương tác thẳng vào trang.)

Rồi mới tới code. Diff thường là một đống file xếp theo thứ tự alphabet, không lời nào giải thích.

Mình gọi nó là "literate diff": bố cục như văn xuôi. Đi qua từng thay đổi theo thứ tự có lý, giải thích bọc quanh, code chèn vào giữa. Review nhanh hơn diff thô.

Cuối cùng ra một tập explainer gọn gàng. Mình vẫn đọc code diff, nhưng luôn đọc cái này trước.

Có hôm mình in ra rồi mang ra quán cà phê ngồi đọc, đỡ bị phân tâm.

Trớ trêu mà đẹp: AI biến một hoạt động tương tác thành một tập giấy tĩnh để mình tập trung đọc sâu :)

Vướng đúng một chỗ: đọc thì mệt 😅

Andy Matuschak có câu ["books don't work"](https://andymatuschak.org/books/). Rất dễ tự lừa là đã đọc rồi, trong khi chẳng nhớ và chẳng hiểu.

Chữa sao? Mình mượn ý của Andy và Michael Nielsen, hai người [nhúng quiz spaced repetition vào bài luận](https://quantum.country/).

Giờ mình làm tương tự với code explainer. Cuối mỗi cái có một quiz tương tác, năm câu về thay đổi vừa rồi, mình ngồi cố trả lời cho hết.

Luật của mình: chưa qua được quiz thì chưa gửi code cho ai. Review code người khác cũng vậy.

**Quiz là một cái phanh.** Làm với AI thì vòng lặp rất dễ chạy nhanh hơn tốc độ người hiểu kịp.

Quiz là lực níu lại: cứ máy móc hỏi "hiểu thật chưa?" để mình còn giữ trọn vai người tham gia sáng tạo.

/explain-diff là vậy. Skill ở link trên nếu ai cần, có hai biến thể: xuất HTML hoặc xuất một trang Notion.

## Kỹ thuật 2: micro-world

Ý tiếp theo: micro-world. Chỗ này lấy cảm hứng từ nhà giáo dục Seymour Papert.

Papert có một ý rất đẹp, ông gọi là *sống trong Mathland*. Muốn học toán thì sống trong Mathland, y như muốn học tiếng Pháp thì sang Pháp sống. Dựng được một môi trường để trẻ con học toán tự nhiên, như hệ quả của trí tò mò, hay không?

Áp vào code thì sao? **Dựng được mấy thế giới để chui vào ở, rồi tự cảm ra hệ thống chạy thế nào và đang đổi ra sao, hay không?**

Năm ngoái mình code một Prolog interpreter và vật vã không hình dung nổi bên trong đang chạy gì.

Mình làm với agent để dựng một debugger, đi từng bước qua phần thực thi ngôn ngữ logic đó. Tua tới lui theo thời gian, xem trên stack có gì, tới bước nào thì rule nào chạy. Mình còn để lại comment cho chính mình ("ngon, rule này áp đúng rồi").

Dựng một công cụ *cho mình* debug khác hẳn để agent debug hộ. Tự làm mới là chỗ cái hiểu lớn lên dọc đường.

Một ví dụ nữa. Mình chuyển website cá nhân từ framework này sang framework khác, Claude viết script làm giúp. Nhưng review thì rất khó: framework mới mình chưa quen, nhìn xong chỉ nói được "chắc là đúng đó".

Thế là mình nhờ Claude làm cho một cái game, một command center để tự tay port từng bước. Vừa bấm vừa nhìn hiệu ứng hiện ra, cây thư mục đổi theo. Thành ra một UI có nút chạy từng bước port, site cũ và site mới chạy song song cạnh nhau.

Trong cái command center đó mình nhìn site mới thành hình dần. Cái hiểu đọng lại gần bằng tự tay làm, nhưng nhanh hơn nhiều, vì cả trải nghiệm bày sẵn ra rồi.

Điểm chính ở đây: agent viết được mấy mẩu code để giúp người ta đọc hiểu code khác.

Chuyện này lớn đấy.

## Kỹ thuật 3: không gian chung

Kỹ thuật cuối: không gian chung. Nãy giờ toàn chuyện hiểu một mình, **nhưng làm việc theo team thì phải hiểu cùng nhau.**

Hai người cùng giữ một mental model thì trao đổi rất nhanh. Chung vốn từ, chung một hình ảnh trong đầu. Nên bàn qua bàn lại, ý này nảy ra ý kia, nói chuyện sáng tạo được. Thiếu mấy cấu trúc chung đó thì bàn kiểu này khó hơn hẳn.

Mình rất hào hứng với chuyện dựng mấy môi trường chung để cả team xây cái hiểu cùng nhau. Notion về cơ bản cũng là chuyện đó.

Gần đây Notion ra rất nhiều tính năng cho người và agent làm chung, để cả team có chung cái hiểu thay vì mỗi người một ngăn.

Một ví dụ nhỏ: giờ chạy được agent Claude và Cursor ngay trong Notion. Mình code kiểu đó khá nhiều.

Mấy agent đó lên plan kỹ thuật trong Notion thì mặc định plan nằm trên một trang cộng tác. Mình comment vào, bàn với team ngay được. Nghĩ cùng nhau, không phải nghĩ một mình.

## Mục tiêu luôn là augment

Chốt lại. Hôm nay toàn chuyện hiểu code, nhưng mình nghĩ vấn đề rộng hơn thế nhiều.

Nhìn rộng ra thì chuyện con người hiểu được mọi thứ vận hành ra sao vẫn quan trọng. **Không chỉ để verify, mà để tham gia.**

Bất ngờ chưa, ý này chẳng mới. Nó có từ thuở khai sinh ngành máy tính.

50 năm trước Alan Kay hình dung máy tính thành một phương tiện mới, tốt hơn sách. Nó dạy người ta cách nghĩ về thế giới, nhất là trẻ con.

Trong tấm hình đó, nhìn thì tưởng mấy đứa nhỏ đang xem YouTube trên iPad, nhưng không phải. Tụi nó đang chơi một game tương tác và sửa code ngay lúc chơi để hiểu vật lý rõ hơn. 50 năm trước đấy!!

Tới đây thì hy vọng cái meme hai ông phi hành gia đã thấm. Một ông: "khoan, hoá ra máy tính sinh ra là để làm mấy simulation động cho người ta hiểu khái niệm khó à?" Ông kia: "luôn luôn là vậy mà."

Mục tiêu luôn là *augment*, không phải chỉ automate.

Đẹp ở chỗ giờ có AI, dựng simulation dễ tiếp cận hẳn. Để AI dạy lại mình là chuyện đẹp nhất nhì máy tính từng mở ra.

Chuyện này làm mình rất lạc quan về tương lai.

**Dựng đúng công cụ thì giờ mình hiểu thế giới sâu hơn bao giờ hết.** Không nhất thiết cứ phải tự rút khỏi vòng lặp, chui sâu vào vòng lặp cũng được. Chuyện đó là ở mình.

*HẾT*
