---
type: concept
created: 2026-07-10
updated: 2026-07-10
tags: [learn]
---
# Next.js Pages Router vs App Router

Hai router hoàn toàn khác nhau trong Next.js, không tương thích lẫn nhau.

**Pages Router** (cũ): routing theo file trong `pages/` (`pages/[slug].js` = route động). Data
fetching qua 3 hàm: `getStaticProps` (SSG, build time), `getServerSideProps` (SSR, mỗi request),
`getStaticPaths` (khai báo path cho route động). SEO/meta qua component `<Head>` từ `next/head`, đặt
thủ công trong mỗi page. Layout chung qua `_app.js` (không lồng được). Component mặc định là Client
Component (hydrate ở browser dù render sẵn server-side).

**App Router** (mới, Next 13+, thư mục `app/`): routing theo folder + file tên cố định
(`app/page.js`, `app/layout.js`, `app/[slug]/page.js`). Data fetching: `fetch()` trực tiếp trong
Server Component (`async function`), Next tự cache/dedupe. SEO/meta qua `export const metadata` hoặc
`generateMetadata()` (Metadata API). Layout lồng được theo cây thư mục. Component mặc định là Server
Component (không gửi JS xuống browser trừ khi khai báo `'use client'`).

**Đánh đổi**: App Router nhẹ JS hơn, layout lồng được, streaming — nhưng phức tạp hơn (ranh giới
Server/Client, cache rules dễ gây bug lạ) và mới hơn (2023+, ít ổn định bằng). Pages Router đơn giản,
ổn định, nhiều năm production nhưng thiếu tính năng mới nhất.

**Quan trọng**: SEO KHÔNG phụ thuộc router — cả 2 đạt HTML đầy đủ + meta đúng + Core Web Vitals tốt
nếu làm đúng. Không có chuyện Pages Router "tệ hơn cho SEO". Migrate router chỉ vì SEO là quyết định
sai cho 1 site đang sống — chi phí migrate lớn hơn nhiều lợi ích thu được.
