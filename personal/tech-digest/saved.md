# Đã lưu để đọc sau (saved) — tech-digest

> Read-it-later cá nhân. Khi digest chạy, mỗi bài có số thứ tự; gõ
> `/tech-digest save <N...>` để lưu bài #N vào đây (URL + title + why + ngày digest).
> Xem bằng `/tech-digest saved` (mới nhất trước). Đọc xong bài #N trong danh sách này
> thì `/tech-digest saved done <N>` — chỉ tick `[x]`, không xoá.
>
> Mỗi mục theo format (append-only, mới thêm lên đầu danh sách):
>
> `- [ ] <title> — <domain> · lưu 2026-07-03 (digest 2026-07-03)`
> `      → <why: 1 dòng vì sao đáng đọc>`
> `      <url>`

<!-- SAVED-LIST (skill đọc & ghi phần dưới dòng này; mục mới chèn ngay dưới marker) -->
- [ ] Personalizing Airbnb search by learning from the guest journey — medium.com/airbnb-engineering · lưu 2026-08-06 (digest 2026-08-06)
      → Transformer-based sequence model encode nhiều NĂM hành vi guest để chọn listing. Pattern personalization từ chuỗi hành vi dài — áp được cho segment/reward theo lịch sử khách.
      https://medium.com/airbnb-engineering/personalizing-airbnb-search-by-learning-from-the-guest-journey-bcefd1915624
- [ ] WebMCP support for Liquid and Hydrogen storefronts — shopify.dev · lưu 2026-08-06 (digest 2026-08-06)
      → Storefront đăng ký 8 tool trực tiếp với browser cho AI agent (catalog, cart, checkout, order, policy/FAQ) — agent hết phải đọc DOM và giả lập click. Tự bật. Giới hạn: origin trial, chỉ Chromium.
      https://shopify.dev/changelog/webmcp-liquid-hydrogen
- [ ] Cloudflare OS: an open platform for agents, apps, and work — blog.cloudflare.com · lưu 2026-08-06 (digest 2026-08-06)
      → Nền tảng open-source: workspace cho agent có context công ty, lớp "Gatekeepers" quản quyền truy cập hệ thống nội bộ, dựng full-stack app trong browser để agent tự chạy.
      https://blog.cloudflare.com/cloudflare-os/
- [ ] Inside the keyv npm Supply Chain Compromise — snyk.io · lưu 2026-08-06 (digest 2026-08-06)
      → 11 release độc, preinstall hook chạy trước cả khi import lib, payload 727KB hút GitHub/npm token + cloud secret. Provenance attestation KÝ HỢP LỆ nên mọi crypto check đều pass. Kiểm tra lockfile.
      https://snyk.io/blog/inside-keyv-npm-compromise-preinstall-malware-trusted-provenance-ide-hooks/
- [ ] Discovery Loop — discoveryloop.com · lưu 2026-08-06 (digest 2026-08-06)
      → Jeff Dean, Sanjay Ghemawat, Quoc Le, Oriol Vinyals lập startup tự động hoá toàn bộ vòng lặp thí nghiệm khoa học, bắt đầu từ ML research.
      https://www.discoveryloop.com/
- [ ] Software Factories, Light and Dark — addyosmani.com · lưu 2026-08-06 (digest 2026-08-06)
      → Nút thắt agentic coding là VERIFY chứ không phải sinh code. Quy tắc "back pressure": chỉ giao autonomy đúng bằng mức verify được rẻ và đáng tin. Dark factory tích comprehension debt; light factory giữ người ở chỗ đắt tiền.
      https://addyosmani.com/blog/software-factories/
- [ ] The AI Aesthetic — blog.jim-nielsen.com · lưu 2026-08-02 (digest 2026-08-02)
      → Jim Nielsen về "mùi AI" trong design: sparkle ✨, streaming/shimmering text, tiny icons (Claude/Codex/Cursor), beige+cam+serif, UI non-deterministic. Lược dịch TV: translations/2026-08-02-the-ai-aesthetic-vi.md
      https://blog.jim-nielsen.com/2026/ai-aesthetic/
- [ ] Hydrogen developer preview release notes: July 8, 2026 — hydrogen.shopify.dev · lưu 2026-07-29 (digest 2026-07-29)
      → Hydrogen thành framework-neutral: `createCustomerSession()` lo trọn login/OAuth/refresh/logout, `getShopifyScriptTags()` dùng được ngoài React, thêm edge caching Storefront API + WebMCP. Breaking: `createStorefrontRequestContext` → `createShopifyRequestContext`, bỏ `shopifyCartGet`.
      https://hydrogen.shopify.dev/update/developer-preview-release-notes-july-8-2026
- [ ] Hydrogen now deploys to Vercel — shopify.dev · lưu 2026-07-03 (digest 2026-07-03)
      → Nút Deploy one-click đưa Hydrogen lên Vercel (tự tạo repo + setup + build), khỏi local setup — liên quan trực tiếp mảng Shopify headless.
      https://shopify.dev/changelog/hydrogen-now-deploys-to-vercel
- [ ] claude-real-video — any LLM can watch a video — github.com · lưu 2026-07-03 (digest 2026-07-03)
      → Cho bất kỳ LLM nào "xem" được video; hữu ích để đưa screen-recording / bug repro cho agent phân tích.
      https://github.com/HUANGCHIHHUNGLeo/claude-real-video
- [ ] The short leash AI coding method for beating Fable — blog.okturtles.org · lưu 2026-07-03 (digest 2026-07-03)
      → Phản đề của vibe coding: review từng diff trong permission prompt, deny khi AI lệch hướng. 163 comments, thread cãi nhau to — đáng đọc cả thread.
      https://blog.okturtles.org/2026/07/short-leash-ai-method/
- [ ] Superpowers 6 — blog.fsck.com · lưu 2026-07-03 (digest 2026-07-03)
      → Framework orchestrate subagent cho Claude Code (plan → TDD → multi-axis review) bản 6: claim nhanh hơn tới 50%, token rẻ hơn tới 60%.
      https://blog.fsck.com/2026/06/15/Superpowers-6/
- [ ] The Safari MCP server for web developers — webkit.org · lưu 2026-07-03 (digest 2026-07-03)
      → WebKit ship MCP server: agent inspect DOM, đọc console, screenshot, computed styles trong Safari thật — cho bug Safari-only, đúng kiểu workflow test-trên-browser.
      https://webkit.org/blog/18136/introducing-the-safari-mcp-server-for-web-developers/
