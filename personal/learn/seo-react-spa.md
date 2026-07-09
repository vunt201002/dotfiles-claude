---
topic: SEO toàn diện (content + technical + off-page) — áp dụng tienvu-bt, hướng nghề SEO
mode: plan
status: in-progress
started: 2026-06-24
last_session: 2026-07-10
next_start: "Bắt đầu Buổi 3 — Content Strategy: Topic Cluster & Pillar Page + E-E-A-T. Map content hiện có của tienvu-bt (blog + policies + product) vào 1 cluster structure."
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

## Đang kẹt / chưa rõ
- (chưa có)

## Lộ trình (PLAN) / Nguồn — CHIA THEO PHASE

### Phase 0 — Nền tảng ✅ DONE
- [x] Buổi 1 — Search engine 3 phase + JS rendering two-wave (xem "Đã học")

### Phase 1 — Content & Strategy (mảng mới hoàn toàn, ưu tiên học trước)
- [x] Buổi 2 — Keyword Research & Search Intent (DONE 2026-07-10, xem "Đã học"):
      https://www.semrush.com/blog/search-intent/
- [ ] Buổi 3 — Content Strategy: Topic Cluster & Pillar Page (hub-and-spoke), E-E-A-T (Experience-
      Expertise-Authoritativeness-Trustworthiness — quan trọng cho B2B industrial vì cần "trust").
      Thực hành: map content hiện có (blog + policies + product) của tienvu-bt vào 1 cluster structure:
      https://searchengineland.com/guide/topic-clusters
      https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- [ ] Buổi 4 — On-page content writing: công thức title tag/meta description, heading hierarchy,
      keyword đặt tự nhiên (không nhồi nhét), internal linking. Thực hành: viết lại 1 trang thật của
      tienvu-bt theo checklist:
      https://developers.google.com/search/docs/fundamentals/seo-starter-guide

### Phase 2 — Technical SEO (dev có lợi thế, học nhanh hơn)
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
