# Workflow chuẩn — vunt

> **Nguồn chân lý** cho mọi task code, mọi app (Joy, Wishlist, side projects).
> Workflow **generic**; phần đặc thù từng app nằm ở **Project Adapter**. Component skill ở
> `~/.claude/skills`; doc này là **người chỉ huy** — bảo gọi skill nào, thứ tự nào, dừng ở cổng nào.
> Khi bắt đầu: đọc *"Bắt đầu từ đâu"* → theo A / B / C. Muốn Claude chạy theo: bảo *"làm theo workflow.md"*.

---

## Nguyên tắc lõi

**Prove trước khi build.** Chất lượng bị chặn trên bởi chất lượng *bằng chứng* anh ép ra, không
phải độ thông minh của Claude.

- **Bug** → chứng minh **NGUỒN** (root cause + bằng chứng runtime) *trước khi fix*.
- **Feature** → chứng minh **SPEC + APPROACH** (đầu bài cụ thể + hướng làm sống sót review) *trước khi build*.
- **Đợt batch** → chốt **checklist mục tiêu** + **verify hard-blocker bằng bằng chứng** *trước khi xếp lịch*.

## Khung bao quanh MỌI task

1. **WIP ≤ 2.** Quá thì vào hàng đợi, không vào đầu.
2. **Kẹt thì ĐÀO, đừng nhảy task.** Kẹt = tín hiệu gọi bug-hunter, không phải để trốn.
3. **`/my-worklog` mỗi lần switch** — 1 dòng: đang ở đâu + next action. "Nhớ lại" còn 10 giây.
4. **Right-size.** Trivial (typo/label/color/copy/1-dòng) → fix thẳng. Non-trivial → full.
5. **Dồn công + max-effort lên ĐẦU** (investigate / spec), không phải implement. Đầu quyết định ~80% chất lượng.
6. **Tripwire 3-strike.** 3-4 lần fix fail cùng một chỗ → DỪNG (agent đang là liability): revert, làm tay hoặc đổi approach — không thử lần 5.
7. **2 lần sửa Claude cùng một lỗi → `/clear` + viết lại prompt đầu** (nhét bài học vào prompt). Session sạch + prompt tốt > session dài + chồng correction.

## Bộ skill — 3 vai + phụ trợ

| Skill | Vai |
|---|---|
| `/my-bug-hunter` | Chứng minh *vì sao* (root cause, mọi stack). Cũng là **subroutine** gọi bất cứ khi nào "có cái không chạy". |
| `/my-verify` | *Verify một change THẬT + blast radius + regression*, **mọi layer**. Route xuống đồ từng layer. (Bước A7/B8.) |
| `/my-frontend-fix` | *Thấy & verify* frontend — **route UI của `/my-verify`** (screenshot loop, `__joyDebug`/Playwright) **+ design-eye** (`references/design-eye.md`: visual read · design-verify 2 tầng chấm 0-10 · pattern library tích lũy). |
| `/joy-widget-v4-fix` | Joy adapter (`__joyDebug`, layer matrix 4 tầng). *App khác → adapter của app đó.* |
| `/my-explore` · `/implement` · `/codex` | Hiểu source · chạy plan từng bước · second opinion / challenge |
| `/plan-eng-review` · `/plan-ceo-review` · `/plan-design-review` · `/autoplan` | Review approach feature (kiến trúc / scope / UI / cả ba) |
| `/notion-task-personal` · `/joy-point-assign` · `/my-worklog` · `/my-commit` · `/merge-branch` · `/deploy-staging` | Task · ước lượng · checkpoint · commit · gộp nhánh · staging |

---

## Project Adapter (thiết lập 1 lần / app)

Workflow giống nhau mọi app; chỉ phần *đặc thù* khác. **Vào một app lần đầu** → thiết lập adapter,
**ghi vào `CLAUDE.md` của app đó** (theo luật platform-agnostic: đọc config; thiếu → hỏi/thiết lập → lưu).
Khi app có `.claude/skills` riêng → **skill generic của anh là phương pháp, defer xuống skill repo** cho phần đặc thù.

**Adapter gồm:** dev run sao · đồ quan sát runtime (debug-global? emulator? port?) · test harness · repo skills.

| App | Dev run | Quan sát backend/data | Debug-global FE | Test harness |
|---|---|---|---|---|
| **Joy** | Vite `5173` / `shopify app dev` | emulator UI `:4012` (functions/firestore/pubsub) | `__joyDebug` ✅ (`/joy-widget-v4-fix`) | ❌ 0 test backend — cần dựng |
| **Wishlist** | `shopify app dev` / `yarn emulators` | emulator UI `:4000` (functions `:5001`/firestore `:8080`/pubsub `:8085`) | ❌ chưa có → dùng Playwright `eval`/`queryShadow` | ✅ **Jest** (`jest-patterns.md`); repo có `.claude/skills`: frontend/backend/polaris/shopify-api |
| **App mới** | đọc `CLAUDE.md`; thiếu → thiết lập + lưu | ? | ? | ? |

**Quan sát runtime — generic theo layer** (adapter điền chi tiết):

| Layer | Quan sát bằng |
|---|---|
| Storefront widget (shadow DOM/Lit) | debug-global nếu có · Playwright `eval`/`getComputedStyle`/`queryShadow` |
| Admin (React/Polaris) | Standalone Admin: `console.log` · eval qua /my-chrome · React DevTools. Embedded app: `/browse` + `frame --name app-iframe` (documented trong source, chưa live-verify ở máy này). **Login Admin và drive embedded iframe là hai capability khác nhau — xem "Test trên browser" bên dưới.** |
| Backend (Cloud Functions) | **Firebase emulator: log stdout** — dùng cho bước prove, **đừng deploy staging để đọc log** |
| DB / record state | emulator UI · firebase console |
| Webhook | pubsub emulator trigger + log |

### Test trên browser — route theo surface qua /my-chrome

Bước test/verify nào cần browser (A7 / B8, QA, dogfood) → dùng **skill `/my-chrome`**
để route theo surface. Storefront/theme editor/standalone Admin dùng
`claude-in-chrome` trên Chrome thật; embedded Admin trong cross-origin iframe dùng
`/browse` + `$B frame --name app-iframe`.
(Đừng nhầm với built-in `/chrome` của Claude Code — lệnh đó chỉ bật/kết nối extension.)
Chi tiết đầy đủ (load tools, surface map Shopify, safety) nằm trong skill; protocol
tab-group dưới đây **chỉ áp dụng cho các row dùng `claude-in-chrome`**:

- **Trước MỖI lần test: check group trước.** `tabs_context_mcp` (không tham số):
  1. **CÓ group** (kèm tab) → **DÙNG nó**: `navigate` tab sẵn có; chỉ `tabs_create_mcp`
     khi thật sự cần thêm tab song song (tab mới vẫn vào đúng group đó).
  2. **CHƯA có group** → tạo đúng **1 lần** (`tabs_create_mcp`), rồi mọi bước test
     sau trong session check-thấy-và-tái-dùng group này — không tạo lần hai.
- Giới hạn extension (verified + issue anthropics/claude-code#69542): check chỉ thấy
  group **của session hiện tại** — session mới luôn "chưa có" nên sẽ tạo 1 group mới;
  không nhận lại được group cũ hay group tạo tay.
- **Dọn khi xong:** kết thúc phần test → `tabs_close_mcp` đóng các tab đã mở →
  group của session tự biến mất. Không để group rác sau khi xong việc.
- **Không đụng tab ngoài group** — `navigate` cũng chỉ chạy với tab trong group.
- **Login có sẵn không đồng nghĩa drive được iframe.** Chrome thật đã đăng nhập
  Shopify Admin / store / Notion nên `claude-in-chrome` mở được các page đó mà không
  cookie-import; `find`/`read_page` vẫn không thấy controls trong cross-origin app iframe.

#### HARD STOP browser — 2 attempts

Sau **2 lần** không reach/act được cùng một control bằng browser tool đã chọn: **DỪNG,
báo user, không retry lần 3, không thử browser tool thứ ba, không coordinate-click
xuyên iframe**. Nếu UI không drive được, verify qua staging Firestore hoặc storefront
trực tiếp và ghi rõ chưa verify embedded UI.

#### Route/fallback cần login

Chọn theo surface trước, không thử tool tuần tự theo thói quen:

1. **Không cần login?** Trang công khai, hoặc test được ở **storefront** thay vì
   admin → cứ đi thẳng, không cần import.
2. **Storefront/theme editor/standalone Admin:** dùng `/my-chrome`; extension không
   khả dụng thì dùng `/browse` và prime bằng `/qa-login` khi thật sự cần.
3. **Embedded Admin iframe:** dùng `/browse`, rồi `$B frame --name app-iframe` →
   `$B snapshot -i` → act bằng `@ref`; `$B frame main` để quay lại shell. Capability
   này đã xác nhận trong source nhưng **chưa live-verify Shopify ở máy này**.
4. **Dùng lại browser/page context đang mở** nếu vừa test xong
   bước trước — đừng mở tab mới từ đầu.
5. **Né Admin bằng đường khác**: app embed → **dev/preview URL** (`shopify app dev`) ·
   dựng data/state → **Admin API** · theme/storefront → **theme preview URL**.
6. **Hết cách login → `/qa-login`** (last resort). Storefront thường carry được;
   **Admin device-bound/SSO có thể vẫn chặn** — giới hạn đã biết, không phải bug.

**Dead ends đã chốt:** `claude-in-chrome` `find`/`read_page` không xuyên cross-origin
embedded iframe; coordinate click không phải fallback. Chrome DevTools MCP
`--autoConnect`/deviceId là **UNVERIFIED**, không route vào đó. Playwright MCP chỉ
được biết là configured ở workspace `wishlist-3`; workspace khác không được giả định có.

---

## Bắt đầu từ đâu

- QC/tester báo lỗi, hoặc "đang chạy bỗng hỏng" → **Workflow B (Bug)**
- Việc mới cần xây → **Workflow A (Feature)**
- Một mục tiêu gồm **nhiều item** (BFS, dọn N bug, milestone) → **Workflow C (Batch)** → C tự route xuống A/B
- Vào một app **lần đầu** → thiết lập **Project Adapter** trước
- Đụng cái không chạy **giữa chừng** → **bug-hunter subroutine** (mục *Bug trong feature*)

---

## Workflow A — Implement task mới (Feature)

**A1. Chốt SPEC** — `/notion-task-personal` · *idea mơ hồ → `/office-hours`* · *ước lượng → `/joy-point-assign`*
Viết **acceptance criteria cụ thể**: "xong" = gì, input/output, edge case, cái gì **NGOÀI** scope.
**▣ CỔNG 1 — Spec cụ thể + chốt.** Chưa rõ "đúng nghĩa là gì" → chưa đi tiếp.

**A2. Hiểu source** — `/my-explore`  ·  feature ráp vào đâu, theo pattern nào, đụng gì.

**A3. Design + Plan** — plan mode  ·  viết **approach** (luồng dữ liệu, component/endpoint, migration, rủi ro) — anh đọc để nắm + verify hướng. Rồi liệt kê bước.

**A4. Review approach** — `/plan-eng-review` (kiến trúc) · `/plan-ceo-review` (scope) · `/plan-design-review` (UI) · lớn → `/autoplan` · adversarial → `/codex challenge`
**▣ CỔNG 2 — Approach sống sót review.** Chưa qua → chưa code.

**A5. Acceptance tests → ĐỎ**  ·  test cho acceptance criteria (Playwright hành vi / Jest backend). Đỏ → build tới xanh.

**A6. Implement — lát mỏng trước** — `/implement`  ·  build **lát dọc mỏng nhất chạy end-to-end** trước, rồi mở rộng. **Đừng big-bang.** Tới khi test xanh.

**A7. Verify + blast radius** — `/my-verify` *(route theo layer: `/my-frontend-fix` UI · emulator/Jest BE · `/verify`·`/qa` E2E)*  ·  feature mới **có làm vỡ flow cũ không?** UI mới: qua **design-verify** (design-eye §B) như B8.
*Verify cần browser → **/my-chrome route theo surface** (mục "Test trên browser"); embedded Admin dùng `/browse frame`, không dùng `claude-in-chrome` coordinate click.*

**A8. Đóng** — **spec-check** *(agent fresh, chỉ nhận spec A1 + diff: "có build đúng cái đã chốt không — thiếu gì, thừa gì, tự ý đổi gì?")* → `/tech-review` + `/impact-review` → `/review` → local verify → `/my-commit` → `/deploy-staging` → QC
*Spec-check đứng ĐẦU và tách khỏi review chất lượng: chấm diff theo SPEC bắt được lớp lỗi mà chấm theo code-quality bỏ sót (silent scope drift, tự lấp spec gap, feature không ai xin) — đo được ~60-70% lỗi thuộc lớp này. Reviewer fresh không được xem lý luận lúc build — chỉ spec + diff.*
*`/tech-review` (chất lượng code + merge-provenance) và `/impact-review` (dự đoán regression qua caller/dependent) là 2 lens nhẹ, 1-pass, chạy song song được — đứng trước `/review` (pipeline nặng — SQL/security/concurrency) để bắt sớm trước khi đầu tư vào pass nặng hơn.*

---

## Workflow B — Fix bug

**B1. Context** — `/notion-task-personal`  ·  đọc bug: mô tả, repro, khi nào. Mơ hồ → hỏi lại.

**B2. Investigate + PROVE root cause** — `/my-bug-hunter` ⭐
- Reproduce → Localize (6 kỹ thuật: neo chuỗi · trace ngược · bisect-log · diff-vs-working · git blame · data flow).
- Quan sát runtime theo **adapter app** (FE: debug-global/Playwright · BE: emulator).
**▣ CỔNG — Bằng chứng runtime.** Research = *"tại Y:Z, biến = A nhưng phải = B"* (quan sát thật). Chưa quan sát → `[CHƯA CHỨNG MINH]`, không qua bước sau.

**B3. Anh đọc research** — nắm hệ thống + verify approach.

**B4. Red-team ROOT CAUSE** — `/codex challenge`  ·  *"Nguồn hay triệu chứng? Fix đây thì thượng nguồn còn sai gì? Còn nguyên nhân khác?"* Lộ hổng → về B2.
Nhận findings theo framing **"reviewer ngoài nộp bản phân tích này — nên 'tuyển' không? Finding nào THẬT?"** — triage từng finding (real / noise), chỉ finding ảnh hưởng correctness mới quay về B2. Đừng gật sửa theo tất (reviewer được prompt "tìm gap" thì LUÔN tìm ra gap).

**B5. Red test → ĐỎ**  ·  FE: screenshot baseline / Playwright assertion. BE: Jest test (Wishlist) / emulator repro (Joy, tới khi có harness).

**B6. Plan nếu cần** — plan mode *(bug nhỏ đã chứng minh nguồn → skip, fix thẳng)*

**B7. Implement tối thiểu → XANH** — `/implement`  ·  fix **tại NGUỒN**, 1-3 dòng nếu được, không refactor kèm.

**B8. Verify + blast radius** — `/my-verify` *(route: `/my-frontend-fix` UI · emulator/Jest BE · `/verify`·`/qa` E2E)*
Chống băng-dán (giá trị runtime đổi đúng, không hardcode/`!important` đè) + blast radius (mọi nơi cùng nguồn) + regression.
Bug UI: thêm cổng **design-verify** (design-eye §B — cơ học trên DOM rồi taste rubric, 5 dimension chấm 0-10, mọi cái ≥8 mới đóng; [Medium]/[Nitpick] → polish, đổ về checklist C, không tự sửa).
*Verify cần browser → **/my-chrome route theo surface** (mục "Test trên browser"); embedded Admin dùng `/browse frame`, không dùng `claude-in-chrome` coordinate click.*

**B9. Đóng** — **spec-check** *(agent fresh, chỉ nhận root cause B2 + scope B6/B7 + diff: "fix đúng NGUỒN đã chứng minh không? có drive-by refactor không?")* → `/tech-review` + `/impact-review` → `/review` → local verify → `/my-commit` (message = câu root cause) → `/deploy-staging` → QC
*`/tech-review` (chất lượng code + merge-provenance) và `/impact-review` (dự đoán regression qua caller/dependent) là 2 lens nhẹ, 1-pass, chạy song song được — đứng trước `/review` (pipeline nặng — SQL/security/concurrency) để bắt sớm trước khi đầu tư vào pass nặng hơn.*

---

## Workflow C — Đợt batch (nhiều việc → một cổng)

Khi có **một mục tiêu** gồm nhiều item: BFS submit, dọn N bug QC, milestone. Đây là *mini-project*, C **bọc** A/B.

**C1. Spec cấp project = checklist mục tiêu.**  Lấy checklist chính thức (vd Built for Shopify), list mọi tiêu chí đang fail. **▣ CỔNG 1 toàn cục:** "đạt" nghĩa là gì.

**C2. Triage mỗi item** → **bug (B)** / **feature nhỏ (A)** / **polish** (`/plan-design-review`, perf pass — chấm theo rubric design-eye §B + surface adapter §C). "Lỗi" của một checklist không phải đều là bug. Item polish do design-verify của các fix trước đổ về (mục "polish lân cận") cũng vào lane này.

**C3. Verify hard-blocker bằng bằng chứng** — *trước* khi xếp lịch. Đừng giả định thiếu/đủ (vd webhook bắt buộc: grep code thật, không đoán).

**C4. Ưu tiên** — item **BLOCK submission** trước, polish sau.

**C5. Execute** — chạy từng item qua A/B. **WIP ≤ 2.** Gom nhóm theo area/root-cause.

**C6. Ship theo lô** — `/merge-branch` + `/deploy-staging` (test chung staging).

**C7. DoD = checklist pass** (automated checks + manual review), không phải "sửa được vài cái".

---

## Bug nằm TRONG một feature (interleave)

`/my-bug-hunter` là **subroutine** — gọi bất cứ khi nào "có cái không chạy". Khoảnh khắc thứ gì không chạy → **lật từ BUILD sang PROVE ngay tại chỗ**.

| Bug xuất hiện khi | Repro lấy ở đâu | Vùng tìm | Cách | Xong thì về |
|---|---|---|---|---|
| Code feature **mình vừa viết** sai (test đỏ vì *sai*, không phải *chưa làm*) | Chính test đỏ đang có | `git diff` của mình (hẹp) | bug-hunter **nhẹ** | A6 — build tiếp |
| Feature **làm vỡ flow cũ** (bắt ở A7) | Tái hiện flow cũ | Rộng (code cũ vừa đụng) | bug-hunter **đầy đủ** | A7 — verify tiếp |
| **QC báo** sau khi ship | Theo step QC | Như bug thật | **Workflow B từ đầu** (log Notion) | Task riêng |

**Bẫy số 1:** code mình vừa viết không chạy → bản năng *chọc tay sửa lung tung*. Cấm. **Code của mình cũng qua đúng thanh bằng chứng** như mọi bug: test đỏ → localize trong diff → quan sát runtime → *rồi mới* sửa.

**Luật interleave:** đang trong tay thì **đào tại chỗ**; đã rời tay rồi QC mới báo thì là **task mới** (tính WIP).
