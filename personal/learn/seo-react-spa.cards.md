---
topic: SEO toàn diện — áp dụng tienvu-bt, hướng nghề SEO
ladder: [3, 7, 14, 30, 90]
created: 2026-08-10
---

# Thẻ kiến thức — SEO

Rút từ 4 buổi đã dạy (24/06 → 27/07) + phần Buổi 9 dạy dở ngày 10/08.

**Mọi thẻ đang ở `level: 0` vì chưa từng được kiểm lại lần nào** — không phải kết luận là
đã quên, mà là **chưa có dữ liệu**. Vài buổi REVIEW đầu là để hiệu chỉnh: hỏi ra mức thật
rồi mới xếp lịch ôn đúng.

`next_review` được rải sẵn để mỗi buổi không quá 5 thẻ. Thẻ nền tảng (Buổi 1-2) đến trước.

Quy tắc chấm: 0 quên · 1 lơ mơ · 2 tự giải thích lại được · 3 áp được vào ca chưa từng gặp.
Đạt (≥2) → `streak+1`, hẹn theo ladder. Trượt (≤1) → `streak=0`, hẹn lại buổi kế tiếp.

---

## Buổi 1 — Search engine hoạt động thế nào

- id: 3-phase-search
  concept: Google chạy 3 phase — Crawling (tải HTML thô) → Indexing (phân tích, gộp trùng) → Serving/Ranking (khớp query, xếp hạng). Mỗi phase có thể chặn riêng.
  neo: buổi 1 — curl tienvu-bt local, xác nhận trang chủ SSR có content ngay ở phase Crawl
  level: 0
  streak: 0
  taught: 2026-07-09
  last_tested: null
  next_review: 2026-08-11

- id: two-wave-rendering
  concept: Trang cần JS mới ra content phải qua hàng đợi Render (headless Chromium, không tức thời) rồi mới được index. SSR/SSG nhét sẵn content vào response đầu nên Google thấy ngay ở bước Crawl.
  neo: buổi 1 — `getServerSideProps` của tienvu-bt khiến curl thuần đã thấy title + h1
  level: 0
  streak: 0
  taught: 2026-07-09
  last_tested: null
  next_review: 2026-08-11

- id: soft-404
  concept: Soft 404 = route động trả HTTP 200 dù không có data thật. Khác 404 thật ở chỗ Google vẫn coi là trang hợp lệ và đem đi index.
  neo: buổi 1 — `[slug].js` trả `{ notFound: true }` → Next.js set 404 thật, tienvu-bt KHÔNG dính
  level: 0
  streak: 0
  taught: 2026-07-09
  last_tested: null
  next_review: 2026-08-11

## Buổi 2 — Keyword & search intent

- id: keyword-la-tin-hieu-intent
  concept: Keyword không phải chỉ là một cụm từ, nó là tín hiệu ý định. Chính modifier word mới mang tín hiệu intent, không phải từ gốc.
  neo: buổi 2 — "băng tải cao su" vs "băng tải cao su cho mỏ đá" vs "...uy tín"
  level: 0
  streak: 0
  taught: 2026-07-10
  last_tested: null
  next_review: 2026-08-11

- id: 4-loai-search-intent
  concept: Bốn loại — Informational, Navigational, Commercial investigation, Transactional.
  neo: buổi 2 — bài tập tự phân loại 3 keyword thật của tienvu-bt
  level: 0
  streak: 0
  taught: 2026-07-10
  last_tested: null
  next_review: 2026-08-11

- id: b2b-funnel-ket-thuc-ngoai-search
  concept: Funnel B2B dài hơn B2C và kết thúc bằng LIÊN HỆ TRỰC TIẾP, không phải bằng một query transactional. Nên không có "keyword transactional" để nhắm.
  neo: buổi 2 — user tự suy ra đúng khi đặt mình vào vai khách mỏ đá
  level: 0
  streak: 0
  taught: 2026-07-10
  last_tested: null
  next_review: 2026-08-11

- id: ctr-theo-vi-tri
  concept: Top 3 kết quả organic chiếm khoảng 68.7% tổng click; vị trí 2 khoảng 12-18%; qua trang 2 gần như không ai thấy.
  neo: buổi 2 — số dùng để chốt "lớp 1 ranking là bắt buộc"
  level: 0
  streak: 0
  taught: 2026-07-10
  last_tested: null
  next_review: 2026-08-14

- id: 2-lop-ranking-va-trust
  concept: Lớp 1 = ranking (đưa mình lên bảng — bắt buộc). Lớp 2 = trust, quyết định khách chọn ai GIỮA CÁC SITE ĐÃ THẤY. Lớp 2 chỉ có tác dụng sau lớp 1, không thay thế được.
  neo: buổi 2 — chốt lại sau khi user push back về vai trò của social presence
  level: 0
  streak: 0
  taught: 2026-07-10
  last_tested: null
  next_review: 2026-08-14

- id: ai-overview-an-ctr
  concept: Khi SERP có AI Overview, CTR vị trí #1 giảm rất mạnh (Ahrefs 2/2026: tương quan ~58%). Ngành đang gọi mảng tối ưu cho nó là AEO, song song SEO cổ điển.
  neo: buổi 2 — ghi chú xu hướng 2026
  level: 0
  streak: 0
  taught: 2026-07-10
  last_tested: null
  next_review: 2026-08-14

## Buổi 3 — Topic cluster & E-E-A-T

- id: hub-and-spoke
  concept: Pillar phủ RỘNG một topic, spoke đào SÂU một subtopic. Một cluster = một topic, không trộn.
  neo: buổi 3 — cluster /bang-tai-cao-su, /con-lan, /vat-tu-mo của tienvu-bt
  level: 0
  streak: 0
  taught: 2026-07-11
  last_tested: null
  next_review: 2026-08-14

- id: 3-luat-internal-link-cluster
  concept: (1) pillar→spoke: anchor mô tả, trong body, xuất hiện sớm. (2) spoke→pillar: gần đầu bài. (3) spoke↔spoke khi liên quan.
  neo: buổi 3 — bài 3 (downtime) làm cầu nối link cả 3 pillar
  level: 0
  streak: 0
  taught: 2026-07-11
  last_tested: null
  next_review: 2026-08-14

- id: pillar-test
  concept: Cách chống chọn nhầm pillar — hỏi: người search head query mà đáp xuống trang này thì có được trả lời không? Không thì nó không phải pillar.
  neo: buổi 3 — /construction rớt test, vai đúng của nó là kho bằng chứng Experience
  level: 0
  streak: 0
  taught: 2026-07-11
  last_tested: null
  next_review: 2026-08-14

- id: commercial-vs-guide-pillar
  concept: Chọn kiểu pillar theo intent của head query. Head query thiên commercial thì pillar vừa bán vừa dạy.
  neo: buổi 3 — "băng tải cao su" thiên commercial
  level: 0
  streak: 0
  taught: 2026-07-11
  last_tested: null
  next_review: 2026-08-17

- id: eeat-trust-la-tru-cot
  concept: Trong E-E-A-T, Trust quan trọng nhất — không cần đủ 4 chân đều nhau. Framework Who/How/Why.
  neo: buổi 3 — policies live sai tên pháp lý công ty = lỗ rò Trust thật
  level: 0
  streak: 0
  taught: 2026-07-11
  last_tested: null
  next_review: 2026-08-17

- id: ai-content-va-spam-policy
  concept: AI content tạo ra CHỦ YẾU ĐỂ XẾP HẠNG = vi phạm spam policy. AI hỗ trợ + người kiểm + disclose = được.
  neo: buổi 3
  level: 0
  streak: 0
  taught: 2026-07-11
  last_tested: null
  next_review: 2026-08-17

## Buổi 4 — On-page

- id: title-vs-h1
  concept: Title = biển hiệu ngoài đường (ở SERP, cần brand, ≤60 ký tự, cạnh tranh với 9 kết quả khác). H1 = câu chào khi khách đã vào (không cần brand, được dài hơn). KHÔNG copy title xuống làm H1.
  neo: buổi 4 — user mắc đúng lỗi này, đã chữa bằng bảng so sánh vai trò
  level: 0
  streak: 0
  taught: 2026-07-27
  last_tested: null
  next_review: 2026-08-17
  note: khái niệm này chưa vững ở buổi 12/07, phải dạy lại ngày 27/07 — ưu tiên kiểm kỹ

- id: front-load-keyword
  concept: Front-load ≠ luôn để tên sản phẩm lên đầu. Nghĩa là để lên đầu cái từ mà người tìm ĐÚNG TRANG NÀY sẽ gõ.
  neo: buổi 4 — /about là trang duy nhất brand đứng đầu, vì keyword của nó chính là tên công ty
  level: 0
  streak: 0
  taught: 2026-07-27
  last_tested: null
  next_review: 2026-08-17

- id: meta-desc-khong-phai-ranking-factor
  concept: Meta description không phải yếu tố xếp hạng — nó ảnh hưởng CTR. "Ranking đưa lên bảng, snippet giành click."
  neo: buổi 4 — câu check hiểu số 2, user trả lời đúng ngày 27/07
  level: 0
  streak: 0
  taught: 2026-07-12
  last_tested: null
  next_review: 2026-08-17

- id: google-viet-lai-title
  concept: Google viết lại title khi nó quá dài, nhồi keyword, boilerplate, hoặc lệch nội dung trang.
  neo: buổi 4
  level: 0
  streak: 0
  taught: 2026-07-12
  last_tested: null
  next_review: 2026-08-20

- id: semantic-seo-tu-vung-nganh
  concept: Quên mật độ keyword đi. Keyword đặt ở vị trí trọng yếu vì nội dung cần; phần còn lại dùng TỪ VỰNG NGÀNH thật — chính từ vựng ngành mới chứng minh expertise.
  neo: buổi 4 — lớp bố, lưu hóa, độ mài mòn
  level: 0
  streak: 0
  taught: 2026-07-12
  last_tested: null
  next_review: 2026-08-20

- id: heading-hierarchy-vai-tro
  concept: Thứ tự heading không ảnh hưởng ranking (doc Google 12/2025). Nó phục vụ người đọc và giúp máy hiểu cấu trúc. H2 dạng câu hỏi + đoạn trả lời gọn ngay dưới thì dễ được trích featured snippet / AI Overview.
  neo: buổi 4
  level: 0
  streak: 0
  taught: 2026-07-12
  last_tested: null
  next_review: 2026-08-20

- id: khong-bia-claim-trong-title
  concept: Title là lời hứa. Hứa một con số không kiểm chứng được trên trang là tự đào hố E-E-A-T.
  neo: buổi 4 — định thêm "từ 2009" vào title /about, curl kiểm thấy site không ghi năm thành lập ở đâu → bỏ
  level: 0
  streak: 0
  taught: 2026-07-27
  last_tested: null
  next_review: 2026-08-20

## Buổi 9 — Sitemap & robots (dạy dở 10/08, CHƯA qua cổng hiểu)

⚠️ Năm thẻ dưới đây được giảng ngày 10/08 nhưng buổi bị ngắt giữa chừng, **chưa hỏi kiểm
lần nào**. Ưu tiên kiểm ngay buổi tới trước khi dạy tiếp phần còn lại của Buổi 9.

- id: 4-cong-cu-2-tang
  concept: robots.txt và sitemap tác động ở tầng CRAWL; noindex và canonical tác động ở tầng INDEX. Bốn thứ nói bốn câu khác nhau, không thay thế nhau được.
  neo: buổi 9 — bảng 4 công cụ
  level: 0
  streak: 0
  taught: 2026-08-10
  last_tested: null
  next_review: 2026-08-11

- id: disallow-khong-chan-index
  concept: Disallow trong robots.txt KHÔNG giấu được trang khỏi Google — URL vẫn có thể lên kết quả nếu có site khác link tới. Muốn chặn hiển thị phải dùng noindex. Và Disallow + noindex cùng lúc thì noindex vô hiệu, vì Google không tải trang nên không đọc được thẻ đó.
  neo: buổi 9 — câu hỏi kiểm số 1, chưa trả lời
  level: 0
  streak: 0
  taught: 2026-08-10
  last_tested: null
  next_review: 2026-08-11

- id: robots-txt-vi-tri-va-pham-vi
  concept: robots.txt phải nằm ở gốc host. Phạm vi bó theo protocol + host + port — file ở https://a.com/robots.txt không áp cho http://a.com hay https://m.a.com.
  neo: buổi 9
  level: 0
  streak: 0
  taught: 2026-08-10
  last_tested: null
  next_review: 2026-08-13

- id: url-tuyet-doi-bat-buoc
  concept: Mọi thứ khai với Google mà trỏ ra ngoài trang hiện tại đều phải là URL tuyệt đối — Google không tự đoán http/https/www.
  neo: buổi 9 — cùng một luật gây ra 2 bug trên tienvu-bt: sitemap directive và hreflang render URL tương đối ở ThemeLayout.js:33
  level: 0
  streak: 0
  taught: 2026-08-10
  last_tested: null
  next_review: 2026-08-13

- id: sitemap-la-goi-y
  concept: Sitemap không đảm bảo được crawl hay index. Cần nó khi site mới / ít external link / internal link chưa phủ hết trang quan trọng.
  neo: buổi 9 — homepage tienvu-bt không link tới product nào, /blog trống → 10 trang product là ốc đảo
  level: 0
  streak: 0
  taught: 2026-08-10
  last_tested: null
  next_review: 2026-08-13
