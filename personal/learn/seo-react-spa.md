---
topic: SEO toàn diện (content + technical + off-page) — áp dụng tienvu-bt, hướng nghề SEO
mode: plan
status: in-progress
started: 2026-06-24
last_session: 2026-07-27
next_start: "Buổi 4 XONG (title 6 trang + 2 H1 đã chốt, xem bảng cuối Ghi chú 27/07). TRƯỚC KHI VÀO BUỔI 5 — làm 2 việc P0: (1) set NEXT_PUBLIC_SITE_URL=https://tienvujsc.com.vn ở production + đổi 2 fallback trong code (SEO.js:11 'https://tienvu-bt.com' → domain thật; ThemeLayout.js:33 '' → domain thật); (2) kéo Buổi 9 (sitemap+robots, cả 2 đang 404) lên làm TRƯỚC Buổi 5. Rồi mới vào Buổi 5 (Site Architecture). MỞ ĐẦU HỎI: (a) search site:tienvujsc.com.vn đã ra chưa, (b) GSC Hiệu suất/Lập chỉ mục đã có data chưa, (c) đã áp 6 title + 2 H1 lên site chưa."
---
## Bối cảnh (CẬP NHẬT 2026-07-09 — mở rộng scope)
- User là frontend dev, hướng frontend depth + senior/system design.
- **Mục tiêu kép** (user làm rõ 09/07): (1) SEO tốt cho site thật tienvu-bt, (2) đủ kiến thức/kỹ năng để
  tìm được công việc SEO — không chỉ dừng ở "implement cho 1 site." Roadmap vì vậy học ĐẦY ĐỦ discipline
  SEO (content, technical, off-page, local, tools/đo lường), không chỉ phần Next.js-specific.
- **Lợi thế xuất phát từ dev**: technical SEO (site architecture, structured data, rendering, Core Web
  Vitals) sẽ học nhanh vì đã có nền code. **Mảng mới hoàn toàn**: content strategy/writing, keyword
  research, off-page/link building, local SEO, tools đo lường (GSC/GA4) — ưu tiên học các mảng này trước
  để cân bằng, vì đây là gap lớn nhất so với 1 SEO specialist thực thụ.
- Site THẬT = tienvu-bt (`D:\Project\j\tienvu-bt`) — Next.js 14, **Pages Router**, block-driven CMS (VI
  mặc định, EN overlay qua `translations.en.data`), B2B industrial (băng tải cao su, con lăn, vật tư khai
  thác mỏ — khách hàng: mỏ đá, trạm nghiền sàng, nhà máy khai khoáng, chủ yếu Việt Nam). Đã có content-
  rewrite plan riêng trong repo (`research.md`, `CONTENT-REWRITE-PLAN.md`).
- **QUAN TRỌNG**: tienvu-bt là **doanh nghiệp thật của user** (không phải bài tập/portfolio) — đang kinh
  doanh truyền thống, muốn hiện đại hóa. Website đã xong, SEO là bước tiếp theo. → Ưu tiên đề xuất có ROI
  thật cho business, không chỉ lý thuyết/bài tập.
- **Mục tiêu website (user chốt 2026-07-11)**: **lead-generation**, KHÔNG phải e-commerce (không giá,
  không thanh toán). Conversion duy nhất = khách chủ động liên hệ (hotline/Zalo/form báo giá). Nghề cũ:
  in catalog gửi tận mỏ + khách cũ giới thiệu → giờ chuyển sang kiếm khách online. Khách mua là người
  TRONG NGHỀ (giám đốc mỏ/quản đốc/kỹ sư) — nhiều người không cần được "dạy", họ cần tìm nhà cung cấp
  đáng tin nhất / so sánh với bên đang biết. → Tỉ trọng content nghiêng thêm về **commercial
  investigation**; informational vẫn giữ (3 vai: cửa vào ranking, chứng minh nghề, bắt buying committee).
  VN trước, cross-border sau (EN overlay có sẵn).
- Cấu trúc roadmap giờ chia theo **Phase** (mỗi phase = 1 mảng kiến thức). Mỗi buổi vẫn dạy tương tác +
  verify thật trên tienvu-bt khi áp dụng được (như cách làm ở Buổi 1: test curl thật trên local).

## Đã học / nắm được
- Phân biệt Pages Router vs App Router (routing/data fetching/metadata/layout/component mặc định) +
  đánh đổi 2 bên + kết luận SEO không phụ thuộc router, tienvu-bt không cần migrate.
- **Buổi 1 — 3 phase Search Engine + JS rendering two-wave (DONE, test thật trên local):**
  - 3 phase: Crawling (Googlebot tải HTML thô) → Indexing (phân tích + canonical clustering, chặn bởi
    content chất lượng thấp/`noindex`/JS phức tạp) → Serving/Ranking (match query, xếp hạng theo hàng
    trăm yếu tố).
  - Với trang có JS, Crawl thực ra tách nhỏ: crawl HTML thô → **Render** (hàng đợi headless Chromium,
    KHÔNG tức thời, có thể chậm) → Index (đọc DOM đã render). Content chỉ có sau khi JS chạy thì phải
    đợi hàng Render; content có sẵn trong HTML thô (SSR/SSG) thì Google thấy ngay ở bước Crawl.
  - Pitfall hay gặp: fragment routing (`#/...`, Googlebot không đọc được), soft 404 (route động trả
    200 dù không có data thật).
  - **Verify thật trên tienvu-bt local (curl, không chạy JS)**: `frontend/pages/[slug].js` dùng
    `getServerSideProps` trả `{ notFound: true }` khi `fetchPageData` báo không có data → Next.js tự
    set HTTP status **404 thật** (test slug rác → status 404, title "Page Not Found - 404") — KHÔNG
    dính soft-404. Trang chủ `/` — HTML thô (curl thuần, chưa chạy JS) đã có sẵn `<title>` +
    `<h1>` đầy đủ → đúng lý thuyết, Google không cần đợi Render mới thấy content chính vì SSR đã nhét
    sẵn vào response đầu.
  - Phát hiện phụ: `<title>` trang chủ hiện tại đã on-brand ("Băng tải cao su & con lăn cho mỏ đá...").
    `research.md` (30/05) từng ghi meta còn stale — có vẻ Phase 8 (Global SEO meta) đã được áp dụng ít
    nhất cho trang chủ sau đó. Mới check 1 trang, CHƯA kết luận toàn site — để dành cho buổi Audit cuối.

- **Buổi 2 — Keyword Research & Search Intent (DONE 2026-07-10):**
  - Keyword = tín hiệu ý định (intent), không phải chỉ là 1 từ. 4 loại: Informational / Navigational /
    Commercial investigation / Transactional — modifier word (VD "uy tín", "cho mỏ đá") mới là thứ mang
    tín hiệu intent thật, không phải keyword gốc.
  - B2B funnel dài hơn B2C: Informational → Commercial investigation → **liên hệ trực tiếp** (KHÔNG phải
    1 search query transactional nữa) — user tự suy ra đúng hoàn toàn qua ví dụ thật (tự đặt mình vào vai
    khách mỏ đá).
  - **Insight từ user, đã tự sửa lại phạm vi (2026-07-10)**: B2B buyer vetting qua nhiều tab + social
    presence (Facebook fanpage follower/bài/tương tác, LinkedIn) — user nói rõ đây là quan sát CÁ NHÂN
    (N=1), KHÔNG phải data đã kiểm chứng cho toàn bộ khách B2B. Ghi nhận là **giả thuyết** cho Buổi 13,
    verify lại bằng Analytics/GSC thật của Tiến Vũ khi có data, không coi là fact đã chứng minh.
  - **Khung 2 lớp (chốt lại sau khi user push back đúng)**: Lớp 1 = Ranking (backlink/technical/content
    quality làm tín hiệu rank — BẮT BUỘC, áp dụng số đông, đã verify bằng data thật: top 3 kết quả
    organic chiếm **68.7%** tổng click, vị trí 2 = 12-18%, vị trí 3-5 = 5-10%, qua trang 2 gần như
    không ai thấy — nguồn: navboost.com/ctr-by-position, indexsy.com/ctr-statistics, 2026). Lớp 2 =
    Trust/chọn giữa các site ĐÃ THẤY (social presence, content đầy đủ — bao gồm Brand SERP/off-site
    trust signal, fold vào Buổi 13) — chỉ có tác dụng SAU lớp 1, phụ chứ không thay thế được. Roadmap
    (chủ yếu Phase 2-3) vẫn tập trung lớp 1 là chính.
  - **Ghi chú 2026 mới, đáng theo dõi**: AI Overview đang ăn bớt CTR đáng kể ngay cả ở vị trí #1 (Ahrefs
    2/2026, 300K từ khóa: có AI Overview → CTR vị trí #1 giảm tương quan ~58%, vị trí 2 ~50.8%, vị trí 3
    ~46.4%). Ngành đang nói tới AEO (Answer Engine Optimization) song song SEO cổ điển — chưa cần buổi
    riêng, nhắc lại ở buổi CWV/Audit cuối.
  - **Action item còn treo**: GSC chưa setup trên tienvu-bt (xác nhận qua code — không có verification
    tag/file nào). Cần setup sớm (link thật đã đưa) để kịp có data trước Buổi 14.

- **Buổi 3 — Content Strategy: Topic Cluster & Pillar Page + E-E-A-T (DONE 2026-07-11):**
  - Hub-and-spoke: pillar phủ RỘNG 1 topic, spoke sâu 1 subtopic. 3 luật linking: (1) pillar→spoke —
    anchor mô tả, trong body, xuất hiện sớm; (2) spoke→pillar — gần đầu bài; (3) spoke↔spoke liên quan.
    Anchor đa dạng tự nhiên. Homepage → pillar trong vài click. 1 cluster = 1 topic, không trộn.
  - **Pillar test** (chống chọn nhầm): người search head query đáp xuống trang này có được trả lời
    không? User chọn /construction làm pillar → rớt test (nó trả lời "công ty làm được gì" = trust,
    không phải "băng tải chọn/mua thế nào"). Vai đúng của /construction = **kho bằng chứng Experience**,
    mỗi spoke nhúng ảnh/case từ đó.
  - Commercial pillar vs guide pillar — chọn theo intent head query. "Băng tải cao su" thiên commercial
    → pillar vừa bán vừa dạy. Pillar không cần hoàn hảo từ đầu — nuôi dần khi thêm spoke.
  - E-E-A-T: **Trust quan trọng nhất**, không cần đủ 4 đều nhau; là on-site version của "lớp 2" Buổi 2
    nhưng được Google dùng làm signal lớp 1. Framework Who/How/Why (byline kỹ sư thật; bằng chứng thi
    công thật; viết để giúp người đọc). AI content chủ-yếu-để-xếp-hạng = vi phạm spam policy; AI hỗ trợ
    + người kiểm + disclose = OK.
  - **Lỗ rò Trust thật tìm thấy**: policies live viết cho nghề V-belt cũ + SAI TÊN PHÁP LÝ ("TNHH Tiến
    Vũ Industrial" → đúng: "Công ty Cổ phần Tiến Vũ"). User tự ưu tiên đúng: sửa tên trước (người mở
    policies = khách đang thẩm định cuối funnel; entity/NAP consistency — gặp lại ở Buổi 13).
  - **Cluster map chốt cho tienvu-bt** (3 dòng sản phẩm = 3 cluster; pillar tạo qua CMS + route
    `[slug].js` có sẵn → zero-code, URL top-level sạch — KHÔNG đặt dưới /products/... vì đụng namespace
    `products/[slug].js`):
    - `/bang-tai-cao-su`: spokes = bài draft 1 (chọn theo độ dày/lớp bố/tải), 4 (bảo trì & splicing),
      5 (abrasion grades)
    - `/con-lan`: spokes = bài 2 + 3 bài mới: cấu tạo & cách chọn con lăn (info→commercial, kỹ sư cơ
      điện); con lăn hỏng sớm (info, pain-point); tiêu chí chọn NCC con lăn + checklist RFQ
      (**commercial investigation** — bài lead-gen)
    - `/vat-tu-mo`: hạt giống = bài 6, nuôi dần
    - Bài 3 (downtime) = cầu nối: đặt /blog, treo cluster băng tải, link cả 3 pillar + construction;
      bài "cấp lãnh đạo" — đáng share Zalo/gửi khách cũ (nối kênh referral truyền thống)
    - V-belt cũ: NGOÀI cả 3 cluster. Bando/bakery → unpublish; bảng tra còn traffic → giữ, KHÔNG link
      vào cluster mới, đợi data GSC rồi quyết redirect/bỏ (quyết bằng data)
  - Ghi chú 2026: cluster cấu trúc rõ + entity rõ được cite trong AI Overviews (~20% search) nhiều hơn;
    core update 6/2025 củng cố topical authority — cùng cấu trúc phục vụ SEO + AEO.

- **Buổi 4 — On-page SEO (DONE 2026-07-27):**
  - **Phần chốt ngày 27/07 (title/H1 thực chiến):**
    - Title = biển hiệu ngoài đường (SERP, ≤60 ký tự, cần brand, cạnh tranh với 9 kết quả khác);
      H1 = câu chào khi khách đã vào (không cần brand, được dài hơn, xác nhận + đẩy tới hành động).
      **KHÔNG copy title xuống làm H1** — user mắc đúng lỗi này, đã chữa.
    - **Front-load keyword chính ≠ luôn để tên sản phẩm lên đầu.** Nó = để lên đầu từ mà người
      tìm trang NÀY sẽ gõ. Vì vậy `/about` là trang DUY NHẤT brand đứng đầu (keyword của nó là
      "công ty cổ phần Tiến Vũ" = vế 1 mục tiêu của user).
    - Lỗi user lặp 2 lần: **lặp từ trong title** (`Công trình - Các công trình đã thi công`;
      `Liên hệ: Thông tin liên hệ`) — tiêu 2/3 mặt tiền 60 ký tự vào 1 ý không phải keyword.
    - Thói quen user: khuôn `[Nhãn trang]: [mô tả] - [brand]` — nhãn ("Dịch vụ", "Giới thiệu"...)
      tốn 8-11 ký tự và không từ nào là từ khách gõ. Trộn `:` và `-` trong cùng title.
    - Title trang hub (`/blog`) không được hứa 1 chủ đề duy nhất — nó chứa nhiều spoke.
    - Fix H1 nhiều khi = **nâng cấp heading có sẵn**, không phải viết mới (`/contact` đã có H2
      "Yêu cầu báo giá băng tải / con lăn" viết tốt, chỉ sai cấp).
    - **Cơ chế cụ thể mạnh hơn tính từ**: "Gửi bản vẽ" > "phản hồi nhanh chóng, uy tín".
    - **Không bịa claim trong title/H1**: định thêm "từ 2009" vào title /about → curl kiểm,
      site không ghi năm thành lập ở đâu → BỎ. Title là lời hứa; hứa số không kiểm chứng được
      là tự đào hố E-E-A-T.
  - **Lý thuyết dạy 2026-07-12:**
  - Mental model 3 tầng: máy đọc (title/heading/link/alt) · SERP (title link + snippet → CTR) ·
    content thật — 3 tầng phải kể cùng 1 câu chuyện.
  - Title: công thức `[keyword chính]+[qualifier]+[brand]`, front-load, unique/trang, ~55-60 ký tự
    (cắt theo pixel ~600px). Google VIẾT LẠI title khi: quá dài / nhồi keyword / boilerplate / lệch
    nội dung. Nhồi biến thể keyword = spam signal.
  - Meta description: KHÔNG phải ranking factor — ảnh hưởng CTR ("ranking đưa lên bảng, snippet giành
    click"). Công thức `[có gì]+[cho ai]+[USP]+[CTA]`, ~150-160 ký tự. Google hay thay bằng đoạn trích
    khớp query hơn — bình thường.
  - Heading: H1 = lời hứa (1/trang là convention tốt); thứ tự không ảnh hưởng ranking (doc 12/2025) —
    phục vụ người đọc + máy hiểu cấu trúc. Mẹo 2026: H2 dạng câu hỏi người search gõ + đoạn trả lời
    gọn ngay dưới → dễ được trích featured snippet / AI Overview (trích theo section).
  - Keyword tự nhiên = semantic SEO: quên mật độ; keyword ở vị trí trọng yếu vì nội dung cần; phần
    còn lại dùng TỪ VỰNG NGÀNH thật (lớp bố, lưu hóa, độ mài mòn...) — chính từ vựng ngành chứng minh
    expertise. Keyword stuffing = vi phạm spam policy.
  - Internal link: anchor nói rõ trang đích, link trong body > nav/footer, external không tin cậy →
    nofollow. Alt text = 1 câu tả quan hệ ảnh-nội dung; ảnh thật > stock.
  - **Audit on-page live 12/07** (curl toàn bộ trang chính): `/` `/about` `/services` `/blog`
    `/contact` đạt (Phase 8 meta rewrite ĐÃ chạy — khác research.md 30/05); lỗi còn lại:
    `/products` title+desc+H1 stale nghề cũ ("vòng bi, dây curoa") — TỆ NHẤT, đã chữa mẫu trong chat
    (title "Sản phẩm — Băng tải cao su, con lăn & vật tư mỏ | CTCP Tiến Vũ" + desc mới + H1 mới);
    `/construction` title thiếu brand/ngữ cảnh (= bài tập A của user); `/blog` + `/contact` H1 rỗng.
  - **Hotline giả XÁC NHẬN**: nút gọi/Zalo toàn site đọc `frontend/config/contact.json:2-3` =
    `0912345678` (placeholder), trong khi hotline thật trong meta services/contact = **0913 304 809**
    → khách bấm nút gọi vào số ma. Fix: sửa contact.json + deploy (user tự làm). Check thêm
    contact.json:4 có `tienvu-bt.com` (domain chết) — nghi email cũng hỏng.

## Đang kẹt / chưa rõ
- (chưa có)

## Action items (business, ngoài giờ học)

### 1. Setup Google Search Console — ✅ DONE 2026-07-12 (verify thành công, làm cùng nhau trong phiên)
- Domain property `tienvujsc.com.vn` verified qua TXT record ở Tenten (hướng dẫn từng bước bên dưới đã
  hoàn thành). **Phát hiện quan trọng trước đó: site CHƯA được index** (user search `site:` trên điện
  thoại = 0 kết quả; không có gì chặn — không robots.txt/noindex — chỉ là Google chưa phát hiện ra site:
  domain mới, không backlink, không sitemap).
- Đã hướng dẫn URL Inspection → Request indexing cho 7 trang chính (homepage, products, services,
  construction, about, contact, blog). **Follow-up: 2-3 ngày sau search lại `site:tienvujsc.com.vn`**
  để xác nhận index; GSC dashboard cần ~1 ngày mới có data.

Checklist gốc (đã xong, giữ để tham khảo):
Domain thật: `tienvujsc.com.vn` (live, HTTP 200). DNS đang ở **Tenten** (ns-b1/b2/b3.tenten.vn).
1. [ ] Vào https://search.google.com/search-console (dùng Google account giữ lâu dài cho công ty) →
       Add property → chọn loại **Domain** → nhập `tienvujsc.com.vn`.
2. [ ] Google đưa 1 TXT record dạng `google-site-verification=...` → mở panel DNS Tenten → thêm TXT
       record cho domain gốc (Name/Host: `@` hoặc để trống) → Save.
3. [ ] Đợi DNS propagate (5-60p) → quay lại GSC bấm **Verify**. Fail thì đợi thêm rồi bấm lại —
       record đúng thì sớm muộn cũng pass, không mất gì.
4. [ ] KHÔNG cần submit sitemap lúc này (site chưa có — Buổi 9 sẽ build). Data Performance bắt đầu
       tích từ lúc verify, không backfill quá khứ → làm càng sớm càng có baseline cho Buổi 14/17.
- Fallback nếu không có quyền DNS Tenten: property loại **URL prefix** `https://tienvujsc.com.vn/`
  → method "HTML tag" → gắn meta tag vào global `<Head>` rồi deploy (cần sửa code + deploy, làm
  ngoài phiên học).

### 2. SEO bugs phát hiện 2026-07-10 (check live bằng curl, CHƯA sửa — thuộc Buổi 8/16)
- Homepage **không có** `canonical`, `og:url`, `og:image`, `hreflang` (title/description thì có) →
  component `SEO.js` không được dùng ở homepage.
- `frontend/components/SEO.js:11` fallback `NEXT_PUBLIC_SITE_URL || 'https://tienvu-bt.com'` —
  domain `tienvu-bt.com` **không tồn tại** (NXDOMAIN). Trang nào dùng `SEO.js`
  (`products/[slug].js`, `_error.js`) mà production không set env đó → canonical/og:url trỏ domain
  chết. CHƯA verify được trên product page live (homepage không link thẳng product nào) — check ở
  Buổi 16 audit hoặc sửa sớm cùng Buổi 8.

### 3. Audit toàn site 2026-07-27 (curl + đọc payload CMS) — CHƯA SỬA

**P0 — chặn index:**
- **1 env var thiếu, 3 hệ thống gãy.** `NEXT_PUBLIC_SITE_URL` không được set ở production,
  và 2 nơi fallback khác nhau:
  - `SEO.js:11` → `|| 'https://tienvu-bt.com'` (domain NXDOMAIN, đã curl xác nhận chết)
    ⇒ **canonical + og:url của cả 10/10 product page trỏ domain chết** — nhiều khả năng là
    lý do `site:` vẫn trắng sau 2 tuần dù đã request indexing.
  - `ThemeLayout.js:33` → `|| ''` ⇒ hreflang render ra URL **tương đối** (`href="/"`,
    `href="/en/"`). Thẻ CÓ (đính chính: báo cáo đầu buổi nói "hreflang=0" là SAI, grep hụt)
    nhưng spec Google yêu cầu URL tuyệt đối → Google bỏ qua toàn bộ, vi/en không ghép cặp.
  - Fix: set env ở production + đổi CẢ HAI fallback sang `https://tienvujsc.com.vn`.
  - **Bài học**: fallback im lặng nguy hiểm hơn crash. Nếu code throw khi thiếu env thì lỗi
    đã lộ ngay hôm deploy thay vì sống 2 tháng.
- **`robots.txt` + `sitemap.xml` đều 404** (đã thử cả `sitemap-0.xml`, `sitemap_index.xml`).
- **`/blog` trống 0 bài viết** — không có `href="/blog/..."` nào. Toàn bộ cluster Buổi 3
  chưa có spoke nào live.

**P1:**
- 6 title trơ trọi (đã chốt bản thay ở Ghi chú 27/07); `/blog` + `/contact` **h1=0**.
- Trang tĩnh (`/ /about /services /blog /contact /construction /products`) **không có
  canonical, og:title, og:image, og:url** — chỉ trang dùng `SEO.js` mới có (mà cái đó đang
  hỏng). Không og:image ⇒ share Zalo/Facebook ra thẻ trắng, đúng kênh user đang dùng.
- **Không có JSON-LD Organization/LocalBusiness** ở đâu. Chỉ product detail có Product+Brand.
- **CTA trên /about trỏ 404**: hero secondaryButtonHref = `/lien-he` (đường thật `/contact`).
  Đã curl: 404. Trên site lead-gen = nút chuyển đổi dẫn vào ngõ cụt.
- **NAP không nhất quán** (→ Buổi 13): địa chỉ footer VI "xã Thuận An, TP Hà Nội" vs navbar
  mobile "Kim Sơn, Gia Lâm, Hà Nội" vs EN "Kim Son, Gia Lam, Hanoi". Email 2 kiểu
  (`info@tienvujsc.com.vn` / `tienvuinfo@gmail.com`), hotline khác nhau giữa VI (09 678 32 669)
  và EN (0913 304 809).
- **Hotline giả còn sót**: `/contact` vẫn có `tel:0912345678` + `zalo.me/0912345678` nằm cạnh
  số thật. Chuỗi `ten@gmail.com` (placeholder) còn trong messages contact.emailInvalid.
- **Bản EN còn nội dung nghề cũ**: tagline `"Expert solutions, reliable power transmission"`
  (nghề V-belt), brandAccent EN = "Expert Solutions".
- **4 icon social đều `href: "#"`** (Facebook/Instagram/TikTok/YouTube) — liên quan trực tiếp
  giả thuyết Buổi 2 về khách B2B kiểm fanpage trước khi liên hệ.
- **CATEGORIES nghề cũ** trong `products/index.js:8-14`: chip lọc "Vòng bi", "Dây curoa"
  (count = 0). Lệch câu chuyện 3 tầng của Buổi 4.
- **Menu data cũ còn sót**: navbar có 2 mảng — `links` (cũ, chứa `/products/bang-tai`,
  `/products/vong-bi`, `/products/day-curoa`, `/du-an` — đã curl, **tất cả 404**) và
  `menuItems` (đúng, đang render). Mảng cũ chưa dọn.
- **Ảnh hero /about là stock Unsplash** — Buổi 4: ảnh thật > stock; Buổi 3: /construction là
  kho bằng chứng Experience, nên dùng ảnh công trình thật.
- **Số liệu trang trí đáng ngờ**: hero /about có telemetry "Tải trọng 15,000 T/H", "Tốc độ
  6.5 M/S", "Hoạt động 99.98%" — không rõ của cái gì. Rủi ro Trust với khách trong nghề.

**P2:**
- `/products` nặng 283KB HTML, `__NEXT_DATA__` chiếm 215KB (76%) — payload lặp nội dung đã
  render. Ảnh hưởng LCP (→ Buổi 11).
- `/en/` → `/en` redirect 308 (vô hại, phí crawl).
- Tin tốt: **0 ảnh thiếu alt** trên mọi trang đã kiểm.

**Lệch giữa content site và quy trình thật (business, → content rewrite):**
- Site hứa "khảo sát tận nơi" ít nhất 5 chỗ (About, Giá trị cốt lõi/Tâm, Nguyên tắc với khách
  hàng, Sứ mệnh, CTA cuối trang) và đặt nó làm lời mời chủ đạo. Quy trình THẬT (user nói
  27/07): **tư vấn qua bản vẽ trước**, khảo sát tận nơi chỉ khi đơn đủ nghiêm túc, vì công
  trình xa, đi mà không chốt được đơn thì tốn chi phí. → Đề xuất đổi sang lời hứa 2 bước:
  "Gửi bản vẽ hoặc thông số — kỹ sư tư vấn quy cách và báo giá. Khảo sát tận nơi khi công
  trình cần." Vừa đúng thực tế, vừa hạ rào cản chuyển đổi.
- Điểm mạnh thật chưa được nói trên site: **phản hồi nhanh kể cả ngoài giờ hành chính**.

## Lộ trình (PLAN) / Nguồn — CHIA THEO PHASE

### Phase 0 — Nền tảng ✅ DONE
- [x] Buổi 1 — Search engine 3 phase + JS rendering two-wave (xem "Đã học")

### Phase 1 — Content & Strategy (mảng mới hoàn toàn, ưu tiên học trước)
- [x] Buổi 2 — Keyword Research & Search Intent (DONE 2026-07-10, xem "Đã học"):
      https://www.semrush.com/blog/search-intent/
- [x] Buổi 3 (DONE 2026-07-11) — Content Strategy: Topic Cluster & Pillar Page (hub-and-spoke), E-E-A-T (Experience-
      Expertise-Authoritativeness-Trustworthiness — quan trọng cho B2B industrial vì cần "trust").
      Thực hành: map content hiện có (blog + policies + product) của tienvu-bt vào 1 cluster structure:
      https://searchengineland.com/guide/topic-clusters
      https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [x] Buổi 4 (DONE 2026-07-27) — On-page content writing: công thức title tag/meta description, heading hierarchy,
      keyword đặt tự nhiên (không nhồi nhét), internal linking. Thực hành: viết lại 1 trang thật của
      tienvu-bt theo checklist:
      https://developers.google.com/search/docs/fundamentals/seo-starter-guide

### Phase 2 — Technical SEO (dev có lợi thế, học nhanh hơn)
> **ĐỔI THỨ TỰ 27/07**: làm **Buổi 9 (sitemap + robots)** TRƯỚC Buổi 5. Lý do: cả
> `robots.txt` và `sitemap.xml` đều 404, site chưa index, 0 backlink, homepage không link
> tới bất kỳ product/blog nào → Google gần như không có đường vào. Sitemap là đòn bẩy
> lớn nhất còn lại sau khi fix canonical.
- [ ] Buổi 5 — Site Architecture: cấu trúc phẳng vs sâu, URL structure, crawl budget (Google 2026: chỉ
      fetch 2MB đầu của HTML — liên hệ page weight thật của tienvu-bt). Thực hành: vẽ + đánh giá cấu
      trúc site hiện tại:
      https://searchengineland.com/guide/website-structure
- [ ] Buổi 6 — Structured Data / Schema Markup (JSON-LD): 5 loại quan trọng nhất (Organization,
      Article, FAQPage, Product, LocalBusiness). Thực hành: thêm JSON-LD Organization + Product cho
      tienvu-bt (rất hợp vì là B2B công ty thật, địa chỉ thật):
      https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
      https://developers.google.com/search/docs/appearance/structured-data/organization
- [ ] Buổi 7 — Data fetching & rendering mode Pages Router: SSG (`getStaticProps`) / SSR
      (`getServerSideProps`) / route động (`getStaticPaths`) / ISR (`revalidate`) — chọn mode cho từng
      page tienvu-bt:
      https://nextjs.org/docs/pages/building-your-application/data-fetching/get-static-props
      https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props
      https://nextjs.org/docs/pages/building-your-application/data-fetching/get-static-paths
      https://nextjs.org/docs/pages/guides/incremental-static-regeneration
- [ ] Buổi 8 — SEO meta qua `next/head` (Pages Router KHÔNG có Metadata API — cái đó chỉ App Router
      mới có):
      https://nextjs.org/docs/pages/api-reference/components/head
      https://nextjs.org/learn-pages-router/seo/rendering-and-ranking/metadata
- [ ] Buổi 9 — Sitemap + robots.txt cho Pages Router (KHÔNG có file convention `sitemap.ts`/`robots.ts`
      như App Router — cần package hoặc tự viết API route):
      https://www.npmjs.com/package/next-sitemap
- [ ] Buổi 10 — i18n SEO: hreflang, canonical đa ngôn ngữ, tránh duplicate content vi/en (site có
      `i18n: {locales:['vi','en']}` thật):
      https://nextjs.org/docs/pages/guides/internationalization
      https://next-intl.dev/docs/getting-started/pages-router
      https://developers.google.com/search/docs/specialty/international/localized-versions
- [ ] Buổi 11 — Core Web Vitals (LCP/INP/CLS, INP thay FID 2024; `next/image`, `next/font`):
      https://web.dev/articles/vitals
      https://web.dev/articles/top-cwv

### Phase 3 — Off-page SEO (mảng mới hoàn toàn)
- [ ] Buổi 12 — Link building & Domain Authority: backlink chất lượng vs số lượng, editorial link,
      digital PR, broken-link building. Áp dụng: brainstorm hướng đi cho B2B industrial VN (hiệp hội
      ngành khai khoáng, case study/dữ liệu kỹ thuật, guest post chuyên ngành):
      https://developers.google.com/search/docs/fundamentals/seo-starter-guide

### Phase 4 — Local SEO (mảng mới, rất hợp vì Tiến Vũ có địa chỉ/khách theo khu vực VN)
- [ ] Buổi 13 — Google Business Profile + Local SEO + **Brand SERP/social trust audit** (mở rộng
      2026-07-10 từ giả thuyết cá nhân của user — CHƯA kiểm chứng bằng data, verify lại khi có GSC/
      Analytics thật): NAP consistency (Name/Address/Phone khớp mọi nơi), tối ưu GBP, local citation —
      VÀ audit "brand SERP" (tìm "Tiến Vũ" xem gì hiện ra: fanpage Facebook — follower/số bài/tương tác,
      LinkedIn, review) như 1 phần PHỤ sau khi ranking (Phase 2-3) đã ổn, không phải ưu tiên chính.
      Thực hành: audit/setup GBP thật cho Tiến Vũ nếu chưa có:
      https://support.google.com/business/answer/7039811
      https://support.google.com/business/?hl=en

### Phase 5 — Tools & Đo lường
- [ ] Buổi 14 — Google Search Console đầy đủ: Performance report, Coverage/Indexing report, submit
      sitemap, URL inspection (đã dùng nhẹ ở Buổi 1, giờ học sâu):
      https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console
- [ ] Buổi 15 — Google Analytics 4 cho SEO: track organic traffic, kết nối GSC+GA4, conversion tracking
      (form liên hệ = conversion cho B2B):
      https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console

### Phase 6 — Audit thật + Job-readiness
- [ ] Buổi 16 — Full audit tienvu-bt theo TOÀN BỘ kiến thức đã học (content + technical + structured
      data + local), qua /browse. Bao gồm: check Phase 8 (Global SEO meta) trong `CONTENT-REWRITE-
      PLAN.md` đã apply hết chưa (Buổi 1 mới check được trang chủ).
- [ ] Buổi 17 — Portfolio & job-readiness: đóng gói case-study từ chính quá trình SEO tienvu-bt (số
      liệu trước/sau), free certification thật (đã verify tồn tại, không bịa):
      https://academy.hubspot.com/courses/seo-training
      https://www.semrush.com/academy/courses/seo/
      https://academy.moz.com (Moz SEO Essentials Certification)

## Ghi chú buổi 2026-06-24
- Lúc đầu lập roadmap cho SPA thuần (CSR). User báo site là Next.js App Router → ĐÃ VIẾT LẠI roadmap
  (nhầm — xem ghi chú 2026-07-09).

## Ghi chú buổi 2026-07-09
- Review code thật của tienvu-bt trước khi vào Buổi 1 → phát hiện roadmap 24/06 nhầm App Router, site
  thật là **Pages Router** (xác nhận qua `frontend/pages/`, `next.config.js` i18n key, và `research.md`
  tự audit của chính user).
- Dạy phân biệt Pages Router vs App Router (routing / data fetching / metadata / layout / component mặc
  định) + đánh đổi 2 bên + kết luận SEO không phụ thuộc router, tienvu-bt không cần migrate.
- Viết lại toàn bộ Lộ trình cho đúng Pages Router (link docs thật đã search lại, không dùng từ memory).
- **Buổi 1 hoàn thành cùng ngày**: dạy 3 phase + JS rendering two-wave (fetch lại 2 doc Google để đảm
  bảo nội dung mới nhất). Check hiểu bằng cách test THẬT trên app local đang chạy (curl): xác nhận
  `[slug].js` trả 404 thật (không soft-404) qua `{ notFound: true }`, và trang chủ SSR có content đầy đủ
  trong HTML thô. Phát hiện thêm: title trang chủ có vẻ đã on-brand, khác với "stale" ghi trong
  research.md 30/05 — cần audit lại đầy đủ ở buổi Audit cuối.
- **Mở rộng scope (cùng ngày, sau khi xong Buổi 1)**: user làm rõ mục tiêu kép — SEO tốt cho tienvu-bt
  VÀ đủ skill xin việc SEO (hiện là dev). Research lại (11 WebSearch) để xây roadmap đầy đủ discipline
  SEO, không chỉ Next.js-specific: thêm Phase 1 (Content Strategy: keyword research, topic cluster,
  E-E-A-T, on-page writing), Phase 3 (Off-page: link building), Phase 4 (Local SEO — hợp vì Tiến Vũ có
  địa chỉ/khách theo khu vực VN), Phase 5 (Tools: GSC/GA4 đầy đủ). Phase 2 = giữ nguyên các buổi Next.js
  cũ (đánh số lại 7-11). Phase 6 = audit đầy đủ + job-readiness (case study + free certification thật:
  HubSpot Academy, Semrush Academy, Moz — đã verify URL tồn tại). Tổng roadmap giờ 17 buổi qua 7 phase.
  next_start = Buổi 2.

## Ghi chú buổi 2026-07-10
- **Buổi 2 hoàn thành**: dạy keyword = tín hiệu intent, 4 loại intent, B2B funnel dài hơn B2C. Check code
  trước buổi → phát hiện GSC chưa setup (không verification tag/file), và site chỉ có analytics tự viết
  riêng (không thay được GSC vì Google không lộ query qua referrer) — đưa link setup GSC thật, khuyên làm
  sớm để kịp tích data trước Buổi 14.
  - Bài tập: user tự phân loại keyword thật ("băng tải cao su", "...cho mỏ đá", "công ty cung cấp...uy
    tín") — đúng phần Commercial, cần sửa nhẹ phần Informational (bare term = mơ hồ chứ không thuần info;
    thêm use-case qualifier là đã lùi gần Commercial hơn).
  - Check hiểu mở rộng: hỏi bước sau "uy tín" search là gì → user tự trả lời đúng: liên hệ trực tiếp qua
    kênh trên website (xác nhận transactional-trong-B2B ≠ 1 search query khác).
  - **Insight giá trị từ user** (không có sẵn trong roadmap): B2B buyer vetting qua nhiều tab + social
    presence (Facebook fanpage follower/bài/tương tác, LinkedIn) trước khi liên hệ — đã fold thành "Brand
    SERP/social trust audit" vào Buổi 13.
  - **Business context quan trọng lộ ra**: tienvu-bt là doanh nghiệp thật của user (không phải bài tập),
    đang chuyển từ kinh doanh truyền thống sang digital, website xong rồi giờ tới SEO. Đã lưu vào memory
    user-profile. Từ giờ ưu tiên đề xuất có ROI thật, không chỉ lý thuyết.
  - next_start = Buổi 3 (Content Strategy: Topic Cluster/Pillar Page + E-E-A-T).

## Ghi chú buổi 2026-07-10→11 (phiên 2)
- User hỏi GSC có bắt buộc / block Buổi 3 không → không; chọn vào thẳng Buổi 3, GSC làm ngoài giờ học
  theo checklist ở mục "Action items" (domain thật = tienvujsc.com.vn, DNS Tenten → Domain property +
  TXT record). Check nhanh site live phát hiện: homepage thiếu hẳn canonical/og:url/og:image/hreflang;
  fallback domain chết trong SEO.js (chi tiết Action items §2 — thuộc Buổi 8/16, chưa sửa).
- Buổi 3 dạy tương tác, user tiến bộ rõ: nắm định nghĩa pillar/spoke ngay; chọn nhầm /construction làm
  pillar → chữa bằng pillar test; tự cảm nhận đúng bài 6 "rộng hơn" cluster băng tải; tự đề xuất pillar
  dạng trang chuyên biệt /products/bang-tai-cao-su → chỉnh sang top-level slug qua CMS (zero-code);
  trả lời đúng bài check E-E-A-T (ưu tiên sửa tên pháp lý trước).
- User kể bối cảnh nghề (catalog giấy gửi tận mỏ, khách cũ giới thiệu) → chốt mục tiêu site = LEAD-GEN
  (đã cập nhật mục Bối cảnh). Điều chỉnh chiến lược: thêm loại spoke commercial investigation; giữ
  informational với 3 vai (cửa vào ranking / chứng minh nghề / buying committee), user đồng ý "giữ
  content nhưng chỉnh tỉ trọng + thiết kế để dễ chuyển đổi hơn".
- **Homework user tự giao**: rà soát lại TOÀN BỘ content web một lượt (product, blog, ảnh) trước buổi
  sau. Buổi 4 mở đầu bằng việc hỏi kết quả rà soát này + GSC setup chưa.

## Ghi chú buổi 2026-07-12 (phiên 3)
- User báo cảm giác "3 buổi chưa đọng lại" → hệ thống hóa quanh mục tiêu user phát biểu: (vế 1) search
  "công ty cổ phần Tiến Vũ" ra site — mục tiêu TUẦN; (vế 2) search "băng tải cao su" ra site — mục
  tiêu THÁNG/QUÝ = toàn bộ roadmap. Một dòng/buổi: B1=được thấy · B2=thấy với query nào · B3=thắng
  query khó · B4=từng trang nói gì.
- **Phát hiện lớn: site CHƯA ĐƯỢC INDEX** (user search site: = 0; không bị chặn — không robots.txt/
  noindex — chỉ là Google chưa phát hiện: domain mới, 0 backlink, 0 sitemap). → Setup GSC ngay trong
  phiên: Domain property + TXT ở Tenten, verify THÀNH CÔNG 12/07, request indexing 7 trang chính.
  Follow-up: check site: sau 2-3 ngày; nếu 1 tuần vẫn trắng → xem Lập chỉ mục→Trang + kéo Buổi 9
  (sitemap) lên sớm.
- Buổi 4 dạy lý thuyết on-page (xem "Đã học") + audit live toàn trang + chữa mẫu /products + xác nhận
  hotline giả contact.json. User quyết định: GÁC việc sửa site, tự audit một lượt trước rồi mới nhờ
  rà lại — bài tập vì vậy chuyển sang dạng thuần kiến thức.
- **Đang treo khi kết phiên**: 2 câu check hiểu Buổi 4 (chọn title a/b/c — đáp án đúng là (b), (a)
  fail vì nhồi keyword, (c) fail vì mơ hồ không keyword/không hứa gì; câu 2 — desc tốt tăng CTR,
  không đổi position/impressions) + bài tập A (title /construction) + B (skeleton pillar
  /bang-tai-cao-su). Fix-list code user tự áp: contact.json hotline/zalo (+email?), H1 /blog /contact,
  meta /products theo bản chữa mẫu, title /construction.

## Ghi chú buổi 2026-07-27 (phiên 4) — KHÉP BUỔI 4

- User chọn "vừa học vừa làm, thực hành thẳng trên site". Mở phiên bằng **audit lại toàn bộ site
  live** (curl mọi trang chính + 10 product detail + đọc payload CMS) → xem mục "Action items §3"
  cho danh sách đầy đủ. Phát hiện lớn nhất: **canonical 10 trang product trỏ domain chết**, và
  gốc rễ chung là 1 env var thiếu làm gãy canonical + og:url + hreflang.
- Chữa xong 2 câu check hiểu treo từ 12/07 (đáp án (b); chỉ CTR đổi).
- **Bài tập title — 3 vòng, user tiến bộ rõ**: vòng 1 `/products` 7/10 (đúng khung, thiếu "con lăn",
  dùng "vật tư khai mỏ" thay vì từ ngành thật) nhưng `/construction` 4/10 (không keyword nào + lặp
  từ). Vòng 2 `/services` 7/10, `/about` 5/10, `/contact` 3/10 (lặp lại đúng lỗi lặp từ), `/blog`
  5/10. Vòng 3 (H1) — user copy title xuống làm H1, đã chữa bằng bảng so sánh vai trò title vs H1.
- **User hỏi thẳng "viết H1 là như nào"** → dạy lại từ đầu bằng sơ đồ vị trí (title ở tab trình
  duyệt + SERP, H1 là chữ to nhất trên trang), quan hệ H1→H2→H3 = mục lục, và chỉ đúng chỗ sửa
  trong CMS. Ghi nhận: khái niệm này chưa vững ở buổi 12/07, cần kiểm lại khi audit Buổi 16.
- **Bảng title + H1 CHỐT (chưa áp lên site)**:
  | Trang | Title | H1 |
  |---|---|---|
  | `/` | giữ nguyên (đã đạt) | đã có |
  | `/products` | `Băng tải cao su, con lăn & vật tư mỏ \| CTCP Tiến Vũ` | `Băng tải cao su, con lăn & vật tư khai thác mỏ` |
  | `/construction` | `Công trình băng tải cao su & con lăn cho mỏ đá \| Tiến Vũ` | đã có |
  | `/services` | `Khảo sát, lắp đặt & nối băng tải cao su \| CTCP Tiến Vũ` | đã có |
  | `/about` | `CTCP Tiến Vũ — nhà cung cấp băng tải cao su & vật tư mỏ` | đã có |
  | `/contact` | `Liên hệ & báo giá băng tải cao su, con lăn \| Tiến Vũ` | `Gửi bản vẽ, nhận tư vấn quy cách và báo giá — kể cả ngoài giờ` |
  | `/blog` | `Kiến thức băng tải cao su & con lăn cho mỏ đá \| Tiến Vũ` | `Chọn, lắp đặt và bảo trì băng tải cao su cho mỏ đá` |
- **Chỗ sửa đã dò ra chính xác**: `/products` title+desc = `frontend/messages/vi.json:46-47`
  (+ `en.json`); `/products` H1 hardcode `products/index.js:64`. 5 trang còn lại
  (`/about /services /contact /blog /construction`) lấy title từ `pageConfig.page` qua CMS →
  sửa trong admin, zero-code. H1 cần tìm ô "heading level" trong section CMS; nếu section không
  có ô đó thì phải thêm 1 dòng vào component section.
- **Business context mới (user kể 27/07)**: phản hồi khách rất nhanh, **kể cả ngoài giờ hành
  chính**; khảo sát chủ yếu **qua bản vẽ trước** vì công trình xa, đi khảo sát mà không chốt đơn
  thì tốn chi phí. → Dùng làm H1 `/contact`, và lộ ra lệch giữa content site (hứa "khảo sát tận
  nơi" 5 chỗ) và quy trình thật (xem Action items §3, mục cuối).
