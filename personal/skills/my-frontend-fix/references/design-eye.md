# Design-eye — nửa não designer cho UI fix

> **Vai:** `/my-bug-hunter` chứng minh *vì sao*. `/my-frontend-fix` *thấy & verify*. File này cho
> nó **con mắt + gu**: nhìn có cấu trúc (§A), chấm theo chuẩn (§B), so với chuẩn surface (§C),
> và nhớ pattern (§D). Không phải skill riêng — được `/my-frontend-fix` nạp khi fix UI, và
> `/fix-bug` · `/fix-bugs-parallel` trỏ tới cho bug UI.

> **Nguyên tắc chấm:** "đúng chưa" (symptom hết, runtime value đổi đúng) là điều kiện CẦN.
> "chuẩn chưa" (design-verify §B) là điều kiện ĐỦ. Fix chưa qua CẢ HAI = chưa xong.

> **Luật grounded (áp cho mọi nhận xét visual):** phải chỉ đúng element/region + SỐ ĐO +
> screenshot. Cấm "spacing feels off" — phải là "gap giữa X và Y = 13px, hệ là bội 8, xem vùng
> khoanh". Nhận xét không localize được = không tính.

---

## §A. Visual read — nhìn như designer TRƯỚC khi đoán (2-5 phút)

Khi mở surface (bước 2 của my-frontend-fix), đừng chỉ nhìn element lỗi. Đọc CẢ CỤM xung quanh:

1. **Hệ spacing** — đo margin/padding/gap của 4-5 element quanh vùng bug (`getComputedStyle`).
   Hệ đang là bội mấy px (4? 8?)? Chỗ bug có giá trị lạc hệ (13px, 22px) không?
2. **Alignment grid** — các element bám mép nào? Chỗ nào lệch 1-3px so với siblings?
3. **Type ramp + màu** — font-size/weight quanh đó theo bậc nào, token màu nào? Chỗ bug có bậc
   lạ / hex gần-đúng hardcode không?
4. **Component inventory** — element lỗi LẼ RA là component gì của hệ (Polaris component? nút
   theme?) — nó đang tự chế thay vì dùng hệ à?
5. **So với chuẩn surface** (§C) → **output bắt buộc, điền vào checklist fix:**

   `Hệ đang dùng: <...> · Lệch chuẩn: <gì, số đo> · Bug là: [property lẻ | HỆ sai]`

Nhiều bug UI "báo 1 chỗ" thực ra là **HỆ sai** (widget không inherit token theme, layout system
lệch). Fix hệ = 1 lần; fix property lẻ khi hệ sai = whack-a-mole — QC báo lại chỗ khác tuần sau.

---

## §B. Design-verify — cổng chấm fix (chạy SAU khi symptom hết)

**Right-size:** bug lẻ → **Quick pass**. Polish / BFS / nhiều bug cùng surface → **Full pass**.

### Tầng 1 — CƠ HỌC (DOM/computed styles, deterministic — làm TRƯỚC, rẻ, không cần "mắt")

- [ ] Spacing vùng sửa ∈ scale của hệ (bội 4px; đúng Polaris token nếu Admin — §C1)
- [ ] Không horizontal scroll ở 375px (mức trang)
- [ ] Touch target ≥44×44px, cách nhau ≥10px (floor tuyệt đối 24×24 — WCAG 2.5.8) `[mobile]`
- [ ] Contrast chữ ≥4.5:1 (3:1 large text) trên nền THẬT
- [ ] Console không error mới
- [ ] Runtime value đổi đúng root cause — không hardcode/`!important` đè (kế thừa chống băng-dán)

### Tầng 2 — TASTE (mắt nhìn screenshot; Quick pass = câu 1-4 + 11, Full pass = cả 15)

| # | Câu hỏi (binary) |
|---|---|
| 1 | Spacing: mọi margin/padding thuộc 1 scale nhất quán — không có 13px/22px lẻ? |
| 2 | Proximity: khoảng cách GIỮA nhóm > khoảng cách TRONG nhóm (nhóm liên quan đọc thành 1 khối)? |
| 3 | Alignment: mọi element bám chung mép/grid — không lệch 1-3px so với siblings? |
| 4 | Hierarchy: nhận ra ngay hành động/thông tin chính (bằng weight + màu, không chỉ size)? |
| 5 | Type: family/size/weight/line-height đúng hệ (≤2 family, scale giới hạn)? |
| 6 | Color: nền/chữ/viền/icon dùng token — không hex gần-đúng hardcode? |
| 7 | States: element tương tác đủ default/hover/focus-visible/active/disabled? (mục bị miss nhiều nhất) |
| 8 | System status: loading/empty/error có thật, trông chủ đích (không blank/vỡ)? |
| 9 | Touch: mọi target đủ chuẩn tính CẢ padding, không chồng nhau? |
| 10 | Content stress: sống sót text rất dài/rất ngắn/ảnh missing/2× số item? |
| 11 | Responsive: 375/768/1280 — zero h-scroll, không chồng/cắt element? |
| 12 | Mobile chrome: không gì bị toolbar/keyboard/safe-area (notch) che? |
| 13 | Component consistency: button/card/input giống hệt nhau ở mọi nơi (radius/shadow/padding)? |
| 14 | Contrast đạt trên nền thật — kể cả trên ảnh lúc xấu nhất? |
| 15 | Motion: duration/easing nhất quán; không gì shift layout bất ngờ (scrollbar/font swap/ảnh load)? |

### Chấm điểm + điều kiện dừng loop

- Gom thành 5 dimension, chấm **0-10** mỗi cái: `spacing · alignment · hierarchy · states · mobile`.
- **Ngưỡng đóng fix: mọi dimension ≥ 8** — HOẶC finding còn lại được phân loại severity và GHI
  NHẬN rõ ràng (không bao giờ im lặng bỏ qua). "Nhìn ổn rồi" không phải điểm dừng; điểm số mới là.
- **Severity:** `[Blocker]` `[High]` `[Medium]` `[Nitpick]`. Trong phiên FIX BUG chỉ
  Blocker/High được đụng code; Medium/Nitpick → mục "polish lân cận" của report, đổ về checklist
  Workflow C — giữ đúng kỷ luật minimal-fix, designer PHÁT HIỆN nhưng không tự ý mở scope.

---

## §C. Surface adapter — chuẩn để so

### §C1. Shopify Admin (Polaris) — app embedded

**Số cứng:** space token bội 4px (`100`=4 · `200`=8 · `300`=12 · `400`=16 · `600`=24 · `800`=32;
card padding/gap 16px, button-group gap 8px) · breakpoints `sm`=490 `md`=768 `lg`=1040 `xl`=1440 ·
text ≥13px (caption ≥12px) · contrast ≥4.5:1 · touch ≥44px · Web Vitals p75: LCP ≤2.5s ·
CLS ≤0.1 · INP ≤200ms.

**Checklist reviewer BFS — các lý do reject hay dính (chấm fix theo ĐÚNG thước này):**
- Content không nằm trong card / nền không phải admin gray chuẩn
- \>1 primary button trong 1 card · primary button trong table
- Lỗi hiện bằng toast tự tắt (phải: **đỏ, inline cạnh field, persistent**) · show lỗi TRƯỚC khi
  user tương tác
- Form có nút Save riêng thay vì App Bridge **Contextual Save Bar** · rời trang được khi còn
  unsaved changes
- Custom sidebar/nav thay vì `s-app-nav` · sub-page không có back về parent · tab đổi content
  PHÍA TRÊN hàng tab
- ≥2 banner cạnh nhau · auto-open modal/popover · countdown · đỏ dùng ngoài error/destructive
- Mobile: horizontal scroll cả trang · layout 2 cột không stack dưới 490px · content ẩn không
  mở được
- Spacing lệch hẳn admin · serif/script font · body text lệch cỡ admin

Trong repo **Wishlist**: defer xuống repo skill `.claude/skills` (polaris) cho chi tiết component.
Nguồn sống (fetch khi nghi outdated): `shopify.dev/docs/apps/launch/built-for-shopify/requirements`
· `shopify.dev/docs/apps/design` · `polaris-react.shopify.com/tokens/space`.

### §C2. Storefront widget (nhúng theme merchant)

- **Chuẩn = HÒA VÀO THEME**: computed font-family/color/radius của widget kế thừa/khớp theme,
  không tự chế hệ riêng (trừ accent đặc thù của brand app). Visual read §A ở đây = đọc HỆ CỦA
  THEME (nút theme cao bao nhiêu, radius mấy, font gì) rồi so widget với nó.
- CSS scoped 100% dưới wrapper class · zero bare element selector · zero `!important` đè theme ·
  không global reset · responsive theo section CHA (không fixed width mức trang).
- Budget: JS ≤10KB gzip/block · storefront Lighthouse delta ≤10 điểm · icon ≤24×24 với hit-box 44×44.
- **Blast radius đặc thù:** bug chỉ hiện trên MỘT SỐ theme = CSS bleed (§D1 #19) — verify tối
  thiểu trên 2 theme khác nhau.

### §C3. Web thường (tienvu-bt, side projects)

Không có token hệ ngoài → suy hệ từ chính trang (visual read §A) rồi chấm theo **tính nhất quán
nội bộ** + rubric 15 câu. Project có `DESIGN.md` → đó là chuẩn, đọc trước.

---

## §D. Pattern library — não tích lũy

**Nghi thức (bắt buộc, 30 giây):**
1. **ĐỌC trước** — mở §D1 TRƯỚC khi diagnose: symptom khớp dòng nào thì kiểm giả thuyết đó ĐẦU TIÊN.
2. **GHI sau** — fix xong 1 UI bug: root cause class chưa có dòng → append 1 dòng; có rồi → tăng
   cột "Gặp". Bug nào dạy được điều CẤM → thêm vào §D2.

### §D1. Pattern nhận diện (seed 2026-07 — nguồn: Defensive CSS, web.dev, Smashing, MDN, CSS-Tricks)

| # | Triệu chứng | Root cause class | Nhận diện nhanh | Gặp |
|---|---|---|---|---|
| 1 | Text/card tràn flex container, ellipsis không ăn | flex item `min-width:auto` không co dưới content | con của flex; `min-width:0` là hết | 0 |
| 2 | Cột grid "nổ" bề ngang trang | `1fr` = `minmax(auto,1fr)`, con rộng ép min size | con grid có content không bẻ được; `minmax(0,1fr)` | 0 |
| 3 | Scrollbar ngang màn hẹp, item bị ép | flex mặc định `nowrap` | hàng item không bao giờ wrap; check `flex-wrap` | 0 |
| 4 | `z-index:99999` vẫn chìm | kẹt trong stacking context của ancestor | tìm ancestor có transform/filter/opacity<1/will-change | 0 |
| 5 | `position:fixed` trôi theo scroll / sai chỗ | ancestor transform/filter thành containing block | fixed chỉ hỏng trong wrapper có animate/transition | 0 |
| 6 | Nội dung đáy bị toolbar mobile che | `100vh` = largest viewport trên mobile | có `100vh` + chỉ kêu mobile; dùng `svh`/`dvh` | 0 |
| 7 | iPhone zoom vào khi tap input, không zoom ra | iOS auto-zoom input font <16px computed | chỉ iOS, lúc focus; check rendered font-size | 0 |
| 8 | Scroll trong modal/widget kéo cả trang | scroll chaining tại biên | chạm đáy inner scroller thì body trôi; `overscroll-behavior:contain` | 0 |
| 9 | Như #8 nhưng widget là iframe, thuộc tính "không ăn" | set trên iframe element thay vì document TRONG iframe | phải set trên html/body bên trong | 0 |
| 10 | Bottom bar chui dưới home indicator / notch đè | `viewport-fit=cover` thiếu `env(safe-area-inset-*)` | chỉ hỏng iPhone tai thỏ | 0 |
| 11 | Bàn phím che input; widget nhúng trôi khỏi màn | layout viewport ≠ visual viewport khi mở keyboard (iOS scroll parent, không scroll iframe) | iOS + input trong iframe/fixed; cần visualViewport API | 0 |
| 12 | Khoảng cách dọc lúc có lúc không | margin collapse | margin dọc kề = max không phải sum; padding/flex parent chặn | 0 |
| 13 | Ảnh card méo | ép ratio container không có `object-fit` | img có w+h cứng; `object-fit:cover` | 0 |
| 14 | Username/URL dài phá layout | không có chiến lược overflow cho dynamic content | chuỗi user-generated; `overflow-wrap:anywhere`/ellipsis | 0 |
| 15 | Content tràn đáy box | `height` cứng thay vì `min-height` | height hardcode + content dài hơn design (bản dịch!) | 0 |
| 16 | 2 item `space-between` văng 2 mép | space-between chia theo count | chỉ vỡ khi ít item hơn dự kiến; dùng `gap` | 0 |
| 17 | Hover "dính" sau khi tap mobile | touch giả lập hover | chỉ mobile; bọc `@media (hover:hover)` | 0 |
| 18 | Nút/link khó bấm mobile | target < chuẩn (44pt HIG / 24px WCAG floor) | đo hit area render GỒM padding, không phải icon | 0 |
| 19 | Widget chỉ hỏng trên MỘT SỐ theme | CSS host page bleed (reset, `!important`, inherit) | repro theo theme; diff computed styles vs trang sạch; fix = scoping | 0 |
| 20 | Modal/dropdown bị cắt ở mép container | ancestor `overflow:hidden` (hoặc transform) clip popout | popout đứt đúng biên 1 parent; walk ancestors | 0 |

(Bản đầy đủ 28 pattern + nguồn từng dòng: `personal/docs/claude-smarter-research-2026-07-20.md` Phần 2.)

### §D2. Negative list — điều CẤM cụ thể (specific negation lái model mạnh hơn positive guidance)

- KHÔNG fix UI bằng `!important`/hardcode đè — băng-dán, B8 bắt.
- KHÔNG thêm margin lẻ để "đẩy cho thẳng" khi lệch là do HỆ (§A phải trả lời "hệ hay lẻ" trước).
- KHÔNG đưa primary button thứ 2 vào 1 card / primary button vào table (BFS reject).
- KHÔNG hiện lỗi bằng toast tự tắt — đỏ, inline, persistent (BFS reject).
- KHÔNG sửa spacing 1 element mà bỏ qua siblings cùng hàng — alignment chấm theo CỤM.
- KHÔNG đóng fix mobile khi mới nhìn viewport desktop (matrix bắt buộc — my-frontend-fix bước 2).
- *(append tại đây khi bug mới dạy được điều cấm mới)*
