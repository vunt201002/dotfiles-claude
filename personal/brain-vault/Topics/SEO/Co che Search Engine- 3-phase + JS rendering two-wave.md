---
type: concept
created: 2026-07-10
updated: 2026-07-10
tags: [learn]
---
# Co che Search Engine: 3-phase + JS rendering two-wave

Google Search có 3 giai đoạn chính:
1. **Crawling** — Googlebot tự tìm URL mới (qua link, sitemap) rồi tải nội dung. Bị chặn bởi lỗi
   server, `robots.txt`, trang cần login.
2. **Indexing** — Google phân tích nội dung (text/ảnh/video/metadata), quyết định trang nào đủ chất
   lượng lưu vào index; nhiều trang trùng nội dung thì "cluster" lại chọn 1 bản canonical đại diện.
   Bị ảnh hưởng bởi chất lượng content, thẻ `noindex`, độ phức tạp JavaScript.
3. **Serving/Ranking** — khi user search, Google match query với index, xếp hạng theo hàng trăm yếu
   tố (độ liên quan, chất lượng, cá nhân hóa theo vị trí/ngôn ngữ/thiết bị).

**JS rendering là "two-wave" (quan trọng cho SPA/CSR)**: với trang có JS, bước Crawl thực ra tách
nhỏ: (1) crawl HTML thô, đọc `<a href>` có sẵn — CHƯA chạy JS; (2) **Render** — nếu status 200, trang
xếp hàng để Google chạy JS thật bằng headless Chromium, bước này KHÔNG tức thời (có thể vài giây tới
lâu hơn nhiều); (3) Index — đọc lại HTML đã render.

Content chỉ xuất hiện SAU khi JS chạy (client-side render thuần) phải đợi hàng Render, không đảm bảo
nhanh. Content có sẵn trong HTML thô (SSR/SSG) thì Google thấy ngay ở bước Crawl. Đây là lý do
SSR/SSG tốt hơn CSR thuần cho SEO.

**Pitfall hay gặp**: fragment routing (`#/products` — Googlebot không đọc được hash URL, dùng History
API thay thế); soft 404 (route động trả HTTP 200 dù không có data thật — nên dùng cơ chế thật của
framework để trả 404 thật, VD Next.js Pages Router: `getServerSideProps` return `{ notFound: true }`
tự set HTTP status 404 thật).

Nguồn: developers.google.com/search/docs/fundamentals/how-search-works,
developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
