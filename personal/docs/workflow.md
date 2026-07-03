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

## Bộ skill — 3 vai + phụ trợ

| Skill | Vai |
|---|---|
| `/my-bug-hunter` | Chứng minh *vì sao* (root cause, mọi stack). Cũng là **subroutine** gọi bất cứ khi nào "có cái không chạy". |
| `/my-verify` | *Verify một change THẬT + blast radius + regression*, **mọi layer**. Route xuống đồ từng layer. (Bước A7/B8.) |
| `/my-frontend-fix` | *Thấy & verify* frontend — **route UI của `/my-verify`** (screenshot loop, `__joyDebug`/Playwright). |
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
| Admin (React/Polaris) | `console.log` · eval qua /chrome hoặc Playwright · React DevTools. **Cần login Admin → /chrome trên Chrome thật (đã login sẵn) — xem "Test trên browser" bên dưới.** |
| Backend (Cloud Functions) | **Firebase emulator: log stdout** — dùng cho bước prove, **đừng deploy staging để đọc log** |
| DB / record state | emulator UI · firebase console |
| Webhook | pubsub emulator trigger + log |

### Test trên browser — mặc định /chrome (Chrome thật, group tab "Claude")

Bước test/verify nào cần browser (A7 / B8, QA, dogfood) → dùng **/chrome**
(claude-in-chrome) điều khiển **Chrome thật anh đang mở**, không phải headless.

- **Đúng 1 group cố định tên "Claude"** = sân của Claude: mọi tab trong đó đều để
  Claude test. **KHÔNG tạo group mới** — mỗi lần `tabs_create` là dễ đẻ thêm một
  group "Claude" nữa, rác browser.
- Quy trình mỗi lần test: `tabs_context` → tìm tab trong group "Claude" → **navigate
  tab sẵn có đó** (đổi URL theo tabId) — **không `tabs_create`**. Chỉ khi group chưa
  có tab test nào mới tạo đúng **1 tab**, rồi tái dùng nó suốt; nhiều URL → điều hướng
  tuần tự trên cùng tab, đừng mỗi URL một tab.
- **Không đụng tab ngoài group** — đó là tab làm việc của anh.
- **Login có sẵn.** Chrome thật đã đăng nhập Shopify Admin / store / Notion... →
  hết hẳn vấn đề device-bound + Cloudflare; **không cần cookie-import**.

#### Fallback headless — verify trên browser cần login (khi /chrome không khả dụng)

Chỉ khi /chrome không dùng được (extension chưa bật, máy khác, cần bulk/headless)
→ về `/browse` như cũ. Lúc đó nếu trang cần login, đi bậc thang **rẻ → đắt**,
dừng ở bậc đầu tiên cho ra bằng chứng:

1. **Không cần login?** Trang công khai, hoặc test được ở **storefront** thay vì
   admin → cứ `/browse` thẳng.
2. **Dùng lại session Playwright đang có** trong phiên (`$B status`, `$B cookies`).
3. **Né Admin bằng đường khác**: app embed → **dev/preview URL** (`shopify app dev`) ·
   dựng data/state → **Admin API** · theme/storefront → **theme preview URL**.
4. **Hết cách → `/qa-login`** (last resort). Storefront gần như luôn pass; **Admin
   device-bound/SSO có thể vẫn chặn** — giới hạn đã biết, không phải bug. Lúc đó
   login Admin một lần bằng tay trong session browse rồi tái dùng (về bậc 2).

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

**A7. Verify + blast radius** — `/my-verify` *(route theo layer: `/my-frontend-fix` UI · emulator/Jest BE · `/verify`·`/qa` E2E)*  ·  feature mới **có làm vỡ flow cũ không?**
*Verify cần browser → **/chrome trên Chrome thật, group tab "Claude"** (mục "Test trên browser"); headless `/browse` + `/qa-login` chỉ là fallback.*

**A8. Đóng** — `/review` → local verify → `/my-commit` → `/deploy-staging` → QC

---

## Workflow B — Fix bug

**B1. Context** — `/notion-task-personal`  ·  đọc bug: mô tả, repro, khi nào. Mơ hồ → hỏi lại.

**B2. Investigate + PROVE root cause** — `/my-bug-hunter` ⭐
- Reproduce → Localize (6 kỹ thuật: neo chuỗi · trace ngược · bisect-log · diff-vs-working · git blame · data flow).
- Quan sát runtime theo **adapter app** (FE: debug-global/Playwright · BE: emulator).
**▣ CỔNG — Bằng chứng runtime.** Research = *"tại Y:Z, biến = A nhưng phải = B"* (quan sát thật). Chưa quan sát → `[CHƯA CHỨNG MINH]`, không qua bước sau.

**B3. Anh đọc research** — nắm hệ thống + verify approach.

**B4. Red-team ROOT CAUSE** — `/codex challenge`  ·  *"Nguồn hay triệu chứng? Fix đây thì thượng nguồn còn sai gì? Còn nguyên nhân khác?"* Lộ hổng → về B2.

**B5. Red test → ĐỎ**  ·  FE: screenshot baseline / Playwright assertion. BE: Jest test (Wishlist) / emulator repro (Joy, tới khi có harness).

**B6. Plan nếu cần** — plan mode *(bug nhỏ đã chứng minh nguồn → skip, fix thẳng)*

**B7. Implement tối thiểu → XANH** — `/implement`  ·  fix **tại NGUỒN**, 1-3 dòng nếu được, không refactor kèm.

**B8. Verify + blast radius** — `/my-verify` *(route: `/my-frontend-fix` UI · emulator/Jest BE · `/verify`·`/qa` E2E)*
Chống băng-dán (giá trị runtime đổi đúng, không hardcode/`!important` đè) + blast radius (mọi nơi cùng nguồn) + regression.
*Verify cần browser → **/chrome trên Chrome thật, group tab "Claude"** (mục "Test trên browser"); headless `/browse` + `/qa-login` chỉ là fallback.*

**B9. Đóng** — `/review` → local verify → `/my-commit` (message = câu root cause) → `/deploy-staging` → QC

---

## Workflow C — Đợt batch (nhiều việc → một cổng)

Khi có **một mục tiêu** gồm nhiều item: BFS submit, dọn N bug QC, milestone. Đây là *mini-project*, C **bọc** A/B.

**C1. Spec cấp project = checklist mục tiêu.**  Lấy checklist chính thức (vd Built for Shopify), list mọi tiêu chí đang fail. **▣ CỔNG 1 toàn cục:** "đạt" nghĩa là gì.

**C2. Triage mỗi item** → **bug (B)** / **feature nhỏ (A)** / **polish** (`/plan-design-review`, perf pass). "Lỗi" của một checklist không phải đều là bug.

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
