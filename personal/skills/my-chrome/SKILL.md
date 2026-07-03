---
name: my-chrome
description: Drive the user's REAL logged-in Chrome (claude-in-chrome MCP) to test any web app — the default browser for every test/verify step (workflow.md A7/B8), works in every project (Joy/Loyalty, Wishlist, side projects). NOT the built-in /chrome command (that only connects/manages the extension) — this skill is the testing methodology on top of it. Real Chrome means Shopify Admin device-bound sessions and Cloudflare just work, no cookie import. Tab-group discipline built in - check the session's Claude tab group first (HAVE one → use it; NOT yet → create exactly once), navigate the same tab across URLs, never touch tabs outside the group, close opened tabs when done so no group litter remains. Knows Shopify surfaces (embedded admin = cross-origin iframe → coordinate clicks; storefront/theme editor → find/read_page refs) + safety rules (never trigger JS dialogs, prod stores non-destructive). Use when asked to "/my-chrome", "test trên browser", "test trên Chrome", "browser test", "mở browser", or whenever a verify step needs a real logged-in browser. Headless /browse is the fallback when the extension is unavailable.
type: workflow
---

# /my-chrome — test trên Chrome thật (claude-in-chrome)

> **Vai:** browser driver mặc định cho mọi bước test/verify cần browser (A7/B8 của
> `workflow.md`, QA, dogfood). Chrome thật của anh **đã login sẵn** (Shopify Admin
> device-bound + Cloudflare pass tự nhiên) → không cookie-import, không headless.
>
> **KHÔNG dùng cho:** bulk/headless check hàng loạt hoặc khi extension không chạy →
> fallback `/browse` (bậc thang login trong `workflow.md` § "Test trên browser").
>
> **Đừng nhầm với built-in `/chrome`** của Claude Code — lệnh đó chỉ bật/kết nối/
> reconnect extension. Extension chưa nối → bảo anh chạy `/chrome` (built-in) trước.

## 0. Load tools (1 lần / session)

Nếu tool `mcp__claude-in-chrome__*` đang deferred → load **1 lần bằng 1 call
ToolSearch duy nhất** (batch, không load lẻ từng tool):

```
ToolSearch "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__read_network_requests,mcp__claude-in-chrome__tabs_close_mcp"
```

(Cần form thì thêm `form_input`; cần quay GIF thì thêm `gif_creator` vào cùng call.)

## 1. Tab-group protocol — ĐIỀU KIỆN CỨNG, làm đúng thứ tự

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

## 2. Target URL — đọc config của project, đừng đoán

- **Shopify app** (Joy, Wishlist...): đọc `shopify.app.toml` / config đang active
  → `dev_store_url` (store), `name`/handle. URL map:
  - Admin embedded: `https://admin.shopify.com/store/{store}/apps/{app-handle}` (`/embed` cho embedded view)
  - Storefront: `https://{dev_store_url}` · Theme editor: `…/themes/current/editor?context=apps`
- **App khác**: dev URL/lệnh chạy theo `CLAUDE.md` của project (Project Adapter).
  Thiếu → hỏi rồi ghi vào CLAUDE.md của project đó — không hardcode ở đây.

## 3. Đọc trang theo surface (chọn đúng đồ, đỡ mò)

| Surface | Đọc/act bằng |
|---|---|
| Storefront / theme editor (KHÔNG iframe) | `find` (tìm element bằng NL) + `read_page` (a11y tree) → `computer` theo ref |
| **Embedded admin app** (cross-origin **iframe**) | `find`/`read_page` KHÔNG thấy controls của app → screenshot + `computer` theo **coordinate**, zoom khi control nhỏ |
| State/runtime | `javascript_tool` (console.log → đọc lại bằng `read_console_messages` với `pattern`) |
| API calls | `read_network_requests` |

## 4. Verify — bằng chứng, không phải "nhìn ổn"

- Screenshot → **Read ảnh** (chưa Read = chưa verify).
- `read_console_messages` với `pattern` filter — đừng đọc cả đống log.
- `read_network_requests` cho API; backend log theo adapter (Joy/Wishlist:
  `firebase-debug.log`, emulator UI).
- Chống băng-dán + blast radius: theo `/my-verify`; fix loop UI: theo `/my-frontend-fix`.

## 5. Safety

- **Không bao giờ trigger JS dialog** (alert/confirm/prompt) — đơ extension,
  mất điều khiển. Debug bằng console.log + `read_console_messages`.
- **Prod store** (đuôi `-prod` hoặc store thật): chỉ non-destructive — xem/verify;
  **confirm với anh trước mọi write/checkout/delete**. Order thật = tiền thật.
- Click fail 2-3 lần / trang treo → **dừng và báo**, đừng retry mù.

## Combine

- **Được gọi từ:** `/my-verify` (route UI) · `/my-frontend-fix` (bước 2 mở surface) · QA flows.
- **Project adapter:** Joy/Wishlist có `.claude/skills/shopify-testing` +
  `.claude/commands/browser-test.md` riêng — kịch bản đặc thù app defer xuống đó,
  nhưng **tab-group protocol (§1) luôn theo skill này**.
- **Fallback:** extension không khả dụng → `/browse` (headless); cần login trong
  headless → bậc thang trong `workflow.md`, `/qa-login` là nước cuối.
