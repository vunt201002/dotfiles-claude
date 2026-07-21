# Research 2026-07-20 — Làm Claude "thông minh" hơn

> Tổng hợp từ 6 research agent (3 về design-eye cho UI bug fixing, 3 về workflow/skills/cách dùng
> Claude Code). Mọi claim đều có nguồn — link ở từng mục. Doc này là INPUT cho các đợt nâng cấp;
> lộ trình đề xuất ở cuối.

## TL;DR — một kết luận hội tụ từ cả 3 hướng research

Kỷ luật prompt của hệ hiện tại (workflow.md gates, iron law, red-team, blast radius) đã thuộc
nhóm đầu — không cần thêm prose. Cái đang thiếu, và là chỗ mọi nguồn giỏi nhất (Anthropic official
+ senior devs + repo cộng đồng) đều hội tụ:

**Chuyển kỷ luật từ PROSE (khuyên bảo) sang MÁY MÓC (cưỡng chế + tự đo).**

Số đo được cite (Merlin Mann gist tổng hợp từ Willison): quy tắc bằng prose ≈ **25-40% tuân thủ**,
blocking hook ≈ **95%**. Anthropic chính thức xếp thang verify: deterministic script (Stop hook)
> fresh-model evaluator (/goal) > fresh-context subagent reviewer > LLM-as-judge. Nguyên tắc lõi:
**người làm không được tự chấm bài mình** — và checker tốt nhất là cái máy chạy được.

Nguyên tắc chống meta-work đi kèm (Willison): **chỉ build hook/cơ chế SAU KHI quan sát được một
failure thật — không bao giờ build cho tình huống giả định.** Đây là phanh quan trọng nhất khi
áp dụng doc này.

---

## PHẦN 1 — Nâng cấp hệ thống (workflow / skills / cách dùng)

### Nhóm 1: Prose → Machinery (đòn bẩy lớn nhất)

**1.1. Blocking hooks cho các iron law hiện có.**
Iron Law ("no fix without proven root cause"), lint/typecheck sau edit, cấm lệnh nguy hiểm —
hiện toàn nằm trong skill text (tầng 25-40%). Chuyển thành:
- `PostToolUse` hook: prettier/eslint/tsc **chỉ trên file vừa edit** (rẻ, mỗi edit).
- `Stop` hook: full typecheck + test suite **một lần lúc kết thúc turn** — chặn turn kết thúc khi
  chưa pass (exit 2 + stderr = Claude đọc lý do và tự sửa). Tách changed-vs-project theo
  [claudekit](https://github.com/carlrannaberg/claudekit) — full tsc mỗi edit tốn ~25 phút
  wall-clock/feature, đừng làm.
- `PreToolUse` hook: chặn `rm -rf`, đọc `.env`, edit file protected — chạy **trước cả permission
  check, kể cả bypassPermissions mode**.
- Mẫu tham khảo: [claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery)
  (3.8k★), [tdd-guard](https://github.com/nizos/tdd-guard) (2.3k★ — PreToolUse validator chặn
  implement-không-có-red-test; đúng Iron Law của mình dạng deterministic).
- Docs: https://code.claude.com/docs/en/hooks-guide (30+ events; prompt-hook = Haiku chấm điều
  kiện; agent-hook = subagent có tool access verify lúc Stop).

**1.2. `/goal` — evaluator độc lập chấm "xong chưa" sau mỗi turn.**
Đặt điều kiện hoàn thành đo được ("tests in X pass + lint clean + không sửa file test khác +
dừng sau 20 turn") → một Haiku fresh chấm sau mỗi turn, lý do "chưa đạt" tự thành chỉ thị turn
sau. Chạy được cả trong `claude -p`. Docs: https://code.claude.com/docs/en/goal

**1.3. Compaction-proof context injection** (trick của Superpowers).
`SessionStart` hook với `matcher: "compact"` → re-inject block 20 dòng (iron laws + skill index +
trạng thái worklog) **sau mỗi lần compact**. Hiện tại context injection của đa số setup chết
lặng lẽ khi compact — nested CLAUDE.md cũng KHÔNG được re-inject sau compact (chỉ root).

**1.4. CLAUDE.md diet + `.claude/rules/*.md` có `paths:` frontmatter.**
Official: CLAUDE.md nên < 200 dòng; file phình = Claude bỏ qua rule ("nếu xoá dòng này Claude có
sai không? Không → cắt"). Rule theo path (`paths: ["**/widget/**"]`) chỉ load khi đụng đúng file
— kiến thức Joy-widget-v4 / Wishlist-polaris thuộc dạng này. `/doctor` có đề xuất trim tự động.
Docs: https://code.claude.com/docs/en/memory

### Nhóm 2: Bộ não tự lớn (compound loop) — đúng vision "1 bộ não"

**2.1. Return arrow — vault phải có cạnh ĐỌC LẠI bắt buộc.**
[compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) (23k★):
sau mỗi unit việc, learnings ghi vào `docs/solutions/`; và **brainstorm/plan tiếp theo bắt buộc
grep đọc thư mục đó trước**. Mình có vault (joy-note, brain-vault, pattern library sắp có) nhưng
thiếu cạnh read-back cưỡng chế — thêm 1 dòng vào đầu /my-bug-hunter, /implement, /fix-bug:
"search pattern library + solutions trước khi đề xuất approach". "Each unit of work makes
subsequent units easier."

**2.2. Mistake→mechanism ratchet** (Hashimoto / Huntley / Böckeler).
Bước đóng của /investigate + /my-bug-hunter: "failure class này có đáng đẻ ra 1 lint rule /
validation script / hook / dòng pattern không? Có → viết luôn." Mỗi lỗi lặp lại của agent = một
cơ chế mới, vĩnh viễn. Cùng họ với nghi thức ghi pattern của design-eye.

**2.3. Episodic memory (optional, sau).**
[Superpowers](https://github.com/obra/superpowers) + [claude-mem](https://github.com/thedotmack/claude-mem):
index transcript `~/.claude/projects/*.jsonl` vào SQLite+vector, search **qua subagent** (search
trượt không làm bẩn context chính). Bổ sung chứ không thay vault curated. Chỉ adopt khi vault
chứng tỏ không đủ — ambient + curated cùng lúc dễ thành "context soup".

### Nhóm 3: Repo-as-harness (làm REPO thông minh lên, không chỉ agent)

**3.1. Lint/error message viết cho agent đọc** ("positive prompt injection" — Böckeler,
martinfowler.com/articles/harness-engineering.html). Viết lại top-10 message lỗi lint/test hay
gặp của repo Wishlist thành lời nhắn cho agent: "Đừng thêm X để fix cái này; config thật nằm ở Y,
sửa ở đó." Guidance 0 token, đến đúng lúc cần.

**3.2. Logging as agent infrastructure** (Ronacher, lucumr.pocoo.org/2025/6/12/agentic-coding).
Dev server tee structured log ra 1 file path cố định (ghi trong CLAUDE.md của app); debug mode in
payload side-effect (webhook, email, OTP) vào log để agent tự đọc runtime — kênh bổ sung cho
screenshot trong my-frontend-fix. Rất hợp app Shopify (webhook flows).

**3.3. Feedback-speed audit.** Ronacher: tốc độ vòng lặp (1 test chạy mất bao lâu, typecheck bao
lâu) chi phối năng suất agent hơn mọi prompt. Đo và tối ưu ở repo app.

### Nhóm 4: Kỹ thuật session / review nâng cao

**4.1. Two-stage review: spec-compliance TRƯỚC code-quality** (Superpowers 4). Reviewer #1 chỉ
nhận plan + diff: "có build đúng cái plan nói không?" (bắt silent scope drift — Böckeler đo được
review-vs-spec bắt 60-70% lỗi). Rồi mới reviewer #2 chấm chất lượng. Ghép vào bước đóng A8/B9.

**4.2. "Should we hire this reviewer?"** (Jesse Vincent). Output của /codex challenge đưa lại
main session dưới framing: "Một reviewer bên ngoài phân tích thế này — nên 'tuyển' không? Finding
nào THẬT?" → được triage thật thay vì gật đầu sửa theo mọi finding. + Cảnh báo official: reviewer
được prompt "tìm gap" thì LUÔN tìm ra gap — phải giới hạn "chỉ flag cái ảnh hưởng correctness".

**4.3. Competing-hypotheses cho bug round-2-fail** (official agent-teams pattern). 3-5 agent, MỖI
agent ôm 1 giả thuyết root cause khác nhau và **cố bác bỏ giả thuyết của nhau**. Fix-bugs-parallel
hiện chia THEO BUG; cái này chia THEO GIẢ THUYẾT trong 1 bug khó — cơ chế chống anchoring mà
my-bug-hunter chưa có.

**4.4. Scout pattern** (Willison/Bleecher Snyder). Trước khi plan feature khó: thả 1 agent nháp
làm thử trong worktree, KHÔNG merge — tập file nó đụng + chỗ nó kẹt = bản đồ blast radius thật
cho plan. Code vứt đi.

**4.5. Tripwires.** Hashimoto: 3-4 lần fix fail cùng 1 bug → agent là "liability", dừng, làm tay
hoặc re-scope. Official: sửa Claude 2 lần cùng 1 lỗi → `/clear` + viết lại prompt đầu tốt hơn
(session sạch + prompt tốt > session dài + chồng correction).

**4.6. Skill audit: description = WHEN, không phải WHAT** (bài học Superpowers 4 — model claim
"đã dùng skill" mà không đọc; fix = description thuần trigger-condition). Cân nhắc consolidate
skill chồng lấn (Jesse merge 3 skill debug thành 1 vì "nhiều skill giống nhau làm hỏng
triggering") — audit thôi, chưa chắc cần.

**4.7. EARS spec format + spec-traceability** (Kiro). Acceptance criteria viết dạng "WHEN
[condition] THE SYSTEM SHALL [behavior]" — mỗi clause map 1:1 sang một red test; review cuối chấm
diff theo từng clause. Bơm thẳng vào A1/A5 hiện có.

### Nhóm 5: Nice-to-have (10 phút mỗi cái)

- **Dynamic injection trong skill**: `` !`git diff HEAD` `` chạy trước khi Claude đọc skill —
  state đến sẵn, đỡ 1-2 turn. + `allowed-tools` frontmatter (hết permission prompt trong skill),
  `context: fork` cho skill nặng. Docs: https://code.claude.com/docs/en/skills
- **Interview pattern**: "Interview me one question at a time (AskUserQuestion) → SPEC.md" → chạy
  implement ở **session mới sạch**.
- **`/compact <chỉ thị>`** (compact có hướng), **`/btw`** (hỏi lề không vào history), `/context`
  (audit cái gì đang chiếm context).
- **ccstatusline + ccusage**: hiện % context-window + cost trên statusline → compact chủ động
  thay vì bị compact bất ngờ giữa investigation.
- **ultrathink** cho bài thật khó; Tab toggle thinking cho phase plan/root-cause.

### Skip list (đánh giá thẳng: hype hoặc thừa với mình)

- **ruflo/claude-flow** (65k★): swarm theater — Byzantine consensus cho coding agent là
  resume-driven architecture, benchmark tự công bố. Skip.
- **claude-squad**: TUI quản worktree song song — mình đã có nếp worktree/subagent. Marginal.
- **awesome-claude-skills mega-lists**: prompt pack, mật độ cơ chế thấp. Skim, đừng học.
- **claude-mem wholesale**: chỉ khi vault curated chứng tỏ thiếu.
- **Ralph loop** (`while :; do cat PROMPT.md | claude; done`): chính tác giả nói "no way in heck
  dùng cho existing codebase" — chỉ giữ trong túi cho migration cơ học overnight có test suite
  làm backpressure.

---

## PHẦN 2 — Design-eye (nửa não designer) — seed data đã research

Kiến trúc đã đề xuất: KHÔNG thêm skill mới — 1 reference `design-eye.md` trong my-frontend-fix +
nâng my-frontend-fix + nối fix-bug/fix-bugs-parallel/workflow.md. Research bổ sung 4 cơ chế:

1. **Điểm 0-10 từng dimension + ngưỡng = điều kiện dừng loop** ("nhìn ổn rồi" không terminate
   được loop; điểm số thì có). Nguồn: OneRedOak, dylanfeltus visual-qa, Visual Verdict QA.
2. **2 tầng check: cơ học trước (DOM/computed styles, deterministic — spacing ∈ scale, touch
   ≥44px, contrast ≥4.5:1, không h-scroll 375px, console sạch), taste sau (mắt nhìn — hierarchy,
   eye-flow).** Nguồn: ibelick/ui-skills (5.6k★).
3. **Grounded findings**: mỗi phát hiện = element/region + số đo + screenshot. Cấm "spacing feels
   off". Paper Google (arXiv 2412.16829) đo được localize làm tăng chất lượng critique.
4. **Negative pattern list**: tích lũy điều CẤM cụ thể của app mình — specific negation lái model
   mạnh hơn positive guidance (Anthropic frontend-design skill insight).

Nguồn chính: [OneRedOak/claude-code-workflows](https://github.com/OneRedOak/claude-code-workflows)
(7-phase, Live Environment First, [Blocker]/[High]/[Medium]/[Nitpick], tách design-principles.md
per-project), [anthropics/skills frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md),
[Tweag visual feedback loop](https://tweag.github.io/agentic-coding-handbook/WORKFLOW_VISUAL_FEEDBACK/)
(screenshot nói CÁI GÌ sai + DOM interrogation nói VÌ SAO).

### Seed: bảng pattern UI/CSS (28 ứng viên, chọn ~20)

| # | Triệu chứng | Root cause class | Nhận diện nhanh |
|---|---|---|---|
| 1 | Text/card tràn flex container, ellipsis không ăn | flex item `min-width:auto` không co dưới content | con của flex; thêm `min-width:0` là hết |
| 2 | Cột grid "nổ" bề ngang trang | `1fr` = `minmax(auto,1fr)`; con rộng ép min size | con grid có content không bẻ được; `minmax(0,1fr)` |
| 3 | Scrollbar ngang màn hẹp, item bị ép | flex mặc định `nowrap` | hàng item không bao giờ wrap; check `flex-wrap` |
| 4 | `z-index:99999` vẫn chìm | kẹt trong stacking context của ancestor | z-index to mà "không ăn" → tìm ancestor có transform/filter/opacity/will-change |
| 5 | `position:fixed` trôi theo scroll / sai chỗ | ancestor transform/filter thành containing block | fixed chỉ hỏng trong wrapper có animate/transition |
| 6 | Nội dung đáy bị toolbar mobile che | `100vh` = largest viewport trên mobile | có `100vh` + chỉ kêu trên mobile; dùng `svh`/`dvh` |
| 7 | Layout nhảy khi scroll mobile | `dvh` re-resolve khi chrome co giãn | height theo dvh; layout tĩnh dùng svh |
| 8 | iPhone zoom vào khi tap input, không zoom ra | iOS auto-zoom input font < 16px computed | chỉ iOS, lúc focus; check rendered font-size |
| 9 | Scroll trong modal/widget kéo cả trang | scroll chaining tại biên | chạm đáy inner scroller thì body trôi; `overscroll-behavior:contain` |
| 10 | Như trên nhưng widget là iframe, thuộc tính "không ăn" | set trên iframe element thay vì document bên trong | phải set trên html/body TRONG iframe |
| 11 | Bottom bar chui dưới home indicator / notch đè header | `viewport-fit=cover` thiếu `env(safe-area-inset-*)` | chỉ hỏng trên iPhone tai thỏ |
| 12 | Bàn phím che input; widget nhúng trôi khỏi màn | layout viewport ≠ visual viewport khi mở keyboard; iOS scroll parent | iOS + input trong iframe/fixed; cần visualViewport API |
| 13 | Khoảng cách dọc lúc có lúc không | margin collapse | margin dọc kề nhau = max không phải sum; padding/flex parent chặn được |
| 14 | Ảnh card méo | ép ratio container không có `object-fit` | img có w+h cứng; thêm `object-fit:cover` |
| 15 | Username/URL dài phá layout | không có chiến lược overflow cho dynamic content | chuỗi user-generated; `overflow-wrap:anywhere`/ellipsis |
| 16 | Content tràn đáy box | `height` cứng thay vì `min-height` | height hardcode + content dài hơn design (bản dịch!) |
| 17 | 2 item `space-between` văng 2 mép | space-between chia theo count | chỉ vỡ khi ít item hơn dự kiến; dùng `gap` |
| 18 | Cả trang xê ngang khi đổi trang ngắn/dài | scrollbar hiện/ẩn đổi width viewport | desktop ~15px; `scrollbar-gutter:stable` |
| 19 | Sticky không dính trong grid | con grid bị stretch full track | `align-self:start` |
| 20 | Chữ trên hero ảnh không đọc được khi ảnh fail/chậm | thiếu background-color fallback dưới text | throttle network để thấy |
| 21 | Style biến mất sau khi thêm selector variant | 1 selector invalid giết cả rule gộp | rule gộp phẩy có vendor/pseudo; tách ra |
| 22 | Hover "dính" sau khi tap mobile | touch giả lập hover | chỉ mobile; bọc `@media (hover:hover)` |
| 23 | `calc()`/style vỡ khi biến JS chưa set | `var()` không fallback → invalid | style phụ thuộc custom property JS bơm; `var(--x, fallback)` |
| 24 | 1 item grid giãn full-width thay vì cỡ card | `auto-fit` collapse track rỗng | nhiều item thì đẹp, 1 item thì sai; cân nhắc `auto-fill` |
| 25 | Ảnh rộng hơn màn mobile | thiếu `img{max-width:100%}` (widget nhúng không có reset) | raw img overflow; theme thiếu reset |
| 26 | Nút/link khó bấm mobile | target < 24px (WCAG 2.5.8) / 44pt (HIG) / 48dp (Material) | đo hit area render gồm padding, không phải icon |
| 27 | Widget chỉ hỏng trên MỘT SỐ theme | CSS host page bleed vào widget (reset, `!important`, inherit) | repro theo theme; diff computed styles vs trang sạch; fix = scoping/shadow DOM |
| 28 | Modal/dropdown bị cắt ở mép container | ancestor `overflow:hidden` (hoặc transform) clip popout | popout đứt đúng biên 1 parent; walk ancestors |

Nguồn: defensivecss.dev/tips · web.dev/blog/viewport-units · smashingmagazine.com 2026/01
unstacking-css-stacking-contexts · MDN overscroll-behavior · CSS-Tricks (grid blowout, flexbox
truncated text, 16px iOS zoom, the notch) · WCAG 2.5.8 / HIG / Material.

### Seed: rubric designer 15 câu (binary)

1. Spacing scale: mọi margin/padding thuộc 1 scale nhất quán (4/8/16/24/32...), không có 13px/22px lẻ?
2. Proximity: khoảng cách GIỮA nhóm > khoảng cách TRONG nhóm?
3. Alignment: mọi element bám chung mép/grid line — không lệch 1-3px so với siblings?
4. Hierarchy: nhận ra ngay hành động/thông tin chính (bằng weight + màu, không chỉ size)?
5. Type: font family/size/weight/line-height theo đúng hệ (≤2 family, scale giới hạn)?
6. Color tokens: nền/chữ/viền/icon dùng token, không hex gần-đúng hardcode?
7. States: mọi element tương tác có đủ default/hover/focus-visible/active/disabled? (mục bị miss nhiều nhất)
8. System status: loading/empty/error có thật và trông chủ đích (không blank/vỡ)?
9. Touch: mọi target ≥24×24 CSS px (lý tưởng 44pt/48dp) tính cả padding, không chồng nhau?
10. Content stress: sống sót text rất dài / rất ngắn / ảnh missing / 2× số item?
11. Responsive: 375/768/1280 — zero h-scroll, không chồng/cắt element?
12. Mobile chrome & notch: không gì bị toolbar/keyboard/safe-area che?
13. Component consistency: button/card/input giống hệt nhau ở mọi nơi xuất hiện (radius/shadow/padding)?
14. Contrast: chữ đạt 4.5:1 body / 3:1 large trên nền THẬT (kể cả trên ảnh lúc xấu nhất)?
15. Motion: duration/easing nhất quán; không gì shift layout bất ngờ (scrollbar, font swap, ảnh load)?

### Seed: chuẩn Shopify — BFS/Polaris (con số thật, nguồn shopify.dev + polaris-react.shopify.com)

**Số cứng:** Polaris space tokens = bội 4px (space-100=4 · 200=8 · 300=12 · 400=16 · 600=24 ·
800=32; card padding/gap 16px, button-group gap 8px). Breakpoints: sm=490, md=768, lg=1040,
xl=1440. Touch ≥44px + cách nhau ≥10px. Text ≥13px (caption ≥12px), contrast ≥4.5:1 (WCAG AA).
Admin Web Vitals p75: LCP ≤2.5s, CLS ≤0.1, INP ≤200ms. Widget: JS ≤10KB gzip/block, Liquid
≤100KB, Lighthouse delta ≤10 điểm, icon ≤24×24 với hit-box 44×44.

**Lý do reject BFS hay dính (nguyên văn checklist reviewer):** content không nằm trong card /
nền không chuẩn admin · >1 primary button per card, primary button trong table · lỗi hiển thị
bằng toast tự tắt thay vì đỏ-inline-persistent (và không show lỗi TRƯỚC khi user tương tác) ·
form không dùng App Bridge Contextual Save Bar · custom sidebar thay vì `s-app-nav` · sub-page
không có back · tab đổi content PHÍA TRÊN tab · ≥2 banner cạnh nhau · đỏ dùng ngoài error/destructive
· modal không dùng `s-modal` đúng slot · mobile: horizontal scroll cả trang, 2 cột không stack
dưới 490px, content bị ẩn không mở được · spacing lệch hẳn admin · serif/script font · claim
kết quả đảm bảo ("tăng sales 18%"), countdown, xin 5 sao đổi thưởng · auto-open modal/popover.

**Widget storefront:** kế thừa typography/màu từ theme (computed font-family = theme body font);
mọi selector scoped dưới wrapper class, zero bare element selector, zero `!important` đè theme,
không global reset; responsive theo section cha (không fixed width); assets load qua schema (chỉ
trang có block).

**Tool:** stylelint-polaris (40+ rule chặn hardcode màu/space/typography ngoài token) · Shopify
Theme Check (`AssetSizeJavascript` 10KB). Docs gốc: shopify.dev/docs/apps/launch/built-for-shopify/requirements
· /docs/apps/design (4px grid) · /docs/apps/build/online-store/theme-app-extensions/ux.

---

## PHẦN 3 — Lộ trình áp dụng đề xuất

**Nguyên tắc:** mỗi cơ chế chỉ build khi trỏ được vào một failure THẬT đã quan sát (chống
meta-work trap). Ưu tiên theo ROI cho task BFS đang chạy.

### Phase 1 — làm ngay (1-2 buổi, ăn thẳng vào BFS)
1. **Design-eye build** (4 file như đề xuất — seed data ở Phần 2 đã đủ).
2. **Hooks starter** (3 cái, mỗi cái trỏ vào failure đã thấy): PostToolUse lint/tsc-on-changed ·
   Stop-hook full check · PreToolUse dangerous-command guard. Đặt ở repo app (Wishlist/Joy).
3. **SessionStart compaction-proof injection** (iron laws + worklog pointer).

### Phase 2 — tuần sau (compound loop + review sắc hơn)
4. Return arrow: bước "đọc pattern library/solutions trước" vào my-bug-hunter//implement/fix-bug.
5. Mistake→mechanism ratchet: bước đóng trong /investigate + /my-bug-hunter.
6. Two-stage review (spec-compliance trước quality) vào A8/B9 + framing "should we hire this
   reviewer?" cho /codex output.
7. Tripwire: 3-4 strike → dừng làm tay; 2 correction → /clear + prompt mới.

### Phase 3 — làm trong lúc code BFS (repo-as-harness, ở repo Wishlist)
8. Agent-addressed error messages cho top lỗi lint/test hay gặp.
9. Structured log file cho dev server + debug-mode payload (webhook/email) — path ghi CLAUDE.md.
10. `.claude/rules/*.md` paths-scoped cho kiến thức per-area.

### Backlog (khi có failure thật gọi tên)
- /goal thành thói quen cho task dài · EARS format cho spec · scout pattern trước feature khó ·
  competing-hypotheses cho round-2-fail bug · skill-description audit (WHEN not WHAT) ·
  episodic memory · ccstatusline context% · dynamic injection trong skill.
