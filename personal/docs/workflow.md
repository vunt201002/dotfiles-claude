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
| Admin (React/Polaris) | `console.log` · Playwright eval · React DevTools. **Cần login Admin → xem "Verify trên browser cần login" bên dưới** (Shopify Admin chặn headless + cookie-copy: device-bound + Cloudflare). |
| Backend (Cloud Functions) | **Firebase emulator: log stdout** — dùng cho bước prove, **đừng deploy staging để đọc log** |
| DB / record state | emulator UI · firebase console |
| Webhook | pubsub emulator trigger + log |

### Verify trên browser cần login — thứ tự fallback

Khi một bước verify (A7 / B8) phải mở trang **sau đăng nhập** (nhất là Shopify Admin),
**đừng nhảy thẳng vào `/qa-login`.** Đó là *bằng chứng đắt nhất* — Shopify Admin chủ
động chặn mọi browser không phải Chrome thật của anh (device-bound session +
Cloudflare bot-check), nên cookie-copy lẫn headless đều có thể fail. Đi theo bậc thang
**rẻ → đắt**, dừng ở bậc đầu tiên cho ra bằng chứng:

1. **Không cần login?** Trang đó công khai, hoặc test được ở **storefront** thay vì
   admin → cứ `/browse` thẳng. Đa số verify UI không thật sự cần vào Admin.
2. **Dùng lại session Playwright đang có.** Một browse session trước trong cùng phiên
   có thể đã authenticated → tái dùng nó (`$B status`, `$B cookies`) thay vì login mới.
3. **Né Admin bằng đường khác** (thường nhanh hơn cả login):
   - App embed của mình → **dev/preview URL** (`shopify app dev`), không qua admin thật.
   - Dựng data/state (product, order, discount, settings) → **Admin API**, không click UI.
   - Theme/storefront → **theme preview URL** / local theme dev.
4. **Hết cách → `/qa-login`** (last resort). Import cookie Chrome thật vào session.
   Storefront/customer gần như luôn pass; **Admin device-bound/SSO có thể vẫn chặn** —
   nếu vẫn hiện màn login thì đó là giới hạn đã biết, không phải bug. Lúc đó: login
   Admin một lần ngay trong session browse bằng tay, rồi tái dùng (về bậc 2).

Khớp nguyên tắc lõi *"prove bằng bằng chứng rẻ nhất ép ra được"* — `/qa-login` là
nước cuối, không phải phản xạ đầu.

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
*Verify cần trang sau login (nhất là Admin) → theo bậc thang **"Verify trên browser cần login"**; `/qa-login` chỉ là nước cuối.*

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
*Verify cần trang sau login (nhất là Admin) → theo bậc thang **"Verify trên browser cần login"**; `/qa-login` chỉ là nước cuối.*

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
