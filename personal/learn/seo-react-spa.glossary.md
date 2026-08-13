---
topic: SEO toàn diện — áp dụng tienvu-bt
created: 2026-08-10
---

# Từ điển SEO — tra ngược

Mọi thuật ngữ đã dùng trong 4 buổi đầu + Buổi 9. Bốn dòng cố định mỗi mục:
**Là gì · Ví von · Trên site anh · Nguồn**.

Dòng "Trên site anh" là dòng quan trọng nhất — thuật ngữ neo vào hệ thống của chính mình
thì nhớ được, định nghĩa trừu tượng thì không.

---

## Google hoạt động thế nào

### Crawling
**Là gì:** bước Google tải file HTML thô của một URL về.
**Ví von:** người đưa thư đi lấy phong bì, chưa bóc ra đọc.
**Trên site anh:** `curl` thuần chính là mô phỏng bước này — thứ curl thấy là thứ Googlebot thấy ở phase 1.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/seo-starter-guide

### Indexing
**Là gì:** bước phân tích nội dung đã tải, gộp các URL trùng, rồi quyết định có đưa vào kho hay không.
**Ví von:** thủ thư bóc phong bì, đọc, rồi quyết định có xếp lên kệ không.
**Trên site anh:** đã Request indexing 7 trang ngày 12/07 nhưng `site:tienvujsc.com.vn` vẫn trắng — nghĩa là kẹt ở đúng bước này, không phải bước crawl.
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview

### Serving / Ranking
**Là gì:** bước khớp query của người dùng với kho đã index, rồi xếp thứ tự.
**Ví von:** thủ thư nghe khách hỏi rồi chọn ra mấy cuốn đưa lên bàn, cuốn hợp nhất để trên cùng.
**Trên site anh:** chưa tới lượt — chưa vào được kho thì không có gì để xếp hạng.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/seo-starter-guide

### Rendering (two-wave indexing)
**Là gì:** với trang cần JS mới ra nội dung, Google phải xếp hàng chạy headless Chromium rồi mới index được. Không tức thời, có thể chậm.
**Ví von:** thư viết bằng mực tàng hình — thủ thư phải xếp hàng chờ máy hơ nóng mới đọc được.
**Trên site anh:** tienvu-bt dùng `getServerSideProps` nên nội dung có sẵn trong HTML thô — **không phải đợi hàng này**. Đây là lợi thế sẵn có.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/seo-starter-guide

### Googlebot
**Là gì:** tên con bot của Google đi crawl.
**Ví von:** chính là anh đưa thư ở trên.
**Trên site anh:** chưa có `robots.txt` nên hiện Googlebot không bị chặn gì — vấn đề là nó không có đường vào, chứ không phải bị cấm.
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/robots/intro

### Crawl budget
**Là gì:** lượng tài nguyên Google chịu bỏ ra để crawl một site. Trang nặng và trang rác tiêu vào đó.
**Ví von:** anh đưa thư mỗi ngày chỉ đi được ngần ấy nhà — nhà nào bắt chờ lâu thì nhà khác bị bỏ.
**Trên site anh:** `/products` nặng 283KB HTML, riêng `__NEXT_DATA__` chiếm 215KB (76%) — payload lặp lại nội dung đã render.
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget

### Soft 404
**Là gì:** trang không có nội dung thật nhưng vẫn trả HTTP 200, nên Google tưởng là trang hợp lệ.
**Ví von:** cửa hàng đóng cửa nhưng biển vẫn ghi "đang mở".
**Trên site anh:** KHÔNG dính — `[slug].js` trả `{ notFound: true }` nên Next.js set 404 thật (đã test bằng slug rác ở Buổi 1).
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/block-indexing

---

## Bốn công cụ điều khiển Google

### robots.txt
**Là gì:** file ở gốc host, nói với crawler được TẢI những đường nào. Tác động ở tầng crawl.
**Ví von:** tấm biển ở cổng: "khu này mời vào, khu kia đừng vào".
**Trên site anh:** đang **404** — chưa có file nào.
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/robots/intro

### Disallow
**Là gì:** luật trong robots.txt cấm crawler TẢI một đường. **Không** giấu được trang khỏi kết quả tìm kiếm.
**Ví von:** cấm anh đưa thư vào nhà — nhưng địa chỉ nhà anh vẫn nằm trong danh bạ.
**Trên site anh:** sẽ cần cho `/login`, `/register`, `/account`, `/profile` — nhưng phải hiểu đúng: muốn chúng biến khỏi Google thì phải dùng `noindex`, không phải Disallow.
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt

### sitemap.xml
**Là gì:** danh sách URL mình muốn Google biết. Là lời mời, **không** đảm bảo được crawl hay index.
**Ví von:** đưa anh đưa thư một tờ danh sách nhà trong ngõ — đi hay không là việc của anh ấy.
**Trên site anh:** đang **404**. Và vì homepage không link tới product/blog nào, sitemap đang là con đường DUY NHẤT để Google biết 10 trang product tồn tại.
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview

### noindex
**Là gì:** thẻ meta hoặc HTTP header ra lệnh: tải thì cứ tải, nhưng đừng đưa lên kết quả. Tác động ở tầng index.
**Ví von:** thủ thư đọc xong rồi cất vào kho riêng, không xếp lên kệ cho khách thấy.
**Trên site anh:** không có `noindex` nào đang chặn (đã kiểm Buổi 12/07) — nên việc chưa index KHÔNG phải do cái này.
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/block-indexing

### canonical
**Là gì:** thẻ khai với Google "mấy URL này là một trang, bản chính là cái này". Là gợi ý, Google có quyền bỏ qua.
**Ví von:** bảo bưu tá "nhà tôi có 3 lối vào, cứ giao ở cửa chính".
**Trên site anh:** **10 trang product đang khai bản chính ở `https://tienvu-bt.com/...` — domain không tồn tại (NXDOMAIN).** Nghi phạm số 1 của việc site không index.
**Nguồn:** https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls

### hreflang
**Là gì:** thẻ ghép cặp các bản ngôn ngữ của cùng một trang, để Google trả đúng bản cho đúng người.
**Ví von:** dán nhãn "bản tiếng Việt / bản tiếng Anh của cùng cuốn sách này".
**Trên site anh:** thẻ CÓ, nhưng `ThemeLayout.js:33` fallback `|| ''` khiến nó render URL **tương đối** (`href="/"`) → Google bỏ qua toàn bộ, vi/en không ghép cặp được.
**Nguồn:** https://developers.google.com/search/docs/specialty/international/localized-versions

---

## Trang kết quả tìm kiếm

### SERP
**Là gì:** Search Engine Results Page — trang kết quả người dùng nhìn thấy.
**Ví von:** cái bàn thủ thư bày sách ra cho khách chọn.
**Trên site anh:** vế 1 mục tiêu của anh — search "công ty cổ phần Tiến Vũ" thì site phải nằm trên SERP đó.
**Nguồn:** https://developers.google.com/search/docs/appearance/title-link

### Impressions
**Là gì:** số lần trang mình xuất hiện trên SERP của ai đó, dù họ có bấm hay không.
**Ví von:** số lần sách mình được bày lên bàn.
**Trên site anh:** chỉ số này trong GSC → Hiệu suất; hiện gần như chắc chắn bằng 0 vì chưa index.
**Nguồn:** https://developers.google.com/search/docs/monitor-debug/search-console-start

### CTR (click-through rate)
**Là gì:** tỉ lệ người thấy rồi bấm vào = clicks ÷ impressions.
**Ví von:** trong 100 người nhìn thấy sách trên bàn thì mấy người cầm lên.
**Trên site anh:** top 3 organic chiếm ~68.7% tổng click — nên chênh một vị trí là chênh rất nhiều khách.
**Nguồn:** https://developers.google.com/search/docs/monitor-debug/search-console-start

### Title link
**Là gì:** dòng chữ xanh bấm được trên SERP. Google lấy từ thẻ `<title>` nhưng có quyền viết lại.
**Ví von:** biển hiệu ngoài đường.
**Trên site anh:** 6 trang đang có title trơ trọi — "Sản phẩm", "Dịch vụ", "Liên hệ", "Tin tức", "Giới thiệu", "Công trình". Bảng thay thế đã chốt 27/07 nhưng chưa áp.
**Nguồn:** https://developers.google.com/search/docs/appearance/title-link

### Snippet / meta description
**Là gì:** đoạn mô tả dưới title link. **Không phải yếu tố xếp hạng** — nó ảnh hưởng CTR. Google hay thay bằng đoạn trích khớp query hơn.
**Ví von:** dòng tóm tắt sau bìa sách.
**Trên site anh:** `/products` description còn stale nghề cũ (vòng bi, dây curoa).
**Nguồn:** https://developers.google.com/search/docs/appearance/snippet

### Featured snippet
**Là gì:** ô trả lời Google trích thẳng lên đầu SERP.
**Ví von:** thủ thư đọc luôn đoạn cần cho khách nghe, khỏi mở sách.
**Trên site anh:** cách nhắm — viết H2 đúng dạng câu hỏi khách gõ, rồi trả lời gọn ngay dưới.
**Nguồn:** https://developers.google.com/search/docs/appearance/featured-snippets

### AI Overview
**Là gì:** đoạn AI tóm tắt Google chèn lên đầu SERP, có trích nguồn.
**Ví von:** thủ thư tự tóm tắt cho khách nghe thay vì đưa sách.
**Trên site anh:** ảnh hưởng thật — theo Ahrefs 2/2026, SERP có AI Overview thì CTR vị trí #1 giảm tương quan ~58%.
**Nguồn:** https://developers.google.com/search/docs/appearance/featured-snippets

### AEO (Answer Engine Optimization)
**Là gì:** tên ngành đang dùng cho việc tối ưu để được AI Overview / chatbot trích dẫn, song song SEO cổ điển.
**Ví von:** thay vì giành chỗ trên kệ, giành chỗ trong câu trả lời của thủ thư.
**Trên site anh:** cấu trúc cluster + entity rõ ràng phục vụ cả hai — không phải làm hai việc riêng.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/creating-helpful-content

---

## Từ khoá & nội dung

### Search intent
**Là gì:** ý định thật đằng sau một query. Bốn loại: Informational, Navigational, Commercial investigation, Transactional.
**Ví von:** cùng câu "băng tải cao su" nhưng người hỏi có thể đang học nghề, đang tìm nhà cung cấp, hay đang định đặt hàng.
**Trên site anh:** modifier mới mang tín hiệu — "băng tải cao su" (mơ hồ) vs "...cho mỏ đá" (đã lùi về commercial) vs "...uy tín" (commercial investigation rõ).
**Nguồn:** https://www.semrush.com/blog/search-intent/

### Head query / long-tail
**Là gì:** head = query ngắn, lượng tìm lớn, khó. Long-tail = query dài, cụ thể, ít người tìm nhưng dễ và đúng khách hơn.
**Ví von:** "quán ăn" vs "quán bún chả gần Gia Lâm mở sau 9h tối".
**Trên site anh:** head = "băng tải cao su" (mục tiêu quý). Long-tail = "băng tải cao su chịu mài mòn cho trạm nghiền sàng".
**Nguồn:** https://www.semrush.com/blog/search-intent/

### Topic cluster (pillar / spoke)
**Là gì:** một pillar phủ rộng cả topic, nhiều spoke đào sâu từng subtopic, link qua lại với nhau.
**Ví von:** một cuốn tổng quan cộng với các chuyên khảo, cùng nằm một kệ và cùng chỉ về nhau.
**Trên site anh:** 3 cluster đã chốt — `/bang-tai-cao-su`, `/con-lan`, `/vat-tu-mo`. Hiện **chưa có spoke nào live**, `/blog` trống 0 bài.
**Nguồn:** https://searchengineland.com/guide/topic-clusters

### Anchor text
**Là gì:** chữ hiển thị của một link.
**Ví von:** dòng chữ trên biển chỉ đường, không phải mũi tên.
**Trên site anh:** luật đã học — anchor phải nói rõ trang đích đưa tới đâu, và đa dạng tự nhiên chứ không lặp một cụm.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/seo-starter-guide

### Internal link
**Là gì:** link giữa các trang trong cùng site. Link trong body có giá trị hơn link ở nav/footer.
**Ví von:** lối đi giữa các phòng trong nhà mình.
**Trên site anh:** đây là lỗ hổng lớn — homepage không link tới bất kỳ product hay bài blog nào, nên 10 trang product là ốc đảo.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/seo-starter-guide

### E-E-A-T
**Là gì:** Experience · Expertise · Authoritativeness · **Trustworthiness**. Trust là trụ cột chính, không cần đủ 4 chân đều nhau.
**Ví von:** khách chọn thợ — đã làm bao giờ chưa, có nghề không, người khác có nhắc tên không, và có tin được không.
**Trên site anh:** lỗ rò Trust thật — trang policies ghi sai tên pháp lý ("TNHH Tiến Vũ Industrial" thay vì "Công ty Cổ phần Tiến Vũ"), và người mở policies chính là khách đang thẩm định cuối funnel.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/creating-helpful-content

### Topical authority
**Là gì:** mức độ Google coi site mình là nguồn đáng tin cho cả một chủ đề, chứ không phải cho một trang lẻ.
**Ví von:** hiệu sách chuyên về một ngành, không phải tiệm tạp hoá bán mỗi thứ một cuốn.
**Trên site anh:** chính là lý do làm cluster thay vì viết bài rời rạc.
**Nguồn:** https://searchengineland.com/guide/topic-clusters

### Keyword stuffing
**Là gì:** nhồi keyword và biến thể của nó một cách bất thường. Vi phạm spam policy.
**Ví von:** hét tên món ăn hai mươi lần trước cửa quán.
**Trên site anh:** đáp án bài kiểm tra title Buổi 4 — phương án (a) trượt đúng vì lỗi này.
**Nguồn:** https://developers.google.com/search/docs/essentials/spam-policies

### Alt text
**Là gì:** câu mô tả ảnh cho máy và cho người không xem được ảnh.
**Ví von:** chú thích dưới bức ảnh trong sách.
**Trên site anh:** **0 ảnh thiếu alt** trên mọi trang đã kiểm — điểm sáng hiếm hoi trong audit.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/seo-starter-guide

---

## Kỹ thuật & đo lường

### Structured data / JSON-LD
**Là gì:** đoạn dữ liệu có định dạng chuẩn nhúng vào trang, khai rõ "đây là công ty, đây là sản phẩm, đây là bài viết".
**Ví von:** tờ khai lý lịch kẹp trong hồ sơ, thay vì bắt người ta đọc cả tập rồi tự đoán.
**Trên site anh:** **0 block Organization/LocalBusiness** ở bất kỳ đâu. Chỉ product detail có Product + Brand.
**Nguồn:** https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data

### SSR / SSG / ISR
**Là gì:** ba cách Next.js dựng HTML — mỗi request (SSR), lúc build (SSG), hoặc build rồi tự làm mới theo chu kỳ (ISR).
**Ví von:** nấu theo order, nấu sẵn từ sáng, hay nấu sẵn rồi cứ vài tiếng làm mẻ mới.
**Trên site anh:** đang dùng `getServerSideProps` = SSR. Tốt cho SEO nhưng chậm hơn SSG — sẽ cân lại ở Buổi 7.
**Nguồn:** https://nextjs.org/docs/pages/api-reference/components/head

### Core Web Vitals (LCP / INP / CLS)
**Là gì:** ba chỉ số trải nghiệm — LCP: bao lâu thấy nội dung chính; INP: bấm vào thì bao lâu mới phản hồi (thay FID từ 2024); CLS: layout có nhảy không.
**Ví von:** món ra bàn nhanh không, gọi thêm thì phục vụ có quay lại không, và bàn có bị xê dịch giữa bữa không.
**Trên site anh:** `/products` 283KB với `__NEXT_DATA__` 215KB sẽ đánh vào LCP.
**Nguồn:** https://web.dev/articles/vitals · https://web.dev/articles/inp

### GSC (Google Search Console)
**Là gì:** công cụ Google cho chủ site — xem query nào ra mình, trang nào được index, lỗi gì đang chặn.
**Ví von:** sổ ghi của thủ thư, cho mình xem người ta hỏi gì và sách mình có được xếp lên kệ không.
**Trên site anh:** đã verify **12/07** qua TXT record ở Tenten, Domain property `tienvujsc.com.vn`. Data không backfill quá khứ — chỉ tích từ lúc verify.
**Nguồn:** https://developers.google.com/search/docs/monitor-debug/search-console-start

### NAP
**Là gì:** Name · Address · Phone. Phải khớp nhau ở mọi nơi trên internet.
**Ví von:** ba dòng trên danh thiếp — in mỗi nơi một kiểu thì không ai biết đâu là thật.
**Trên site anh:** đang lệch nhiều chỗ — footer VI "xã Thuận An, TP Hà Nội" vs navbar mobile "Kim Sơn, Gia Lâm, Hà Nội"; hotline VI (09 678 32 669) khác EN (0913 304 809); email hai kiểu.
**Nguồn:** https://support.google.com/business/answer/7039811

### Citation (local SEO)
**Là gì:** chỗ nào trên internet nhắc tên + địa chỉ + số điện thoại của doanh nghiệp, kể cả không có link.
**Ví von:** tên mình xuất hiện trong danh bạ ngành, dù không ai gọi.
**Trên site anh:** chưa có gì — thuộc Buổi 13.
**Nguồn:** https://support.google.com/business/answer/7039811

### Backlink
**Là gì:** link từ site khác trỏ về mình. Là tín hiệu ranking mạnh, chất hơn lượng.
**Ví von:** người khác giới thiệu quán mình — mấy lời giới thiệu đó đáng tin hơn tự mình quảng cáo.
**Trên site anh:** **0 backlink**. Cùng với việc không có sitemap, đây là lý do Google không có đường nào phát hiện ra site.
**Nguồn:** https://developers.google.com/search/docs/fundamentals/seo-starter-guide
