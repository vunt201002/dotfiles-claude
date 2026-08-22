---
name: my-chrome
description: Route browser verification by SURFACE. Use claude-in-chrome on the user's REAL Chrome for storefront, theme editor, and standalone admin pages; its existing Shopify login/device-bound session can open Admin without cookie import, but it CANNOT drive controls inside a cross-origin embedded-admin iframe. For an embedded admin app, route to /browse and select the iframe element with `frame 'iframe[name="app-iframe"]'`; CDP attach and snapshot were measured on live Shopify, while iframe click/type remain unverified. Enforces tab-group discipline and a hard stop after 2 failed browser attempts. Use when asked "/my-chrome", "test trên browser", "test trên Chrome", "browser test", "mở browser", or whenever a verify step needs a browser.
type: workflow
---

# /my-chrome — route browser theo surface

> **Vai:** router theo **surface** cho mọi bước test/verify cần browser (A7/B8 của
> `workflow.md`, QA, dogfood). Chrome thật của anh **đã login sẵn** nên mở được
> Shopify Admin mà không cookie-import. Điều đó chỉ giải quyết **LOGIN**, không có
> nghĩa `claude-in-chrome` drive được UI nằm trong cross-origin iframe.
>
> **KHÔNG dùng `claude-in-chrome` cho:** embedded admin app trong cross-origin
> iframe. Surface đó route thẳng sang `/browse` + `frame`; đừng thử coordinate click.
>
> **Đừng nhầm với built-in `/chrome`** của Claude Code — lệnh đó chỉ bật/kết nối/
> reconnect extension. Extension chưa nối → bảo anh chạy `/chrome` (built-in) trước.

## 0. Route theo SURFACE — chọn trước khi mở tool

| Surface | Tool | Command / cách act |
|---|---|---|
| Storefront | `claude-in-chrome` trên Chrome thật | `find` + `read_page` → `computer` theo ref |
| Theme editor (phần ngoài iframe) | `claude-in-chrome` trên Chrome thật | `find` + `read_page` → `computer` theo ref |
| Standalone Admin page (không phải app embed) | `claude-in-chrome` trên Chrome thật | `find` + `read_page` → `computer` theo ref; login sẵn chỉ có nghĩa là mở được trang |
| **Embedded Admin app trong cross-origin iframe** | **`/browse`** | **`$B goto <admin-app-url>` → `$B frame 'iframe[name="app-iframe"]'` → `$B snapshot -i` → act bằng `@ref`; xong chạy `$B frame main`** |

Trong frame, dùng `snapshot`/`text`/`click`/`fill` như bình thường; output snapshot có
header `[Context: iframe src="..."]`. Source hỗ trợ `$B frame <css-selector-or-@ref>`
và `$B frame --url <literal-pattern>`. Không dùng `$B frame --name app-iframe` cho
Shopify embedded Admin: lệnh đó đọc frame name, trong khi surface đã đo chỉ expose
`name="app-iframe"` trên iframe element.

**Trạng thái xác minh:** trên live Shopify với Chrome đã login, `browse --cdp` đã attach
thành công, `frame 'iframe[name="app-iframe"]'` đã resolve được frame, và `snapshot -i`
đã thấy 14 control của app kèm `@ref`. **Chưa chạy, cần human confirm 1 lần:** click một
control non-destructive bên trong iframe → `frame main` quay lại được Admin shell.

State/runtime ngoài iframe: `javascript_tool` + `read_console_messages` có `pattern`.
API calls ngoài iframe: `read_network_requests`.

### HARD STOP — 2 ATTEMPTS MAX

> **Sau 2 lần không reach/act được cùng một control bằng browser tool đã chọn: DỪNG
> NGAY và báo anh. Không retry lần 3, không nhảy sang browser tool thứ ba, không đổi
> sang coordinate-click để cố xuyên iframe.**

Report surface, tool + command đã dùng, hai kết quả fail, và bằng chứng còn thiếu.
Chỉ đổi tool trước khi thử khi routing table trên chỉ ra tool hiện tại sai surface.

### Dead ends đã chốt — không rediscover

- **Cross-origin embedded iframe qua `claude-in-chrome` `find`/`read_page`: không
  work. Không retry. Settled.** Hai tool chỉ thấy Admin shell, không thấy controls app.
- **Screenshot + `computer` theo coordinate để drive embedded iframe:** dead end,
  không phải fallback. Screenshot chỉ dùng làm bằng chứng hình ảnh.
- **Chrome DevTools MCP `--autoConnect` chọn Chrome bằng deviceId:** **UNVERIFIED**;
  không route test vào đây và không trình bày như solution.
- **Playwright MCP:** chỉ được biết là configured trong workspace `wishlist-3`;
  workspace khác không được giả định có tool này.

## 1. Load tools (1 lần / session, chỉ khi route chọn `claude-in-chrome`)

Nếu tool `mcp__claude-in-chrome__*` đang deferred → load **1 lần bằng 1 call
ToolSearch duy nhất** (batch, không load lẻ từng tool):

```
ToolSearch "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__read_network_requests,mcp__claude-in-chrome__tabs_close_mcp"
```

(Cần form thì thêm `form_input`; cần quay GIF thì thêm `gif_creator` vào cùng call.)

## 2. Tab-group protocol — chỉ cho route `claude-in-chrome`

1. **Check trước:** `tabs_context_mcp` (không tham số).
2. **CÓ group** (kèm tab) → **DÙNG nó**: `navigate` tab sẵn có theo tabId.
   Chỉ `tabs_create_mcp` khi thật sự cần thêm tab chạy song song — tab mới
   vẫn rơi vào đúng group đó.
3. **CHƯA có group** → tạo đúng **1 lần** (`tabs_create_mcp`). Mọi lần test sau
   trong session: quay lại bước 1 → check-thấy-và-tái-dùng, **không tạo lần hai**.
4. **Nhiều URL → 1 tab:** `navigate` tuần tự trên cùng tab, đừng mỗi URL một tab.
5. **Không đụng tab ngoài group** — đó là tab làm việc của anh (`navigate` cũng
   không nhận tabId ngoài group).
6. **XONG VIỆC → DỌN:** `tabs_close_mcp` đóng các tab đã mở → group của session
   tự biến mất. Không để group rác.

> Giới hạn extension (đã verify + issue anthropics/claude-code#69542): group gắn
> theo TỪNG session — session mới luôn "chưa có" nên tạo 1 group mới; không nhận
> lại group cũ hay group tạo tay. Vì vậy bước 6 là bắt buộc, không phải lịch sự.

## 3. Target URL — đọc config của project, đừng đoán

- **Shopify app** (Joy, Wishlist...): đọc `shopify.app.toml` / config đang active
  → `dev_store_url` (store), `name`/handle. URL map:
  - Admin embedded: `https://admin.shopify.com/store/{store}/apps/{app-handle}` (`/embed` cho embedded view)
  - Storefront: `https://{dev_store_url}` · Theme editor: `…/themes/current/editor?context=apps`
- **App khác**: dev URL/lệnh chạy theo `CLAUDE.md` của project (Project Adapter).
  Thiếu → hỏi rồi ghi vào CLAUDE.md của project đó — không hardcode ở đây.

## 4. Verify — bằng chứng, không phải "nhìn ổn"

- Screenshot → **Read ảnh** (chưa Read = chưa verify).
- `read_console_messages` với `pattern` filter — đừng đọc cả đống log.
- `read_network_requests` cho API; backend log theo adapter (Joy/Wishlist:
  `firebase-debug.log`, emulator UI).
- Chống băng-dán + blast radius: theo `/my-verify`; fix loop UI: theo `/my-frontend-fix`.
- Nếu UI không drive được sau hard stop: verify qua **data thay vì UI** — đọc staging
  Firestore bằng adapter của project, hoặc kiểm trực tiếp output trên storefront.
  Ghi rõ đây là data/storefront verification, không claim đã verify embedded UI.

## 5. Safety

- **Không bao giờ trigger JS dialog** (alert/confirm/prompt) — đơ extension,
  mất điều khiển. Debug bằng console.log + `read_console_messages`.
- **Prod store** (đuôi `-prod` hoặc store thật): chỉ non-destructive — xem/verify;
  **confirm với anh trước mọi write/checkout/delete**. Order thật = tiền thật.
- Click/reach fail → áp dụng **HARD STOP 2 attempts** ở §0.

## Combine

- **Được gọi từ:** `/my-verify` (route UI) · `/my-frontend-fix` (bước 2 mở surface) · QA flows.
- **Project adapter:** Joy/Wishlist có `.claude/skills/shopify-testing` +
  `.claude/commands/browser-test.md` riêng — kịch bản đặc thù app defer xuống đó,
  nhưng **tab-group protocol (§2) chỉ áp dụng khi row chọn `claude-in-chrome`**.
- **Fallback theo surface, không theo thói quen:** embedded Admin → `/browse frame`;
  surface khác mà extension không khả dụng → `/browse`. Cần login trong headless →
  `/qa-login` là nước cuối; Shopify Admin vẫn có thể chặn vì device-bound/SSO.
