# Vì sao `/learn` được thiết kế như vậy

Ghi lại nguồn cho từng luật trong SKILL.md, để sau này sửa skill thì biết luật nào đang
chống lại vấn đề gì, và luật nào chỉ là sở thích.

Nghiên cứu được tra ngày 2026-08-10.

---

## Vấn đề: vì sao học cùng AI dễ thấy trôi chảy mà không đọng lại

### Fluency illusion

Nội dung do AI sinh ra rất mượt. Não xử lý nó dễ, rồi **nhầm "dễ đọc" thành "đã hiểu"** —
gọi là fluency heuristic. Tác dụng phụ nguy hiểm: câu trả lời trôi chảy **xoá mất tín hiệu
khó**, mà tín hiệu khó chính là thứ bình thường kích hoạt việc tự kiểm tra
(metacognitive monitoring).

### Metacognitive laziness

Fan et al., *British Journal of Educational Technology* (2025) — **đã qua bình duyệt**.
Vòng lặp: muốn nhanh → AI trả lời trôi chảy → ảo giác đã hiểu → thôi tự kiểm tra → càng
giao phó nhiều hơn.

Kết luận đáng giá nhất là **performance–learning paradox**: dùng AI làm *kết quả trước mắt
tốt lên*, trong khi *kiến thức đọng lại dài hạn kém đi*. Hai chỉ số đi ngược nhau — nên
"buổi học trôi chảy" không hề là bằng chứng của việc học được.

- https://bera-journals.onlinelibrary.wiley.com/doi/10.1111/bjet.13544
- https://arxiv.org/abs/2412.09315

### Cognitive debt

MIT Media Lab, *Your Brain on ChatGPT* — 54 sinh viên, đo EEG khi viết luận. Nhóm dùng LLM
có kết nối não yếu nhất, **không trích lại nổi bài mình vừa viết**, và tự đánh giá bài đó
ít thuộc về mình nhất. Theo dõi 4 tháng, nhóm LLM kém hơn ở cả ba mặt: thần kinh, ngôn ngữ,
hành vi.

⚠️ **Preprint, chưa bình duyệt, n=54, chỉ đo tác vụ viết luận.** Không phải chân lý — nhưng
khớp hướng với paper BJET ở trên, nên vẫn đáng dùng làm cảnh báo.

- https://arxiv.org/abs/2506.08872
- https://www.media.mit.edu/projects/your-brain-on-chatgpt/overview/

→ **Sinh ra Rule 2 (fluency là kẻ địch), ANTI-FLUENCY, và Phase 4 (người học tự viết tổng kết).**

---

## Cái gì có tác dụng

### Retrieval practice + spaced repetition + personalization

arXiv 2309.13060 — dựng AI tutor cho một khoá học thật, cài đúng ba nguyên tắc:
personalization, **distributed** retrieval practice, spaced repetition. Sinh viên tương tác
chủ động hơn tới **15 percentile** so với lớp không có tutor. Chữ *distributed* là điểm mấu
chốt: kiểm tra **rải theo thời gian**, không phải hỏi dồn cuối buổi.

- https://arxiv.org/abs/2309.13060

→ **Sinh ra Phase 1 (REVIEW mở đầu mọi buổi) và toàn bộ cơ chế cards.**

### Đo bằng chuyển giao, không phải bằng nhớ lại

Google LearnLM (Gemini fine-tune cho việc dạy). Chỉ số họ công bố không phải "nhớ được bài
vừa học" mà là: sinh viên được LearnLM kèm có xác suất giải được **bài toán mới ở chủ đề
sau** cao hơn **5.5 điểm phần trăm**.

Nguyên tắc họ dùng: active learning · scaffolding · personalization · retrieval practice ·
spaced repetition · worked examples · **productive struggle (gợi ý chứ không đưa lời giải)**.

⚠️ Bản PDF prompt guide của Google trích xuất không trọn vẹn — danh sách nguyên tắc trên
lấy từ phần đọc được và từ mô tả công khai, không phải trích nguyên văn toàn bộ.

- https://cloud.google.com/solutions/learnlm
- https://services.google.com/fh/files/misc/learnlm_prompt_guide.pdf

→ **Sinh ra level 3 = "áp được vào ca chưa từng gặp", và luật hints-not-solutions.**

### Teach-back + thang ôn 3/7/14/30/90

Một người tự dựng AI tutor trên Claude, viết lại thiết kế. Vòng lặp:
`explain → example → check understanding → evaluate → practice → review`.
Luật cứng: *"AI giải thích, rồi bắt bạn giải thích lại. Nếu bạn không giải thích được, nó
biết bạn chưa học được."* Prerequisite là cổng bắt buộc. Lịch ôn tăng dần
**3 → 7 → 14 → 30 → 90 ngày**.

- https://robotsatemyhomework.substack.com/p/the-ai-tutor-i-built-in-claude-that

→ **Sinh ra understanding gate và thang ladder trong cards.**

### Conversational spaced repetition

David Bieber: đừng ép kiến thức thành thẻ hai mặt cứng nhắc. Lưu **đơn vị kiến thức + con
trỏ về đúng đoạn hội thoại đã học nó**, để LLM hỏi lại linh hoạt nhiều kiểu. Lợi thế so với
Anki: người học được trả lời nửa vời, lưỡng lự, hoặc hỏi ngược — tín hiệu giàu hơn nhiều so
với đúng/sai nhị phân.

- https://davidbieber.com/snippets/2024-03-04-conversational-spaced-repetition/

→ **Sinh ra format card (`concept` + `neo` + `note`) thay vì Q/A hai mặt.**

### Tiền lệ triển khai trong Claude Code

learn-faster-kit — thư mục `.learning/`, ba lệnh `/learn` `/review` `/progress`, một
`review_scheduler.py` riêng, teach-back bắt buộc trước khi chủ đề được lên lịch ôn.

- https://github.com/hluaguo/learn-faster-kit

→ **Xác nhận kiến trúc file-state là đúng hướng; mình làm cùng việc đó không cần script.**

---

## Cái phải tránh

### Người học cầm lái

Phê bình ChatGPT Study Mode. Lỗ hổng gốc: **"the student is still in the driver's seat."**
Tác giả bám vào một ý sai lệch và con tutor *"hào hứng cổ vũ tôi và xây tiếp lên cái
'insight' đó"*, mãi sau mới nhận ra nó chẳng liên quan bài học. Với bài khó, LLM *"cổ vũ
luôn cả lỗi sai và cuối cùng rối tung cùng với học viên"*.

- https://www.moderndescartes.com/essays/study_mode/

→ **Sinh ra toàn bộ mục ANTI-SYCOPHANCY.**

### Roadmap không phải là chỗ thiếu

Đã kiểm các repo roadmap SEO phổ biến trên GitHub (`devrahmanbd/seo-roadmap`, các
`awesome-seo`). Nhận xét sau khi đọc: *"lacks hands-on tasks, tracking sections, and
interactive checklists... topic lists without implementation guidance. No progress-tracking
mechanisms."* Tức là chúng **kém hơn** file tiến độ mình đang có.

Ngược lại, [learningseo.io](https://learningseo.io/) (Aleyda Solis) — roadmap SEO miễn phí
được coi là chuẩn ngành — có hai thứ đáng mượn: **"Keep up with SEO News" là một stage
thường trực** (đọc người trong nghề là phần của việc học, không phải việc thêm), và
**"Execute an SEO Process" nằm ngay stage 2**, không phải sau mười lăm buổi lý thuyết.

→ **Sinh ra PLAN mode mục 3 (keep-up track) và mục 4 (đưa execution lên sớm).**

---

## Bằng chứng từ chính lịch sử dùng skill này

Bốn buổi SEO đầu (2026-06-24 → 2026-07-27), soi lại thấy đúng mọi failure mode ở trên:

- Buổi 2 dạy 4 loại search intent ngày 10/07 — tới 10/08 **chưa hỏi lại lần nào**.
- Hai câu kiểm tra treo từ 12/07 tới 27/07 mới chữa — không có gì chặn việc đi tiếp.
- 3/4 buổi mở màn bằng audit site, ăn mất nửa thời lượng dạy.
- File tiến độ 460 dòng, ~40 thuật ngữ tiếng Anh, **không có chỗ nào tra ngược được**.
- Một quan sát cá nhân N=1 của người học đã được dựng thành hẳn một buổi trong lộ trình.

Người học tự mô tả kết quả: *"cảm giác kiến thức hơi ít"*, *"chưa thực sự hiệu quả"* —
đúng triệu chứng của fluency illusion cộng với zero retrieval.
