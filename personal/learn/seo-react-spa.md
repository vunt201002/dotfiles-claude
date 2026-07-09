---
topic: SEO cho React/SPA web app
mode: plan
status: in-progress
started: 2026-06-24
last_session: 2026-06-24
next_start: "Bắt đầu Buổi 1 — search engine 3 phase + vì sao Next App Router (server-render) đã thắng sẵn phần khó của SPA. Đọc 2 link Google. Rồi check hiểu."
---
## Bối cảnh (CẬP NHẬT)
- User là frontend dev, hướng frontend depth + senior/system design.
- Site THẬT = **Next.js, App Router (app/)**, nhiều page khác nhau, CHƯA làm gì về SEO. Học roadmap trước, audit sau (/browse).
- QUAN TRỌNG: vì là Next App Router (server-render mặc định) → KHÔNG cần phần dynamic rendering/prerendering của SPA thuần. Roadmap đã rút gọn cho Next.
- Dạy tiếng Việt, giữ thuật ngữ English. PLAN mode (Next Metadata API + render modes là version-specific, không lecture từ memory).

## Đã học / nắm được
- (chưa bắt đầu buổi nào — mới lập roadmap Next App Router)

## Đang kẹt / chưa rõ
- (chưa có)

## Lộ trình (PLAN) / Nguồn — cho NEXT.JS APP ROUTER
- [ ] Buổi 1 — Search engine 3 phase + vì sao CSR khó / Next server-render dễ:
      https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
      https://developers.google.com/search/docs/fundamentals/how-search-works
- [ ] Buổi 2 — Rendering App Router: Static(SSG) / Dynamic(SSR) / ISR, chọn mode cho từng page:
      https://nextjs.org/docs/app/getting-started/server-and-client-components
      https://vercel.com/blog/how-to-choose-the-best-rendering-strategy-for-your-app
- [ ] Buổi 3 — Metadata API: metadata object tĩnh + generateMetadata() động (khác next/head cũ):
      https://nextjs.org/docs/app/getting-started/metadata-and-og-images
      https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- [ ] Buổi 4 — File conventions sitemap.ts/robots.ts + JSON-LD structured data:
      https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
      https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
      https://nextjs.org/docs/app/guides/json-ld
- [ ] Buổi 5 — Core Web Vitals cho Next (LCP/INP/CLS, INP thay FID 2024; next/image, next/font):
      https://web.dev/articles/vitals
      https://web.dev/articles/top-cwv
- [ ] Final — Audit site Next thật của user qua /browse theo checklist

## Ghi chú buổi 2026-06-24
- Lúc đầu lập roadmap cho SPA thuần (CSR). User báo site là Next.js App Router → ĐÃ VIẾT LẠI roadmap.
- Khác biệt then chốt: Next App Router render server-side mặc định → bỏ qua dynamic rendering/prerendering;
  trọng tâm = dùng đúng Metadata API + chọn render mode/page + file conventions + CWV. Gọn còn 5 buổi + audit.
- Đã search docs Next chính thống (Metadata API, generateMetadata, sitemap/robots file conventions, json-ld guide).
- User chưa quyết học Buổi 1 luôn hay tự đọc — chờ trả lời.
