# Oracle — đo xem cổng nào thật sự bắt được gì

> Một oracle chưa được đo không phải oracle, nó là nghi thức.
> Đây là P6 của [[../docs/manager-layer-plan-2026-08-12.md]] — thay con số đi mượn
> `~60-70%` trong `workflow.md` bằng con số của chính máy này.

19 fixture, **mỗi cái là một bug đã xảy ra thật**, cắm sẵn để chạy từng cổng lên và
đếm. Cổng nào bắt, cổng nào bỏ sót, cổng nào kêu oan.

---

## Chạy

```bash
bun personal/oracle/run.ts                    # cổng deterministic, miễn phí, không cần key
bun personal/oracle/run.ts --matrix           # thêm lưới fixture × cổng
bun personal/oracle/run.ts --json             # bản máy đọc
bun personal/oracle/run.ts --write-baseline   # đóng băng lần chạy này làm mốc

ORACLE_LLM=1 ANTHROPIC_API_KEY=... bun personal/oracle/run.ts   # thêm spec-check + reviewer (TỐN TIỀN)
```

Test:

```bash
bun test personal/oracle/            # ~14s: fixture integrity + red-test, miễn phí
ORACLE=1 bun test personal/oracle/   # ~2.5 phút: thêm guard/lint/tsc (vẫn miễn phí, cần npx)
ORACLE_LLM=1 bun test personal/oracle/   # thêm cổng LLM, TỐN TIỀN
```

**Exit code:** `0` sạch · `1` có fixture không chứng minh được bug của nó, hoặc một
cổng deterministic không chạy được · `2` tụt so với baseline.

> `personal/oracle/` **chưa** nằm trong script `test` của `package.json`. Muốn nó chạy
> cùng `bun run test` thì thêm `personal/oracle/` vào danh sách đường dẫn ở đó — một
> chữ, cố tình để lại cho người quyết.

---

## Đọc con số

| Cột | Nghĩa |
|---|---|
| `detect` | `caught / (caught + missed)`. `n/a` = cổng chưa bao giờ áp được vào fixture nào |
| `cover` | cổng áp được vào bao nhiêu trong 19 fixture |
| `fp rate` | false positive trên số lần *có thể* kêu oan |
| `n/a` | cổng **không áp được** vào fixture đó — khác hẳn "nhìn mà không thấy" |
| `err` | tooling gãy hoặc chưa đo. **Không bao giờ** được đọc là "cổng cho qua" |

**Ba cái bẫy khi đọc, đọc trước khi trích số:**

1. **`red-test` trả lời câu hỏi KHÁC ba cổng kia.** Nó hỏi *"cái test suy ra từ BẢN
   MÔ TẢ BUG có đỏ không"*. Mọi fixture ở đây đều là bug **đã được tìm ra và viết
   lại**, nên con số đó là **cận trên của B5 khi đã có ticket**, không phải tỉ lệ
   phát hiện bug chưa ai biết. Bug mà cổng đáng ra phải bắt *trước khi* có người báo
   thì đúng là loại `red-test` không nhìn thấy được — xem hai dòng `miss` trong lưới.
2. **FP của `guard` đo trên bộ probe cố tình dựng để ép precision**, không phải trên
   traffic thật. Precision thật cần gate log (`bin/gate-log`), không phải file này.
3. **Fixture là bug đã LỌT.** Chúng thoát khỏi cổng đang có tại thời điểm đó, nên
   `tsc`/`lint` ra 0% là kết quả *đúng như dự đoán*, không phải lỗi đo. Giá trị của
   `tsc` nằm ở cột **ratchet**, không ở cột detect.

---

## Fixture — nguồn và lớp lỗi

Ba nguồn, đều đọc-only. `source` trong `fixtures/ground-truth.json` ghi chính xác
commit / dòng debt / dòng pattern.

### Từ `git log` của chính repo này

| Fixture | Lớp lỗi | Nguồn |
|---|---|---|
| `hook-hardcoded-repo-path` | giả định môi trường biến cổng thành no-op câm | `717480d1` |
| `hook-lint-flag-version-drift` | tool-version drift; lỗi CLI-parse bị đọc là lint fail | `34753b89` |
| `hook-gate-without-config` | guard cắm trên một nhánh, quên nhánh sinh đôi | `a8ac4569` |
| `stage-whole-index` | scope drift; hard gate chỉ tồn tại dưới dạng prose | `21579879` + `ce54f1e9` (cùng hình dạng, hai skill) |
| `worklog-dedupe-key` | key normalization lệch giữa bên ghi và bên đọc | `5f26ea8c` |
| `symlink-script-path` | path resolve qua link thay vì qua đích của link | `81f407ed` |
| `sheet-tombstone-resurrection` | hai đường hiểu khác nhau về ý định của user | `9ecc7bcf` (sự cố 06/08) |
| `sheet-empty-row-footprint` | kiểm tra rỗng một phần bị coi là rỗng hoàn toàn | `c52959ff` (mất dữ liệu tab 08/2026) |
| `guard-denylist-variant` | denylist liệt kê, biến thể không được liệt kê | `pre-tool-use-guard.sh` + benchmark §3 |

### Từ `design-eye.md` §D1 (hai dòng có cột "Gặp" = 1)

| Fixture | Lớp lỗi | Nguồn |
|---|---|---|
| `scroll-pinned-control` | đúng ở đúng cái trạng thái mà người ta nhìn | §D1 pattern 21 |
| `cross-surface-token-drift` | N bản sao, một bản drift, QC chỉ báo một surface | §D1 pattern 22 |

### Từ `eivno/docs/DEBT.md` (chỉ đọc)

| Fixture | Lớp lỗi | Nguồn |
|---|---|---|
| `twin-mapper-drift` | hai bản của một mapping; field thêm vào cả hai query, map ở một | T-124 |
| `pagination-truncation` | biên trên page size + guard so tài liệu với chính nó | T-130 |
| `tautological-validation` | oracle lấy số đối chiếu từ chính thứ nó đang kiểm | T-147, T-148 |
| `ignored-input-field` | field đầu vào có thật, không ai đọc | T-81 |
| `silent-skip-without-env` | suite báo pass trong khi không chạy gì | luật oracle 2 §7.4, T-113 |
| `idempotency-key-race` | hai writer tranh một key, kẻ thua tiêu mất key | T-146 |
| `global-queue-drain` | drain state chung không scope theo run | T-120 |

### Thuần spec

| Fixture | Lớp lỗi | Nguồn |
|---|---|---|
| `scope-drift-extra-endpoint` | scope drift âm thầm, vô hình với test theo cấu tạo | plan §3.3 + workflow A8 |

---

## Cấu trúc một fixture

```
fixtures/<id>/
├── buggy/   index.ts | index.js | script.sh     code lúc còn bug
├── fixed/   ...                                 code sau khi sửa thật
├── ratchet/ ...                                 (tuỳ chọn) type đã siết áp lên call site cũ
├── probe.ts     red test — viết từ MÔ TẢ BUG, không từ root cause
└── witness.ts   (tuỳ chọn) assert targeted, chứng minh buggy ≠ fixed
```

**Luật viết probe:** probe viết được **chỉ từ trường `description`** trong ground
truth, đúng điều kiện B5 ngoài đời (có ticket, chưa có root cause). Probe được phép
**bỏ sót** — `cross-surface-token-drift` và `scope-drift-extra-endpoint` bỏ sót đúng
theo thiết kế, vì ngoài đời không có ticket nào mô tả chúng. Đó là kết quả, không
phải lỗi.

**Vì sao cần `witness.ts`:** probe bỏ sót thì làm sao biết fixture có hỏng thật hay
chỉ là code vô hại? `witness` là assert targeted (viết khi ĐÃ biết root cause), phải
**đỏ trên `buggy` và xanh trên `fixed`**. Runner từ chối báo số nếu có fixture nào
không qua được kiểm tra này. Fixture nào probe đã đỏ thì probe kiêm luôn witness.

---

## Cổng đo được gì, chạy bằng gì

| Cổng | Family | Chạy | Áp vào |
|---|---|---|---|
| `guard` | deterministic | `personal/hooks/pre-tool-use-guard.sh` với JSON qua stdin, exit 2 = chặn | fixture có `guard_input` |
| `lint` | deterministic | `npx --package eslint` + `lib/eslint.config.mjs` | fixture `.js` |
| `tsc` | deterministic | `npx --package typescript -- tsc --noEmit --strict` | fixture `.ts` |
| `red-test` | deterministic | `probe.ts` của fixture | tất cả |
| `spec-check` | llm | agent fresh nhận spec + code, chấm bằng `outcomeJudge` | tất cả, cần key |
| `reviewer` | llm | agent fresh chỉ nhận code, chấm bằng `outcomeJudge` | tất cả, cần key |

**`lib/eslint.config.mjs` là `eslint:recommended` chép nguyên văn từ `@eslint/js`
9.39.5**, đóng băng cố ý: config phải load được mà không resolve package nào (nó chạy
qua `npx`), và một cổng thay định nghĩa theo từng bản ESLint thì không baseline-diff
được. Cập nhật thì cập nhật có chủ đích và ghi vào baseline.

**`lint` là `n_a` trên fixture TypeScript** — ESLint core không parse được TS, và máy
này không resolve được `typescript-eslint` khi chạy qua `npx`. Joy/Wishlist có parser
đó trong config riêng, nên con số `lint` ở đây là **cận dưới** của cổng lint thật.

### Cổng nào cũng có canary

Ba cổng dùng tool ngoài đều chạy một **canary** trước khi tin kết quả:

- `guard` phải chặn `rm -rf /`
- `tsc` phải bắt `const x: number = 'string'` **và** truy được lỗi đó về đúng file
- `lint` phải bắt biến undefined + binding thừa **và** truy được về đúng file

Canary không nổ ⟹ cổng bị đánh dấu `error`, **không** phải "0 lần bắt". Đây đúng là
lớp lỗi `silent-skip-without-env` đang đo — một cổng gãy im lặng trả về "không có
finding" y hệt một cổng đang chạy tốt.

> Canary attribution không phải phòng xa: lần chạy đầu tiên **tsc báo path tương đối
> còn matcher so path tuyệt đối**, nên mọi lỗi tsc rơi vào hư không và cả 8 fixture
> đọc ra `missed`. Nếu không có canary thì "tsc bắt 0%" đã thành một con số bịa nằm
> trong doc này.

---

## Thêm fixture mới

Khi một bug mới dạy được điều gì:

1. `mkdir -p fixtures/<id>/{buggy,fixed}` — `<id>` là slug, trùng đúng `id` trong
   ground truth.
2. Viết `buggy/` và `fixed/`. **Nhỏ nhất tái hiện được lớp lỗi**, không phải chép
   nguyên module thật. Phải chạy được và hỏng thật.
3. Viết `probe.ts` **chỉ từ mô tả bug**. Nếu nó không đỏ trên `buggy` thì thêm
   `witness.ts` — runner sẽ bắt nếu thiếu.
4. Thêm một dòng vào `fixtures/ground-truth.json` với đủ `id · category · severity ·
   description · detection_hint` (format của `test/fixtures/qa-eval-ground-truth.json`)
   cộng `source · bug_class · lang · spec`. Tăng `total_bugs`.
   **`source` phải trỏ tới bug thật** — commit, dòng debt, dòng pattern. Không có
   nguồn thì không vào bộ này.
5. `guard_input` (tuỳ chọn) nếu bug có hình dạng một tool call, để cổng guard chấm được.
6. `ratchet/` (tuỳ chọn) nếu bản sửa thật có siết type — dán type mới lên call site
   cũ, oracle sẽ báo ratchet có cắn không.
7. `bun personal/oracle/run.ts` → sửa cho tới khi integrity 19/19 → `--write-baseline`.

Ngôn ngữ chọn theo **bug thật ở đâu**, đừng chọn theo cổng nào muốn bắt được. Chọn
ngược là tự dựng số.

---

## Baseline

`baseline.json` là lần chạy đã đóng băng. Mỗi lần chạy sau diff lại và báo:

- `REGRESSION` — cổng nào tụt detection, thêm false positive, thêm error, hoặc một ô
  từ `caught` rơi xuống khác `caught`
- `improved` — ngược lại
- `new fixture` / `DROPPED`

Đây là thứ trả lời câu hỏi mà cả P6 tồn tại vì nó: **oracle có đang tụt không.**
