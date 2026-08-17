# Đã lưu để đọc sau (saved) — tech-digest

> Read-it-later cá nhân. Khi digest chạy, mỗi bài có số thứ tự; gõ
> `/tech-digest save <N...>` để lưu bài #N vào đây (URL + title + why + ngày digest).
> Xem bằng `/tech-digest saved` (mới nhất trước). Đọc xong bài #N trong danh sách này
> thì `/tech-digest saved done <N>` — chỉ tick `[x]`, không xoá.
>
> **Số thứ tự đếm từ trên xuống, 1 = mới lưu nhất.** Mục mới chèn lên đầu nên số sẽ
> dịch xuống — skill đánh số lại toàn danh sách mỗi lần `save`, đừng sửa số bằng tay.
>
> Mỗi mục theo format (append-only, mới thêm lên đầu danh sách):
>
> `- [ ] 1. <title> — <domain> · lưu 2026-07-03 (digest 2026-07-03)`
> `      → <why: 1 dòng vì sao đáng đọc>`
> `      <url>`

<!-- SAVED-LIST (skill đọc & ghi phần dưới dòng này; mục mới chèn ngay dưới marker, rồi đánh số lại từ 1) -->
- [ ] 1. Claude: System Prompts — platform.claude.com · lưu 2026-08-17 (digest 2026-08-17)
      → Anthropic công bố thẳng system prompt của Claude trong release notes. Tài liệu hiếm: xem chính hãng hướng dẫn model xử lý tool, an toàn, format ra sao — đọc để viết CLAUDE.md và skill theo đúng cách model đã được huấn luyện để hiểu.
      https://platform.claude.com/docs/en/release-notes/system-prompts
- [ ] 2. Three AI Coding Agents, One GitHub Issue: CI/CD Secrets Exposed — labs.cloudsecurityalliance.org · lưu 2026-08-17 (digest 2026-08-17)
      → Một GitHub issue độc là đủ để lừa Claude Code, Gemini CLI và Codex làm lộ secret trong CI/CD. Đúng ba tool đang dùng, đúng kịch bản agent tự đọc issue rồi chạy lệnh. Đọc bề mặt tấn công trước khi cho agent quyền chạm repo/CI.
      https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-cicd-secrets-20260808-csa/
- [x] 3. "Give Claude ways to verify its own work end to end" (Boris Cherny) — x.com · lưu 2026-08-14 (digest 2026-08-14)
      → Chính người tạo Claude Code nói cách dùng đúng: bật auto mode cho permission, để code review + security review chạy mặc định, dùng giao diện quản nhiều agent cùng lúc (Agent view CLI, Desktop, iOS). Verify quan trọng hơn prompt.
      https://x.com/bcherny/status/2077929390806073807
- [ ] 4. DeepSeek Harness developer preview — deepseek.com · lưu 2026-08-14 (digest 2026-08-14)
      → DeepSeek ra harness coding agent riêng, không chỉ model — hướng cả ngành đang đi (harness là chỗ tạo khác biệt, không phải weights). Xem họ thiết kế vòng lặp tool-call/verify thế nào so với Claude Code.
      https://deepseek.com/harness/en/
- [ ] 5. Understanding is the new bottleneck — geoffreylitt.com · lưu 2026-08-14 (digest 2026-08-14)
      → Geoffrey Litt (Ink & Switch): khi viết code đã rẻ, nút thắt chuyển sang việc HIỂU code mà agent vừa đẻ ra. Bài nói về cách thiết kế công cụ quanh đúng cái nút thắt đó.
      https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck
- [ ] 6. How Compaction Works in Pi — earendil.com · lưu 2026-08-14 (digest 2026-08-14)
      → Mổ xẻ cơ chế nén context khi hội thoại dài: agent quyết định giữ/bỏ cái gì khi context đầy. Giải thích trực tiếp vì sao agent "quên" giữa chừng và cách brief lại cho đúng.
      https://earendil.com/posts/compaction-in-pi/
- [ ] 7. Launch HN: Bullet (YC S26) – A Faster Coding Agent — codewithbullet.com · lưu 2026-08-14 (digest 2026-08-14)
      → Coding agent YC S26 đặt cược vào tốc độ. Phần comment HN mới là chỗ đáng đọc: dân dùng agent hàng ngày mổ xẻ đánh đổi latency vs chất lượng.
      https://www.codewithbullet.com
- [ ] 8. NP-overrated — gruhn.me · lưu 2026-08-14 (digest 2026-08-14)
      → Phản biện cách dev hay dùng "NP-hard" như cái cớ bỏ cuộc: nhiều bài toán NP-hard trong thực tế giải rất ổn. Ngắn, hợp mạch DSA.
      https://gruhn.me/blog/2026-08-13/
- [ ] 9. A Decade of AI Platform at Pinterest — medium.com/pinterest-engineering · lưu 2026-08-14 (digest 2026-08-14)
      → Tổng kết 10 năm xây AI platform nội bộ: từng lớp hạ tầng ra đời vì lý do gì và cái gì phải bỏ. Tài liệu system design thực chiến cho hướng senior.
      https://medium.com/pinterest-engineering/a-decade-of-ai-platform-at-pinterest-4e3b37c0f758
- [ ] 10. How Gödel's Proof Works (2020) — quantamagazine.org · lưu 2026-08-14 (digest 2026-08-14)
      → Quanta giải thích định lý bất toàn theo đường đi của chính chứng minh, không né phần kỹ thuật. Nền CS fundamentals mà hầu hết dev chỉ nghe tên.
      https://www.quantamagazine.org/how-godels-proof-works-20200714/
- [ ] 11. A Tale of Dynamic Programming — iagoleal.com · lưu 2026-08-13 (digest 2026-08-13)
      → DP giải thích từ gốc (Bellman equation, fixed point) chứ không phải theo kiểu "học thuộc mẫu bài LeetCode". Đúng hướng nếu muốn hiểu DP thay vì nhớ DP.
      https://iagoleal.com/posts/dynamic-programming/
- [ ] 12. How I use LLMs to learn complex topics — laurentiugabriel.github.io · lưu 2026-08-10 (digest 2026-08-10)
      → Quy trình 4 bước: dựng nền kiến thức → bắt model tự review độ chính xác → render thành simulation tương tác kiểu low-poly Rollercoaster Tycoon → deploy GitHub Pages. Khác "hỏi ChatGPT" ở bước verify + ép ra artifact trực quan thay vì đọc text. Hợp cách chạy /learn.
      https://laurentiugabriel.github.io/blog/articles/how-i-use-llms-to-learn/
- [ ] 13. Improving GPT-5.6 Sol in ChatGPT, expanding GPT-5.6 Luna access for free users — openai.com · lưu 2026-08-07 (digest 2026-08-07)
      → Post chính chủ OpenAI: Sol được tune lại, Luna mở cho tài khoản free. Đọc để biết tier nào giờ dùng được model nào — ảnh hưởng trực tiếp nếu build feature AI cho user không trả tiền.
      https://openai.com/index/improving-gpt-5-6-sol-in-chatgpt/
- [ ] 14. Eval-driven development: Lessons from evaluating GenAI at scale — medium.com/airbnb-engineering · lưu 2026-08-07 (digest 2026-08-07)
      → Airbnb coi eval là hạng mục kỹ thuật hạng nhất chứ không phải việc làm cuối: eval nào chạy lúc nào, ai sở hữu, xử lý sao khi eval và cảm nhận người dùng mâu thuẫn. Đúng bài toán khi ship tính năng GenAI mà không biết đo gì.
      https://medium.com/airbnb-engineering/eval-driven-development-lessons-from-evaluating-genai-at-scale-e817e5ae5788
- [ ] 15. Taste Is All That's Left — notashelf.dev · lưu 2026-08-07 (digest 2026-08-07)
      → Friction khi code trước đây không chỉ là rào cản, nó là giáo trình dạy phán đoán. AI xoá friction thì người mới ship nhanh hơn nhưng bỏ qua đoạn học nghề đó. Câu hỏi chuyển từ "làm được không" sang "cái này có nên tồn tại không".
      https://notashelf.dev/posts/taste-is-all-thats-left
- [ ] 16. Can you reverse engineer an ASIC? — blog.janestreet.com · lưu 2026-08-07 (digest 2026-08-07)
      → Jane Street kể quá trình bóc ngược một con chip chuyên dụng. Đọc như một bài debugging ở tầng thấp nhất có thể — không có source, không có symbol, chỉ có hành vi.
      https://blog.janestreet.com/can-you-reverse-engineer-an-asic/
- [x] 17. GitHub Actions and Pages are experiencing degraded availability — githubstatus.com · lưu 2026-08-07 (digest 2026-08-07)
      → Sự cố đang diễn ra hôm 07/08. Nếu CI fail thì kiểm tra trang này trước khi đi debug pipeline. (Trang incident — sẽ đóng khi GitHub khắc phục xong.)
      https://www.githubstatus.com/incidents/qcvjkzcs7j74
- [ ] 18. Personalizing Airbnb search by learning from the guest journey — medium.com/airbnb-engineering · lưu 2026-08-06 (digest 2026-08-06)
      → Transformer-based sequence model encode nhiều NĂM hành vi guest để chọn listing. Pattern personalization từ chuỗi hành vi dài — áp được cho segment/reward theo lịch sử khách.
      https://medium.com/airbnb-engineering/personalizing-airbnb-search-by-learning-from-the-guest-journey-bcefd1915624
- [ ] 19. WebMCP support for Liquid and Hydrogen storefronts — shopify.dev · lưu 2026-08-06 (digest 2026-08-06)
      → Storefront đăng ký 8 tool trực tiếp với browser cho AI agent (catalog, cart, checkout, order, policy/FAQ) — agent hết phải đọc DOM và giả lập click. Tự bật. Giới hạn: origin trial, chỉ Chromium.
      https://shopify.dev/changelog/webmcp-liquid-hydrogen
- [ ] 20. Cloudflare OS: an open platform for agents, apps, and work — blog.cloudflare.com · lưu 2026-08-06 (digest 2026-08-06)
      → Nền tảng open-source: workspace cho agent có context công ty, lớp "Gatekeepers" quản quyền truy cập hệ thống nội bộ, dựng full-stack app trong browser để agent tự chạy.
      https://blog.cloudflare.com/cloudflare-os/
- [ ] 21. Inside the keyv npm Supply Chain Compromise — snyk.io · lưu 2026-08-06 (digest 2026-08-06)
      → 11 release độc, preinstall hook chạy trước cả khi import lib, payload 727KB hút GitHub/npm token + cloud secret. Provenance attestation KÝ HỢP LỆ nên mọi crypto check đều pass. Kiểm tra lockfile.
      https://snyk.io/blog/inside-keyv-npm-compromise-preinstall-malware-trusted-provenance-ide-hooks/
- [ ] 22. Discovery Loop — discoveryloop.com · lưu 2026-08-06 (digest 2026-08-06)
      → Jeff Dean, Sanjay Ghemawat, Quoc Le, Oriol Vinyals lập startup tự động hoá toàn bộ vòng lặp thí nghiệm khoa học, bắt đầu từ ML research.
      https://www.discoveryloop.com/
- [ ] 23. Software Factories, Light and Dark — addyosmani.com · lưu 2026-08-06 (digest 2026-08-06)
      → Nút thắt agentic coding là VERIFY chứ không phải sinh code. Quy tắc "back pressure": chỉ giao autonomy đúng bằng mức verify được rẻ và đáng tin. Dark factory tích comprehension debt; light factory giữ người ở chỗ đắt tiền.
      https://addyosmani.com/blog/software-factories/
- [ ] 24. The AI Aesthetic — blog.jim-nielsen.com · lưu 2026-08-02 (digest 2026-08-02)
      → Jim Nielsen về "mùi AI" trong design: sparkle ✨, streaming/shimmering text, tiny icons (Claude/Codex/Cursor), beige+cam+serif, UI non-deterministic. Lược dịch TV: translations/2026-08-02-the-ai-aesthetic-vi.md
      https://blog.jim-nielsen.com/2026/ai-aesthetic/
- [x] 25. Hydrogen developer preview release notes: July 8, 2026 — hydrogen.shopify.dev · lưu 2026-07-29 (digest 2026-07-29)
      → Hydrogen thành framework-neutral: `createCustomerSession()` lo trọn login/OAuth/refresh/logout, `getShopifyScriptTags()` dùng được ngoài React, thêm edge caching Storefront API + WebMCP. Breaking: `createStorefrontRequestContext` → `createShopifyRequestContext`, bỏ `shopifyCartGet`.
      https://hydrogen.shopify.dev/update/developer-preview-release-notes-july-8-2026
- [x] 26. Hydrogen now deploys to Vercel — shopify.dev · lưu 2026-07-03 (digest 2026-07-03)
      → Nút Deploy one-click đưa Hydrogen lên Vercel (tự tạo repo + setup + build), khỏi local setup — liên quan trực tiếp mảng Shopify headless.
      https://shopify.dev/changelog/hydrogen-now-deploys-to-vercel
- [ ] 27. claude-real-video — any LLM can watch a video — github.com · lưu 2026-07-03 (digest 2026-07-03)
      → Cho bất kỳ LLM nào "xem" được video; hữu ích để đưa screen-recording / bug repro cho agent phân tích.
      https://github.com/HUANGCHIHHUNGLeo/claude-real-video
- [ ] 28. The short leash AI coding method for beating Fable — blog.okturtles.org · lưu 2026-07-03 (digest 2026-07-03)
      → Phản đề của vibe coding: review từng diff trong permission prompt, deny khi AI lệch hướng. 163 comments, thread cãi nhau to — đáng đọc cả thread.
      https://blog.okturtles.org/2026/07/short-leash-ai-method/
- [ ] 29. Superpowers 6 — blog.fsck.com · lưu 2026-07-03 (digest 2026-07-03)
      → Framework orchestrate subagent cho Claude Code (plan → TDD → multi-axis review) bản 6: claim nhanh hơn tới 50%, token rẻ hơn tới 60%.
      https://blog.fsck.com/2026/06/15/Superpowers-6/
- [ ] 30. The Safari MCP server for web developers — webkit.org · lưu 2026-07-03 (digest 2026-07-03)
      → WebKit ship MCP server: agent inspect DOM, đọc console, screenshot, computed styles trong Safari thật — cho bug Safari-only, đúng kiểu workflow test-trên-browser.
      https://webkit.org/blog/18136/introducing-the-safari-mcp-server-for-web-developers/
