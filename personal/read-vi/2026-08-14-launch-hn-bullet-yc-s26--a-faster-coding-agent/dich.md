# Launch HN: Bullet (YC S26) – A Faster Coding Agent — trang chủ Bullet (VIẾT LẠI tiếng Việt)

> Nguồn: https://www.codewithbullet.com
> Tóm tắt: [tom-tat.md](tom-tat.md)
> Chế độ: VIẾT LẠI (đảo DỊCH SÁT: lệnh cài CLI, số version, con số benchmark) — trang landing marketing, dịch sai một chữ thì người đọc không LÀM sai gì, chỉ mất ý.
> Xưng hô: mình
> Kèm phần tổng hợp 73 comment trên Hacker News (mục cuối, không phải nội dung trang gốc): https://news.ycombinator.com/item?id=49283063
> Pass 2 (editor mù nguồn): 3 vòng · điểm vòng cuối (vòng 3 chấm bản vòng 2): nhịp câu 9 · từ ngữ 8 · xưng hô 10 · mạch đoạn 9 · thuật ngữ 8
> Pass 3 (soát nghĩa): 13 finding · đã sửa 13 · còn lại: không còn

Bullet là coding agent, bán bằng đúng một lời hứa: nhanh. Trang chủ mở bằng dòng `FAST, BY DESIGN.`, cạnh đó là nhãn `95.8% ON SWE-BENCH VERIFIED` dẫn sang trang kết quả benchmark. Đang private beta, dùng miễn phí, version `1.3.32`. Phần giới thiệu đầu trang và nút tải chỉ nói tới macOS và Linux, nhưng danh sách link tải lại có sẵn `Setup-x64.exe` cho Windows. Y Combinator rót vốn.

Câu mô tả gọn nhất nằm trong thẻ meta: coding agent rất nhanh, lớp orchestration mỏng hơn.

## 01. Vấn đề: độ trễ

Ý tưởng chạy nhanh thì agent cũng phải nhanh theo. Bên mình đốt hàng giờ chỉ để ngồi chờ agent chạy xong. Không phải vì model kém. Bộ máy dựng quanh model nặng hơn mức cần thiết, chỉ vậy thôi.

## 02. Hệ thống Bullet: gọn ngay từ mặc định

Vẫn là khuôn cũ: model → tools → results. Chỉ có vòng lặp quanh nó siết chặt lại.

### Protocol 01 · Route / Escalate

Đúng model, đúng lúc. Việc dễ thì đẩy sang model nhanh, chỉ leo thang khi việc đòi hỏi. Trang minh hoạ bằng ba nấc: `FAST` cho việc dễ, `DEEP` cho việc phức tạp, `REASON` cho việc khó nhất.

### Protocol 02 · Search / Acquire

Bắt đúng mục tiêu, bỏ qua tiếng ồn. Search có định hướng rồi đọc file là ra đoạn code liên quan, khỏi cần embedding cả repo. Hình minh hoạ: query `auth middleware` trả về `src/router.ts` điểm `94.2` và `src/auth.ts` điểm `88.7`, phần repo đụng tới chỉ `08%`.

### Protocol 03 · Parallel execution

Cái gì chạy song song được thì đừng xếp hàng. Tool call độc lập chạy cùng lúc; call trùng và loop kẹt bị chặn trước khi kịp đốt thêm giây nào. Đồng hồ trong hình dừng ở `00:02.31` cho ba thao tác chạy đồng thời.

Giữa hai mục là dải chữ chạy `NO DEAD TIME`, kèm câu chốt: dựng cho đà chạy, không phải cho phép màu.

## 03. Field test: xem Bullet chạy

Prompt thật, repo thật, không cắt dựng kiểu quảng cáo. Trang nhúng video demo dài `02:14` trên YouTube.

## 04. Bản CLI: không GUI, vẫn agent đó

Cùng router, cùng tool, cùng vòng lặp agent, chỉ là dọn vào shell.

```
$ npm install -g @trybullet/cli
$ bullet
```

macOS và Linux, cần `Node 18+`, miễn phí và không cần key để bắt đầu.

## 05. Lời người sáng lập: dựng lên vì bực

Ở công ty, bên mình đốt hàng giờ ngồi chờ agent. Ngày nào cũng dựng đồ bằng Claude Code, thấy model thừa sức mà vẫn phải lết qua bộ máy chậm không đáng có.

Nên Bullet khởi đầu là project làm cho vui: route việc đơn giản cho nhanh, chỉ đọc thứ đáng đọc, tool nào độc lập thì cho chạy cùng lúc, chặn loop trước khi nó xoáy.

Giờ bên mình dùng nội bộ. Nó gỡ cho bên mình một cơn đau đầu, và bên mình nghĩ nó gỡ được cho người khác cơn y vậy.

> ĐỪNG ĐỂ CODE GIỮ MÌNH LÀM CON TIN.

## Chốt trang: đừng chờ nữa

Private beta, truy cập miễn phí. Không subscription. Chỉ là đường ship nhanh hơn.

---

## Phần comment trên Hacker News (tổng hợp)

Phần này là tổng hợp: mình đọc hết 73 comment trong thread rồi gom theo luồng ý kiến, chứ không dịch nguyên văn từng comment. Thread có 25 nhánh gốc. 28 trong số 73 comment là của chính hai người sáng lập (`alsima` 23 comment, `adi1` 5 comment), tức gần bốn phần mười thread là lời người bán hàng. 45 comment còn lại đến từ 34 tài khoản khác nhau. Tên tài khoản, con số và tên sản phẩm giữ nguyên.

Nói trước cho khỏi hiểu nhầm: bài chính chỉ chừng 460 từ marketing, phần comment dài gấp sáu lần và là chỗ có nội dung thật.

### Con số 95.8% có chứng minh được gì không

Đây là nhánh nặng ký nhất, mà không phải ý kiến đám đông. Đúng một người, `seizethecheese`, đẩy tới cùng qua năm comment liên tiếp, kéo cả hai người sáng lập vào trả lời.

Lập luận: SWE-bench Verified đã bão hoà, nên con số 95.8% gần như vô nghĩa. Bài này `seizethecheese` tự vấp mới rút ra được. Từng cố nâng điểm GPQA Diamond cho hệ multi-agent tự dựng, cố kiểu gì cũng không nhích. Tới khi Fable 5 ra mà cũng không hơn Opus thì mới nhận ra benchmark bão hoà rồi. Ở bảng GPQA Diamond, Fable được 92.6% với giá $0.22 mỗi task, trong khi vài model khác điểm cao hơn mà chỉ $0.01. Từ đó ra đòn chí mạng: trên bảng đã bão hoà, chỉ cần viết router chọn model **ngẫu nhiên** là đã công bố được "cải thiện điểm với chi phí thấp hơn".

Rồi tự nối thêm một comment nữa, lần này cho trục tốc độ. Chọn ngẫu nhiên giữa Fable và Gemini 3.7 Flash là đã nhanh hơn chừng 50% mà điểm còn tốt hơn: Flash giải mất 0.1 phút, Fable mất 0.8 phút, và Flash điểm cao hơn. Đẩy tiếp cho cực đoan: cứ để router luôn luôn chọn Flash thì công bố được mức giảm 87.5% thời gian.

Phía Bullet trả lời theo ba nhịp. `alsima` nói benchmark chạy **không có** router, và chạy ở nấc model mạnh nhất bên họ. `adi1` chỉ vào link "Full results and methodology" trong bài đăng: phần chia theo model, chi phí mỗi task và methodology nằm cả ở đó, không hề giấu. Rồi nhận thẳng: 95.8% trên benchmark đã chín không phải bằng chứng chính. Họ đang chạy mấy bảng khó hơn và ít bão hoà hơn: Terminal-Bench, CursorBench, SlopCodeBench, kết quả công bố sau.

`seizethecheese` đọc xong link vẫn hỏi tiếp: tài liệu đó không cho biết đang route sang agent nào, mấy agent đó điểm SWE-bench Verified bao nhiêu. `alsima` giải thích benchmark cố tình bỏ router ra để so sánh sòng phẳng harness với harness, cụ thể là so với mini-swe-agent trên cùng model. Câu hỏi là bỏ phần route đi rồi thì harness có thêm được giá trị nào về tốc độ và chi phí không.

Chỗ này mới ra câu chốt của cả nhánh, và là nhượng bộ rõ nhất trong toàn thread. `seizethecheese`: vậy thì bài đăng viết rất dễ gây nhầm. Nhắc router làm gì, hay là hệ chạy thật có router còn bản eval thì không? Nếu vậy sao không công bố luôn eval có router. `alsima` nhận: đúng, router chỉ nằm trong hệ chạy thật, và họ sẽ cố diễn đạt lại cho rõ hơn. Lý do bỏ router khỏi eval, theo `alsima`: phần lợi về tốc độ và chi phí khi đó chủ yếu do dùng model rẻ và đơn giản hơn. Cái đó không chứng minh được harness tốt hơn.

Không ai vào bênh con số 95.8%. Lập luận bão hoà thì có đúng một người bác, và là chính `alsima`: chọn ngẫu nhiên giữa hai model thì không giữ được chất lượng. Nhưng rồi `alsima` tự lùi, nhận là nhầm phiên bản Gemini. Ngoài lần đó ra, không ai bác.

### Khác biệt cơ chế nằm ở đâu, hay chỉ là system prompt khác

Câu hỏi kỹ thuật sắc nhất thread đến từ `yetanotherjosh`, và đáng chú ý là **không người sáng lập nào trả lời nó**. Đáp lại chỉ có một commenter khác.

`yetanotherjosh` soi từng gạch đầu dòng trong bài đăng:

1. **Model routing** là thứ duy nhất hiểu được.
2. **Search có định hướng** thì "chẳng phải chỉ là một system prompt khác hay sao", và sao harness khác lại không làm y vậy được nếu bảo nó làm.
3. **Giữ context sạch**: harness hiện có vốn đã không đọc lại file chưa đổi. Phần đã nằm trong context window là cached token nên không thêm latency đáng kể. Mà bỏ context ra khỏi lịch sử thì lại làm hỏng KV cache.
4. **Turn hiệu quả**, chỗ bài đăng khoe giảm 16% số vòng đi lại và 27% chi phí: chẳng phải đó chỉ là chiến lược sub-agent, cũng làm được bằng prompt hay sao.

Kết lại, `yetanotherjosh` nói thật lòng là không hiểu harness này khác về **cơ chế** ở chỗ nào. Khác tới mức một prompt hay một skill ở harness khác không tái tạo nổi.

`andai` vào đáp, nói rõ không phải tác giả. Kinh nghiệm bên đó ngược lại một nửa. `andai` từng tái tạo được một phần lợi ích của harness tự dựng ngay bên trong Claude, chỉ bằng một MCP riêng cộng vài startup hook. Nhưng vướng đúng một chỗ: phải đánh nhau với system prompt của Claude, thứ bảo model làm mấy việc triệt tiêu gần hết phần lợi kia. Hook khởi động thì đơn giản tới mức buồn cười: `grep def`, sang JavaScript thì thêm `grep function`, `grep class`, `interface`. Nó cho model một cái outline để đỡ mò mù. `andai` cũng tự thừa nhận repo bên đó nhỏ, repo lớn thì cách này đẻ ra một cục to.

### Ai cũng tự dựng harness, vậy harness có bán được không

Ba tài khoản kể chuyện tự dựng harness riêng, và cả ba đều chuộng đồ tự dựng hơn đồ có sẵn.

`lowbloodsugar` hỏi thẳng harness có kiếm ra tiền không. Có harness riêng, thích nó hơn mọi harness khác. Còn bọc tool trong đó thành MCP cho Claude xài, thấy Claude lặp nhanh hẳn lên, nhưng vẫn thích UI tự dựng hơn. Chốt lại là nghi ngờ luôn mô hình kinh doanh. Nếu không làm ở một chỗ kiểu FAANG thì đã đưa nó lên GitHub. Rồi chẳng ai dùng, vì người ta chỉ cần chĩa AI của họ vào đó là clone được. Dựng harness không khó tới vậy.

`japborst` bác lại bằng đúng một nước cờ cũ mà hay: người ta không muốn dựng harness, người ta muốn xong việc. Rồi thả câu kinh điển của Hacker News, "Dropbox thì cũng chỉ là rsync".

`ojr` đứng ở góc khác: harness đang thành tech stack mới, `ojr` cũng dựng một cái, và gu thì khác hẳn. Agent bên đó không chạy trong shell, và **đề xuất** thay đổi file trước chứ không sửa luôn. Tức là prompt → đề xuất → duyệt, còn Bullet theo lối quen thuộc prompt → sửa luôn → revert nếu không ưng. Agent đó dùng vector search kèm grep; theo `ojr`, chỉ dùng grep thì lâu hơn và mỗi task tốn hơn. `ojr` cũng đưa ra một tiêu chuẩn mà `alsima` đồng ý ngay: bằng chứng mạnh nhất cho một cái tool là thứ dựng được **bằng** nó, chứ không phải bản thân cái tool.

### Inference nhanh lên thì harness còn quan trọng không

Hai người, ở hai nhánh khác nhau, cùng bắn một mũi tên. `Terretta` chỉ sang Cerebras chạy Sol ở 750 token mỗi giây. Tới mức đó thì tốc độ harness thành chuyện không đáng bàn, cái đáng bàn là tận dụng kết quả trả về tức thì. `andai` nói cùng ý ở nhánh khác: vài tháng nữa ai quan tâm tốc độ cũng ngồi trên Cerebras, và khi đó harness chậm nhất cũng nhanh hơn harness tự dựng lẫn Bullet. Thử rồi, nhanh tới mức điên rồ.

`alsima` đáp cả hai gần như y nhau, và câu trả lời này là chỗ đáng cân nhắc nhất trong phần đối đáp. Inference nhanh chỉ rút ngắn khâu **sinh chữ**. Theo trải nghiệm bên `alsima`, test, build, search và mấy việc tool khác vẫn chiếm phần lớn thời gian ở nhiều task thật. `alsima` thừa nhận có thể tới lúc harness không còn quan trọng nữa, nhưng đoán Cerebras sẽ rất đắt.

### YC rót tiền cho cái này?

Ba tài khoản chê, hai tài khoản nói lại, không ai đổi ý ai.

`tontinton` mở màn gay gắt nhất: cũng tự dựng một công cụ riêng tên `maki.sh`, nên YC mà ném tiền vào thứ như thế này thì chính `tontinton` cũng gọi vốn được, còn sớm hơn thiên hạ mấy tháng. `Supermancho` nói lý hơn. Không hiểu sao lại có người bỏ tiền cho chuyện "dựng một agent". OpenCode vốn đã cạnh tranh với Codex và Claude, còn project agent mới thì mọc lên rồi chết liên tục, mà chết không phải vì thiếu vốn. `docheinestages` gọn hơn: dạo này YC đầu tư toàn thứ đáng ngờ.

`tomhow` kéo mốc lịch sử ra: năm 2009 người ta cũng nói y hệt về YC, đúng vào lúc Airbnb và Stripe được rót vốn. Triết lý YC xưa nay là đầu tư thật nhiều công ty, chấp nhận không biết trước cái nào sống. Phần lớn chết, mấy cái sống đủ lớn để bù hết chỗ lỗ. `kkotak` chốt lại: đó không riêng gì YC, cả ngành seed đều chạy vậy, rải đạn rồi cầu nguyện.

`alsima` không đôi co chuyện vốn, chỉ trả lời phần nội dung. Đông người làm nghĩa là bài toán đáng làm. Vấn đề chính bên họ là tốc độ, và họ thử OpenCode, Pi cùng vài thứ nữa mà không cái nào giải đúng chỗ đau đó. Câu cuối thẳng thắn tới mức dễ nhớ: nếu có chìm thì cũng là chìm cùng một bài toán họ thật sự quan tâm.

### Màn hình bắt đăng ký, chuyện chia sẻ chat, và cú chặn devtools

Đây là nhánh mở đầu thread, và cũng là nhánh duy nhất trượt dài theo hướng xấu: bốn tài khoản, không một ai bênh.

`apimade` dán vài dòng JavaScript chạy trong console để bỏ qua màn hình onboarding, tức đi thẳng vào app khỏi đăng ký. Kèm theo là cảnh báo đáng chú ý hơn nhiều: tuỳ chọn chia sẻ chat với Bullet, mô tả là để cải thiện routing và chất lượng trả lời, **bật sẵn mặc định**.

`alsima` cảm ơn, rồi thông báo bản mới đã chặn `Cmd+Option+I`, và có thêm thông báo về chuyện chia sẻ chat lúc đăng ký. Đúng câu đó châm ngòi.

`poly2it` trích lại nguyên văn câu chặn devtools rồi phang gọn lỏn một chữ "Bulletproof". `xrisk` nối thêm: đúng là dựng bằng vibe thật. `alsima` đáp lại bằng mặt cười và câu "ngày nào bên mình cũng tối ưu". `davidfiala` nói câu nặng nhất: người ta đang chỉ mẹo cho user chứ có báo bug đâu mà đi gỡ, và nếu có ngụ ý gì thì là gợi ý bỏ bức tường đăng nhập. Giờ chặn luôn inspector thì user báo bug còn khó hơn, trừ phi bug cũng tự động gửi về nốt.

`alsima` trả lời phần này tử tế hơn hẳn: guest mode đang làm cho ai không muốn tạo tài khoản, app có sẵn form gửi phản hồi, và bug không tự động gửi đi.

### Trang landing: chia đôi thật sự

Chỗ này hai phe cân nhau, hai chê hai khen.

`docheinestages` chê trang chủ khó đọc: có chỗ cỡ chữ đúng nghĩa 10px, animation thì kéo mắt người đọc đi. Còn nhắn thẳng YC nên bắt startup trích một phần khoản 500k cho web design tử tế. `KellyCriterion` giơ tay theo, thêm một chi tiết vui: chính lời chê đó là lý do duy nhất khiến `KellyCriterion` bấm vào trang, và trông nó giống thiết kế nhạc techno thập niên 90.

Phía kia, `waingake` nói ngắn: trang nhìn ổn đấy chứ. `japborst` nói thêm là thích đúng kiểu thiết kế này. `alsima` chỉ đáp một câu, sẽ chỉnh.

### Chê thẳng: "không thêm giá trị gì"

Một tài khoản, `esafak`, chê ở tầng định vị sản phẩm chứ không phải tầng chi tiết: thứ này không thêm giá trị gì, cứ OpenCode mà dùng. Hai thứ Bullet đem khoe thì `esafak` không coi là vấn đề. Routing thì OpenCode có sẵn subagent định nghĩa trước, trỏ sang model nào tuỳ ý. Search thì đã có MCP search theo AST và theo embedding, `esafak` đang dùng `codebase-memory-mcp`.

`esafak` muốn thứ khác kia. Xem trực quan độ nét cao, sửa được bằng thao tác kiểu Figma thì càng tốt. Tool use ngon tới mức khỏi phải cầm tay chỉ việc cho model. Tiết kiệm token, tiết kiệm tài nguyên máy.

`alsima` đáp: lý tưởng thì route không nên là việc user tự làm, phải có một lớp route giùm họ. Bên họ tập trung vào quản lý tool và hiệu quả context. Mấy thứ kiểu như `graphify` thì có xem qua, nhưng chưa đánh giá kỹ xem nó tăng tốc được bao nhiêu trên harness bên họ.

### Khen: nhiều, nhưng gần hết là một dòng

Sáu tài khoản khen thẳng, bốn trong số đó viết đúng một dòng, không kèm nội dung kiểm chứng được. `drxcliu` bảo chạy như phép màu. `AlexRisio` bảo cái này chắc sẽ hữu ích. `arthurdls` bảo đây là thứ quan trọng cho tương lai sản phẩm AI native. `myshapeprotocol` nói nhắm vào tốc độ thực thi là nhắm đúng nút thắt. Có cả một câu đùa ăn theo cái tên, `FergusArgyll`: đạn thì xuyên tường chứ sao.

Hai lời khen có nội dung thật đáng đọc hơn hẳn.

`lucasdimarco` nói đã chuyển sang dùng Bullet là chính cho project riêng, tốc độ giúp dựng project mới nhanh và chạy đúng. Cũng khen Adi và Alex cập nhật rất đều theo phản hồi gửi qua tab feedback. Cả thread chỉ có hai báo cáo dùng thật đủ chi tiết, đây là một.

`mattm` là người còn lại, thận trọng hơn, và chính vì thận trọng nên đáng tin. Đang thử trên một project mới, thấy có vẻ nhanh hơn **nhưng chưa bấm giờ so với Claude**. Thích cái browser tích hợp, thấy ngay thay đổi và thấy agent đang làm gì. Cảm ơn vì có bản Linux. `alsima` mách lại: trong app có sẵn một "race lab" để bấm giờ đọ với Claude và Codex.

`karanraina` nằm giữa khen và xin. Đang dùng codex cli, than là bản Linux không có UI. Dùng opencode thay thì lại không hợp với bộ model 5.6 mới của OpenAI, mà Codex thì vừa nhanh vừa tốt hơn. Muốn một GUI chạy được như Codex, và nghĩ Bullet có thể chính là thứ đó. Kèm một lời xin: thêm MCP support.

### Bug và thứ người dùng xin thêm

Phần này ít tranh cãi nhưng là chỗ đọc ra được sản phẩm đang thiếu gì.

- `etchalon` nói một câu đủ để mất một user: agent tự ghi tên nó làm author trong commit, tắt không được, nên chịu, không dùng được. Cái đó phải là tuỳ chọn chứ không phải ép. `alsima` nhận là điểm đúng, và đang sửa.
- `andai` bấm nút Download trên điện thoại Android và bị tải thẳng về một file `.dmg` nặng 200MB. `alsima` xin lỗi: họ chặn tải trên iOS mà quên Android, sẽ sửa; app không thiết kế để chạy trên điện thoại, trừ tính năng điều khiển từ xa.
- `retropragma` hỏi harness có hỗ trợ ACP không. `alsima`: hiện chưa, Bullet dùng harness nội bộ riêng cùng phần tích hợp CLI, tương lai thì có thể làm.
- `0kk33` hỏi hỗ trợ nhà cung cấp model nào, có gọi thẳng claude-code CLI để dùng chung subscription Anthropic không, theo kiểu `orca` hay `herdr` vẫn làm. `adi1`: hỗ trợ OpenCode, Codex, Grok, Claude, qua cả subscription lẫn API key.
- `exe34` hỏi chạy trong Docker được không và có cắm được endpoint OpenAI tuỳ ý không. `alsima`: bản CLI chạy được trong Docker, bản desktop thì không thiết kế để chạy trong đó; endpoint nào theo chuẩn OpenAI qua HTTPS đều cắm được, kể cả base URL và model ID tự đặt.
- `japborst` góp một ý về cách trình bày: nên nói rõ hơn là thứ này không đòi thêm subscription nào, và nó chỉ là harness chứ không phải thêm một model.
- `throw03172019` trích lại đoạn bài đăng kể Bullet từng là quỹ đầu cơ AI. Rồi agent điều khiển browser, rồi dữ liệu tài chính tổng hợp, rồi IDE cho mobile, rồi vài thứ nữa. Rồi hỏi thẳng: liệu còn cú pivot tiếp theo không, vì chuyện đó làm `throw03172019` ngại. `alsima` đáp không, vì họ làm cái này cho chính họ dùng. `throw03172019` cảm ơn và nói sẽ thử.
- `hmokiguess` bắt được một chi tiết vui mà cũng hơi cay: đoạn code bí mật giấu ở footer thì gọi là giấu sao được, khi AI viết trang đánh dấu luôn cho nó cái `aria-label="Hidden secret code"`.

### Người sáng lập nói gì

Tách riêng phần này, vì lời người làm ra sản phẩm không cùng trọng lượng với bình luận của người ngoài.

Hai người sáng lập có mặt dày đặc: `alsima` (Alex) 23 comment và `adi1` (Adi) 5 comment, cộng lại 28 trên tổng 73. Họ trả lời gần như mọi nhánh, nhanh và lịch sự, kể cả mấy nhánh nói nặng. Bốn comment gốc họ để trôi: `yetanotherjosh`, `lowbloodsugar`, ý `japborst` góp về subscription, và câu đùa của `FergusArgyll`. Trừ câu đùa thì ba cái kia đều có nội dung, và nặng nhất là câu hỏi cơ chế của `yetanotherjosh`.

Những gì họ nhận và hứa, gom lại:

- Benchmark chạy **không kèm router**; router chỉ có trong bản chạy thật. Bài đăng viết chưa rõ chỗ này, họ nói sẽ cố diễn đạt lại cho rõ hơn.
- Con số 95.8% trên một benchmark đã chín không phải bằng chứng chính. Họ đang chạy Terminal-Bench, CursorBench, SlopCodeBench và sẽ công bố sau.
- Guest mode đang làm; bug gửi qua form trong app và không tự động gửi đi.
- Ưu tiên hiện tại là hỗ trợ MCP và giữ nguyên phần skill.
- Chuyện agent tự ghi tên vào author của commit thì đang sửa.
- Sẽ chặn nút tải trên Android.
- Chưa hỗ trợ ACP.
- Về Cerebras: inference nhanh chỉ rút ngắn khâu sinh chữ, còn theo trải nghiệm bên họ thì phần tool vẫn chiếm nhiều thời gian; và họ đoán Cerebras sẽ rất đắt.
- Bullet lấy cảm hứng nhiều từ mini-swe-agent.
- Không có cú pivot nào nữa.
- Trang landing sẽ chỉnh.

Còn một câu trả lời của họ thì phản tác dụng thấy rõ, và nó đáng nhớ hơn cả phần còn lại. Có người chỉ cách bỏ qua màn hình đăng ký, phản xạ đầu tiên là **chặn phím mở devtools**. Ba người vào chế ngay sau đó. Cái giá phải trả không nằm ở chỗ mất một mẹo vặt, mà ở chỗ người dùng còn cần devtools để báo bug.
