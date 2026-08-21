---
name: my-verify
description: Generic "is the change REAL?" verification + blast-radius step, any layer (frontend, backend, data, logic, behavior). After a fix or build, prove it actually does what it should by observing real runtime evidence (not "looks ok"), enumerate every place the same root cause/change manifests and verify each, then check regressions. Routes to layer-specific tools - /my-frontend-fix for UI, Firebase emulator/Jest for backend & data, /verify or /qa for end-to-end behavior. Iron Law - close only on observed evidence + covered blast radius. Use as the Verify step (A7/B8) of the workflow.
type: workflow
---

# My Verify

> **Vai:** bước **Verify + blast radius** của workflow (A7 / B8), cho **mọi layer** — không chỉ frontend.
> Sau khi fix/build xong: chứng minh nó **thật sự đúng**, **không bỏ sót**, **không vỡ chỗ khác**.

> **Iron Law:** chỉ đóng khi **quan sát được bằng chứng "đổi đúng"** + **blast radius đã cover**.
> "Verify" = quan sát bằng chứng, KHÔNG phải "chắc là ổn". (Cùng triết lý prove của `/my-bug-hunter`.)

## 3 việc cố định (mọi layer)

**1. Confirm THẬT — chống băng-dán.**
Thay đổi có giải quyết đúng **root cause** (bug) / đúng **spec** (feature) không? Quan sát
**giá trị/hành vi runtime thật** — KHÔNG phải:
- hardcode / `!important` / đè giá trị cho qua mắt
- làm test xanh bằng cách sửa *test*, không sửa *nguồn*
- "nhìn màn hình thấy ổn" mà không chỉ được giá trị nào đổi

> Hỏi: *"mình chỉ ra được một giá trị runtime vừa đổi A→B đúng theo nguồn không?"* Không → chưa thật.

**2. Blast radius — không bỏ sót.**
Từ root cause / change, liệt kê **MỌI nơi nó biểu hiện** rồi verify từng cái:
- Mọi surface/layer dùng chung nguồn (UI · admin · backend · scripttag · fallback)
- Mọi variant (mobile/desktop · light/dark · loại view)
- Data / config / translation / cache liên quan

> Cùng 1 nguồn thường hiện ở nhiều mặt — fix 1 chỗ rồi đóng = round-2-fail.

**3. Regression — không vỡ chỗ khác.**
Chỗ liên quan (gần fix, dùng chung code) còn chạy đúng không?

## Route theo layer (đồ verify)

| Layer | Verify bằng | Bằng chứng |
|---|---|---|
| **UI / frontend** | `/my-frontend-fix` (loop fix→screenshot→so baseline; `__joyDebug`/Playwright) | screenshot + giá trị state |
| **Backend handler/service** | chạy **Firebase emulator** + đọc log stdout; hoặc **Jest** integration test | log / return value thật |
| **Data / record state** | đọc state thật — emulator UI / firebase console | giá trị field thật |
| **Logic / pure function** | **unit test** (Jest) chạy đỏ→xanh | assert pass |
| **Behavior / flow / E2E** | `/verify` (chạy app, quan sát) · `/qa` | hành vi quan sát được |

> App-specific: lấy đồ từ **Project Adapter** (Joy: `__joyDebug` + emulator UI `:4012`; Wishlist: Jest + emulator UI `:4000`).

> **Browser khi cần mở trang:** dùng **/my-chrome để route theo surface**. Storefront/
> theme editor/standalone Admin dùng `claude-in-chrome` trên Chrome thật. Chỉ với các
> surface này, **check group trước mỗi lần test:** `tabs_context_mcp` → **CÓ group thì DÙNG**
> (`navigate` tab sẵn có; `tabs_create_mcp` chỉ khi cần thêm tab — vẫn vào group đó);
> **CHƯA có thì tạo đúng 1 lần** rồi tái dùng suốt session. (Check chỉ thấy group của
> session hiện tại — session mới luôn phải tạo; giới hạn extension #69542.) **Xong việc →
> `tabs_close_mcp` đóng tab đã mở** để group tự biến mất. Không đụng tab ngoài group.
> Login Admin/store có sẵn chỉ giải quyết login. **Embedded Admin cross-origin iframe
> route thẳng `/browse`: `$B frame 'iframe[name="app-iframe"]'` → `$B snapshot -i` → act bằng
> `@ref` → `$B frame main`** (selector đã đo trên live Shopify; full `browse --cdp`
> path chưa verify end-to-end). Sau 2 lần không reach cùng control: STOP + báo user, không retry lần 3/không
> thử tool thứ ba. UI không drive được → verify staging Firestore/storefront và ghi rõ
> embedded UI chưa verify.

## Vòng lặp

```
1. Chọn layer → chạy đồ verify tương ứng
2. Quan sát bằng chứng "đổi đúng" chưa?
   - CHƯA → quay lại bước fix (B7/A6), KHÔNG băng-dán
   - RỒI  → bước 3
3. Blast radius: còn nơi nào cùng nguồn? → verify hết
4. Regression: chỗ liên quan có vỡ? → có thì quay lại fix
5. Sạch hết → Report
```

## Report (kèm bằng chứng)

```
## Verify Done
### Đổi đúng: [giá trị/hành vi runtime quan sát được — A→B]
### Blast radius: [x] [nơi 1] · [x] [nơi 2] ... (mọi nơi cùng nguồn)
### Regression: [x] [chỗ liên quan] — clean
### Layer/đồ đã dùng: [my-frontend-fix / emulator / Jest / verify ...]
```

## Gate

Chưa quan sát được "đổi đúng" **HOẶC** blast radius chưa cover → **chưa đóng**, chưa qua bước commit.

## Combine

- **Vào từ:** B7 / A6 (sau khi implement)
- **Route xuống:** `/my-frontend-fix` (UI) · emulator/Jest (backend/data) · `/verify`·`/qa` (E2E)
- **Ra:** B9 / A8 (review → commit → staging)
